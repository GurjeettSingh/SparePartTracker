from __future__ import annotations

import argparse
import csv
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import Base, engine, get_db_session
from .models import CarModel, Manufacturer, PartCatalog, SparePart


def _categorize_part(name: str) -> str:
    n = " ".join((name or "").strip().lower().split())
    if not n:
        return "Others"
    if "filter" in n:
        return "Filters"
    if "brake" in n or "pad" in n or "disc" in n or "shoe" in n:
        return "Brakes"
    if "clutch" in n or "gear" in n or "transmission" in n:
        return "Transmission"
    if "engine" in n or "spark" in n or "timing" in n or "mount" in n or "oil" in n:
        return "Engine"
    return "Others"


@dataclass(frozen=True)
class ImportStats:
    manufacturers_added: int
    models_added: int
    spare_parts_added: int
    catalog_rows_upserted: int


_SPLIT_TOKENS = ["/"]


def _split_multi(value: str) -> list[str]:
    cleaned = " ".join((value or "").strip().split())
    if not cleaned:
        return []

    parts = [cleaned]
    for tok in _SPLIT_TOKENS:
        next_parts: list[str] = []
        for p in parts:
            if tok in p:
                next_parts.extend([seg.strip() for seg in p.split(tok) if seg.strip()])
            else:
                next_parts.append(p)
        parts = next_parts

    # de-dupe preserving order
    seen: set[str] = set()
    out: list[str] = []
    for p in parts:
        if p not in seen:
            seen.add(p)
            out.append(p)
    return out


def _get_first(row: dict[str, str], keys: list[str]) -> str:
    for k in keys:
        v = (row.get(k) or "").strip()
        if v:
            return v
    return ""


def _get_or_create_manufacturer(db: Session, name: str) -> tuple[Manufacturer, bool]:
    existing = db.execute(select(Manufacturer).where(Manufacturer.name == name)).scalar_one_or_none()
    if existing is not None:
        return existing, False
    mfr = Manufacturer(name=name)
    db.add(mfr)
    db.flush()
    return mfr, True


def _get_or_create_model(db: Session, manufacturer_id: int, name: str) -> tuple[CarModel, bool]:
    existing = db.execute(
        select(CarModel).where(
            CarModel.manufacturer_id == manufacturer_id,
            CarModel.name == name,
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing, False
    model = CarModel(name=name, manufacturer_id=manufacturer_id)
    db.add(model)
    db.flush()
    return model, True


def _get_or_create_spare_part(db: Session, name: str) -> tuple[SparePart, bool]:
    existing = db.execute(select(SparePart).where(SparePart.name == name)).scalar_one_or_none()
    if existing is not None:
        return existing, False
    part = SparePart(name=name, category=_categorize_part(name))
    db.add(part)
    db.flush()
    return part, True


def _upsert_catalog(
    db: Session,
    *,
    manufacturer_id: int,
    model_id: int,
    spare_part_id: int,
    vehicle_type: str | None,
    typical_specification: str | None,
    oem_part_number: str | None,
) -> bool:
    existing = db.execute(
        select(PartCatalog).where(
            PartCatalog.manufacturer_id == manufacturer_id,
            PartCatalog.model_id == model_id,
            PartCatalog.spare_part_id == spare_part_id,
        )
    ).scalar_one_or_none()

    if existing is None:
        db.add(
            PartCatalog(
                manufacturer_id=manufacturer_id,
                model_id=model_id,
                spare_part_id=spare_part_id,
                vehicle_type=vehicle_type,
                typical_specification=typical_specification,
                oem_part_number=oem_part_number,
            )
        )
        return True

    changed = False
    if vehicle_type and existing.vehicle_type != vehicle_type:
        existing.vehicle_type = vehicle_type
        changed = True
    if typical_specification and existing.typical_specification != typical_specification:
        existing.typical_specification = typical_specification
        changed = True
    if oem_part_number and existing.oem_part_number != oem_part_number:
        existing.oem_part_number = oem_part_number
        changed = True
    if changed:
        db.add(existing)
    return changed


def import_car_data(db: Session, csv_text_path: Path, *, dry_run: bool = False) -> ImportStats:
    if not csv_text_path.exists():
        raise FileNotFoundError(str(csv_text_path))

    manufacturers_added = 0
    models_added = 0
    spare_parts_added = 0
    catalog_rows_upserted = 0

    with csv_text_path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            raise ValueError("CSV appears to have no header row")

        for row in reader:
            mfr_cell = (row.get("Manufacturer") or "").strip()
            model_cell = (row.get("Model") or "").strip()
            item_cell = _get_first(row, ["Item", "Spare Part", "SparePart"])
            if not mfr_cell or not model_cell:
                continue

            if not item_cell:
                continue

            vehicle_type = _get_first(row, ["Vehicle Type", "VehicleType"]) or None
            typical_spec = _get_first(row, ["Typical Specification / Note", "Typical Specification", "Note"]) or None
            oem_part_number = _get_first(
                row,
                [
                    "OEM Part Number (Common/Rep)",
                    "OEM Part Number",
                    "OEM Part No",
                    "OEM",
                ],
            ) or None

            part, part_created = _get_or_create_spare_part(db, item_cell)
            if part_created:
                spare_parts_added += 1

            manufacturer_names = _split_multi(mfr_cell)
            model_names = _split_multi(model_cell)
            for mfr_name in manufacturer_names:
                mfr, created = _get_or_create_manufacturer(db, mfr_name)
                if created:
                    manufacturers_added += 1

                for model_name in model_names:
                    model, model_created = _get_or_create_model(db, mfr.id, model_name)
                    if model_created:
                        models_added += 1

                    if _upsert_catalog(
                        db,
                        manufacturer_id=mfr.id,
                        model_id=model.id,
                        spare_part_id=part.id,
                        vehicle_type=vehicle_type,
                        typical_specification=typical_spec,
                        oem_part_number=oem_part_number,
                    ):
                        catalog_rows_upserted += 1

    if dry_run:
        db.rollback()
    else:
        db.commit()

    return ImportStats(
        manufacturers_added=manufacturers_added,
        models_added=models_added,
        spare_parts_added=spare_parts_added,
        catalog_rows_upserted=catalog_rows_upserted,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Upsert manufacturer/model/spare-part master data from carData.txt")
    parser.add_argument("file", type=str, help="Path to the carData CSV text file")
    parser.add_argument("--dry-run", action="store_true", help="Parse and compute inserts, but roll back")
    args = parser.parse_args()

    # Ensure tables exist (useful if script is run standalone)
    Base.metadata.create_all(bind=engine)

    db = get_db_session()
    try:
        stats = import_car_data(db, Path(args.file), dry_run=args.dry_run)
    finally:
        db.close()

    print(
        "Import complete: "
        f"manufacturers_added={stats.manufacturers_added}, "
        f"models_added={stats.models_added}, "
        f"spare_parts_added={stats.spare_parts_added}, "
        f"catalog_rows_upserted={stats.catalog_rows_upserted}"
    )


if __name__ == "__main__":
    main()
