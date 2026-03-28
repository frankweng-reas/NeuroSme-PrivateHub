"""
Intent JSON v3.2：與 system_prompt_analysis_intent_tool.md（SSOT）對齊的嚴格 Pydantic。
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

USER_FACING_INTENT_V32_VALIDATION_MESSAGE = (
    "Intent v3.2 結構無法解析。請對照 system_prompt_analysis_intent_tool.md："
    "須含 dims（groups、time_filter）、list 模式須含 select[]、"
    "filters／metrics 內使用 col／op／val。"
)

_ALLOWED_OPS = frozenset(
    {
        "eq",
        "ne",
        "gt",
        "gte",
        "lt",
        "lte",
        "between",
        "in",
        "contains",
        "is_null",
        "is_not_null",
    }
)


def _norm_op(op: str) -> str:
    s = (op or "").strip().lower().replace(" ", "")
    aliases = {"=": "eq", "==": "eq", "!=": "ne", "<>": "ne", ">": "gt", ">=": "gte", "<": "lt", "<=": "lte"}
    return aliases.get(s, s)


class FilterClauseV32(BaseModel):
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
    def _val_presence(self) -> FilterClauseV32:
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


class DimsV32(BaseModel):
    model_config = ConfigDict(extra="forbid")

    groups: list[str] = Field(default_factory=list)
    time_filter: FilterClauseV32 | None = None

    @field_validator("groups", mode="before")
    @classmethod
    def _groups(cls, v: Any) -> list[str]:
        if v is None:
            return []
        if not isinstance(v, list):
            raise ValueError("dims.groups 須為陣列")
        return [str(x).strip() for x in v if str(x).strip()]


class MetricV32(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    alias: str = Field(min_length=1, pattern=r"^[a-zA-Z_][a-zA-Z0-9_]*$")
    formula: str = Field(min_length=1)
    filters: list[FilterClauseV32] = Field(default_factory=list)
    # "total" → scalar CTE（不 GROUP BY），用於佔比分母；None 表示正常分組聚合
    window: Literal["total"] | None = None

    @field_validator("id", "formula")
    @classmethod
    def _strip_ids(cls, v: str) -> str:
        return str(v).strip()


class PostSortV32(BaseModel):
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


class PostProcessV32(BaseModel):
    model_config = ConfigDict(extra="forbid")

    where: FilterClauseV32 | None = None
    sort: list[PostSortV32] = Field(default_factory=list)
    limit: int | None = Field(default=None, ge=1)


class IntentV32(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    version: str | int | float
    mode: Literal["calculate", "list"] = "calculate"
    dims: DimsV32
    filters: list[FilterClauseV32] = Field(default_factory=list)
    metrics: list[MetricV32] = Field(default_factory=list)
    select: list[str] = Field(default_factory=list)
    post_process: PostProcessV32 | None = None

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
    def _mode_rules(self) -> IntentV32:
        try:
            major = float(str(self.version).split(".", 1)[0])
        except ValueError as e:
            raise ValueError("version 無法解析") from e
        if major < 3 or major >= 4:
            raise ValueError("IntentV32 僅支援 version 3.x")
        if self.mode == "list":
            if not self.select:
                raise ValueError("mode=list 時 select 須為至少一個 col_*")
            if self.metrics:
                raise ValueError("mode=list 時 metrics 須為空陣列")
        else:
            if not self.metrics:
                raise ValueError("mode=calculate 時 metrics 須至少一筆")
        return self


def is_intent_v32_payload(data: dict[str, Any]) -> bool:
    """是否為 v3.2 形狀（有 dims）且 version 屬 3.x。"""
    from app.schemas.intent_v3 import is_intent_v3

    if not isinstance(data, dict) or not is_intent_v3(data):
        return False
    dims = data.get("dims")
    return isinstance(dims, dict)


def parse_intent_v32(data: dict[str, Any]) -> IntentV32:
    if not isinstance(data, dict):
        raise ValueError("intent 須為物件")
    return IntentV32.model_validate(data)
