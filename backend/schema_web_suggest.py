# backend/schema_web_suggest.py
import re
import html
import time
from typing import List, Dict, Tuple, Optional
import httpx

# --- Wikipedia endpoints ---
WIKI_API = "https://en.wikipedia.org/w/api.php"               # Legacy Action API
WIKI_REST_SEARCH = "https://en.wikipedia.org/w/rest.php/v1/search/title"
WIKI_REST_PAGE = "https://en.wikipedia.org/w/rest.php/v1/page/"  # + {encoded_title}

# IMPORTANT: Provide a descriptive User-Agent per Wikipedia API etiquette.
# Replace the email/URL with your contact or repository URL.
DEFAULT_UA = "DataSynthSchemaBot/1.0 (https://example.com/contact; mailto:dev@example.com)"

# --- Utilities ---

def _strip_tags(s: str) -> str:
    """Remove HTML tags and unescape entities."""
    s = re.sub(r"<[^>]+>", "", s)
    return html.unescape(s).strip()

def _normalize_field_name(s: str) -> str:
    """
    Normalize a label into a nice column name:
    - remove parentheses content
    - keep alphanumerics and spaces
    - convert to lower_snake_case
    """
    s = re.sub(r"\(.*?\)", "", s)         # remove parentheses
    s = re.sub(r"[^A-Za-z0-9 ]+", "", s)  # keep alphanumerics/spaces
    s = s.strip().lower()
    s = re.sub(r"\s+", "_", s)
    return s or "field"

def _unique_preserve_order(seq: List[str]) -> List[str]:
    seen = set()
    out = []
    for x in seq:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out

def _httpx_client(user_agent: Optional[str] = None) -> httpx.Client:
    headers = {
        "User-Agent": user_agent or DEFAULT_UA,
        "Accept": "application/json; charset=utf-8",
    }
    return httpx.Client(headers=headers, timeout=10.0, follow_redirects=True)

def _request_with_retry(
    client: httpx.Client,
    method: str,
    url: str,
    *,
    params: Optional[Dict] = None,
    max_retries: int = 3,
    backoff_base: float = 0.6
) -> httpx.Response:
    """
    Basic retry for 403/429/5xx. Wikipedia may throttle or block if UA missing/too fast.
    """
    attempt = 0
    while True:
        try:
            resp = client.request(method, url, params=params)
            # Retry on common transient statuses
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

# --- Wikipedia (legacy) Action API helpers ---

def _wiki_search_top_title_legacy(query: str, client: httpx.Client) -> Tuple[str, int]:
    """
    Return (best_title, total_hits). Empty title if nothing found. Uses legacy Action API.
    """
    params = {
        "action": "query",
        "list": "search",
        "srsearch": query,
        "format": "json",
        "srlimit": 1,
        "utf8": 1,
    }
    r = _request_with_retry(client, "GET", WIKI_API, params=params)
    data = r.json()
    hits = data.get("query", {}).get("search", [])
    if not hits:
        return "", 0
    return hits[0]["title"], data.get("query", {}).get("searchinfo", {}).get("totalhits", 0)

def _wiki_page_extract_legacy(title: str, client: httpx.Client) -> str:
    """
    Get plain-text extract/summary for context via legacy API.
    """
    params = {
        "action": "query",
        "prop": "extracts",
        "explaintext": 1,
        "titles": title,
        "format": "json",
        "utf8": 1,
    }
    r = _request_with_retry(client, "GET", WIKI_API, params=params)
    data = r.json()
    pages = data.get("query", {}).get("pages", {})
    for _, page in pages.items():
        if "extract" in page and page["extract"]:
            return page["extract"][:800]
    return ""

def _wiki_page_html_legacy(title: str, client: httpx.Client) -> str:
    """
    Get rendered HTML for the page; used to parse infobox via legacy API.
    """
    params = {
        "action": "parse",
        "page": title,
        "prop": "text",
        "formatversion": 2,
        "format": "json",
        "utf8": 1,
    }
    r = _request_with_retry(client, "GET", WIKI_API, params=params)
    data = r.json()
    return data.get("parse", {}).get("text", "") or ""

# --- Wikimedia REST API helpers (fallback path) ---

def _wiki_rest_search_title(query: str, client: httpx.Client) -> Tuple[str, int]:
    """
    REST: returns (top_title, total_estimate). If none, returns ("", 0).
    """
    params = {"q": query, "limit": 1}
    r = _request_with_retry(client, "GET", WIKI_REST_SEARCH, params=params)
    data = r.json()
    pages = data.get("pages", [])
    if not pages:
        return "", 0
    top = pages[0]
    title = top.get("title") or ""
    total = data.get("pages", []) and len(data.get("pages", [])) or 0
    return title, total

def _wiki_rest_page_html(title: str, client: httpx.Client) -> str:
    """
    REST: fetch the HTML for a page title.
    """
    from urllib.parse import quote
    url = WIKI_REST_PAGE + quote(title, safe="")
    r = _request_with_retry(client, "GET", url + "/with_html")
    data = r.json()
    return data.get("html", "") or ""

def _wiki_rest_page_summary(title: str, client: httpx.Client) -> str:
    from urllib.parse import quote
    url = WIKI_REST_PAGE + quote(title, safe="")
    r = _request_with_retry(client, "GET", url)
    data = r.json()
    extract = data.get("extract") or data.get("description") or ""
    return str(extract)[:800]

# --- Infobox parsing ---

def _extract_infobox_labels(html_text: str) -> List[str]:
    """
    Extract <th> labels from the infobox table in HTML (legacy or REST HTML).
    """
    m = re.search(
        r'<table[^>]*class="[^"]*infobox[^"]*"[^>]*>(.*?)</table>',
        html_text,
        re.DOTALL | re.IGNORECASE,
    )
    if not m:
        return []

    table_html = m.group(1)
    labels = re.findall(r"<th[^>]*>(.*?)</th>", table_html, re.DOTALL | re.IGNORECASE)
    labels = [_strip_tags(x) for x in labels]
    labels = [x for x in labels if x and len(x) <= 40 and not x.lower().startswith("part of")]
    return _unique_preserve_order(labels)

# --- Heuristic fallback templates ---

def _fallback_templates(description: str) -> List[Tuple[str, str]]:
    d = description.lower()

    def pack(names: List[str], descs: List[str]) -> List[Tuple[str, str]]:
        return list(zip(names, descs))

    if any(k in d for k in ["ecommerce", "e-commerce", "order", "retail", "shop", "cart"]):
        return pack(
            ["order_id", "order_date", "customer_id", "product_id", "quantity", "unit_price", "order_total"],
            [
                "Unique order identifier",
                "Date of the order",
                "Reference to the customer",
                "Reference to the product",
                "Units ordered",
                "Price per unit",
                "Computed total for the order",
            ],
        )

    if any(k in d for k in ["student", "education", "exam", "grades", "school", "university"]):
        return pack(
            ["student_id", "name", "class", "subject", "score", "exam_date"],
            [
                "Unique student identifier",
                "Student full name",
                "Class/grade level",
                "Subject name",
                "Marks/score obtained",
                "Date of examination",
            ],
        )

    if any(k in d for k in ["transactions", "bank", "finance", "ledger", "payment"]):
        return pack(
            ["txn_id", "account_id", "txn_date", "amount", "merchant", "category", "status"],
            [
                "Unique transaction identifier",
                "Linked account identifier",
                "Date of transaction",
                "Signed transaction amount",
                "Merchant/payee",
                "Spending category",
                "Cleared/pending status",
            ],
        )

    if any(k in d for k in ["weather", "climate", "temperature"]):
        return pack(
            ["date", "location", "temperature_c", "humidity_pct", "precip_mm", "wind_kph", "condition"],
            [
                "Calendar date",
                "Station/city",
                "Air temperature (°C)",
                "Relative humidity (%)",
                "Precipitation (mm)",
                "Wind speed (kph)",
                "Textual weather condition",
            ],
        )

    return pack(
        ["id", "name", "category", "description", "created_at", "value"],
        [
            "Unique identifier",
            "Entity name",
            "High-level grouping",
            "Short description",
            "Creation timestamp",
            "Primary numeric or textual value",
        ],
    )

# --- Public API ---

def suggest_schema_from_web(description: str, max_fields: int = 6, user_agent: Optional[str] = None) -> Dict:
    """
    Suggest a schema using Wikipedia/Web only (no LLM).
    Returns dict with 'fields' and 'global_reasoning'.
    """
    query = (description or "").strip()
    if not query:
        pairs = _fallback_templates("generic")[:max_fields]
        return {
            "fields": [{"name": n, "description": d, "useAI": True} for n, d in pairs],
            "global_reasoning": "No description provided; used generic template.",
        }

    # Use a persistent client with compliant UA
    with _httpx_client(user_agent) as client:
        # 1) Try legacy Action API first (usually best for infobox)
        title = ""
        hits = 0
        extract = ""
        html_text = ""

        try:
            title, hits = _wiki_search_top_title_legacy(query, client)
            if title:
                html_text = _wiki_page_html_legacy(title, client)
                extract = _wiki_page_extract_legacy(title, client)
        except Exception:
            # 2) Fallback to REST search
            try:
                title, hits = _wiki_rest_search_title(query, client)
                if title:
                    html_text = _wiki_rest_page_html(title, client)
                    extract = _wiki_rest_page_summary(title, client)
            except Exception:
                title, hits = "", 0

        if not title:
            # Heuristic fallback if no page found
            pairs = _fallback_templates(description)[:max_fields]
            return {
                "fields": [{"name": n, "description": d, "useAI": True} for n, d in pairs],
                "global_reasoning": f"No Wikipedia hits for “{query}”. Used heuristic template.",
            }

        labels = _extract_infobox_labels(html_text)

        if not labels:
            pairs = _fallback_templates(description)[:max_fields]
            reasoning = (
                f"Wikipedia page found: “{title}”, but no infobox attributes detected. "
                f"Falling back to heuristic template based on your description."
            )
            return {
                "fields": [{"name": n, "description": d, "useAI": True} for n, d in pairs],
                "global_reasoning": reasoning,
            }

        # Build fields from labels
        norm_names = [_normalize_field_name(x) for x in labels]
        if "id" not in norm_names:
            norm_names.insert(0, "id")
            labels.insert(0, "Identifier")

        fields: List[Dict] = []
        for nm, raw in zip(norm_names, labels):
            if len(fields) >= max_fields:
                break
            fields.append({
                "name": nm,
                "description": f"{raw} (extracted from Wikipedia infobox of “{title}”)",
                "useAI": True
            })

        reasoning = (
            f"Searched Wikipedia for “{query}” → top page “{title}” (approx hits: {hits}). "
            f"Extracted {len(fields)} field(s) from the page's infobox. "
            f"{'Summary: ' + extract if extract else ''}"
        )

        return {"fields": fields, "global_reasoning": reasoning}