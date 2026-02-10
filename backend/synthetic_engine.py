# backend/synthetic_engine.py
from __future__ import annotations

import json
import random
import unicodedata
from typing import Any, Dict, List, Optional

from groq import Groq
from config import get_settings
from generate_from_web import generate_rows_via_wiki_refine


# ------------------ Helpers ------------------

def _ascii(s: Any) -> Any:
    if not isinstance(s, str):
        return s
    norm = unicodedata.normalize("NFKD", s)
    return " ".join(norm.encode("ascii", "ignore").decode("ascii").split())


def _is_numeric_field(name: str) -> bool:
    n = (name or "").lower()
    hints = [
        "pop", "population", "gdp", "area", "km", "kg", "radius", "mass",
        "size", "height", "weight", "length", "amount", "price", "score",
        "count", "number", "qty", "lat", "lon", "longitude", "latitude",
        "age", "year", "duration", "period", "index", "rank"
    ]
    return any(h in n for h in hints)


def _looks_like_id(name: str) -> bool:
    n = (name or "").lower()
    return ("id" in n) or ("uuid" in n) or n.endswith("_id")


SYNONYMS: Dict[str, List[str]] = {
    "countryname": ["country", "country_name"],
    "capitalcity": ["capital", "capital_city", "capitalname"],
    "currency": ["curr", "money", "fiat"],
    "population": ["pop", "people"],
    "lang": ["language", "languages"],
}

def _lookup_with_synonyms(candidate: Dict[str, Any], target_name: str) -> Optional[Any]:
    if not isinstance(candidate, dict):
        return None
    if target_name in candidate:
        return candidate[target_name]
    lowmap = {k.lower().replace(" ", ""): k for k in candidate.keys()}
    tn = target_name.lower().replace(" ", "")
    if tn in lowmap:
        return candidate[lowmap[tn]]
    for alt in SYNONYMS.get(tn, []):
        if alt in lowmap:
            return candidate[lowmap[alt]]
    return None


def _groq_chat_json(
    client: Groq, *, model: str, system: Optional[str], user: str,
    temperature: float = 0.6, retries: int = 2, backoff_base: float = 0.6
) -> Optional[dict]:
    """
    Safe JSON chat with retries/backoff and error-body logging.
    Returns parsed dict or None.
    """
    import time
    import re

    def _safe_load(s: str) -> dict:
        try:
            return json.loads(s)
        except Exception:
            pass
        s2 = (s or "").strip()
        s2 = re.sub(r"^```(?:json)?", "", s2, flags=re.I).strip()
        s2 = re.sub(r"```$", "", s2).strip()
        import re as _re
        m = _re.search(r"\{.*\}", s2, flags=_re.S)
        if m:
            try:
                return json.loads(m.group(0))
            except Exception:
                return {}
        return {}

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
            txt = comp.choices[0].message.content or ""
            return _safe_load(txt)
        except Exception as e:
            # Log error body (httpx) if available
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


def _fallback_row(required: List[str], i: int) -> Dict[str, Any]:
    """
    Very small procedural fallback row if LLM fails: ensures all keys exist.
    """
    row: Dict[str, Any] = {}
    for name in required:
        if _looks_like_id(name):
            row[name] = str(100000 + ((i * 7919) % 900000))
        elif _is_numeric_field(name):
            row[name] = (i * 13) % 97
        else:
            row[name] = f"Item {i+1}"
        row[name] = _ascii(row[name])
    return row


# ------------------ Main entry ------------------

def generate_dataset(
    *,
    generator: str,                       # "ai" | "web"
    fields: List[Dict[str, Any]],         # [{ name, description }]
    count: int,
    description: str,
    locale: str,
    api_key: Optional[str],
    model: Optional[str],
    relations: Optional[Dict[str, Dict[str, List[str]]]] = None,  # dependencies for AI mode
) -> Any:
    """
    Returns: {"rows": [ {...}, ... ]}
    Behavior:
      - If generator == "web": LLM refines a Wikipedia query, fetch summaries,
        then LLM arranges rows from those summaries (strict schema). If web fails,
        fall back to AI.
      - If generator == "ai": synthesize rows via LLM; inject dependency guidance when provided.
    """

    requested_fields: List[str] = [str(f.get("name", "")).strip() for f in fields if str(f.get("name", "")).strip()]
    if not requested_fields:
        return {"rows": []}

    # ---------------- Web mode ----------------
    if generator == "web":
        settings = get_settings()
        ua = getattr(
            settings,
            "wikipedia_user_agent",
            "DataSynthWebGen/1.0 (https://example.com; mailto:contact@example.com)",
        )

        rows_web = generate_rows_via_wiki_refine(
            fields=[{"name": f.get("name",""), "description": f.get("description","")} for f in fields],
            count=count,
            description=description,
            locale=locale,
            user_agent=ua,
            groq_api_key=api_key,
            model=model,
        )

        if rows_web:
            final_rows = []
            for r in rows_web[:count]:
                # Enforce requested schema keys and ASCII normalize
                row = {}
                for k in requested_fields:
                    v = r.get(k, "")
                    row[k] = _ascii(v if v is not None else "")
                final_rows.append(row)
            return {"rows": final_rows}
        # else: fall through to AI fallback

    # ---------------- AI mode (or web fallback) ----------------
    if not api_key or not model:
        return {"rows": []}

    fields_json = json.dumps(requested_fields, ensure_ascii=False)
    sys = "You are a disciplined data synthesizer that outputs only JSON."

    example_keys = (
        f'"{requested_fields[0]}": "..."'
        + (f', "{requested_fields[-1]}": "..."' if len(requested_fields) > 1 else "")
    )

    user = f"""
Dataset Subject: {description} (Locale: {locale})
Generate exactly {count} rows.

Use these exact column keys (case and spelling must match):
{fields_json}

Rules:
- Output ONLY a JSON object with a top-level "rows" array.
- Each row MUST contain ALL the keys listed above exactly as provided.
- Language: English.
- Keep realistic variability; avoid obvious duplicates.
Return format example:
{{ "rows": [ {{ {example_keys} }} ] }}
""".strip()

    # Inject dependency guidance (prompt-only) if provided
    parents_map = (relations or {}).get("parents", {})
    if parents_map:
        deps_text = json.dumps(parents_map, ensure_ascii=False)
        user += f"""

Dependency graph (child -> parents):
{deps_text}

Sampling guidance:
- Generate parent fields first.
- For each child, pick values consistent with its parents (e.g., derived ranges, categories).
- If a parent implies constraints (e.g., distance_from_sun far -> habitability = 'low'), reflect it.
"""

    client = Groq(api_key=api_key)
    parsed = _groq_chat_json(client, model=model or "qwen/qwen3-32b", system=sys, user=user, temperature=0.6, retries=2)
    ai_rows = []
    if isinstance(parsed, dict):
        rows_val = parsed.get("rows")
        if isinstance(rows_val, list):
            ai_rows = rows_val

    final_rows: List[Dict[str, Any]] = []
    required = requested_fields

    for i in range(count):
        if ai_rows:
            candidate = ai_rows[i] if i < len(ai_rows) else ai_rows[i % len(ai_rows)]
            cand = candidate if isinstance(candidate, dict) else {}
        else:
            cand = {}

        row: Dict[str, Any] = {}
        for name in required:
            v = _lookup_with_synonyms(cand, name)
            if v in (None, ""):
                if not ai_rows:
                    v = _fallback_row(required, i).get(name)
                else:
                    if _looks_like_id(name):
                        v = str(100000 + ((i * 7919) % 900000))
                    elif _is_numeric_field(name):
                        v = (i * 13) % 97
                    else:
                        v = f"Item {i+1}"
            row[name] = _ascii(v)

        final_rows.append(row)

    return {"rows": final_rows}