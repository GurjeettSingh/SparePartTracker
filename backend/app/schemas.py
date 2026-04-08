from __future__ import annotations

import datetime as dt

from pydantic import BaseModel, ConfigDict, Field


class ApiBaseModel(BaseModel):
    model_config = ConfigDict(protected_namespaces=())


class SignupIn(ApiBaseModel):
    first_name: str = Field(min_length=1, max_length=120)
    last_name: str = Field(min_length=1, max_length=120)
    workshop_name: str = Field(min_length=1, max_length=200)
    mobile_number: str = Field(min_length=5, max_length=30)
    email: str | None = Field(default=None, max_length=200)
    password: str = Field(min_length=6, max_length=200)
    confirm_password: str = Field(min_length=6, max_length=200)


class LoginIn(ApiBaseModel):
    mobile_number: str = Field(min_length=5, max_length=30)
    password: str = Field(min_length=1, max_length=200)


class UserOut(ApiBaseModel):
    id: int
    first_name: str
    last_name: str
    workshop_name: str
    mobile_number: str
    email: str | None = None
    created_at: dt.datetime


class AuthOut(ApiBaseModel):
    token: str
    user: UserOut


class UserProfileUpdate(ApiBaseModel):
    workshop_name: str = Field(min_length=1, max_length=200)
    email: str | None = Field(default=None, max_length=200)


class ManufacturerOut(ApiBaseModel):
    id: int
    name: str


class ModelOut(ApiBaseModel):
    id: int
    name: str
    manufacturer_id: int


class SparePartOut(ApiBaseModel):
    id: int
    name: str
    category: str = "Others"


class PartCatalogLookupOut(ApiBaseModel):
    manufacturer_id: int
    model_id: int
    spare_part_id: int
    typical_specification: str | None = None
    oem_part_number: str | None = None


class OrderCreate(ApiBaseModel):
    pass


class OrderOut(ApiBaseModel):
    id: int
    order_name: str | None = None
    status: str = "Draft"
    supplier_name: str | None = None
    created_at: dt.datetime


class OrderRename(ApiBaseModel):
    order_name: str = Field(min_length=1, max_length=200)


class OrderSummaryOut(ApiBaseModel):
    id: int
    order_name: str
    created_at: dt.datetime
    total_items: int
    status: str = "Draft"
    supplier_name: str | None = None


class OrderItemCreateInline(ApiBaseModel):
    manufacturer_id: int
    model_id: int
    spare_part_id: int
    quantity: int = Field(gt=0)
    available_stock: int = Field(default=0, ge=0)


class OrderCreateWithItems(ApiBaseModel):
    order_name: str = Field(min_length=1, max_length=200)
    items: list[OrderItemCreateInline]


class OrderItemCreate(ApiBaseModel):
    order_id: int
    manufacturer_id: int
    model_id: int
    spare_part_id: int
    quantity: int = Field(gt=0)
    available_stock: int = Field(default=0, ge=0)


class OrderItemUpdate(ApiBaseModel):
    quantity: int | None = Field(default=None, gt=0)
    available_stock: int | None = Field(default=None, ge=0)


class OrderItemOut(ApiBaseModel):
    id: int
    order_id: int
    manufacturer_id: int
    manufacturer_name: str
    model_id: int
    model_name: str
    spare_part_id: int
    spare_part_name: str
    spare_part_category: str = "Others"
    quantity: int
    available_stock: int = 0
    to_purchase: int = 0
    typical_specification: str | None = None
    oem_part_number: str | None = None


class OrderWithItemsOut(ApiBaseModel):
    id: int
    order_name: str | None = None
    status: str = "Draft"
    supplier_name: str | None = None
    created_at: dt.datetime
    items: list[OrderItemOut]


class OrderPurchaseUpdate(ApiBaseModel):
    status: str = Field(default="Purchased", pattern="^(Draft|Purchased)$")
    supplier_name: str | None = Field(default=None, max_length=200)


class InventoryOut(ApiBaseModel):
    id: int
    user_id: int
    manufacturer_id: int
    manufacturer_name: str
    model_id: int
    model_name: str
    spare_part_id: int
    spare_part_name: str
    stock_quantity: int
    updated_at: dt.datetime


class InventoryUpsert(ApiBaseModel):
    manufacturer_id: int = Field(ge=1)
    model_id: int = Field(ge=1)
    spare_part_id: int = Field(ge=1)
    stock_quantity: int = Field(ge=0)


class InventoryCreate(ApiBaseModel):
    manufacturer: str = Field(min_length=1, max_length=120)
    model: str = Field(min_length=1, max_length=120)
    spare_part: str = Field(min_length=1, max_length=120)
    stock_quantity: int = Field(ge=0)


class InventoryUpdate(ApiBaseModel):
    stock_quantity: int = Field(ge=0)
