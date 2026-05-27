from datetime import datetime
from app.utils.time import utc_now

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session, object_session

from app.db.session import SessionLocal
from app.models.app_setting import AppSetting
from app.models.credit_card import CreditCard
from app.models.player import Player
from app.models.purchase_batch import PurchaseBatch


router = APIRouter(tags=["players"])
MULTI_PLAYER_MODE_KEY = "multi_player_mode_enabled"
VOIDED_SALE_EXPORT_RETENTION_KEY = "voided_sale_sensitive_export_retention"
VOIDED_SALE_EXPORT_RETENTION_DEFAULT = "never"
VOIDED_SALE_EXPORT_RETENTION_OPTIONS = {"never", "24_hours", "7_days", "forever"}


class PlayerCreate(BaseModel):
    label: str
    name: str | None = None
    notes: str | None = None
    active: bool = True


class PlayerUpdate(BaseModel):
    label: str | None = None
    name: str | None = None
    notes: str | None = None
    active: bool | None = None


class AppSettingsUpdate(BaseModel):
    multi_player_mode_enabled: bool | None = None
    voided_sale_sensitive_export_retention: str | None = None


def serialize_player(player: Player) -> dict:
    db = object_session(player)
    linked_credit_card_count = (
        db.query(CreditCard).filter(CreditCard.player_id == player.id).count()
        if db
        else 0
    )
    linked_purchase_count = (
        db.query(PurchaseBatch).filter(PurchaseBatch.player_id == player.id).count()
        if db
        else 0
    )

    return {
        "id": player.id,
        "label": player.label,
        "name": player.name,
        "notes": player.notes,
        "active": player.active,
        "linked_credit_card_count": linked_credit_card_count,
        "linked_purchase_count": linked_purchase_count,
        "created_at": player.created_at,
        "updated_at": player.updated_at,
    }


def get_bool_setting(db: Session, key: str, default: bool = False) -> bool:
    setting = db.query(AppSetting).filter(AppSetting.key == key).first()

    if not setting or setting.value is None:
        return default

    return setting.value.lower() in {"1", "true", "yes", "on"}


def set_bool_setting(db: Session, key: str, value: bool) -> AppSetting:
    setting = db.query(AppSetting).filter(AppSetting.key == key).first()

    if not setting:
        setting = AppSetting(key=key, value="true" if value else "false")
        db.add(setting)
    else:
        setting.value = "true" if value else "false"
        setting.updated_at = utc_now()

    return setting


def get_string_setting(db: Session, key: str, default: str) -> str:
    setting = db.query(AppSetting).filter(AppSetting.key == key).first()

    if not setting or setting.value is None:
        return default

    return setting.value


def set_string_setting(db: Session, key: str, value: str) -> AppSetting:
    setting = db.query(AppSetting).filter(AppSetting.key == key).first()

    if not setting:
        setting = AppSetting(key=key, value=value)
        db.add(setting)
    else:
        setting.value = value
        setting.updated_at = utc_now()

    return setting


def ensure_default_player(db: Session) -> None:
    has_player = db.query(Player).first()

    if has_player:
        return

    player = Player(
        label="P1",
        name=None,
        notes="Default player created when multi-player mode was enabled.",
        active=True,
    )
    db.add(player)
    db.flush()
    backfill_unassigned_credit_cards(db, player.id)


def backfill_unassigned_credit_cards(db: Session, player_id: int) -> int:
    updated = (
        db.query(CreditCard)
        .filter(CreditCard.player_id.is_(None))
        .update({CreditCard.player_id: player_id}, synchronize_session=False)
    )
    return int(updated or 0)


def disable_multiplayer_if_no_active_players(db: Session) -> None:
    active_count = db.query(Player).filter(Player.active.is_(True)).count()

    if active_count == 0:
        set_bool_setting(db, MULTI_PLAYER_MODE_KEY, False)
        db.query(CreditCard).filter(CreditCard.player_id.is_not(None)).update(
            {CreditCard.player_id: None},
            synchronize_session=False,
        )


def deactivate_player(db: Session, player: Player) -> int:
    player.active = False
    player.updated_at = utc_now()
    unassigned_cards = (
        db.query(CreditCard)
        .filter(CreditCard.player_id == player.id)
        .update({CreditCard.player_id: None}, synchronize_session=False)
    )
    disable_multiplayer_if_no_active_players(db)
    return int(unassigned_cards or 0)


@router.get("/app-settings")
@router.get("/settings")
@router.get("/settings/")
def get_app_settings():
    db: Session = SessionLocal()

    try:
        return {
            "multi_player_mode_enabled": get_bool_setting(
                db,
                MULTI_PLAYER_MODE_KEY,
                False,
            ),
            "voided_sale_sensitive_export_retention": get_string_setting(
                db,
                VOIDED_SALE_EXPORT_RETENTION_KEY,
                VOIDED_SALE_EXPORT_RETENTION_DEFAULT,
            ),
        }
    finally:
        db.close()


@router.patch("/app-settings")
@router.patch("/settings")
@router.patch("/settings/")
def update_app_settings(payload: AppSettingsUpdate):
    db: Session = SessionLocal()

    try:
        if payload.multi_player_mode_enabled is not None:
            set_bool_setting(
                db,
                MULTI_PLAYER_MODE_KEY,
                payload.multi_player_mode_enabled,
            )
            if payload.multi_player_mode_enabled:
                ensure_default_player(db)

        if payload.voided_sale_sensitive_export_retention is not None:
            if (
                payload.voided_sale_sensitive_export_retention
                not in VOIDED_SALE_EXPORT_RETENTION_OPTIONS
            ):
                raise HTTPException(status_code=400, detail="Invalid retention policy")
            set_string_setting(
                db,
                VOIDED_SALE_EXPORT_RETENTION_KEY,
                payload.voided_sale_sensitive_export_retention,
            )
        db.commit()
        return {
            "multi_player_mode_enabled": get_bool_setting(
                db,
                MULTI_PLAYER_MODE_KEY,
                False,
            ),
            "voided_sale_sensitive_export_retention": get_string_setting(
                db,
                VOIDED_SALE_EXPORT_RETENTION_KEY,
                VOIDED_SALE_EXPORT_RETENTION_DEFAULT,
            ),
        }
    finally:
        db.close()


@router.get("/players/")
def list_players(active_only: bool = False):
    db: Session = SessionLocal()

    try:
        query = db.query(Player)
        if active_only:
            query = query.filter(Player.active.is_(True))
        players = query.order_by(Player.label.asc(), Player.id.asc()).all()
        return [serialize_player(player) for player in players]
    finally:
        db.close()


@router.post("/players/")
def create_player(payload: PlayerCreate):
    db: Session = SessionLocal()

    try:
        player_count_before = db.query(Player).count()
        player = Player(
            label=payload.label.strip(),
            name=payload.name,
            notes=payload.notes,
            active=payload.active,
        )
        db.add(player)
        db.flush()
        backfilled_cards = 0

        if player_count_before == 0:
            backfilled_cards = backfill_unassigned_credit_cards(db, player.id)

        if payload.active:
            set_bool_setting(db, MULTI_PLAYER_MODE_KEY, True)

        db.commit()
        db.refresh(player)
        data = serialize_player(player)
        data["backfilled_credit_cards"] = backfilled_cards
        return data
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail="Unable to save player") from exc
    finally:
        db.close()


@router.patch("/players/{player_id}")
def update_player(player_id: int, payload: PlayerUpdate):
    db: Session = SessionLocal()

    try:
        player = db.query(Player).filter(Player.id == player_id).first()

        if not player:
            raise HTTPException(status_code=404, detail="Player not found")

        update_data = payload.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(player, field, value.strip() if field == "label" and value else value)

        player.updated_at = utc_now()
        if "active" in update_data and update_data["active"] is False:
            deactivate_player(db, player)
        elif "active" in update_data and update_data["active"] is True:
            set_bool_setting(db, MULTI_PLAYER_MODE_KEY, True)

        db.commit()
        db.refresh(player)
        return serialize_player(player)
    finally:
        db.close()


@router.delete("/players/{player_id}")
def delete_player(player_id: int):
    db: Session = SessionLocal()

    try:
        player = db.query(Player).filter(Player.id == player_id).first()

        if not player:
            raise HTTPException(status_code=404, detail="Player not found")

        linked_credit_cards = (
            db.query(CreditCard).filter(CreditCard.player_id == player_id).count()
        )
        linked_purchases = (
            db.query(PurchaseBatch).filter(PurchaseBatch.player_id == player_id).count()
        )

        if linked_credit_cards or linked_purchases:
            raise HTTPException(
                status_code=409,
                detail={
                    "error": "player_has_linked_records",
                    "message": "This player has linked records. Deactivate instead?",
                    "linked_credit_card_count": linked_credit_cards,
                    "linked_purchase_count": linked_purchases,
                },
            )

        db.delete(player)
        db.flush()
        disable_multiplayer_if_no_active_players(db)
        db.commit()
        return {
            "deleted": True,
            "deactivated": False,
            "player_id": player_id,
            "message": "Player deleted.",
        }
    finally:
        db.close()


@router.post("/players/{player_id}/deactivate")
def deactivate_player_endpoint(player_id: int):
    db: Session = SessionLocal()

    try:
        player = db.query(Player).filter(Player.id == player_id).first()

        if not player:
            raise HTTPException(status_code=404, detail="Player not found")

        unassigned_cards = deactivate_player(db, player)
        db.commit()
        db.refresh(player)
        return {
            "deactivated": True,
            "unassigned_credit_cards": unassigned_cards,
            "player": serialize_player(player),
            "message": "Player deactivated and linked cards moved to Unassigned.",
        }
    finally:
        db.close()
