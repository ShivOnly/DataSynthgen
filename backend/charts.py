# backend/charts.py
import json
from typing import Any, Dict, List, Optional, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from config import get_settings, Settings
from groq import Groq

router = APIRouter()

# ---------- Pydantic models (only for charts) ----------

class ChartSuggestionRequest(BaseModel):
    description: str
    country: str
    rows: List[Dict[str, Any]]  # generated dataset rows

class ChartConfig(BaseModel):
    chart_type: Literal["bar", "line", "area", "pie", "scatter", "radar", "composed"]
    x: Optional[str] = None
    y: List[str] = []
    group_by: Optional[str] = None
    aggregation: Optional[Literal["sum", "avg", "count"]] = None
    reasoning: str
    explanation: str

class FieldStub(BaseModel):  # <-- NEW: field blueprint
    name: str
    description: Optional[str] = ""

class ChartSuggestionResponse(BaseModel):
    suggestions: List[ChartConfig]
    global_reasoning: str
    table_suggestions: List[str]  # 3 actions for the table panel (frontend shows 3)
    # NEW: schema blueprints per suggestion text
    table_suggestion_schemas: Dict[str, List[FieldStub]] = {}

# ---------- Helpers (infer types, profile, etc.) ----------

ALLOWED_TYPES = {"bar", "line", "area", "pie", "scatter", "radar", "composed"}
TYPE_SYNONYMS = {
    "bar_chart": "bar",
    "column": "bar",
    "stacked_bar": "bar",
    "grouped_bar": "bar",
    "line_chart": "line",
    "area_chart": "area",
    "donut": "pie",
    "donut_chart": "pie",
    "pie_chart": "pie",
    "scatterplot": "scatter",
    "scatter_plot": "scatter",
    "radar_chart": "radar",
    "mixed": "composed",
    "combo": "composed",
    "composite": "composed",
}

def _infer_type(value: Any) -> str:
    if value is None:
        return "null"
    try:
        float(str(value).replace(",", ""))
        return "numeric"
    except Exception:
        pass
    s = str(value).strip().lower()
    date_hints = ["-", "/", ":", "t", "z", " am", " pm"]
    if any(h in s for h in date_hints):
        return "datetime_or_text"
    if len(s) < 64 and " " not in s:
        return "categorical_or_text"
    return "text"

def _profile(rows: List[Dict[str, Any]], max_rows: int = 200) -> Dict[str, Any]:
    sample = rows[:max_rows]
    cols: Dict[str, Dict[str, Any]] = {}
    for r in sample:
        for k, v in r.items():
            if k not in cols:
                cols[k] = {"values": [], "nulls": 0}
            if v in (None, ""):
                cols[k]["nulls"] += 1
            cols[k]["values"].append(v)

    summary = []
    for k, info in cols.items():
        values = info["values"]
        first_non_null = next((v for v in values if v not in (None, "")), None)
        inferred = _infer_type(first_non_null)
        uniques = len(set(map(lambda x: str(x), filter(lambda x: x not in (None, ""), values))))
        summary.append({
            "name": k,
            "inferred_type": inferred,
            "non_null_count": len(values) - info["nulls"],
            "null_count": info["nulls"],
            "unique_values": uniques,
            "sample_values": list(map(lambda x: str(x), values[:5])),
        })
    return {"row_count": len(rows), "columns": summary}

def _normalize_chart_type(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    key = raw.strip().lower()
    if key in ALLOWED_TYPES:
        return key
    if key in TYPE_SYNONYMS:
        return TYPE_SYNONYMS[key]
    key2 = key.replace(" ", "_")
    if key2 in TYPE_SYNONYMS:
        return TYPE_SYNONYMS[key2]
    return None

def _numeric_cols(profile: Dict[str, Any]) -> List[str]:
    cols = profile.get("columns", [])
    return [c["name"] for c in cols if c.get("inferred_type") == "numeric"]

def _all_cols(profile: Dict[str, Any]) -> List[str]:
    return [c["name"] for c in profile.get("columns", [])]

# ---------- Domain-aware table suggestions ----------

def _domain_table_suggestions(description: str, profile: Dict[str, Any]) -> List[str]:
    d = (description or "").lower()

    # Oncology / cancer patients
    if any(k in d for k in ["cancer", "oncology", "tumor", "chemotherapy", "radiation"]):
        return [
            "Show patients who died due to cancer",
            "List medicines related to cancer with usage or last prescribed date",
            "Summarize hospitals/clinics and total cancer-related expenses",
            "Show health insurance coverage and claims for cancer treatments",
        ]

    # E‑commerce / orders
    if any(k in d for k in ["ecommerce", "e-commerce", "orders", "retail", "shopping", "cart", "order dataset"]):
        return [
            "Top products by revenue and quantity",
            "Customers with highest lifetime value and order count",
            "Orders with refunds or chargebacks in the last 30 days",
        ]

    # Banking / transactions
    if any(k in d for k in ["bank", "transaction", "ledger", "card", "payment", "finance"]):
        return [
            "High-value transactions and their merchants",
            "Recurring payments by category and monthly totals",
            "Suspicious transactions flagged by amount spikes or unusual merchants",
        ]

    # Students / education
    if any(k in d for k in ["student", "school", "exam", "grade", "university", "education"]):
        return [
            "Top-performing students by subject and class",
            "Students at risk (low average score or steep declines)",
            "Attendance vs performance by class or subject",
        ]

    # Hospitals / general healthcare
    if any(k in d for k in ["hospital", "clinic", "icu", "admissions", "discharge"]):
        return [
            "Admissions by department and average length of stay",
            "Readmission cases within 30 days",
            "Top procedures by cost and volume",
        ]

    # HR / employees
    if any(k in d for k in ["employee", "payroll", "hr", "hiring", "attrition"]):
        return [
            "Attrition over time by department and tenure",
            "Top performers by rating and compensation bands",
            "Open roles vs hiring pipeline stage counts",
        ]

    # Logistics / supply chain
    if any(k in d for k in ["shipment", "logistics", "inventory", "warehouse", "supply", "delivery"]):
        return [
            "Late deliveries by route and carrier",
            "Stockouts and low-inventory SKUs by warehouse",
            "Average fulfillment time by product and region",
        ]

    # Generic fallback (if no domain match)
    cols_all = _all_cols(profile)
    nums = _numeric_cols(profile)
    first_col = cols_all[0] if cols_all else "(first column)"
    first_num = nums[0] if nums else "(value)"
    return [
        f"Top {first_col} by {first_num}",
        f"Filter out rows where {first_num} = 0",
        f"Group by {first_col} and sum {first_num}",
    ]

# ---------- NEW: Schema blueprints per suggestion ----------

def _schema_for_suggestion(description: str, suggestion: str, profile: Dict[str, Any]) -> List[Dict[str, str]]:
    d = (description or "").lower()
    s = (suggestion or "").lower()

    def pack(names: List[str]) -> List[Dict[str, str]]:
        return [{"name": n, "description": n.replace("_", " ").title()} for n in names]

    # ---- Cancer domain presets ----
    if "patients who died" in s and "cancer" in s:
        return pack([
            "patient_id", "patient_name", "sex", "age_at_death",
            "cancer_type", "stage", "date_of_diagnosis",
            "date_of_death", "cause_of_death",
            "treatment_regimen", "last_hospital", "city"
        ])

    if "medicines related to cancer" in s:
        return pack([
            "rx_id", "patient_id", "medicine_name", "drug_class",
            "indication", "regimen_name", "dosage", "route",
            "last_prescribed_date", "prescribing_physician"
        ])

    if "hospitals/clinics" in s or "hospitals" in s:
        return pack([
            "patient_id", "hospital_id", "hospital_name", "city", "state",
            "visit_date", "procedure", "expense_amount",
            "insurance_coverage_amount", "out_of_pocket_amount"
        ])

    if "health insurance coverage" in s or "claims for cancer" in s:
        return pack([
            "patient_id", "insurer", "plan_name", "plan_type",
            "coverage_limit", "claim_id", "claim_date",
            "claim_amount", "approved_amount", "status",
            "deductible", "copay"
        ])

    # ---- E‑commerce ----
    if "top products" in s:
        return pack([
            "product_id", "product_name", "category",
            "qty_sold", "revenue", "avg_price"
        ])
    if "customers with highest lifetime value" in s:
        return pack([
            "customer_id", "customer_name", "orders_count",
            "ltv_amount", "avg_order_value", "last_order_date"
        ])
    if "refunds or chargebacks" in s:
        return pack([
            "order_id", "customer_id", "refund_date",
            "refund_amount", "reason", "payment_method"
        ])

    # ---- Banking ----
    if "high-value transactions" in s:
        return pack([
            "txn_id", "account_id", "txn_date", "amount",
            "merchant", "category", "channel"
        ])
    if "recurring payments" in s:
        return pack([
            "subscription_id", "account_id", "merchant",
            "category", "billing_cycle", "last_payment_date", "amount"
        ])
    if "suspicious transactions" in s:
        return pack([
            "txn_id", "account_id", "txn_date", "amount",
            "merchant", "risk_score", "flag_reason"
        ])

    # ---- Students ----
    if "top-performing students" in s:
        return pack([
            "student_id", "student_name", "class",
            "subject", "avg_score", "exam_count"
        ])
    if "students at risk" in s:
        return pack([
            "student_id", "student_name", "class",
            "avg_score", "trend_30d", "absences_30d"
        ])
    if "attendance vs performance" in s:
        return pack([
            "student_id", "student_name", "class",
            "attendance_rate", "avg_score", "term"
        ])

    # ---- Generic fallback: take a categorical and a numeric if present ----
    cols_all = _all_cols(profile)
    nums = _numeric_cols(profile)
    first_col = cols_all[0] if cols_all else "entity"
    first_num = nums[0] if nums else "value"
    return pack(["id", first_col, "category", first_num, "created_at"])

def _default_chart_suggestions(profile: Dict[str, Any]) -> List[Dict[str, Any]]:
    cols_all = _all_cols(profile)
    nums = _numeric_cols(profile)
    out: List[Dict[str, Any]] = []
    if cols_all:
        if nums:
            out.append({
                "chart_type": "bar",
                "x": cols_all[0],
                "y": [nums[0]],
                "group_by": None,
                "aggregation": "sum",
                "reasoning": "Fallback bar chart using the first categorical column vs first numeric.",
                "explanation": "Shows aggregated totals by the first column.",
            })
        if len(nums) >= 2:
            out.append({
                "chart_type": "scatter",
                "x": None,
                "y": [nums[0], nums[1]],
                "group_by": None,
                "aggregation": None,
                "reasoning": "Fallback scatter with the first two numeric columns.",
                "explanation": "Reveals the relationship between two measures.",
            })
    return out[:2]

# ---------- Sanitization ----------

def _sanitize(parsed: Dict[str, Any], profile: Dict[str, Any], description: str) -> ChartSuggestionResponse:
    suggestions = parsed.get("suggestions") or []
    global_reasoning = parsed.get("global_reasoning") or ""
    # we deliberately ignore LLM's table_suggestions and use domain-aware set
    cols_all = set(_all_cols(profile))
    cols_num = set(_numeric_cols(profile))

    cleaned: List[Dict[str, Any]] = []
    for s in suggestions[:6]:
        ct = _normalize_chart_type(s.get("chart_type"))
        if not ct:
            continue

        x = s.get("x")
        y = s.get("y") or []
        group_by = s.get("group_by")
        agg = s.get("aggregation")
        reasoning = s.get("reasoning") or ""
        explanation = s.get("explanation") or ""

        x = x if (x in cols_all) else None
        group_by = group_by if (group_by in cols_all) else None
        y = [yy for yy in y if yy in cols_all]

        if ct in {"bar", "line", "area", "composed", "scatter", "radar"} and not y:
            if cols_num:
                y = [next(iter(cols_num))]
            else:
                y = ["value"]
                agg = agg or "count"

        if ct == "scatter" and len(y) < 2:
            if len(cols_num) >= 2:
                nums = list(cols_num)[:2]
                y = [nums[0], nums[1]]
            else:
                continue

        cleaned.append({
            "chart_type": ct,
            "x": x,
            "y": y,
            "group_by": group_by,
            "aggregation": agg if agg in (None, "sum", "avg", "count") else None,
            "reasoning": reasoning,
            "explanation": explanation,
        })

    cleaned = cleaned[:4]

    # Domain-aware table suggestions (3)
    table_suggestions = _domain_table_suggestions(description, profile)[:3]

    # Build schema blueprint per suggestion
    table_suggestion_schemas: Dict[str, List[FieldStub]] = {}
    for s in table_suggestions:
        fields = _schema_for_suggestion(description, s, profile)
        table_suggestion_schemas[s] = [FieldStub(**f) for f in fields]

    if not cleaned:
        for c in _default_chart_suggestions(profile):
            cleaned.append(c)

    return ChartSuggestionResponse(
        suggestions=[ChartConfig(**c) for c in cleaned],
        global_reasoning=str(global_reasoning or "Chart ideas based on dataset profile."),
        table_suggestions=table_suggestions,
        table_suggestion_schemas=table_suggestion_schemas,
    )

# ---------- Endpoint ----------

@router.post("/suggest-charts", response_model=ChartSuggestionResponse)
async def suggest_charts(req: ChartSuggestionRequest, settings: Settings = Depends(get_settings)):
    if not req.rows:
        raise HTTPException(status_code=400, detail="rows cannot be empty")

    client = Groq(api_key=settings.groq_api_key)
    profile = _profile(req.rows)

    system_msg = (
        "You are a data visualization assistant. "
        "Given a dataset profile and a goal, suggest up to 4 charts and 3 actionable table suggestions. "
        "Prefer categorical/time on X and numeric on Y. Use aggregation when grouping categories. "
        "Explain why each chart fits and the insights it reveals."
    )
    user_msg = (
        f"always be in english\n"
        f"Dataset goal: {req.description}\n"
        f"Locale: {req.country}\n"
        f"Dataset profile (JSON): {json.dumps(profile, ensure_ascii=False)}\n\n"
        "Return JSON with keys:\n"
        "  suggestions: [\n"
        "    { chart_type: 'bar'|'line'|'area'|'pie'|'scatter'|'radar'|'composed',\n"
        "      x: string|null, y: string[], group_by: string|null,\n"
        "      aggregation: 'sum'|'avg'|'count'|null, reasoning: string, explanation: string }\n"
        "  ],\n"
        "  global_reasoning: string\n"
    )

    try:
        completion = client.chat.completions.create(
            model=settings.model_name,
            messages=[
                {"role": "system", "content": system_msg},
                {"role": "user", "content": user_msg},
            ],
            response_format={"type": "json_object"},
        )
        raw = json.loads(completion.choices[0].message.content)
        return _sanitize(raw, profile, req.description)

    except Exception:
        # Fallback: domain table suggestions + simple chart fallbacks
        table_suggestions = _domain_table_suggestions(req.description, profile)[:3]
        table_suggestion_schemas: Dict[str, List[FieldStub]] = {
            s: [FieldStub(**f) for f in _schema_for_suggestion(req.description, s, profile)]
            for s in table_suggestions
        }
        return ChartSuggestionResponse(
            suggestions=[ChartConfig(**c) for c in _default_chart_suggestions(profile)],
            global_reasoning="Heuristic chart/table suggestions (LLM failed).",
            table_suggestions=table_suggestions,
            table_suggestion_schemas=table_suggestion_schemas,
        )