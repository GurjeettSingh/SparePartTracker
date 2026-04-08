from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db
from ..deps import get_current_user
from ..schemas import InventoryCreate, InventoryOut, InventoryUpdate, InventoryUpsert

router = APIRouter()


@router.get("", response_model=list[InventoryOut])
def list_inventory(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    rows = (
        db.execute(
            select(models.Inventory)
            .where(models.Inventory.user_id == current_user.id)
            .order_by(models.Inventory.updated_at.desc())
        )
        .scalars()
        .all()
    )

    # Ensure relationships are loaded for response
    for r in rows:
        r.manufacturer
        r.model
        r.spare_part

    return [
        InventoryOut(
            id=r.id,
            user_id=r.user_id,
            manufacturer_id=r.manufacturer_id,
            manufacturer_name=r.manufacturer.name,
            model_id=r.model_id,
            model_name=r.model.name,
            spare_part_id=r.spare_part_id,
            spare_part_name=r.spare_part.name,
            stock_quantity=r.stock_quantity,
            updated_at=r.updated_at,
        )
        for r in rows
    ]


@router.post("", response_model=InventoryOut)
def create_inventory(
    payload: InventoryCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    # Debug log for 404 troubleshooting (requested)
    print("Inventory POST called")

    mfr_name = payload.manufacturer.strip()
    model_name = payload.model.strip()
    part_name = payload.spare_part.strip()

    mfr = (
        db.execute(select(models.Manufacturer).where(func.lower(models.Manufacturer.name) == func.lower(mfr_name)))
        .scalars()
        .first()
    )
    if mfr is None:
        raise HTTPException(status_code=400, detail="Unknown manufacturer")

    model = (
        db.execute(
            select(models.CarModel)
            .where(models.CarModel.manufacturer_id == mfr.id)
            .where(func.lower(models.CarModel.name) == func.lower(model_name))
        )
        .scalars()
        .first()
    )
    if model is None:
        raise HTTPException(status_code=400, detail="Unknown model")

    part = (
        db.execute(select(models.SparePart).where(func.lower(models.SparePart.name) == func.lower(part_name)))
        .scalars()
        .first()
    )
    if part is None:
        raise HTTPException(status_code=400, detail="Unknown spare_part")

    existing = (
        db.execute(
            select(models.Inventory)
            .where(models.Inventory.user_id == current_user.id)
            .where(models.Inventory.manufacturer_id == mfr.id)
            .where(models.Inventory.model_id == model.id)
            .where(models.Inventory.spare_part_id == part.id)
        )
        .scalars()
        .first()
    )

    if existing is None:
        inv = models.Inventory(
            user_id=current_user.id,
            manufacturer_id=mfr.id,
            model_id=model.id,
            spare_part_id=part.id,
            stock_quantity=payload.stock_quantity,
        )
        db.add(inv)
        db.commit()
        db.refresh(inv)
        inv.manufacturer
        inv.model
        inv.spare_part
        return InventoryOut(
            id=inv.id,
            user_id=inv.user_id,
            manufacturer_id=inv.manufacturer_id,
            manufacturer_name=inv.manufacturer.name,
            model_id=inv.model_id,
            model_name=inv.model.name,
            spare_part_id=inv.spare_part_id,
            spare_part_name=inv.spare_part.name,
            stock_quantity=inv.stock_quantity,
            updated_at=inv.updated_at,
        )

    existing.stock_quantity = max(0, int(existing.stock_quantity) + int(payload.stock_quantity))
    existing.updated_at = func.now()
    db.add(existing)
    db.commit()
    db.refresh(existing)
    existing.manufacturer
    existing.model
    existing.spare_part
    return InventoryOut(
        id=existing.id,
        user_id=existing.user_id,
        manufacturer_id=existing.manufacturer_id,
        manufacturer_name=existing.manufacturer.name,
        model_id=existing.model_id,
        model_name=existing.model.name,
        spare_part_id=existing.spare_part_id,
        spare_part_name=existing.spare_part.name,
        stock_quantity=existing.stock_quantity,
        updated_at=existing.updated_at,
    )


@router.put("/{inventory_id}", response_model=InventoryOut)
def update_inventory(
    inventory_id: int,
    payload: InventoryUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    inv = db.get(models.Inventory, inventory_id)
    if inv is None or inv.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Inventory item not found")

    inv.stock_quantity = payload.stock_quantity
    inv.updated_at = func.now()
    db.add(inv)
    db.commit()
    db.refresh(inv)
    inv.manufacturer
    inv.model
    inv.spare_part
    return InventoryOut(
        id=inv.id,
        user_id=inv.user_id,
        manufacturer_id=inv.manufacturer_id,
        manufacturer_name=inv.manufacturer.name,
        model_id=inv.model_id,
        model_name=inv.model.name,
        spare_part_id=inv.spare_part_id,
        spare_part_name=inv.spare_part.name,
        stock_quantity=inv.stock_quantity,
        updated_at=inv.updated_at,
    )


@router.put("", response_model=InventoryOut)
def upsert_inventory(
    payload: InventoryUpsert,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Id-based upsert used by the dashboard to set stock_quantity absolutely."""

    mfr = db.get(models.Manufacturer, payload.manufacturer_id)
    if mfr is None:
        raise HTTPException(status_code=400, detail="Invalid manufacturer_id")

    model = db.get(models.CarModel, payload.model_id)
    if model is None or model.manufacturer_id != payload.manufacturer_id:
        raise HTTPException(status_code=400, detail="Invalid model_id")

    part = db.get(models.SparePart, payload.spare_part_id)
    if part is None:
        raise HTTPException(status_code=400, detail="Invalid spare_part_id")

    existing = (
        db.execute(
            select(models.Inventory)
            .where(models.Inventory.user_id == current_user.id)
            .where(models.Inventory.manufacturer_id == payload.manufacturer_id)
            .where(models.Inventory.model_id == payload.model_id)
            .where(models.Inventory.spare_part_id == payload.spare_part_id)
        )
        .scalars()
        .first()
    )
    if existing is None:
        inv = models.Inventory(
            user_id=current_user.id,
            manufacturer_id=payload.manufacturer_id,
            model_id=payload.model_id,
            spare_part_id=payload.spare_part_id,
            stock_quantity=payload.stock_quantity,
        )
        db.add(inv)
        db.commit()
        db.refresh(inv)
        inv.manufacturer
        inv.model
        inv.spare_part
        return InventoryOut(
            id=inv.id,
            user_id=inv.user_id,
            manufacturer_id=inv.manufacturer_id,
            manufacturer_name=inv.manufacturer.name,
            model_id=inv.model_id,
            model_name=inv.model.name,
            spare_part_id=inv.spare_part_id,
            spare_part_name=inv.spare_part.name,
            stock_quantity=inv.stock_quantity,
            updated_at=inv.updated_at,
        )

    existing.stock_quantity = payload.stock_quantity
    existing.updated_at = func.now()
    db.add(existing)
    db.commit()
    db.refresh(existing)
    existing.manufacturer
    existing.model
    existing.spare_part
    return InventoryOut(
        id=existing.id,
        user_id=existing.user_id,
        manufacturer_id=existing.manufacturer_id,
        manufacturer_name=existing.manufacturer.name,
        model_id=existing.model_id,
        model_name=existing.model.name,
        spare_part_id=existing.spare_part_id,
        spare_part_name=existing.spare_part.name,
        stock_quantity=existing.stock_quantity,
        updated_at=existing.updated_at,
    )
