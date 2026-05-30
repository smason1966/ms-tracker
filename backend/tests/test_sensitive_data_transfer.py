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
from app.models.buyer import Buyer
from app.models.credit_card import CreditCard
from app.models.credit_card_reward_rule import CreditCardRewardRule
from app.models.gift_card import GiftCard
from app.models.purchase_batch import PurchaseBatch
from app.models.reward_program import RewardProgram
from app.models.sale import Sale
from app.models.sale_gift_card import SaleGiftCard
from app.models.spending_category import SpendingCategory
from app.models.store import Store
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
        "purchase_payments.json": [],
        "sales.json": [],
        "fuel_transactions.json": [],
        "receipts.json": [],
        "card_images.json": [],
        "sale_gift_cards.json": [],
        "sale_fuel_accounts.json": [],
        "sale_events.json": [],
        "buyers.json": [],
        "payment_accounts.json": [],
        "fuel_accounts.json": [],
        "credit_cards.json": [],
        "players.json": [],
        "reward_programs.json": [],
        "spending_categories.json": [],
        "stores.json": [],
        "credit_card_reward_rules.json": [],
    }
    buffer = BytesIO()
    with ZipFile(buffer, "w", ZIP_DEFLATED) as zip_file:
        for filename, payload in payloads.items():
            zip_file.writestr(filename, json.dumps(payload, default=str))
    return buffer.getvalue()


def graph_transfer_zip(payloads: dict) -> bytes:
    now = utc_now().isoformat()
    defaults = {
        "manifest.json": {
            "export_version": "1.0",
            "exported_at": now,
            "source_environment": "local-test",
            "sensitive_transfer": False,
            "include_images": False,
            "binary_payload_bytes": 0,
        },
        "purchases.json": [],
        "cards.json": [],
        "purchase_payments.json": [],
        "sales.json": [],
        "fuel_transactions.json": [],
        "receipts.json": [],
        "card_images.json": [],
        "sale_gift_cards.json": [],
        "sale_fuel_accounts.json": [],
        "sale_events.json": [],
        "buyers.json": [],
        "payment_accounts.json": [],
        "fuel_accounts.json": [],
        "credit_cards.json": [],
        "players.json": [],
        "reward_programs.json": [],
        "spending_categories.json": [],
        "credit_card_reward_rules.json": [],
    }
    defaults.update(payloads)
    buffer = BytesIO()
    with ZipFile(buffer, "w", ZIP_DEFLATED) as zip_file:
        for filename, payload in defaults.items():
            zip_file.writestr(filename, json.dumps(payload, default=str))
    return buffer.getvalue()


def linked_image_zip(
    *,
    receipts: list[dict] | None = None,
    card_images: list[dict] | None = None,
    files: dict[str, bytes] | None = None,
    source_environment: str = "local-test",
) -> bytes:
    now = utc_now().isoformat()
    manifest = {
        "export_version": "1.0",
        "exported_at": now,
        "source_environment": source_environment,
        "package_type": "linked_images",
        "sensitive_transfer": False,
        "image_mode": "linked",
        "binary_payload_bytes": sum(len(value) for value in (files or {}).values()),
        "image_counts": {
            "receipts": len(receipts or []),
            "card_images": len(card_images or []),
        },
    }
    normalized_receipts = [
        {
            **receipt,
            "source_environment": source_environment,
            "source_receipt_id": receipt.get("source_receipt_id") or receipt.get("id"),
            "source_purchase_batch_id": (
                receipt.get("source_purchase_batch_id")
                or receipt.get("purchase_batch_id")
            ),
        }
        for receipt in (receipts or [])
    ]
    normalized_card_images = [
        {
            **image,
            "source_environment": source_environment,
            "source_card_image_id": image.get("source_card_image_id") or image.get("id"),
            "source_gift_card_id": image.get("source_gift_card_id")
            or image.get("gift_card_id"),
        }
        for image in (card_images or [])
    ]
    buffer = BytesIO()
    with ZipFile(buffer, "w", ZIP_DEFLATED) as zip_file:
        zip_file.writestr("manifest.json", json.dumps(manifest, default=str))
        zip_file.writestr("receipts.json", json.dumps(normalized_receipts, default=str))
        zip_file.writestr("card_images.json", json.dumps(normalized_card_images, default=str))
        for filename, payload in (files or {}).items():
            zip_file.writestr(filename, payload)
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


def test_transfer_capabilities_reflect_sensitive_flags(monkeypatch, tmp_path):
    configure_transfer_env(monkeypatch, tmp_path)
    monkeypatch.setenv("ALLOW_SENSITIVE_TRANSFER_EXPORT", "true")
    monkeypatch.setenv("ALLOW_SENSITIVE_TRANSFER_IMPORT", "true")
    from app.api.data_transfer import data_transfer_capabilities

    capabilities = data_transfer_capabilities()

    assert capabilities == {
        "export_enabled": True,
        "import_enabled": True,
        "sensitive_export_enabled": True,
        "sensitive_import_enabled": True,
    }


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


def test_sensitive_import_detects_duplicate_with_different_ids_by_credentials(
    monkeypatch,
    tmp_path,
):
    configure_transfer_env(monkeypatch, tmp_path)
    monkeypatch.setenv("ALLOW_SENSITIVE_TRANSFER_IMPORT", "true")
    from app.api.data_transfer import load_package, preview_package

    session_factory = make_session_factory()
    db = session_factory()
    target_card = GiftCard(
        purchase_batch_id=99,
        brand="Best Buy",
        face_value="100.00",
        acquisition_cost="100.00",
        card_number_encrypted=encrypt_field("6332260074021047"),
        pin_encrypted=encrypt_field("1350"),
        confirmed_card_number=encrypt_field("6332260074021047"),
        confirmed_pin=encrypt_field("1350"),
        status="VERIFIED_AVAILABLE",
    )
    db.add(target_card)
    db.commit()

    package = load_package(
        transfer_zip(
            {"sensitive_transfer": True},
            cards=[
                {
                    "id": 48,
                    "purchase_batch_id": 1,
                    "brand": "Best Buy",
                    "face_value": "100.00",
                    "card_number_encrypted": "6332260074021047",
                    "pin_encrypted": "1350",
                    "confirmed_card_number": "6332260074021047",
                    "confirmed_pin": "1350",
                }
            ],
        )
    )

    preview = preview_package(db, package)

    assert preview["conflicts"]["duplicate_cards"] == [
        {
            "source_id": 48,
            "existing_id": target_card.id,
            "brand": "Best Buy",
            "card_ending": "1047",
            "match_type": "credential",
        }
    ]
    assert "6332260074021047" not in str(preview)
    assert "1350" not in str(preview)
    db.close()


def test_sensitive_import_detects_duplicate_by_imported_source_id(
    monkeypatch,
    tmp_path,
):
    configure_transfer_env(monkeypatch, tmp_path)
    monkeypatch.setenv("ALLOW_SENSITIVE_TRANSFER_IMPORT", "true")
    from app.api.data_transfer import load_package, preview_package

    session_factory = make_session_factory()
    db = session_factory()
    target_card = GiftCard(
        purchase_batch_id=99,
        brand="Best Buy",
        face_value="100.00",
        acquisition_cost="100.00",
        status="VERIFIED_AVAILABLE",
        imported_from_environment="local-test",
        imported_source_id="48",
    )
    db.add(target_card)
    db.commit()

    package = load_package(
        transfer_zip(
            {"sensitive_transfer": True},
            cards=[
                {
                    "id": 48,
                    "purchase_batch_id": 1,
                    "brand": "Best Buy",
                    "face_value": "100.00",
                    "card_number_encrypted": "6332260074021047",
                    "pin_encrypted": "1350",
                }
            ],
        )
    )

    preview = preview_package(db, package)

    assert preview["conflicts"]["duplicate_cards"] == []
    assert preview["plan"]["reuse"]["cards"] == 1
    assert "6332260074021047" not in str(preview)
    db.close()


def test_non_sensitive_import_uses_existing_encrypted_duplicate_behavior(
    monkeypatch,
    tmp_path,
):
    configure_transfer_env(monkeypatch, tmp_path)
    from app.api.data_transfer import load_package, preview_package

    encrypted_card = encrypt_field("6332260074021047")
    encrypted_pin = encrypt_field("1350")
    session_factory = make_session_factory()
    db = session_factory()
    target_card = GiftCard(
        purchase_batch_id=99,
        brand="Best Buy",
        face_value="100.00",
        acquisition_cost="100.00",
        card_number_encrypted=encrypted_card,
        pin_encrypted=encrypted_pin,
        status="VERIFIED_AVAILABLE",
    )
    db.add(target_card)
    db.commit()

    package = load_package(
        transfer_zip(
            {"sensitive_transfer": False},
            cards=[
                {
                    "id": 48,
                    "purchase_batch_id": 1,
                    "brand": "Best Buy",
                    "face_value": "100.00",
                    "card_number_encrypted": encrypted_card,
                    "pin_encrypted": encrypted_pin,
                }
            ],
        )
    )

    preview = preview_package(db, package)

    assert preview["conflicts"]["duplicate_cards"][0]["match_type"] == "encrypted_value"
    assert preview["conflicts"]["duplicate_cards"][0]["existing_id"] == target_card.id
    assert preview["conflicts"]["duplicate_cards"][0]["card_ending"]
    db.close()


def test_sensitive_import_undecryptable_target_does_not_crash(
    monkeypatch,
    tmp_path,
):
    configure_transfer_env(monkeypatch, tmp_path)
    old_key = Fernet.generate_key().decode()
    monkeypatch.setenv("FIELD_ENCRYPTION_KEY", old_key)
    _fernet.cache_clear()
    bad_ciphertext = encrypt_field("6332260074021047")
    configure_transfer_env(monkeypatch, tmp_path)
    monkeypatch.setenv("ALLOW_SENSITIVE_TRANSFER_IMPORT", "true")
    from app.api.data_transfer import load_package, preview_package

    session_factory = make_session_factory()
    db = session_factory()
    db.add(
        GiftCard(
            purchase_batch_id=99,
            brand="Best Buy",
            face_value="100.00",
            acquisition_cost="100.00",
            card_number_encrypted=bad_ciphertext,
            status="VERIFIED_AVAILABLE",
        )
    )
    db.commit()

    package = load_package(
        transfer_zip(
            {"sensitive_transfer": True},
            cards=[
                {
                    "id": 48,
                    "purchase_batch_id": 1,
                    "brand": "Best Buy",
                    "face_value": "100.00",
                    "card_number_encrypted": "6332260074021047",
                }
            ],
        )
    )

    preview = preview_package(db, package)

    assert preview["conflicts"]["duplicate_cards"] == []
    assert preview["warnings"]["duplicate_check_limited"] == [
        {
            "source_id": 48,
            "brand": "Best Buy",
            "message": (
                "Duplicate check was limited because an existing target "
                "credential could not be decrypted."
            ),
        }
    ]
    assert "6332260074021047" not in str(preview)
    db.close()


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


def test_sale_export_expands_to_purchase_and_card_dependencies(monkeypatch, tmp_path):
    configure_transfer_env(monkeypatch, tmp_path)
    from app.api.data_transfer import collect_transfer_data

    session_factory = make_session_factory()
    db = session_factory()
    now = utc_now()
    buyer = Buyer(name="Card Buyer")
    purchase = PurchaseBatch(
        store_name="Best Buy",
        purchase_date=now,
        total_amount="100.00",
        purchase_total_paid="100.00",
    )
    db.add_all([buyer, purchase])
    db.flush()
    card = GiftCard(
        purchase_batch_id=purchase.id,
        brand="Best Buy",
        face_value="100.00",
        acquisition_cost="100.00",
        status="SOLD_PENDING_PAYMENT",
    )
    sale = Sale(buyer_id=buyer.id, expected_payout="90.00")
    db.add_all([card, sale])
    db.flush()
    db.add(SaleGiftCard(sale_id=sale.id, gift_card_id=card.id))
    db.commit()

    data = collect_transfer_data(db, purchase_ids=[], sale_ids=[sale.id])

    assert [purchase["id"] for purchase in data["purchases"]] == [purchase.id]
    assert [exported_card["id"] for exported_card in data["cards"]] == [card.id]
    assert [exported_sale["id"] for exported_sale in data["sales"]] == [sale.id]
    assert data["sale_gift_cards"][0]["gift_card_id"] == card.id
    db.close()


def test_purchase_export_includes_sold_sale_links(monkeypatch, tmp_path):
    configure_transfer_env(monkeypatch, tmp_path)
    from app.api.data_transfer import collect_transfer_data

    session_factory = make_session_factory()
    db = session_factory()
    now = utc_now()
    buyer = Buyer(name="Card Buyer")
    purchase = PurchaseBatch(
        store_name="Best Buy",
        purchase_date=now,
        total_amount="100.00",
        purchase_total_paid="100.00",
    )
    db.add_all([buyer, purchase])
    db.flush()
    card = GiftCard(
        purchase_batch_id=purchase.id,
        brand="Best Buy",
        face_value="100.00",
        acquisition_cost="100.00",
        status="SOLD_PENDING_PAYMENT",
    )
    sale = Sale(buyer_id=buyer.id, expected_payout="90.00")
    db.add_all([card, sale])
    db.flush()
    db.add(SaleGiftCard(sale_id=sale.id, gift_card_id=card.id))
    db.commit()

    data = collect_transfer_data(db, purchase_ids=[purchase.id], sale_ids=[])

    assert [exported_sale["id"] for exported_sale in data["sales"]] == [sale.id]
    assert data["sale_gift_cards"][0]["sale_id"] == sale.id
    db.close()


def test_overlapping_purchase_and_sale_export_deduplicates_graph(monkeypatch, tmp_path):
    configure_transfer_env(monkeypatch, tmp_path)
    from app.api.data_transfer import collect_transfer_data

    session_factory = make_session_factory()
    db = session_factory()
    now = utc_now()
    buyer = Buyer(name="Card Buyer")
    purchase = PurchaseBatch(
        store_name="Best Buy",
        purchase_date=now,
        total_amount="100.00",
        purchase_total_paid="100.00",
    )
    db.add_all([buyer, purchase])
    db.flush()
    card = GiftCard(
        purchase_batch_id=purchase.id,
        brand="Best Buy",
        face_value="100.00",
        acquisition_cost="100.00",
        status="SOLD_PENDING_PAYMENT",
    )
    sale = Sale(buyer_id=buyer.id, expected_payout="90.00")
    db.add_all([card, sale])
    db.flush()
    db.add(SaleGiftCard(sale_id=sale.id, gift_card_id=card.id))
    db.commit()

    data = collect_transfer_data(db, purchase_ids=[purchase.id], sale_ids=[sale.id])

    assert len(data["purchases"]) == 1
    assert len(data["cards"]) == 1
    assert len(data["sales"]) == 1
    assert len(data["sale_gift_cards"]) == 1
    db.close()


def test_graph_import_creates_shared_card_once_and_reuses_on_second_import(
    monkeypatch,
    tmp_path,
):
    configure_transfer_env(monkeypatch, tmp_path)
    from app.api import data_transfer

    session_factory = make_session_factory()
    monkeypatch.setattr(data_transfer, "SessionLocal", session_factory)
    now = utc_now().isoformat()
    contents = graph_transfer_zip(
        {
            "purchases.json": [
                {
                    "id": 10,
                    "store_name": "Best Buy",
                    "purchase_date": now,
                    "total_amount": "100.00",
                    "purchase_total_paid": "100.00",
                }
            ],
            "cards.json": [
                {
                    "id": 20,
                    "purchase_batch_id": 10,
                    "brand": "Best Buy",
                    "face_value": "100.00",
                    "acquisition_cost": "100.00",
                    "status": "SOLD_PENDING_PAYMENT",
                }
            ],
            "buyers.json": [{"id": 30, "name": "Buyer"}],
            "sales.json": [
                {
                    "id": 40,
                    "buyer_id": 30,
                    "sold_at": now,
                    "expected_payout": "90.00",
                    "status": "SOLD_PENDING_PAYMENT",
                }
            ],
            "sale_gift_cards.json": [
                {
                    "id": 50,
                    "sale_id": 40,
                    "gift_card_id": 20,
                    "expected_payout": "90.00",
                }
            ],
        }
    )

    first_result = asyncio.run(data_transfer.apply_transfer(FakeUpload(contents)))
    second_result = asyncio.run(data_transfer.apply_transfer(FakeUpload(contents)))

    assert first_result["created"] == {"purchases": 1, "cards": 1, "sales": 1}
    assert second_result["created"] == {"purchases": 0, "cards": 0, "sales": 0}
    db = session_factory()
    try:
        assert db.query(PurchaseBatch).count() == 1
        assert db.query(GiftCard).count() == 1
        assert db.query(Sale).count() == 1
        assert db.query(SaleGiftCard).count() == 1
    finally:
        db.close()


def test_preview_reuses_exact_imported_purchases_without_duplicate_conflict(
    monkeypatch,
    tmp_path,
):
    configure_transfer_env(monkeypatch, tmp_path)
    from app.api.data_transfer import load_package, preview_package

    session_factory = make_session_factory()
    db = session_factory()
    now = utc_now()
    db.add(
        PurchaseBatch(
            store_name="Best Buy",
            purchase_date=now,
            total_amount="100.00",
            purchase_total_paid="100.00",
            imported_from_environment="local-test",
            imported_source_id="32",
            imported_at=now,
        )
    )
    db.commit()
    contents = graph_transfer_zip(
        {
            "purchases.json": [
                {
                    "id": 32,
                    "store_name": "Best Buy",
                    "purchase_date": now.isoformat(),
                    "total_amount": "100.00",
                    "purchase_total_paid": "100.00",
                },
                {
                    "id": 33,
                    "store_name": "Best Buy",
                    "purchase_date": now.isoformat(),
                    "total_amount": "100.00",
                    "purchase_total_paid": "100.00",
                },
            ],
        }
    )

    preview = preview_package(db, load_package(contents))

    assert preview["plan"]["reuse"]["purchases"] == 1
    assert preview["plan"]["create"]["purchases"] == 1
    assert preview["conflicts"]["duplicate_purchases"] == []
    db.close()


def test_fuzzy_duplicate_purchase_without_source_mapping_still_conflicts(
    monkeypatch,
    tmp_path,
):
    configure_transfer_env(monkeypatch, tmp_path)
    from app.api.data_transfer import load_package, preview_package

    session_factory = make_session_factory()
    db = session_factory()
    now = utc_now()
    existing = PurchaseBatch(
        store_name="Best Buy",
        purchase_date=now,
        total_amount="100.00",
        purchase_total_paid="100.00",
    )
    db.add(existing)
    db.commit()
    contents = graph_transfer_zip(
        {
            "purchases.json": [
                {
                    "id": 33,
                    "store_name": "Best Buy",
                    "purchase_date": now.isoformat(),
                    "total_amount": "100.00",
                    "purchase_total_paid": "100.00",
                },
            ],
        }
    )

    preview = preview_package(db, load_package(contents))

    assert preview["plan"]["reuse"]["purchases"] == 0
    assert preview["plan"]["create"]["purchases"] == 0
    assert preview["conflicts"]["duplicate_purchases"] == [
        {"source_id": 33, "existing_id": existing.id}
    ]
    db.close()


def test_exact_card_and_sale_source_mapping_reuse_does_not_block_preview(
    monkeypatch,
    tmp_path,
):
    configure_transfer_env(monkeypatch, tmp_path)
    from app.api.data_transfer import load_package, preview_package

    session_factory = make_session_factory()
    db = session_factory()
    now = utc_now()
    buyer = Buyer(name="Buyer")
    purchase = PurchaseBatch(
        store_name="Best Buy",
        purchase_date=now,
        total_amount="100.00",
        purchase_total_paid="100.00",
        imported_from_environment="local-test",
        imported_source_id="10",
        imported_at=now,
    )
    db.add_all([buyer, purchase])
    db.flush()
    card = GiftCard(
        purchase_batch_id=purchase.id,
        brand="Best Buy",
        face_value="100.00",
        acquisition_cost="100.00",
        imported_from_environment="local-test",
        imported_source_id="20",
        imported_at=now,
    )
    sale = Sale(
        buyer_id=buyer.id,
        expected_payout="90.00",
        imported_from_environment="local-test",
        imported_source_id="30",
        imported_at=now,
    )
    db.add_all([card, sale])
    db.commit()
    contents = graph_transfer_zip(
        {
            "purchases.json": [
                {
                    "id": 10,
                    "store_name": "Best Buy",
                    "purchase_date": now.isoformat(),
                    "total_amount": "100.00",
                    "purchase_total_paid": "100.00",
                }
            ],
            "cards.json": [
                {
                    "id": 20,
                    "purchase_batch_id": 10,
                    "brand": "Best Buy",
                    "face_value": "100.00",
                    "acquisition_cost": "100.00",
                }
            ],
            "buyers.json": [{"id": 40, "name": "Buyer"}],
            "sales.json": [
                {
                    "id": 30,
                    "buyer_id": 40,
                    "sold_at": now.isoformat(),
                    "expected_payout": "90.00",
                }
            ],
        }
    )

    preview = preview_package(db, load_package(contents))

    assert preview["plan"]["reuse"]["cards"] == 1
    assert preview["plan"]["reuse"]["sales"] == 1
    assert preview["conflicts"]["duplicate_cards"] == []
    assert preview["conflicts"]["duplicate_purchases"] == []
    db.close()


def test_graph_import_rolls_back_on_failure(monkeypatch, tmp_path):
    configure_transfer_env(monkeypatch, tmp_path)
    from app.api import data_transfer

    session_factory = make_session_factory()
    monkeypatch.setattr(data_transfer, "SessionLocal", session_factory)
    now = utc_now().isoformat()
    contents = graph_transfer_zip(
        {
            "purchases.json": [
                {
                    "id": 10,
                    "store_name": "Best Buy",
                    "purchase_date": now,
                    "total_amount": "100.00",
                    "purchase_total_paid": "100.00",
                }
            ],
            "cards.json": [
                {
                    "id": 20,
                    "purchase_batch_id": 10,
                    "face_value": "100.00",
                    "acquisition_cost": "100.00",
                }
            ],
        }
    )

    with pytest.raises(KeyError):
        asyncio.run(data_transfer.apply_transfer(FakeUpload(contents)))

    db = session_factory()
    try:
        assert db.query(PurchaseBatch).count() == 0
        assert db.query(GiftCard).count() == 0
    finally:
        db.close()


def test_image_exclusion_keeps_graph_without_attachment_records(monkeypatch, tmp_path):
    configure_transfer_env(monkeypatch, tmp_path)
    from app.api.data_transfer import collect_transfer_data
    from app.models.card_image import CardImage
    from app.models.receipt import Receipt

    session_factory = make_session_factory()
    db = session_factory()
    now = utc_now()
    purchase = PurchaseBatch(
        store_name="Best Buy",
        purchase_date=now,
        total_amount="100.00",
        purchase_total_paid="100.00",
    )
    db.add(purchase)
    db.flush()
    card = GiftCard(
        purchase_batch_id=purchase.id,
        brand="Best Buy",
        face_value="100.00",
        acquisition_cost="100.00",
    )
    db.add(card)
    db.flush()
    db.add_all(
        [
            Receipt(purchase_batch_id=purchase.id, image_url="/uploads/receipt.jpg"),
            CardImage(
                gift_card_id=card.id,
                image_type="primary",
                original_image_url="/uploads/card.jpg",
            ),
        ]
    )
    db.commit()

    without_images = collect_transfer_data(
        db,
        purchase_ids=[purchase.id],
        sale_ids=[],
        include_images=False,
    )
    with_images = collect_transfer_data(
        db,
        purchase_ids=[purchase.id],
        sale_ids=[],
        include_images=True,
    )

    assert without_images["receipts"] == []
    assert without_images["card_images"] == []
    assert len(with_images["receipts"]) == 1
    assert len(with_images["card_images"]) == 1
    db.close()


def test_linked_image_package_attaches_to_imported_core_records(
    monkeypatch,
    tmp_path,
):
    configure_transfer_env(monkeypatch, tmp_path)
    from app.api import data_transfer
    from app.models.card_image import CardImage
    from app.models.receipt import Receipt

    session_factory = make_session_factory()
    monkeypatch.setattr(data_transfer, "SessionLocal", session_factory)
    now = utc_now()
    db = session_factory()
    db.add(
        PurchaseBatch(
            store_name="Existing",
            purchase_date=now,
            total_amount="1.00",
            purchase_total_paid="1.00",
        )
    )
    db.flush()
    db.add(
        GiftCard(
            purchase_batch_id=1,
            brand="Nike",
            face_value="1.00",
            acquisition_cost="1.00",
        )
    )
    db.flush()
    purchase = PurchaseBatch(
        store_name="Best Buy",
        purchase_date=now,
        total_amount="100.00",
        purchase_total_paid="100.00",
        imported_from_environment="local-test",
        imported_source_id="10",
        imported_at=now,
    )
    db.add(purchase)
    db.flush()
    card = GiftCard(
        purchase_batch_id=purchase.id,
        brand="Best Buy",
        face_value="100.00",
        acquisition_cost="100.00",
        imported_from_environment="local-test",
        imported_source_id="20",
        imported_at=now,
    )
    db.add(card)
    db.commit()
    target_purchase_id = purchase.id
    target_card_id = card.id
    db.close()

    contents = linked_image_zip(
        receipts=[
            {
                "id": 100,
                "purchase_batch_id": 9999,
                "source_purchase_batch_id": 10,
                "image_url": "/uploads/receipts/source.jpg",
                "original_filename": "receipt.jpg",
            }
        ],
        card_images=[
            {
                "id": 200,
                "gift_card_id": 9999,
                "source_gift_card_id": 20,
                "image_type": "primary",
                "original_image_url": "/uploads/card-images/source.jpg",
                "original_filename": "card.jpg",
            }
        ],
        files={
            "receipts/100.jpg": b"receipt-image",
            "card_images/200.jpg": b"card-image",
        },
    )

    result = asyncio.run(data_transfer.apply_transfer(FakeUpload(contents)))

    assert result["created"]["receipts"] == 1
    assert result["created"]["card_images"] == 1
    db = session_factory()
    try:
        assert db.query(Receipt).count() == 1
        assert db.query(CardImage).count() == 1
        assert db.query(Receipt).one().purchase_batch_id == target_purchase_id
        assert db.query(CardImage).one().gift_card_id == target_card_id
    finally:
        db.close()


def test_linked_image_package_requires_core_import_first(monkeypatch, tmp_path):
    configure_transfer_env(monkeypatch, tmp_path)
    from app.api.data_transfer import load_package, preview_package

    db = make_session_factory()()
    package = load_package(
        linked_image_zip(
            card_images=[
                {
                    "id": 200,
                    "gift_card_id": 20,
                    "image_type": "primary",
                    "original_image_url": "/uploads/card-images/source.jpg",
                }
            ],
            files={"card_images/200.jpg": b"card-image"},
        )
    )

    preview = preview_package(db, package)

    missing = preview["conflicts"]["missing_dependencies"][0]
    assert missing["entity"] == "card_image"
    assert missing["missing"] == "imported_gift_card"
    assert missing["missing_source_id"] == 20
    assert missing["source_environment"] == "local-test"
    assert "source id 20" in missing["message"]
    db.close()


def test_linked_image_missing_mapping_reports_source_environment_mismatch(
    monkeypatch,
    tmp_path,
):
    configure_transfer_env(monkeypatch, tmp_path)
    from app.api.data_transfer import load_package, preview_package

    db = make_session_factory()()
    now = utc_now()
    purchase = PurchaseBatch(
        store_name="Best Buy",
        purchase_date=now,
        total_amount="100.00",
        purchase_total_paid="100.00",
        imported_from_environment="test",
        imported_source_id="10",
        imported_at=now,
    )
    db.add(purchase)
    db.commit()
    package = load_package(
        linked_image_zip(
            receipts=[
                {
                    "id": 100,
                    "purchase_batch_id": 10,
                    "image_url": "/uploads/receipts/source.jpg",
                }
            ],
            source_environment="staging",
        )
    )

    preview = preview_package(db, package)

    missing = preview["conflicts"]["missing_dependencies"][0]
    assert missing["source_environment"] == "staging"
    assert missing["missing_source_id"] == 10
    assert missing["source_environment_has_imported_records"] is False
    assert "source environment 'staging'" in missing["message"]
    db.close()


def test_linked_image_sale_export_uses_source_card_and_purchase_ids(
    monkeypatch,
    tmp_path,
):
    configure_transfer_env(monkeypatch, tmp_path)
    from app.api.data_transfer import (
        collect_transfer_data,
        image_transfer_card_images,
        image_transfer_receipts,
    )
    from app.models.card_image import CardImage
    from app.models.receipt import Receipt

    session_factory = make_session_factory()
    db = session_factory()
    now = utc_now()
    buyer = Buyer(name="Card Buyer")
    purchase = PurchaseBatch(
        store_name="Best Buy",
        purchase_date=now,
        total_amount="100.00",
        purchase_total_paid="100.00",
    )
    db.add_all([buyer, purchase])
    db.flush()
    card = GiftCard(
        purchase_batch_id=purchase.id,
        brand="Best Buy",
        face_value="100.00",
        acquisition_cost="100.00",
        status="SOLD_PENDING_PAYMENT",
    )
    sale = Sale(buyer_id=buyer.id, expected_payout="90.00")
    db.add_all([card, sale])
    db.flush()
    receipt = Receipt(
        purchase_batch_id=purchase.id,
        image_url="/uploads/receipts/source.jpg",
    )
    card_image = CardImage(
        gift_card_id=card.id,
        image_type="primary",
        original_image_url="/uploads/card-images/source.jpg",
    )
    db.add_all(
        [
            SaleGiftCard(sale_id=sale.id, gift_card_id=card.id),
            receipt,
            card_image,
        ]
    )
    db.commit()

    data = collect_transfer_data(
        db,
        purchase_ids=[],
        sale_ids=[sale.id],
        include_images=True,
    )
    linked_receipts = image_transfer_receipts(data["receipts"], "test")
    linked_card_images = image_transfer_card_images(data["card_images"], "test")

    assert linked_receipts[0]["source_purchase_batch_id"] == purchase.id
    assert linked_receipts[0]["source_receipt_id"] == receipt.id
    assert linked_card_images[0]["source_gift_card_id"] == card.id
    assert linked_card_images[0]["source_card_image_id"] == card_image.id
    db.close()


def test_duplicate_linked_image_package_import_does_not_duplicate_images(
    monkeypatch,
    tmp_path,
):
    configure_transfer_env(monkeypatch, tmp_path)
    from app.api import data_transfer
    from app.models.card_image import CardImage

    session_factory = make_session_factory()
    monkeypatch.setattr(data_transfer, "SessionLocal", session_factory)
    now = utc_now()
    db = session_factory()
    purchase = PurchaseBatch(
        store_name="Best Buy",
        purchase_date=now,
        total_amount="100.00",
        purchase_total_paid="100.00",
        imported_from_environment="local-test",
        imported_source_id="10",
        imported_at=now,
    )
    db.add(purchase)
    db.flush()
    card = GiftCard(
        purchase_batch_id=purchase.id,
        brand="Best Buy",
        face_value="100.00",
        acquisition_cost="100.00",
        imported_from_environment="local-test",
        imported_source_id="20",
        imported_at=now,
    )
    db.add(card)
    db.commit()
    db.close()

    contents = linked_image_zip(
        card_images=[
            {
                "id": 200,
                "gift_card_id": 20,
                "image_type": "primary",
                "original_image_url": "/uploads/card-images/source.jpg",
                "original_filename": "card.jpg",
            }
        ],
        files={"card_images/200.jpg": b"card-image"},
    )

    first_result = asyncio.run(data_transfer.apply_transfer(FakeUpload(contents)))
    second_result = asyncio.run(data_transfer.apply_transfer(FakeUpload(contents)))

    assert first_result["created"]["card_images"] == 1
    assert second_result["created"]["card_images"] == 0
    assert second_result["skipped"]["duplicate_card_images"] == 1
    db = session_factory()
    try:
        assert db.query(CardImage).count() == 1
    finally:
        db.close()


def test_linked_image_preview_uses_manifest_counts_without_reading_binaries(
    monkeypatch,
    tmp_path,
):
    configure_transfer_env(monkeypatch, tmp_path)
    from app.api import data_transfer

    def fail_if_copying_binary(*_args, **_kwargs):
        raise AssertionError("preview should not copy or process image binaries")

    monkeypatch.setattr(data_transfer, "copy_archive_file", fail_if_copying_binary)
    db = make_session_factory()()
    package = data_transfer.load_package(
        linked_image_zip(
            card_images=[
                {
                    "id": 200,
                    "gift_card_id": 20,
                    "image_type": "primary",
                    "original_image_url": "/uploads/card-images/source.jpg",
                }
            ],
            files={"card_images/200.jpg": b"x" * 1024},
        )
    )

    preview = data_transfer.preview_package(db, package)

    assert preview["counts"]["card_images"] == 1
    assert preview["plan"]["package_size_bytes"] > 0
    db.close()


def reward_setup_zip() -> bytes:
    now = utc_now().isoformat()
    payloads = {
        "manifest.json": {
            "export_version": "1.0",
            "exported_at": now,
            "source_environment": "local-test",
            "package_type": "core",
            "include_reward_setup": True,
            "source_record_ids": {"purchases": [], "sales": []},
        },
        "purchases.json": [],
        "cards.json": [],
        "purchase_payments.json": [],
        "sales.json": [],
        "fuel_transactions.json": [],
        "receipts.json": [],
        "card_images.json": [],
        "sale_gift_cards.json": [],
        "sale_fuel_accounts.json": [],
        "sale_events.json": [],
        "buyers.json": [],
        "payment_accounts.json": [],
        "fuel_accounts.json": [],
        "players.json": [],
        "credit_cards.json": [
            {
                "id": 10,
                "nickname": "Savor",
                "issuer": "Capital One",
                "network": "Mastercard",
                "last_four": "1234",
                "reward_program_id": 5,
                "rewards_type": "points",
                "rewards_rate": None,
                "is_active": True,
            }
        ],
        "reward_programs.json": [
            {
                "id": 5,
                "name": "Capital One Miles",
                "short_code": "CAP1",
                "category": "Bank",
                "eligible_for_credit_cards": True,
                "active": True,
            }
        ],
        "spending_categories.json": [
            {"id": 1, "key": "grocery", "name": "Grocery", "active": True}
        ],
        "stores.json": [
            {
                "id": 2,
                "name": "Target",
                "merchant_type": "target",
                "merchant_category": "target",
                "spending_category_id": 1,
                "active": True,
            }
        ],
        "credit_card_reward_rules.json": [
            {
                "id": 100,
                "credit_card_id": 10,
                "spending_category_id": 1,
                "store_id": None,
                "reward_program_id": 5,
                "reward_type": "points",
                "merchant_type": None,
                "multiplier": "3.0000",
                "value": "3.0000",
                "priority": 100,
                "effective_start_date": "2026-01-01",
                "effective_end_date": None,
                "active": True,
            },
            {
                "id": 101,
                "credit_card_id": 10,
                "spending_category_id": 1,
                "store_id": 2,
                "reward_program_id": None,
                "reward_type": "instant_discount_percent",
                "merchant_type": "target",
                "multiplier": "0.0000",
                "value": "5.0000",
                "priority": 10,
                "effective_start_date": "2026-01-01",
                "effective_end_date": None,
                "active": True,
            },
        ],
    }
    buffer = BytesIO()
    with ZipFile(buffer, "w", ZIP_DEFLATED) as zip_file:
        for filename, payload in payloads.items():
            zip_file.writestr(filename, json.dumps(payload, default=str))
    return buffer.getvalue()


def test_reward_setup_import_uses_natural_keys_and_updates_card(monkeypatch, tmp_path):
    configure_transfer_env(monkeypatch, tmp_path)
    from app.api import data_transfer

    session_factory = make_session_factory()
    monkeypatch.setattr(data_transfer, "SessionLocal", session_factory)
    db = session_factory()
    db.add(
        CreditCard(
            nickname="Savor",
            issuer="Capital One",
            network="Mastercard",
            last_four="1234",
            credit_limit="10000",
            rewards_type="OTHER",
        )
    )
    db.commit()
    db.close()

    result = asyncio.run(data_transfer.apply_transfer(FakeUpload(reward_setup_zip())))

    assert result["created"]["purchases"] == 0
    db = session_factory()
    try:
        card = db.query(CreditCard).filter(CreditCard.nickname == "Savor").one()
        program = db.query(RewardProgram).filter(RewardProgram.short_code == "CAP1").one()
        category = db.query(SpendingCategory).filter(SpendingCategory.name == "Grocery").one()
        rules = db.query(CreditCardRewardRule).order_by(CreditCardRewardRule.priority.asc()).all()
        assert card.reward_program_id == program.id
        assert card.rewards_type == "points"
        assert len(rules) == 2
        assert rules[0].reward_type == "instant_discount_percent"
        assert rules[0].merchant_type == "target"
        assert rules[0].value == 5
        assert rules[1].credit_card_id == card.id
        assert rules[1].spending_category_id == category.id
        assert rules[1].reward_program_id == program.id
        assert rules[1].multiplier == 3
    finally:
        db.close()


def test_reward_setup_repeated_import_reuses_rules(monkeypatch, tmp_path):
    configure_transfer_env(monkeypatch, tmp_path)
    from app.api import data_transfer

    session_factory = make_session_factory()
    monkeypatch.setattr(data_transfer, "SessionLocal", session_factory)
    db = session_factory()
    db.add(
        CreditCard(
            nickname="Savor",
            issuer="Capital One",
            network="Mastercard",
            last_four="1234",
            credit_limit="10000",
            rewards_type="OTHER",
        )
    )
    db.commit()
    db.close()

    contents = reward_setup_zip()
    asyncio.run(data_transfer.apply_transfer(FakeUpload(contents)))
    preview = data_transfer.preview_package(session_factory(), data_transfer.load_package(contents))

    assert preview["plan"]["reuse"]["credit_card_reward_rules"] == 2
    assert preview["plan"]["create"]["credit_card_reward_rules"] == 0
    db = session_factory()
    try:
        assert db.query(CreditCardRewardRule).count() == 2
    finally:
        db.close()


def test_reward_setup_preview_skips_rule_when_target_card_missing(monkeypatch, tmp_path):
    configure_transfer_env(monkeypatch, tmp_path)
    from app.api import data_transfer

    db = make_session_factory()()
    preview = data_transfer.preview_package(db, data_transfer.load_package(reward_setup_zip()))

    assert preview["plan"]["skipped"]["credit_card_reward_rules"] == 2
    assert preview["plan"]["skipped_reward_rules"][0]["missing"] == ["credit_card"]
    db.close()
