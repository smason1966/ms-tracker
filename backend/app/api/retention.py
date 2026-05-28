from __future__ import annotations

import json
from datetime import datetime, timedelta
from app.utils.time import utc_now
from pathlib import Path
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.card_image import CardImage
from app.models.extraction_attempt import ExtractionAttempt
from app.models.extraction_candidate import ExtractionCandidate
from app.models.extraction_profile_metric import ExtractionProfileMetric
from app.models.gift_card import GiftCard
from app.models.purchase_batch import PurchaseBatch
from app.models.receipt import Receipt
from app.models.sale import Sale
from app.models.sale_event import SaleEvent
from app.models.sale_gift_card import SaleGiftCard
from app.services.card_image_schema import ensure_card_image_schema
from app.services.field_encryption import try_decrypt_field
from app.services.ocr_debug import cleanup_ocr_debug_files, purge_temp_ocr_crops
from app.services.retention_schema import ensure_retention_schema
from app.services.upload_storage import (
    build_upload_health_report,
    delete_orphaned_uploads,
    physical_upload_path,
    preview_orphaned_upload_cleanup,
)
from app.services.storage import normalize_object_key, storage


router = APIRouter(prefix="/retention", tags=["retention"])

DEFAULT_RETENTION_MONTHS = 12
RETENTION_DAYS_PER_MONTH = 365 / 12
OPEN_SALE_STATUSES = {"ACTIVE", "SOLD_PENDING_PAYMENT", "PARTIALLY_SETTLED", "AWAITING_PAYMENT"}
UNVERIFIED_CARD_STATUSES = {"NEEDS_VERIFICATION", "PENDING"}


class RetentionRunPayload(BaseModel):
    dry_run: bool = True
    card_image_months: int = DEFAULT_RETENTION_MONTHS
    receipt_image_months: int = DEFAULT_RETENTION_MONTHS
    digital_pdf_months: int = DEFAULT_RETENTION_MONTHS


class OCRArtifactCleanupPayload(BaseModel):
    dry_run: bool = False
    older_than_hours: int = 24
    max_debug_folder_mb: int | None = None
    purge_failed_ocr_attempts: bool = True
    reset_failed_cards_to: str = "pending"


class OrphanedUploadCleanupPayload(BaseModel):
    dry_run: bool = True
    older_than_days: int = 1
    minimum_age_hours: int = 24


def retention_cutoff(months: int) -> datetime:
    return utc_now() - timedelta(days=max(months, 1) * RETENTION_DAYS_PER_MONTH)


def local_path(path_value: str | None) -> Path | None:
    if not path_value:
        return None
    path = physical_upload_path(path_value) or Path(path_value)
    if path.is_absolute():
        return path
    return Path.cwd() / path


def credential_ending(card: GiftCard | None) -> str | None:
    if not card:
        return None
    for encrypted_value in (
        card.confirmed_redemption_code,
        card.confirmed_card_number,
        card.card_number_encrypted,
    ):
        value, unavailable = try_decrypt_field(encrypted_value)
        if unavailable:
            return None
        if value and value.strip():
            return value.strip()[-4:]
    return None


def card_open_sale_reasons(db: Session, card_id: int) -> list[str]:
    rows = (
        db.query(Sale)
        .join(SaleGiftCard, SaleGiftCard.sale_id == Sale.id)
        .filter(SaleGiftCard.gift_card_id == card_id)
        .filter(Sale.status.in_(OPEN_SALE_STATUSES))
        .all()
    )
    return [f"Sale #{sale.id} is {sale.status}" for sale in rows]


def purchase_open_reasons(db: Session, purchase_id: int) -> list[str]:
    cards = (
        db.query(GiftCard)
        .filter(GiftCard.purchase_batch_id == purchase_id)
        .all()
    )
    reasons: list[str] = []
    for card in cards:
        if card.status in UNVERIFIED_CARD_STATUSES:
            reasons.append(f"Gift card #{card.id} is still unverified")
        reasons.extend(card_open_sale_reasons(db, card.id))
    return reasons


def attachment_age_field(row: Any) -> datetime:
    return row.uploaded_at or row.created_at


def metadata_for_card_image(db: Session, image: CardImage) -> dict:
    card = db.query(GiftCard).filter(GiftCard.id == image.gift_card_id).first()
    return {
        "purchase_id": card.purchase_batch_id if card else None,
        "card_id": image.gift_card_id,
        "brand": card.brand if card else None,
        "face_value": str(card.face_value) if card else None,
        "sale_ids": [
            sale_id
            for (sale_id,) in db.query(SaleGiftCard.sale_id)
            .filter(SaleGiftCard.gift_card_id == image.gift_card_id)
            .all()
        ],
        "confirmed_card_ending": credential_ending(card),
        "confirmed_pin_present": bool(
            (
                try_decrypt_field(card.confirmed_pin)[0]
                or try_decrypt_field(card.pin_encrypted)[0]
            )
            if card
            else False
        ),
        "original_filename": image.original_filename,
        "file_path": image.original_image_url,
        "processed_file_path": image.processed_image_url,
    }


def metadata_for_receipt(db: Session, receipt: Receipt) -> dict:
    purchase = (
        db.query(PurchaseBatch)
        .filter(PurchaseBatch.id == receipt.purchase_batch_id)
        .first()
    )
    cards = (
        db.query(GiftCard)
        .filter(GiftCard.purchase_batch_id == receipt.purchase_batch_id)
        .all()
    )
    return {
        "purchase_id": receipt.purchase_batch_id,
        "store_name": purchase.store_name if purchase else None,
        "card_ids": [card.id for card in cards],
        "brands": sorted({card.brand for card in cards}),
        "face_value": str(sum(card.face_value for card in cards)) if cards else None,
        "original_filename": receipt.original_filename,
        "file_path": receipt.image_url,
    }


def card_image_safety_reasons(db: Session, image: CardImage) -> list[str]:
    if image.retain_attachment:
        return ["Attachment is flagged to retain"]
    card = db.query(GiftCard).filter(GiftCard.id == image.gift_card_id).first()
    if not card:
        return []
    reasons: list[str] = []
    if card.status in UNVERIFIED_CARD_STATUSES:
        reasons.append(f"Gift card #{card.id} is still unverified")
    reasons.extend(card_open_sale_reasons(db, card.id))
    return reasons


def receipt_safety_reasons(db: Session, receipt: Receipt) -> list[str]:
    if receipt.retain_attachment:
        return ["Attachment is flagged to retain"]
    return purchase_open_reasons(db, receipt.purchase_batch_id)


def candidate_payload(
    *,
    attachment_table: str,
    attachment_id: int,
    attachment_type: str,
    original_filename: str | None,
    file_path: str | None,
    uploaded_at: datetime,
    retention_until: datetime | None,
    safe_to_purge: bool,
    blocked_reasons: list[str],
    metadata: dict,
) -> dict:
    return {
        "attachment_table": attachment_table,
        "attachment_id": attachment_id,
        "attachment_type": attachment_type,
        "original_filename": original_filename,
        "file_path": file_path,
        "uploaded_at": uploaded_at,
        "retention_until": retention_until,
        "safe_to_purge": safe_to_purge,
        "blocked_reasons": blocked_reasons,
        "metadata": metadata,
    }


def preview_retention(db: Session, payload: RetentionRunPayload) -> list[dict]:
    ensure_card_image_schema(db)
    ensure_retention_schema(db)

    now = utc_now()
    card_cutoff = retention_cutoff(payload.card_image_months)
    digital_cutoff = retention_cutoff(payload.digital_pdf_months)
    receipt_cutoff = retention_cutoff(payload.receipt_image_months)
    candidates: list[dict] = []

    images = (
        db.query(CardImage)
        .filter(CardImage.retention_status == "active")
        .all()
    )
    for image in images:
        attachment_type = image.attachment_type or "card_image"
        cutoff = digital_cutoff if attachment_type == "digital_pdf" else card_cutoff
        uploaded_at = attachment_age_field(image)
        retention_until = image.retention_until or (uploaded_at + timedelta(days=365))
        if uploaded_at > cutoff and retention_until > now:
            continue
        blocked_reasons = card_image_safety_reasons(db, image)
        metadata = metadata_for_card_image(db, image)
        candidates.append(
            candidate_payload(
                attachment_table="card_images",
                attachment_id=image.id,
                attachment_type=attachment_type,
                original_filename=image.original_filename,
                file_path=image.original_image_url,
                uploaded_at=uploaded_at,
                retention_until=retention_until,
                safe_to_purge=not blocked_reasons,
                blocked_reasons=blocked_reasons,
                metadata=metadata,
            )
        )

    receipts = (
        db.query(Receipt)
        .filter(Receipt.retention_status == "active")
        .all()
    )
    for receipt in receipts:
        uploaded_at = attachment_age_field(receipt)
        retention_until = receipt.retention_until or (uploaded_at + timedelta(days=365))
        if uploaded_at > receipt_cutoff and retention_until > now:
            continue
        blocked_reasons = receipt_safety_reasons(db, receipt)
        metadata = metadata_for_receipt(db, receipt)
        candidates.append(
            candidate_payload(
                attachment_table="receipts",
                attachment_id=receipt.id,
                attachment_type=receipt.attachment_type or "receipt_image",
                original_filename=receipt.original_filename,
                file_path=receipt.image_url,
                uploaded_at=uploaded_at,
                retention_until=retention_until,
                safe_to_purge=not blocked_reasons,
                blocked_reasons=blocked_reasons,
                metadata=metadata,
            )
        )

    return candidates


def record_retention_event(db: Session, candidate: dict, action: str, reason: str) -> None:
    event_id = (
        db.execute(text("SELECT COALESCE(MAX(id), 0) + 1 FROM attachment_retention_events"))
        .scalar()
    )
    db.execute(
        text(
            """
            INSERT INTO attachment_retention_events
            (id, attachment_table, attachment_id, attachment_type, action, file_path, reason, metadata, created_at)
            VALUES (:id, :attachment_table, :attachment_id, :attachment_type, :action, :file_path, :reason, :metadata, :created_at)
            """
        ),
        {
            "id": event_id,
            "attachment_table": candidate["attachment_table"],
            "attachment_id": candidate["attachment_id"],
            "attachment_type": candidate["attachment_type"],
            "action": action,
            "file_path": candidate["file_path"],
            "reason": reason,
            "metadata": json.dumps(candidate["metadata"], default=str),
            "created_at": utc_now(),
        },
    )


def delete_file(path_value: str | None) -> bool:
    if not path_value:
        return False
    return storage.delete_or_mark_purged(normalize_object_key(path_value))


def purge_candidate(db: Session, candidate: dict) -> dict:
    now = utc_now()
    deleted_original = delete_file(candidate["file_path"])
    deleted_processed = False

    if candidate["attachment_table"] == "card_images":
        image = db.query(CardImage).filter(CardImage.id == candidate["attachment_id"]).first()
        if image:
            deleted_processed = delete_file(image.processed_image_url)
            image.retention_status = "purged"
            image.purged_at = now
            image.purge_metadata = json.dumps(candidate["metadata"], default=str)
            for sale_id in candidate["metadata"].get("sale_ids", []):
                db.add(
                    SaleEvent(
                        sale_id=sale_id,
                        action="attachment_purged",
                        affected_asset_count=1,
                        user_label="retention",
                        field_name="card_images",
                        reason="Attachment purged per retention policy.",
                        notes=f"Card image #{image.id} metadata retained.",
                    )
                )
    else:
        receipt = db.query(Receipt).filter(Receipt.id == candidate["attachment_id"]).first()
        if receipt:
            receipt.retention_status = "purged"
            receipt.purged_at = now
            receipt.purge_metadata = json.dumps(candidate["metadata"], default=str)

    record_retention_event(db, candidate, "purged", "Attachment purged per retention policy.")
    return {
        **candidate,
        "purged_at": now,
        "deleted_original": deleted_original,
        "deleted_processed": deleted_processed,
    }


def failed_ocr_card_ids(db: Session) -> list[int]:
    return [
        card_id
        for (card_id,) in db.query(GiftCard.id)
        .filter(GiftCard.ocr_status == "failed")
        .all()
    ]


def purge_failed_ocr_attempt_rows(
    db: Session,
    *,
    reset_failed_cards_to: str,
    dry_run: bool,
) -> dict:
    card_ids = failed_ocr_card_ids(db)
    if not card_ids:
        return {
            "failed_card_count": 0,
            "deleted_attempts": 0,
            "deleted_candidates": 0,
            "deleted_profile_metrics": 0,
            "reset_failed_cards_to": reset_failed_cards_to,
        }

    attempt_ids = [
        attempt_id
        for (attempt_id,) in db.query(ExtractionAttempt.id)
        .filter(ExtractionAttempt.gift_card_id.in_(card_ids))
        .all()
    ]
    candidate_count = (
        db.query(ExtractionCandidate)
        .filter(ExtractionCandidate.gift_card_id.in_(card_ids))
        .count()
    )
    metric_count = (
        db.query(ExtractionProfileMetric)
        .filter(ExtractionProfileMetric.gift_card_id.in_(card_ids))
        .count()
    )

    if not dry_run:
        db.query(ExtractionCandidate).filter(
            ExtractionCandidate.gift_card_id.in_(card_ids)
        ).delete(synchronize_session=False)
        db.query(ExtractionProfileMetric).filter(
            ExtractionProfileMetric.gift_card_id.in_(card_ids)
        ).delete(synchronize_session=False)
        db.query(ExtractionAttempt).filter(
            ExtractionAttempt.gift_card_id.in_(card_ids)
        ).delete(synchronize_session=False)
        db.query(GiftCard).filter(GiftCard.id.in_(card_ids)).update(
            {GiftCard.ocr_status: reset_failed_cards_to},
            synchronize_session=False,
        )

    return {
        "failed_card_count": len(card_ids),
        "deleted_attempts": len(attempt_ids),
        "deleted_candidates": candidate_count,
        "deleted_profile_metrics": metric_count,
        "reset_failed_cards_to": reset_failed_cards_to,
    }


@router.post("/preview")
def preview_attachment_retention(payload: RetentionRunPayload):
    db: Session = SessionLocal()
    try:
        candidates = preview_retention(db, payload)
        return {
            "card_image_months": payload.card_image_months,
            "receipt_image_months": payload.receipt_image_months,
            "digital_pdf_months": payload.digital_pdf_months,
            "total_candidates": len(candidates),
            "safe_to_purge_count": len([item for item in candidates if item["safe_to_purge"]]),
            "blocked_count": len([item for item in candidates if not item["safe_to_purge"]]),
            "candidates": candidates,
        }
    finally:
        db.close()


@router.post("/run")
def run_attachment_retention(payload: RetentionRunPayload):
    db: Session = SessionLocal()
    try:
        candidates = preview_retention(db, payload)
        purged = []
        blocked = []
        for candidate in candidates:
            if not candidate["safe_to_purge"]:
                blocked.append(candidate)
                continue
            purged.append(candidate if payload.dry_run else purge_candidate(db, candidate))

        db.commit()
        return {
            "dry_run": payload.dry_run,
            "purged_count": 0 if payload.dry_run else len(purged),
            "would_purge_count": len(purged),
            "blocked_count": len(blocked),
            "purged": [] if payload.dry_run else purged,
            "would_purge": purged if payload.dry_run else [],
            "blocked": blocked,
        }
    finally:
        if payload.dry_run:
            db.rollback()
        db.close()


@router.post("/ocr-artifacts/cleanup")
def cleanup_ocr_artifacts(payload: OCRArtifactCleanupPayload):
    db: Session = SessionLocal()
    try:
        debug_result = (
            {
                "dry_run": True,
                "retention_hours": payload.older_than_hours,
                "max_folder_size_mb": payload.max_debug_folder_mb,
            }
            if payload.dry_run
            else cleanup_ocr_debug_files(
                older_than_hours=payload.older_than_hours,
                max_folder_size_mb=payload.max_debug_folder_mb,
            )
        )
        temp_result = (
            {"dry_run": True}
            if payload.dry_run
            else purge_temp_ocr_crops()
        )
        failed_attempts_result = (
            purge_failed_ocr_attempt_rows(
                db,
                reset_failed_cards_to=payload.reset_failed_cards_to,
                dry_run=payload.dry_run,
            )
            if payload.purge_failed_ocr_attempts
            else {"skipped": True}
        )

        if payload.dry_run:
            db.rollback()
        else:
            db.commit()

        return {
            "dry_run": payload.dry_run,
            "debug_artifacts": debug_result,
            "temporary_ocr_crops": temp_result,
            "failed_ocr_attempts": failed_attempts_result,
        }
    finally:
        db.close()


@router.get("/upload-health")
def get_upload_health():
    db: Session = SessionLocal()
    try:
        return build_upload_health_report(db)
    finally:
        db.close()


@router.post("/upload-health/orphans/preview")
def preview_orphaned_uploads(payload: OrphanedUploadCleanupPayload):
    db: Session = SessionLocal()
    try:
        return preview_orphaned_upload_cleanup(
            db,
            older_than_days=payload.older_than_days,
            minimum_age_hours=payload.minimum_age_hours,
        )
    finally:
        db.close()


@router.post("/upload-health/orphans/cleanup")
def cleanup_orphaned_uploads(payload: OrphanedUploadCleanupPayload):
    db: Session = SessionLocal()
    try:
        return delete_orphaned_uploads(
            db,
            older_than_days=payload.older_than_days,
            minimum_age_hours=payload.minimum_age_hours,
            dry_run=payload.dry_run,
        )
    finally:
        db.close()
