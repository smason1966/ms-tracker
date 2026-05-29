import json
import asyncio
from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile

import pytest
from cryptography.fernet import Fernet
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.base import Base
from app.models.gift_card import GiftCard
from app.services.field_encryption import (
    ENCRYPTED_FIELD_PREFIX,
    _fernet,
    decrypt_field,
    encrypt_field,
)
from app.utils.time import utc_now


def make_session_factory():
    from scripts.encrypt_sensitive_fields import initialize_model_registry

    initialize_model_registry()
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


def configure_transfer_env(monkeypatch, tmp_path):
    monkeypatch.setenv("MS_TRACKER_UPLOADS_DIR", str(tmp_path / "uploads"))
    monkeypatch.setenv("FIELD_ENCRYPTION_KEY", Fernet.generate_key().decode())
    _fernet.cache_clear()


def transfer_zip(manifest: dict, cards: list[dict] | None = None) -> bytes:
    now = utc_now().isoformat()
    payloads = {
        "manifest.json": {
            "export_version": "1.0",
            "exported_at": now,
            "source_environment": "local-test",
            **manifest,
        },
        "purchases.json": [
            {
                "id": 1,
                "store_name": "Best Buy",
                "purchase_date": now,
                "total_amount": "100.00",
                "purchase_total_paid": "100.00",
            }
        ],
        "cards.json": cards or [],
        "sales.json": [],
        "fuel_transactions.json": [],
        "receipts.json": [],
        "card_images.json": [],
        "sale_gift_cards.json": [],
        "sale_fuel_accounts.json": [],
        "buyers.json": [],
        "payment_accounts.json": [],
        "fuel_accounts.json": [],
    }
    buffer = BytesIO()
    with ZipFile(buffer, "w", ZIP_DEFLATED) as zip_file:
        for filename, payload in payloads.items():
            zip_file.writestr(filename, json.dumps(payload, default=str))
    return buffer.getvalue()


class FakeUpload:
    def __init__(self, contents: bytes):
        self.contents = contents

    async def read(self) -> bytes:
        return self.contents


def test_sensitive_export_disabled_by_default(monkeypatch, tmp_path):
    configure_transfer_env(monkeypatch, tmp_path)
    from app.api.data_transfer import (
        SENSITIVE_TRANSFER_DISABLED_MESSAGE,
        export_transfer,
    )

    with pytest.raises(HTTPException) as exc:
        export_transfer(purchases="1", sensitive=True, acknowledge_sensitive=True)

    assert exc.value.status_code == 403
    assert exc.value.detail == SENSITIVE_TRANSFER_DISABLED_MESSAGE


def test_sensitive_export_requires_explicit_acknowledgement(monkeypatch, tmp_path):
    configure_transfer_env(monkeypatch, tmp_path)
    monkeypatch.setenv("ALLOW_SENSITIVE_TRANSFER_EXPORT", "true")
    from app.api.data_transfer import SENSITIVE_TRANSFER_WARNING, export_transfer

    with pytest.raises(HTTPException) as exc:
        export_transfer(purchases="1", sensitive=True)

    assert exc.value.status_code == 400
    assert exc.value.detail["message"] == SENSITIVE_TRANSFER_WARNING


def test_sensitive_transfer_export_payload_decrypts_credentials(monkeypatch, tmp_path):
    configure_transfer_env(monkeypatch, tmp_path)
    from app.api.data_transfer import prepare_sensitive_transfer_data

    data = {
        "cards": [
            {
                "card_number_encrypted": encrypt_field("6332260074021047"),
                "pin_encrypted": encrypt_field("1350"),
                "confirmed_card_number": encrypt_field("6332260074021047"),
                "confirmed_pin": encrypt_field("1350"),
                "confirmed_redemption_code": None,
                "detected_card_number": encrypt_field("6332260074021047"),
                "detected_pin": encrypt_field("1350"),
            }
        ],
        "fuel_accounts": [
            {
                "login_password": encrypt_field("fuel-secret"),
            }
        ],
    }

    sensitive_data = prepare_sensitive_transfer_data(data)

    assert sensitive_data["cards"][0]["card_number_encrypted"] == "6332260074021047"
    assert sensitive_data["cards"][0]["pin_encrypted"] == "1350"
    assert sensitive_data["fuel_accounts"][0]["login_password"] == "fuel-secret"
    assert ENCRYPTED_FIELD_PREFIX not in str(sensitive_data)


def test_sensitive_import_preview_disabled_by_default(monkeypatch, tmp_path):
    configure_transfer_env(monkeypatch, tmp_path)
    from app.api.data_transfer import (
        SENSITIVE_TRANSFER_DISABLED_MESSAGE,
        load_package,
        preview_package,
    )

    package = load_package(transfer_zip({"sensitive_transfer": True}))
    db = make_session_factory()()
    try:
        with pytest.raises(HTTPException) as exc:
            preview_package(db, package)
    finally:
        db.close()

    assert exc.value.status_code == 403
    assert exc.value.detail == SENSITIVE_TRANSFER_DISABLED_MESSAGE


def test_sensitive_import_requires_acknowledgement_when_enabled(
    monkeypatch,
    tmp_path,
):
    configure_transfer_env(monkeypatch, tmp_path)
    monkeypatch.setenv("ALLOW_SENSITIVE_TRANSFER_IMPORT", "true")
    from app.api.data_transfer import SENSITIVE_TRANSFER_WARNING, apply_transfer

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            apply_transfer(FakeUpload(transfer_zip({"sensitive_transfer": True})))
        )

    assert exc.value.status_code == 400
    assert exc.value.detail["message"] == SENSITIVE_TRANSFER_WARNING


def test_sensitive_import_encrypts_plaintext_credentials_on_target(
    monkeypatch,
    tmp_path,
):
    configure_transfer_env(monkeypatch, tmp_path)
    monkeypatch.setenv("ALLOW_SENSITIVE_TRANSFER_IMPORT", "true")
    from app.api import data_transfer

    session_factory = make_session_factory()
    monkeypatch.setattr(data_transfer, "SessionLocal", session_factory)
    contents = transfer_zip(
        {"sensitive_transfer": True},
        cards=[
            {
                "id": 1,
                "purchase_batch_id": 1,
                "brand": "Best Buy",
                "face_value": "100.00",
                "acquisition_cost": "100.00",
                "status": "VERIFIED_AVAILABLE",
                "card_number_encrypted": "6332260074021047",
                "pin_encrypted": "1350",
                "confirmed_card_number": "6332260074021047",
                "confirmed_pin": "1350",
                "confirmed_redemption_code": None,
                "confirmed_at": utc_now().isoformat(),
                "confirmed_source": "manual",
                "detected_card_number": None,
                "detected_pin": None,
                "verification_status": "VERIFIED",
            }
        ],
    )

    result = asyncio.run(
        data_transfer.apply_transfer(
            FakeUpload(contents),
            acknowledge_sensitive=True,
        )
    )

    assert result["created"]["cards"] == 1
    db = session_factory()
    try:
        stored = db.query(GiftCard).one()
        assert stored.card_number_encrypted.startswith(ENCRYPTED_FIELD_PREFIX)
        assert stored.pin_encrypted.startswith(ENCRYPTED_FIELD_PREFIX)
        assert stored.card_number_encrypted != "6332260074021047"
        assert stored.pin_encrypted != "1350"
        assert decrypt_field(stored.card_number_encrypted) == "6332260074021047"
        assert decrypt_field(stored.pin_encrypted) == "1350"
    finally:
        db.close()
