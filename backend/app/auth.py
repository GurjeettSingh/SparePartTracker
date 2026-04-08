from __future__ import annotations

import datetime as dt

import jwt
from fastapi import HTTPException
from passlib.context import CryptContext

from .config import JWT_ALGORITHM, JWT_EXPIRES_DAYS, JWT_SECRET


_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return _pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _pwd_context.verify(password, password_hash)
    except Exception:
        return False


def create_access_token(*, user_id: int, mobile_number: str) -> str:
    now = dt.datetime.now(dt.timezone.utc)
    exp = now + dt.timedelta(days=JWT_EXPIRES_DAYS)
    payload = {
        "user_id": user_id,
        "mobile_number": mobile_number,
        "exp": exp,
        "iat": now,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
