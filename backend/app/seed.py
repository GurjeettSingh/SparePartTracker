from __future__ import annotations

import os

from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import hash_password
from .models import CarModel, Manufacturer, SparePart, User


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


SEED_MANUFACTURERS: dict[str, list[str]] = {
    "Maruti Suzuki": [
        "Alto 800",
        "Alto K10",
        "Swift",
        "Dzire",
        "Baleno",
        "Brezza",
        "Ertiga",
        "WagonR",
    ],
    "Hyundai": [
        "Santro",
        "Grand i10",
        "i20",
        "Verna",
        "Creta",
        "Venue",
        "Aura",
    ],
    "Tata": [
        "Nano",
        "Tiago",
        "Tigor",
        "Nexon",
        "Harrier",
        "Safari",
        "Punch",
    ],
    "Mahindra": [
        "Bolero",
        "Scorpio",
        "Scorpio-N",
        "XUV300",
        "XUV700",
        "Thar",
    ],
    "Honda": [
        "City",
        "Amaze",
        "Jazz",
        "WR-V",
    ],
    "Toyota": [
        "Innova",
        "Innova Crysta",
        "Fortuner",
        "Glanza",
        "Etios",
    ],
    "Skoda": [
        "Rapid",
        "Octavia",
        "Superb",
        "Kushaq",
        "Slavia",
    ],
    "Volkswagen": [
        "Polo",
        "Vento",
        "Virtus",
        "Taigun",
    ],
    "Renault": [
        "Kwid",
        "Triber",
        "Kiger",
        "Duster",
    ],
    "Nissan": [
        "Micra",
        "Sunny",
        "Magnite",
        "Terrano",
    ],
}

SEED_SPARE_PARTS: list[str] = [
    # Filters
    "Fuel Filter",
    "Air Filter",
    "Cabin Filter",
    "Oil Filter",
    # Engine
    "Engine Oil",
    "Engine Mount",
    "Engine Filter",
    "Timing Belt",
    "Spark Plugs",
    # Brakes
    "Brake Pads",
    "Brake Shoes",
    "Brake Discs",
    # Transmission
    "Clutch Plate",
    "Clutch Assembly",
    "Gear Oil",
    # Electrical
    "Battery",
    "Alternator",
    "Starter Motor",
    # Suspension
    "Shock Absorber",
    "Suspension Kit",
    # Others
    "Coolant",
    "Wiper Blades",
    "Tyres",
    "Headlights",
]


def seed_if_empty(db: Session) -> None:
    has_manufacturers = db.execute(select(Manufacturer.id).limit(1)).first() is not None
    has_models = db.execute(select(CarModel.id).limit(1)).first() is not None
    has_parts = db.execute(select(SparePart.id).limit(1)).first() is not None
    has_users = db.execute(select(User.id).limit(1)).first() is not None

    if has_manufacturers and has_models and has_parts:
        # still allow seeding a default admin user (only if no users exist)
        if not has_users:
            _seed_default_admin_user(db)
        return

    name_to_mfr: dict[str, Manufacturer] = {}
    for mfr_name, model_names in SEED_MANUFACTURERS.items():
        mfr = db.execute(select(Manufacturer).where(Manufacturer.name == mfr_name)).scalar_one_or_none()
        if mfr is None:
            mfr = Manufacturer(name=mfr_name)
            db.add(mfr)
            db.flush()
        name_to_mfr[mfr_name] = mfr

        for model_name in model_names:
            existing = db.execute(
                select(CarModel).where(
                    CarModel.manufacturer_id == mfr.id,
                    CarModel.name == model_name,
                )
            ).scalar_one_or_none()
            if existing is None:
                db.add(CarModel(name=model_name, manufacturer_id=mfr.id))

    for part_name in SEED_SPARE_PARTS:
        existing = db.execute(select(SparePart).where(SparePart.name == part_name)).scalar_one_or_none()
        if existing is None:
            db.add(SparePart(name=part_name, category=_categorize_part(part_name)))

    db.commit()

    if not has_users:
        _seed_default_admin_user(db)


def _seed_default_admin_user(db: Session) -> None:
    mobile = os.getenv("DEFAULT_ADMIN_MOBILE", "9999999999").strip()
    password = os.getenv("DEFAULT_ADMIN_PASSWORD", "admin123")
    first_name = os.getenv("DEFAULT_ADMIN_FIRST_NAME", "Admin").strip() or "Admin"
    last_name = os.getenv("DEFAULT_ADMIN_LAST_NAME", "User").strip() or "User"
    workshop_name = os.getenv("DEFAULT_ADMIN_WORKSHOP_NAME", "Default Workshop").strip() or "Default Workshop"
    email = os.getenv("DEFAULT_ADMIN_EMAIL", "admin@example.com").strip() or None

    if not mobile or not password:
        return

    existing = db.execute(select(User).where(User.mobile_number == mobile)).scalar_one_or_none()
    if existing is not None:
        return

    db.add(
        User(
            first_name=first_name,
            last_name=last_name,
            workshop_name=workshop_name,
            mobile_number=mobile,
            email=email,
            password_hash=hash_password(password),
        )
    )
    db.commit()
