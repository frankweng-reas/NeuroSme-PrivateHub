"""
Intent JSON v4.0 — 重新設計的嚴格 Pydantic schema。

主要設計原則（相較 v3.2）：
- 移除 dims.time_filter：時間過濾統一在 metrics.filters，無繼承、無雙層鏡像。
- 移除 metrics.window，改為 metrics.group_override：
    None  → 使用 dims.groups 所有維度（正常分組聚合）
    []    → 全局 scalar，不分組，CROSS JOIN 合併（佔比分母）
    [col] → 按指定子集維度分組（父維度小計），LEFT JOIN 合併
- calculate 模式下頂層 filters 強制為空 []；
  filters 僅在 list 模式（明細查詢）使用。
- 每個 atomic metric 完全自持（self-contained）：過濾條件只在 metrics.filters。
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

USER_FACING_INTENT_V4_VALIDATION_MESSAGE = (
    "這個問題目前無法自動解析，可能原因：條件描述較複雜、缺少明確的時間範圍，或同時指定多個篩選條件。"
    "建議：**寫清楚時間段**（如 2025 年 3 月）、**指定想看的指標**（如銷售額、訂單數），或將複合條件拆成分步提問。"
)

_USER_FACING_INTENT_V4_VALIDATION_MESSAGE_INTERNAL = (
    "Intent v4.0 結構無法解析，請對照 docs/intent_v4_protocol.md："
    "calculate 模式 metrics 至少一筆且頂層 filters 必須為 []；"
    "list 模式須含 select[]；"
    "group_override 若有值，必須為 dims.groups 的子集。"
)

_ALLOWED_OPS = frozenset(
    {
        "eq", "ne", "gt", "gte", "lt", "lte",
        "between", "in", "contains", "is_null", "is_not_null",
    }
)


def _norm_op(op: str) -> str:
    s = (op or "").strip().lower().replace(" ", "")
    aliases = {
        "=": "eq", "==": "eq", "!=": "ne", "<>": "ne",
        ">": "gt", ">=": "gte", "<": "lt", "<=": "lte",
    }
    return aliases.get(s, s)


class FilterClauseV4(BaseModel):
    model_config = ConfigDict(extra="forbid")

    col: str = Field(min_length=1)
    op: str
    val: Any | None = None

    @field_validator("col")
    @classmethod
    def _strip_col(cls, v: str) -> str:
        return str(v).strip()

    @field_validator("op")
    @classmethod
    def _norm_op_v(cls, v: str) -> str:
        n = _norm_op(str(v))
        if n not in _ALLOWED_OPS:
            raise ValueError(f"不支援的 op: {v!r}")
        return n

    @model_validator(mode="after")
    def _val_presence(self) -> FilterClauseV4:
        if self.op in ("is_null", "is_not_null"):
            return self
        if self.op == "between":
            if not isinstance(self.val, (list, tuple)) or len(self.val) != 2:
                raise ValueError("between 須有 val: [lo, hi]")
            return self
        if self.op == "in":
            if not isinstance(self.val, (list, tuple)) or not self.val:
                raise ValueError("in 須有非空 val 陣列")
            return self
        if self.op == "contains":
            if not isinstance(self.val, str) or not str(self.val).strip():
                raise ValueError("contains 須有非空字串 val")
            return self
        if self.val is None:
            raise ValueError(f"op={self.op} 必須有 val")
        return self


class DimsV4(BaseModel):
    model_config = ConfigDict(extra="forbid")

    groups: list[str] = Field(default_factory=list)

    @field_validator("groups", mode="before")
    @classmethod
    def _groups(cls, v: Any) -> list[str]:
        if v is None:
            return []
        if not isinstance(v, list):
            raise ValueError("dims.groups 須為陣列")
        return [str(x).strip() for x in v if str(x).strip()]


import re as _re

_ATOMIC_FORMULA_RE = _re.compile(
    r"^\s*[A-Za-z_][A-Za-z0-9_]*\s*\(\s*col_[a-zA-Z0-9_]+\s*\)\s*$"
)
# COUNT(DISTINCT col_x) 額外支援
_COUNT_DISTINCT_FORMULA_RE = _re.compile(
    r"^\s*COUNT\s*\(\s*DISTINCT\s+(col_[a-zA-Z0-9_]+)\s*\)\s*$",
    _re.IGNORECASE,
)
_RAW_AGG_IN_FORMULA_RE = _re.compile(
    r"\b(SUM|COUNT|AVG|MIN|MAX)\s*\(", _re.IGNORECASE
)
_METRIC_REF_RE = _re.compile(r"\bm\d+\b", _re.IGNORECASE)


class MetricV4(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    alias: str = Field(min_length=1, pattern=r"^[a-zA-Z_][a-zA-Z0-9_]*$")
    # label：給使用者看的顯示名稱（中文），不影響 SQL；省略時 fallback 到 alias
    label: str | None = None
    formula: str = Field(min_length=1)
    filters: list[FilterClauseV4] = Field(default_factory=list)
    # group_override 語義：
    #   None（省略）→ 使用 dims.groups 所有維度（正常分組）
    #   []           → 全局 scalar，不分組（用於佔比分母等）
    #   ["col_x"]    → 僅按指定子集分組（父維度小計）；需為 dims.groups 的子集
    group_override: list[str] | None = None

    @field_validator("id", "formula")
    @classmethod
    def _strip_ids(cls, v: str) -> str:
        return str(v).strip()

    @field_validator("formula")
    @classmethod
    def _validate_formula(cls, v: str) -> str:
        s = v.strip()
        # Atomic：SUM(col_x) 格式 → 合法
        if _ATOMIC_FORMULA_RE.match(s):
            return s
        # COUNT(DISTINCT col_x) → 合法
        if _COUNT_DISTINCT_FORMULA_RE.match(s):
            return s
        # Derived：含 m1/m2 引用 → 合法；但不能同時含原始聚合函數
        has_metric_ref = bool(_METRIC_REF_RE.search(s))
        has_raw_agg = bool(_RAW_AGG_IN_FORMULA_RE.search(s))
        if has_metric_ref and has_raw_agg:
            raise ValueError(
                f"formula 不合法：衍生指標 formula 只能引用 metric ID（m1, m2…），"
                f"不能同時包含聚合函數（SUM/COUNT 等）。"
                f"請將複雜公式拆解：先各自定義 atomic metric，再用衍生 metric 做四則運算。"
                f"例：m1=SUM(col_11), m2=SUM(col_12), m3=(m1-m2)/m1。原始 formula: {s!r}"
            )
        if not has_metric_ref and has_raw_agg and not _ATOMIC_FORMULA_RE.match(s):
            raise ValueError(
                f"formula 不合法：atomic metric 只能是單一聚合單一欄位（如 SUM(col_11)）"
                f"或 COUNT(DISTINCT col_x)。"
                f"若需複合計算，請拆成多個 atomic metric 再用衍生 metric 組合。原始 formula: {s!r}"
            )
        return s

    @field_validator("group_override", mode="before")
    @classmethod
    def _norm_go(cls, v: Any) -> list[str] | None:
        if v is None:
            return None
        if not isinstance(v, list):
            raise ValueError("group_override 須為陣列或 null")
        return [str(x).strip() for x in v if str(x).strip()]


class PostSortV4(BaseModel):
    model_config = ConfigDict(extra="forbid")

    col: str = Field(min_length=1)
    order: Literal["asc", "desc"] = "desc"

    @field_validator("col")
    @classmethod
    def _strip_c(cls, v: str) -> str:
        return str(v).strip()

    @field_validator("order", mode="before")
    @classmethod
    def _ord(cls, v: Any) -> str:
        s = str(v or "desc").strip().lower()
        return "desc" if s == "desc" else "asc"


class PostProcessV4(BaseModel):
    model_config = ConfigDict(extra="forbid")

    where: FilterClauseV4 | None = None
    sort: list[PostSortV4] = Field(default_factory=list)
    limit: int | None = Field(default=None, ge=1)


class IntentV4(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    version: str | int | float
    mode: Literal["calculate", "list"] = "calculate"
    dims: DimsV4
    filters: list[FilterClauseV4] = Field(default_factory=list)
    metrics: list[MetricV4] = Field(default_factory=list)
    select: list[str] = Field(default_factory=list)
    post_process: PostProcessV4 | None = None

    @field_validator("version", mode="before")
    @classmethod
    def _ver(cls, v: Any) -> str:
        if isinstance(v, bool):
            raise ValueError("version 不可為布林")
        if isinstance(v, float):
            return format(v, "g") if v != int(v) else str(int(v))
        if isinstance(v, int):
            return str(v)
        s = str(v).strip()
        if s.lower().startswith("v"):
            s = s[1:].strip()
        return s

    @field_validator("select", mode="before")
    @classmethod
    def _sel(cls, v: Any) -> list[str]:
        if v is None:
            return []
        if not isinstance(v, list):
            raise ValueError("select 須為陣列")
        return [str(x).strip() for x in v if str(x).strip()]

    @model_validator(mode="after")
    def _validate_rules(self) -> IntentV4:
        try:
            major = float(str(self.version).split(".", 1)[0])
        except ValueError as e:
            raise ValueError("version 無法解析") from e
        if major != 4:
            raise ValueError("IntentV4 僅支援 version 4.x")

        if self.mode == "list":
            if not self.select:
                raise ValueError("mode=list 時 select 須為至少一個 col_*")
            if self.metrics:
                raise ValueError("mode=list 時 metrics 須為空陣列")
        else:
            if self.filters:
                raise ValueError(
                    "mode=calculate 時頂層 filters 必須為空 []；"
                    "過濾條件統一在各 metrics.filters 中定義。"
                )
            if not self.metrics:
                raise ValueError("mode=calculate 時 metrics 須至少一筆")
            dims_set = set(self.dims.groups)
            for m in self.metrics:
                if m.group_override is not None and len(m.group_override) > 0:
                    bad = [g for g in m.group_override if g not in dims_set]
                    if bad:
                        raise ValueError(
                            f"metric {m.id!r} 的 group_override 含有不在 dims.groups 中的維度: {bad}"
                        )
        return self


def is_intent_v4_payload(data: dict[str, Any]) -> bool:
    """是否為 v4.x intent（version 主版本 = 4）。"""
    if not isinstance(data, dict):
        return False
    ver = data.get("version")
    if ver is None:
        return False
    try:
        major = float(str(ver).lstrip("vV").split(".")[0])
        return major == 4
    except (ValueError, TypeError):
        return False


def parse_intent_v4(data: dict[str, Any]) -> IntentV4:
    if not isinstance(data, dict):
        raise ValueError("intent 須為物件")
    return IntentV4.model_validate(data)
