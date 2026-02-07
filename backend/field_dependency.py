# backend/field_dependency.py
from __future__ import annotations

import json
import re
import time
from typing import Any, Dict, List, Optional, Tuple
from collections import defaultdict, deque

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field as PydField
from groq import Groq

from config import get_settings

router = APIRouter(prefix="/field-dependency", tags=["field-dependency"])

# -------------------------
# Models
# -------------------------

class Field(BaseModel):
    name: str
    description: Optional[str] = None

class InferReq(BaseModel):
    fields: List[Field] = PydField(default_factory=list)
    sample_rows: List[Dict[str, Any]] = PydField(default_factory=list)
    dataset_description: Optional[str] = None
    mode: Optional[str] = "llm"            # "llm" | "heuristic" (heuristic discouraged)
    max_parents_per_field: Optional[int] = None
    enforce_acyclic: bool = True

class InferResp(BaseModel):
    fields: List[str]
    parents: Dict[str, List[str]]
    rationale: Dict[str, str]
    confidence: Dict[str, float] = PydField(default_factory=dict)  # "child<-parent": 0..1
    matrix: List[List[int]]
    dag_valid: bool
    topo_order: Optional[List[str]]
    global_reasoning: str
    notes: List[str] = PydField(default_factory=list)

# -------------------------
# Utils
# -------------------------

def _safe_json_loads(s: str) -> Dict[str, Any]:
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

def _matrix(fields: List[str], parents: Dict[str, List[str]]) -> List[List[int]]:
    idx = {f: i for i, f in enumerate(fields)}
    m = [[0 for _ in fields] for _ in fields]
    for child, ps in parents.items():
        for p in ps or []:
            if child in idx and p in idx and child != p:
                m[idx[child]][idx[p]] = 1
    return m

def _toposort(fields: List[str], parents: Dict[str, List[str]]) -> Tuple[bool, Optional[List[str]]]:
    indeg = {f: 0 for f in fields}
    kids = defaultdict(set)
    for c in fields:
        for p in parents.get(c, []) or []:
            if p == c: continue
            indeg[c] += 1
            kids[p].add(c)
    q = deque([f for f in fields if indeg[f] == 0])
    order: List[str] = []
    while q:
        n = q.popleft()
        order.append(n)
        for v in list(kids[n]):
            indeg[v] -= 1
            if indeg[v] == 0:
                q.append(v)
    if len(order) != len(fields):
        return False, None
    return True, order

def _edges_from_parents(fields: List[str], parents: Dict[str, List[str]]):
    out = []
    for child, ps in parents.items():
        for p in ps or []:
            if p != child:
                out.append((child, p))
    return out

def _prune_cycles_low_conf(fields: List[str], parents: Dict[str, List[str]], edge_conf: Dict[str, float]):
    while True:
        dag_ok, _ = _toposort(fields, parents)
        if dag_ok:
            return parents
        all_edges = _edges_from_parents(fields, parents)
        if not all_edges:
            return parents
        def score(e):
            return edge_conf.get(f"{e[0]}<-{e[1]}", 0.5)
        for (child, par) in sorted(all_edges, key=score):
            parents[child] = [p for p in parents.get(child, []) if p != par]
            if _toposort(fields, parents)[0]:
                break
        else:
            # remove the lowest confidence edge anyway
            child, par = sorted(all_edges, key=score)[0]
            parents[child] = [p for p in parents.get(child, []) if p != par]

def _coerce_items_to_graph(names: List[str], items: List[Dict[str, Any]], max_parents: Optional[int]):
    name_set = set(names)
    parents: Dict[str, List[str]] = {n: [] for n in names}
    rationale: Dict[str, str] = {}
    conf: Dict[str, float] = {}

    for it in items or []:
        nm = it.get("name")
        if nm not in name_set:
            continue
        ps = [p for p in (it.get("parents") or []) if p in name_set and p != nm]
        if max_parents is not None and max_parents >= 0:
            ps = ps[:max_parents]
        parents[nm] = ps
        rationale[nm] = (it.get("rationale") or "").strip()

        item_c = it.get("confidence")
        if isinstance(item_c, (int, float)):
            for p in ps:
                conf[f"{nm}<-{p}"] = float(item_c)

        for e in it.get("edge_confidence") or it.get("edges") or []:
            if isinstance(e, dict):
                p = e.get("parent")
                c = e.get("confidence")
                if p in ps and isinstance(c, (int, float)):
                    conf[f"{nm}<-{p}"] = float(c)
    return parents, rationale, conf

def _groq_json(client: Groq, **kwargs) -> Optional[dict]:
    """
    Groq wrapper with retries/backoff and error-body logging.
    """
    retries = kwargs.pop("retries", 2)
    backoff_base = kwargs.pop("backoff_base", 0.6)
    for attempt in range(retries + 1):
        try:
            comp = client.chat.completions.create(**kwargs)
            return _safe_json_loads(comp.choices[0].message.content or "")
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

# -------------------------
# LLM Inference
# -------------------------

def _infer_with_llm(fields: List[Field], sample_rows: List[Dict[str, Any]], dataset_description: Optional[str], model: str) -> Optional[Dict[str, Any]]:
    client = Groq(api_key=get_settings().groq_api_key)

    schema_text = "\n".join(f"- {f.name}: {f.description or 'n/a'}" for f in fields)
    # CAP rows to avoid oversize (the usual cause of 400)
    sample_json = json.dumps(sample_rows[:30], ensure_ascii=False)
    ds_desc = (dataset_description or "").strip()

    system = (
        "You are a data modeling expert.\n"
        "Infer minimal, domain-aware dependencies (parents) for a SINGLE flat table.\n"
        "- IDs/UUIDs must be independent.\n"
        "- A field may depend on MULTIPLE parents (0..N) if needed.\n"
        "- Avoid cycles; if unavoidable, set lower confidence on weaker edges.\n"
        "- Use ONLY provided field names."
    )
    user = f"""
Dataset description:
{ds_desc or "(none)"}

Schema (name: description):
{schema_text}

Sample rows (optional):
{sample_json}

Return ONLY JSON:
{{
  "global_reasoning": "string",
  "items": [
    {{
      "name": "field_name",
      "parents": ["parent1","parent2", ...],
      "rationale": "why these parents",
      "edge_confidence": [{{"parent":"parent1","confidence":0.85}}]
    }}
  ]
}}
""".strip()

    return _groq_json(
        client,
        model=model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=0.2,
        response_format={"type": "json_object"},
        retries=2,
        backoff_base=0.6,
    )

# -------------------------
# Endpoint
# -------------------------

@router.post("/infer", response_model=InferResp)
async def infer(req: InferReq, request: Request):
    if not req.fields:
        raise HTTPException(status_code=400, detail="fields cannot be empty")

    settings = get_settings()
    names = [f.name for f in req.fields]
    parents: Dict[str, List[str]] = {n: [] for n in names}
    rationale: Dict[str, str] = {n: "" for n in names}
    edge_conf: Dict[str, float] = {}
    global_reasoning = ""
    notes: List[str] = []

    if (req.mode or "llm").lower() != "llm":
        notes.append("Heuristic disabled; returning independent fields.")
        global_reasoning = "Heuristic disabled."
        mat = _matrix(names, parents)
        dag_ok, order = _toposort(names, parents)
        return InferResp(
            fields=names, parents=parents, rationale=rationale, confidence=edge_conf,
            matrix=mat, dag_valid=dag_ok, topo_order=order if dag_ok else None,
            global_reasoning=global_reasoning, notes=notes
        )

    model = getattr(settings, "groq_dependency_model", None) or "groq/compound"
    raw = _infer_with_llm(req.fields, req.sample_rows, req.dataset_description, model)

    if raw and isinstance(raw, dict):
        items = raw.get("items") or []
        parents, rationale, edge_conf = _coerce_items_to_graph(
            names, items, req.max_parents_per_field
        )
        global_reasoning = str(raw.get("global_reasoning") or "LLM inference (multi-parent)")
        if req.enforce_acyclic:
            parents = _prune_cycles_low_conf(names, parents, edge_conf)
    else:
        notes.append("LLM failed or returned empty JSON; fields left independent (AI-only policy).")
        global_reasoning = "No edges inferred due to LLM failure."

    mat = _matrix(names, parents)
    dag_ok, order = _toposort(names, parents)

    return InferResp(
        fields=names,
        parents=parents,
        rationale=rationale,
        confidence=edge_conf,
        matrix=mat,
        dag_valid=dag_ok,
        topo_order=order if dag_ok else None,
        global_reasoning=global_reasoning,
        notes=notes,
    )