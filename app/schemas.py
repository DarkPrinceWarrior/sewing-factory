from datetime import date
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints

Short = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=180)]
Memo = Annotated[str, Field(max_length=500)]
Quantity = Annotated[Decimal, Field(gt=0, le=1_000_000, max_digits=10, decimal_places=3)]
Money = Annotated[Decimal, Field(ge=0, le=20_000_000, max_digits=10, decimal_places=2)]
Stage = Literal["cut", "sew", "pack"]
Id = Annotated[int, Field(gt=0)]


class Login(BaseModel):
    email: Annotated[str, Field(min_length=3, max_length=180)]
    password: Annotated[str, Field(min_length=1, max_length=128)]


class Password(BaseModel):
    old: Annotated[str, Field(min_length=1, max_length=128)]
    new: Annotated[str, Field(min_length=10, max_length=128)]


class Assignment(BaseModel):
    staff_id: Id
    quantity: Annotated[int, Field(gt=0, le=100_000)]


class WorkLine(BaseModel):
    item_id: Id
    quantity: Annotated[int, Field(gt=0, le=100_000)]
    prepared: Annotated[int, Field(ge=0, le=100_000)] = 0
    assignments: Annotated[list[Assignment], Field(max_length=100)] = []


class Report(BaseModel):
    date: date
    stage: Stage
    shift: Literal["day", "evening", "night"] = "day"
    memo: Memo = ""
    lines: Annotated[list[WorkLine], Field(min_length=1, max_length=100)]


class ItemLine(BaseModel):
    item_id: Id
    quantity: Quantity
    price: Money = Decimal("0")


class Transfer(BaseModel):
    date: date
    target_id: Id
    memo: Memo = ""
    lines: Annotated[list[ItemLine], Field(min_length=1, max_length=100)]


class Receipt(BaseModel):
    date: date
    supplier: Short
    reference: Short
    memo: Memo = ""
    lines: Annotated[list[ItemLine], Field(min_length=1, max_length=100)]


class Sale(BaseModel):
    warehouse_id: Id | None = None
    payment: Literal["card", "cash", "transfer"]
    request_key: Annotated[str, Field(pattern=r"^[a-zA-Z0-9_-]{16,80}$")]
    lines: Annotated[list[ItemLine], Field(min_length=1, max_length=100)]


class Warehouse(BaseModel):
    city: Short
    name: Short
    address: Short


class Staff(BaseModel):
    name: Short
    stage: Literal["cut", "sew", "pack", "warehouse", "office"]
    position: Short
    hired_on: date
    active: bool = True


class Access(BaseModel):
    staff_id: Id
    warehouse_id: Id
    email: Annotated[str, Field(min_length=4, max_length=180, pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$")] | None = None
    password: Annotated[str, Field(min_length=10, max_length=128)] | None = None


class MaterialNorm(BaseModel):
    item_id: Id
    stage: Stage
    quantity: Quantity


class Recipe(BaseModel):
    norms: Annotated[list[MaterialNorm], Field(min_length=1, max_length=120)]
    cut: Money
    sew: Money
    pack: Money


class Product(Recipe):
    sku: Short
    name: Short
    size: Short
    category: Short
    price: Money


class Correction(BaseModel):
    reason: Short
