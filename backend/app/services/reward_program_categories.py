import json
from datetime import datetime
from app.utils.time import utc_now

from sqlalchemy.orm import Session

from app.models.app_setting import AppSetting


REWARD_PROGRAM_CATEGORIES_KEY = "reward_program_categories"

DEFAULT_REWARD_PROGRAM_CATEGORIES = [
    {"name": "Cashback", "active": True, "notes": ""},
    {"name": "Airline Miles", "active": True, "notes": ""},
    {"name": "Hotel Points", "active": True, "notes": ""},
    {"name": "Transferable Points", "active": True, "notes": ""},
    {"name": "Fuel Rewards", "active": True, "notes": ""},
    {"name": "Store Loyalty", "active": True, "notes": ""},
    {"name": "Crypto", "active": True, "notes": ""},
    {"name": "Other", "active": True, "notes": ""},
]


def normalize_category_name(value: str) -> str:
    return " ".join(value.strip().split())


def _setting(db: Session) -> AppSetting | None:
    return (
        db.query(AppSetting)
        .filter(AppSetting.key == REWARD_PROGRAM_CATEGORIES_KEY)
        .first()
    )


def _normalize_categories(categories: list[dict]) -> list[dict]:
    normalized: list[dict] = []
    seen: set[str] = set()

    for category in categories:
        name = normalize_category_name(str(category.get("name", "")))
        key = name.lower()
        if not name or key in seen:
            continue
        normalized.append(
            {
                "name": name,
                "active": bool(category.get("active", True)),
                "notes": str(category.get("notes") or ""),
            }
        )
        seen.add(key)

    return normalized


def load_reward_program_categories(db: Session) -> list[dict]:
    setting = _setting(db)
    categories: list[dict] = []

    if setting and setting.value:
        try:
            raw_categories = json.loads(setting.value)
            if isinstance(raw_categories, list):
                categories = _normalize_categories(raw_categories)
        except json.JSONDecodeError:
            categories = []

    merged = _normalize_categories(categories + DEFAULT_REWARD_PROGRAM_CATEGORIES)
    if not setting or setting.value != json.dumps(merged, sort_keys=True):
        save_reward_program_categories(db, merged)
    return merged


def save_reward_program_categories(db: Session, categories: list[dict]) -> list[dict]:
    normalized = _normalize_categories(categories)
    setting = _setting(db)
    value = json.dumps(normalized, sort_keys=True)

    if not setting:
        setting = AppSetting(key=REWARD_PROGRAM_CATEGORIES_KEY, value=value)
        db.add(setting)
    else:
        setting.value = value
        setting.updated_at = utc_now()

    db.flush()
    return normalized


def active_reward_program_category_names(db: Session) -> set[str]:
    return {
        category["name"]
        for category in load_reward_program_categories(db)
        if category.get("active")
    }
