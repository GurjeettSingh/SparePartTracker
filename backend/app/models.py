from __future__ import annotations

import datetime as dt

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class Manufacturer(Base):
    __tablename__ = "manufacturers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True, index=True)

    models: Mapped[list[CarModel]] = relationship(back_populates="manufacturer", cascade="all,delete")  # type: ignore[name-defined]


class CarModel(Base):
    __tablename__ = "models"
    __table_args__ = (UniqueConstraint("manufacturer_id", "name", name="uq_models_mfr_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), index=True)
    manufacturer_id: Mapped[int] = mapped_column(ForeignKey("manufacturers.id", ondelete="CASCADE"), index=True)

    manufacturer: Mapped[Manufacturer] = relationship(back_populates="models")


class SparePart(Base):
    __tablename__ = "spare_parts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    category: Mapped[str] = mapped_column(String(40), default="Others", server_default="Others", index=True)


class PartCatalog(Base):
    __tablename__ = "part_catalog"
    __table_args__ = (
        UniqueConstraint(
            "manufacturer_id",
            "model_id",
            "spare_part_id",
            name="uq_part_catalog_mfr_model_part",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    manufacturer_id: Mapped[int] = mapped_column(
        ForeignKey("manufacturers.id", ondelete="CASCADE"),
        index=True,
    )
    model_id: Mapped[int] = mapped_column(
        ForeignKey("models.id", ondelete="CASCADE"),
        index=True,
    )
    spare_part_id: Mapped[int] = mapped_column(
        ForeignKey("spare_parts.id", ondelete="CASCADE"),
        index=True,
    )

    vehicle_type: Mapped[str | None] = mapped_column(String(60), nullable=True)
    typical_specification: Mapped[str | None] = mapped_column(String(300), nullable=True)
    oem_part_number: Mapped[str | None] = mapped_column(String(120), nullable=True)

    manufacturer: Mapped[Manufacturer] = relationship()
    model: Mapped[CarModel] = relationship()
    spare_part: Mapped[SparePart] = relationship()


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    first_name: Mapped[str] = mapped_column(String(120))
    last_name: Mapped[str] = mapped_column(String(120))
    workshop_name: Mapped[str] = mapped_column(String(200))
    mobile_number: Mapped[str] = mapped_column(String(30), unique=True, index=True)
    email: Mapped[str | None] = mapped_column(String(200), nullable=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    orders: Mapped[list[Order]] = relationship(back_populates="user", cascade="all,delete")  # type: ignore[name-defined]


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )
    order_name: Mapped[str | None] = mapped_column(String(200), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(20), default="Draft", server_default="Draft", index=True)
    supplier_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    user: Mapped[User] = relationship(back_populates="orders")  # type: ignore[name-defined]

    items: Mapped[list[OrderItem]] = relationship(back_populates="order", cascade="all,delete")  # type: ignore[name-defined]


class OrderItem(Base):
    __tablename__ = "order_items"
    __table_args__ = (
        UniqueConstraint("order_id", "model_id", "spare_part_id", name="uq_order_item_model_part"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)

    manufacturer_id: Mapped[int] = mapped_column(ForeignKey("manufacturers.id", ondelete="RESTRICT"), index=True)
    model_id: Mapped[int] = mapped_column(ForeignKey("models.id", ondelete="RESTRICT"), index=True)
    spare_part_id: Mapped[int] = mapped_column(ForeignKey("spare_parts.id", ondelete="RESTRICT"), index=True)

    quantity: Mapped[int] = mapped_column(Integer)
    available_stock: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    to_purchase: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    order: Mapped[Order] = relationship(back_populates="items")
    manufacturer: Mapped[Manufacturer] = relationship()
    model: Mapped[CarModel] = relationship()
    spare_part: Mapped[SparePart] = relationship()


class Inventory(Base):
    __tablename__ = "inventory"
    __table_args__ = (
        UniqueConstraint("user_id", "manufacturer_id", "model_id", "spare_part_id", name="uq_inventory_user_mfr_model_part"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    manufacturer_id: Mapped[int] = mapped_column(ForeignKey("manufacturers.id", ondelete="CASCADE"), index=True)
    model_id: Mapped[int] = mapped_column(ForeignKey("models.id", ondelete="CASCADE"), index=True)
    spare_part_id: Mapped[int] = mapped_column(ForeignKey("spare_parts.id", ondelete="CASCADE"), index=True)
    stock_quantity: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    user: Mapped[User] = relationship()
    manufacturer: Mapped[Manufacturer] = relationship()
    model: Mapped[CarModel] = relationship()
    spare_part: Mapped[SparePart] = relationship()
