# backend/generate_from_web.py
from __future__ import annotations

import json
import re
import time
from typing import Optional, List, Dict, Any

import httpx
from groq import Groq

# Wikimedia REST endpoints (public, no auth required)
# See: https://www.mediawiki.org/wiki/API:REST_API/Reference
WIKI_REST_SEARCH = "https://en.wikipedia.org/w/rest.php/v1/search/title"  # ?q=&limit=
WIKI_REST_PAGE   = "https://en.wikipedia.org/w/rest.php/v1/page/"         # + {title}
DEFAULT_UA = "DataSynthWebGen/1.0 (https://example.com; mailto:contact@example.com)"


# ---------------- HTTP ----------------

def _httpx_client(user_agent: Optional[str] = None) -> httpx.Client:
    headers = {
        "User-Agent": user_agent or DEFAULT_UA,
        "Accept": "application/json; charset=utf-8",
    }
    return httpx.Client(headers=headers, timeout=15.0, follow_redirects=True)


def _request_with_retry(
    client: httpx.Client,
    method: str,
    url: str,
    *,
    params: Optional[dict] = None,
    max_retries: int = 3,
    backoff_base: float = 0.6,
) -> httpx.Response:
    attempt = 0
    while True:
        try:
            resp = client.request(method, url, params=params)
            if resp.status_code in (403, 429) or 500 <= resp.status_code < 600:
                if attempt < max_retries:
                    time.sleep(backoff_base * (2 ** attempt))
                    attempt += 1
                    continue
            resp.raise_for_status()
            return resp
        except httpx.HTTPStatusError as e:
            if attempt < max_retries and e.response is not None and (
                e.response.status_code in (403, 429) or 500 <= e.response.status_code < 600
            ):
                time.sleep(backoff_base * (2 ** attempt))
                attempt += 1
                continue
            raise


# ---------------- Locale → Topic ----------------

def _locale_to_topic(locale: str) -> str:
    """
    Map locale codes like 'hi_IN' or 'en-US' to a country/topic name
    that works better as a Wikipedia search fallback.
    """
    m = (locale or "").lower().replace("-", "_").strip()
    return {
        "hi_in": "India",
        "en_us": "United States",
        "en_gb": "United Kingdom",
        "ja_jp": "Japan",
        "zh_cn": "China",
        "fr_fr": "France",
        "de_de": "Germany",
    }.get(m, "")


# ---------------- Wikimedia REST helpers ----------------

def _wiki_rest_search_titles(query: str, client: httpx.Client, limit: int) -> List[str]:
    """
    Return up to 'limit' titles that begin with 'query'.
    """
    if not query or not query.strip():
        return []
    params = {"q": query.strip(), "limit": min(max(limit, 1), 100)}
    r = _request_with_retry(client, "GET", WIKI_REST_SEARCH, params=params)
    data = r.json() or {}
    pages = data.get("pages") or []
    titles = [p.get("title") for p in pages if isinstance(p, dict) and p.get("title")]
    return titles


def _wiki_rest_page_summary(title: str, client: httpx.Client) -> str:
    """
    Fetch a short JSON summary: page extract/description.
    """
    if not title:
        return ""
    from urllib.parse import quote
    url = WIKI_REST_PAGE + quote(title, safe="")
    r = _request_with_retry(client, "GET", url)
    data = r.json() or {}
    extract = data.get("extract") or data.get("description") or ""
    return str(extract)[:2000]


def _collect_wiki_context_for_query(
    query: str,
    limit: int,
    user_agent: str,
) -> List[Dict[str, str]]:
    """
    Given a search query, return a list of {title, summary}.
    """
    with _httpx_client(user_agent) as client:
        titles = _wiki_rest_search_titles(query, client, limit)
        contexts: List[Dict[str, str]] = []
        for t in titles[:limit]:
            s = _wiki_rest_page_summary(t, client)
            if s:
                contexts.append({"title": t, "summary": s[:1200]})
        return contexts


# ---------------- Groq wrappers ----------------

def _safe_json(s: str) -> Dict[str, Any]:
    try:
        return json.loads(s)
    except Exception:
        pass
    s2 = (s or "").strip()
    s2 = re.sub(r"^```(?:json)?", "", s2, flags=re.I).strip()
    s2 = re.sub(r"```$", "", s2).strip()
    m = re.search(r"\{.*\}", s2, flags=re.S)
    if m:
        try:
            return json.loads(m.group(0))
        except Exception:
            return {}
    return {}


def _groq_chat_text(
    client: Groq,
    *,
    model: str,
    system: Optional[str],
    user: str,
    temperature: float = 0.2,
    retries: int = 2,
    backoff_base: float = 0.6,
) -> Optional[str]:
    for attempt in range(retries + 1):
        try:
            comp = client.chat.completions.create(
                model=model,
                messages=(
                    [{"role": "system", "content": system}] if system else []
                ) + [{"role": "user", "content": user}],
                temperature=temperature,
            )
            return (comp.choices[0].message.content or "").strip()
        except Exception as e:
            resp = getattr(e, "response", None)
            if resp is not None:
                try:
                    print("[Groq error body]", resp.text)
                except Exception:
                    pass
            if attempt < retries:
                time.sleep(backoff_base * (2 ** attempt))
                continue
            return None


def _groq_chat_json(
    client: Groq,
    *,
    model: str,
    system: Optional[str],
    user: str,
    temperature: float = 0.2,
    retries: int = 2,
    backoff_base: float = 0.6,
) -> Dict[str, Any]:
    for attempt in range(retries + 1):
        try:
            comp = client.chat.completions.create(
                model=model,
                messages=(
                    [{"role": "system", "content": system}] if system else []
                ) + [{"role": "user", "content": user}],
                temperature=temperature,
                response_format={"type": "json_object"},
            )
            return _safe_json(comp.choices[0].message.content or "")
        except Exception as e:
            resp = getattr(e, "response", None)
            if resp is not None:
                try:
                    print("[Groq error body]", resp.text)
                except Exception:
                    pass
            if attempt < retries:
                time.sleep(backoff_base * (2 ** attempt))
                continue
            return {}


# ---------------- LLM steps for WEB mode ----------------

def refine_search_query_with_llm(
    client: Groq,
    model: str,
    dataset_name: str,
    fields: List[Dict[str, str]],
    locale: str,
) -> str:
    """
    Ask LLM to produce a single best Wikipedia search query for the dataset,
    given dataset name/goal + field schema + demographic/locale.
    """
    schema_lines = "\n".join(
        f"- {f.get('name')}: {f.get('description','')}" for f in (fields or [])
    )
    system = "You write concise search queries for Wikipedia. Return ONLY JSON."
    user = f"""
Dataset: {dataset_name}
Locale/demographic hint: {locale}

Fields:
{schema_lines}

Return JSON: {{"query": "string"}}
Rules:
- The query should retrieve pages of the target entities for our dataset.
- Avoid overly generic terms; prefer category/list-like or entity set phrasings (e.g., "States of India", "Premier League clubs").
"""
    out = _groq_chat_json(client, model=model, system=system, user=user, temperature=0.1)
    q = (out.get("query") or "").strip()
    return q


def llm_rows_from_wiki_summaries(
    client: Groq,
    model: str,
    fields: List[Dict[str, str]],
    wiki_contexts: List[Dict[str, str]],  # [{title, summary}]
    count: int,
    dataset_name: str,
    locale: str,
) -> List[Dict[str, Any]]:
    """
    Provide {title, summary} contexts to the LLM and ask it to
    produce rows adhering to the requested field schema.
    """
    field_names = [f.get("name") for f in fields if f.get("name")]
    schema_json = json.dumps(field_names, ensure_ascii=False)

    # Trim contexts to avoid huge prompts
    contexts = wiki_contexts[:count]
    context_text = "\n\n".join(
        f"### {c['title']}\n{c['summary']}" for c in contexts
    )[:13000]

    system = "You are a disciplined data synthesizer; return ONLY JSON."
    user = f"""
We are building a dataset: {dataset_name} (Locale: {locale}).

Columns (use EXACT keys, do not invent new ones):
{schema_json}

Wikipedia contexts:
{context_text}

Task:
- Generate up to {count} rows.
- Each row MUST contain ALL the keys listed above exactly as provided (case/spelling).
- Base values on the contexts above whenever possible; if unclear, infer conservatively.
- Language: English.
Return JSON: {{"rows": [{{...}}, ...]}}
"""
    out = _groq_chat_json(client, model=model, system=system, user=user, temperature=0.2)
    rows = out.get("rows") or []
    return rows if isinstance(rows, list) else []


# ---------------- Public entry for WEB generator ----------------

def generate_rows_via_wiki_refine(
    *,
    fields: List[Dict[str, str]],
    count: int,
    description: str,
    locale: str,
    user_agent: str,
    groq_api_key: Optional[str],
    model: Optional[str],
) -> List[Dict[str, Any]]:
    """
    Pipeline:
      1) LLM produces refined search query from (dataset name/description + fields + locale)
      2) Wikimedia REST search -> get top titles and summaries
      3) LLM arranges rows from those summaries using the requested field schema
    Returns rows (list of dicts) or [] on failure.
    """
    if not groq_api_key or not model:
        return []

    client = Groq(api_key=groq_api_key)

    # Step 1: refine query
    refined = refine_search_query_with_llm(
        client=client, model=model,
        dataset_name=description, fields=fields, locale=locale
    ) or ""

    # If LLM couldn't refine, try a locale-to-topic hint
    if not refined.strip():
        refined = description.strip() or _locale_to_topic(locale) or locale

    # Step 2: fetch wiki contexts; if empty, try locale/topic fallbacks
    contexts = _collect_wiki_context_for_query(refined, count, user_agent)
    if not contexts:
        topic_hint = _locale_to_topic(locale)
        if topic_hint:
            contexts = _collect_wiki_context_for_query(topic_hint, count, user_agent)
    if not contexts and locale:
        contexts = _collect_wiki_context_for_query(locale, count, user_agent)

    if not contexts:
        return []

    # Step 3: compose rows from summaries
    rows = llm_rows_from_wiki_summaries(
        client=client, model=model,
        fields=fields,
        wiki_contexts=contexts,
        count=count,
        dataset_name=description,
        locale=locale,
    )
    return rows