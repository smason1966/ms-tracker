from cryptography.fernet import Fernet
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.base import Base
from app.models.buyer import Buyer
from app.models.extraction_attempt import ExtractionAttempt
from app.models.extraction_candidate import ExtractionCandidate
from app.models.fuel_point_entry import FuelPointEntry
from app.models.fuel_reward_account import FuelRewardAccount
from app.models.gift_card import GiftCard
from app.models.purchase_batch import PurchaseBatch
from app.services.field_encryption import (
    ENCRYPTED_FIELD_PREFIX,
    _fernet,
    decrypt_field,
    encrypt_field,
    validate_field_encryption_configuration,
)


def make_session_factory():
    from scripts.encrypt_sensitive_fields import initialize_model_registry

    initialize_model_registry()
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


def test_field_encryption_round_trips_without_plaintext(monkeypatch):
    monkeypatch.setenv("FIELD_ENCRYPTION_KEY", Fernet.generate_key().decode())
    _fernet.cache_clear()

    encrypted_value = encrypt_field("secret-pin")

    assert encrypted_value != "secret-pin"
    assert encrypted_value.startswith(ENCRYPTED_FIELD_PREFIX)
    assert decrypt_field(encrypted_value) == "secret-pin"

    _fernet.cache_clear()


def test_staging_requires_field_encryption_key(monkeypatch):
    monkeypatch.delenv("FIELD_ENCRYPTION_KEY", raising=False)
    monkeypatch.setenv("APP_ENV", "staging")
    _fernet.cache_clear()

    try:
        try:
            validate_field_encryption_configuration()
        except RuntimeError as exc:
            assert "FIELD_ENCRYPTION_KEY is required" in str(exc)
        else:
            raise AssertionError("Expected missing FIELD_ENCRYPTION_KEY to fail")
    finally:
        _fernet.cache_clear()


def test_fuel_account_password_is_encrypted_at_rest(monkeypatch, tmp_path):
    monkeypatch.setenv("FIELD_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setenv("MS_TRACKER_UPLOADS_DIR", str(tmp_path / "uploads"))
    _fernet.cache_clear()
    from app.api.fuel_accounts import FuelRewardAccountCreate, create_fuel_account

    session_factory = make_session_factory()
    monkeypatch.setattr("app.api.fuel_accounts.SessionLocal", session_factory)

    response = create_fuel_account(
        FuelRewardAccountCreate(
            retailer="Kroger",
            email="buyer@example.com",
            login_password="123456",
        )
    )

    assert response["login_password"] == "123456"

    db = session_factory()
    stored = db.get(FuelRewardAccount, response["id"])
    assert stored.login_password != "123456"
    assert stored.login_password.startswith(ENCRYPTED_FIELD_PREFIX)
    db.close()
    _fernet.cache_clear()


def test_extraction_attempt_api_encrypts_and_decrypts(monkeypatch):
    monkeypatch.setenv("FIELD_ENCRYPTION_KEY", Fernet.generate_key().decode())
    _fernet.cache_clear()
    from app.api.extraction_attempts import (
        ExtractionAttemptCreate,
        create_extraction_attempt,
        list_extraction_attempts,
    )

    session_factory = make_session_factory()
    monkeypatch.setattr("app.api.extraction_attempts.SessionLocal", session_factory)

    created = create_extraction_attempt(
        ExtractionAttemptCreate(
            gift_card_id=1,
            method="ocr_test",
            extracted_card_number="6332260074021047",
            extracted_pin="1350",
            raw_text="Best Buy card 6332260074021047 pin 1350",
        )
    )

    assert created["extracted_card_number"] == "6332260074021047"
    assert created["extracted_pin"] == "1350"
    assert "6332260074021047" in created["raw_text"]

    db = session_factory()
    stored = db.get(ExtractionAttempt, created["id"])
    assert stored.extracted_card_number.startswith(ENCRYPTED_FIELD_PREFIX)
    assert stored.extracted_pin.startswith(ENCRYPTED_FIELD_PREFIX)
    assert stored.raw_text.startswith(ENCRYPTED_FIELD_PREFIX)
    assert stored.extracted_card_number != "6332260074021047"
    assert stored.extracted_pin != "1350"
    assert "6332260074021047" not in stored.raw_text
    db.close()

    listed = list_extraction_attempts(1)
    assert listed[0]["extracted_card_number"] == "6332260074021047"
    assert listed[0]["extracted_pin"] == "1350"
    assert "6332260074021047" in listed[0]["raw_text"]
    _fernet.cache_clear()


def test_extraction_candidate_api_decrypts_encrypted_values(monkeypatch):
    monkeypatch.setenv("FIELD_ENCRYPTION_KEY", Fernet.generate_key().decode())
    _fernet.cache_clear()
    from app.api.extraction_candidates import list_extraction_candidates

    session_factory = make_session_factory()
    setup_db = session_factory()
    attempt = ExtractionAttempt(
        gift_card_id=1,
        method="ocr_test",
        extracted_card_number=encrypt_field("6332260074021047"),
        extracted_pin=encrypt_field("1350"),
        raw_text=encrypt_field("Best Buy card 6332260074021047 pin 1350"),
    )
    setup_db.add(attempt)
    setup_db.flush()
    candidate = ExtractionCandidate(
        extraction_attempt_id=attempt.id,
        gift_card_id=1,
        candidate_type="pin",
        source="zone_consensus",
        value=encrypt_field("1350"),
        confidence_score=0.99,
        notes=encrypt_field("PIN candidate from zone"),
    )
    setup_db.add(candidate)
    setup_db.commit()
    setup_db.close()
    monkeypatch.setattr("app.api.extraction_candidates.SessionLocal", session_factory)

    candidates = list_extraction_candidates(1)

    assert candidates[0]["value"] == "1350"
    assert candidates[0]["notes"] == "PIN candidate from zone"
    _fernet.cache_clear()


def test_sensitive_field_backfill_initializes_models_and_encrypts(
    monkeypatch,
    capsys,
):
    monkeypatch.setenv("FIELD_ENCRYPTION_KEY", Fernet.generate_key().decode())
    _fernet.cache_clear()
    from scripts import encrypt_sensitive_fields

    session_factory = make_session_factory()
    setup_db = session_factory()
    card = GiftCard(
        purchase_batch_id=1,
        brand="Best Buy",
        face_value=100,
        acquisition_cost=100,
        card_number_encrypted="6332260074021047",
        pin_encrypted="1350",
        confirmed_card_number="6332260074021047",
        confirmed_pin="1350",
        detected_card_number="6332260074021047",
        detected_pin="1350",
        status="VERIFIED_AVAILABLE",
    )
    attempt = ExtractionAttempt(
        gift_card_id=1,
        method="ocr_test",
        extracted_card_number="6332260074021047",
        extracted_pin="1350",
        raw_text="Best Buy card 6332260074021047 pin 1350",
    )
    account = FuelRewardAccount(
        retailer="Kroger",
        login_password="fuel-secret",
        status="ACTIVE",
    )
    setup_db.add_all([card, attempt, account])
    setup_db.flush()
    candidate = ExtractionCandidate(
        extraction_attempt_id=attempt.id,
        gift_card_id=1,
        candidate_type="pin",
        source="zone_consensus",
        value="1350",
        confidence_score=0.99,
        notes="PIN candidate 1350",
    )
    setup_db.add(candidate)
    setup_db.commit()
    card_id = card.id
    attempt_id = attempt.id
    candidate_id = candidate.id
    account_id = account.id
    setup_db.close()

    monkeypatch.setattr(encrypt_sensitive_fields, "SessionLocal", session_factory)
    monkeypatch.setattr("sys.argv", ["encrypt_sensitive_fields.py", "--apply"])

    assert encrypt_sensitive_fields.main() == 0

    output = capsys.readouterr().out
    assert "APPLY: gift cards affected: 1" in output
    assert "APPLY: extraction attempts affected: 1" in output
    assert "APPLY: extraction candidates affected: 1" in output
    assert "6332260074021047" not in output
    assert "1350" not in output
    assert "fuel-secret" not in output

    db = session_factory()
    stored_card = db.get(GiftCard, card_id)
    stored_attempt = db.get(ExtractionAttempt, attempt_id)
    stored_candidate = db.get(ExtractionCandidate, candidate_id)
    stored_account = db.get(FuelRewardAccount, account_id)
    assert stored_card.confirmed_card_number.startswith(ENCRYPTED_FIELD_PREFIX)
    assert stored_card.confirmed_pin.startswith(ENCRYPTED_FIELD_PREFIX)
    assert stored_card.confirmed_card_number != "6332260074021047"
    assert stored_card.confirmed_pin != "1350"
    assert stored_card.detected_card_number.startswith(ENCRYPTED_FIELD_PREFIX)
    assert stored_card.detected_pin.startswith(ENCRYPTED_FIELD_PREFIX)
    assert stored_attempt.extracted_card_number.startswith(ENCRYPTED_FIELD_PREFIX)
    assert stored_attempt.extracted_pin.startswith(ENCRYPTED_FIELD_PREFIX)
    assert stored_attempt.raw_text.startswith(ENCRYPTED_FIELD_PREFIX)
    assert "6332260074021047" not in stored_attempt.raw_text
    assert stored_candidate.value.startswith(ENCRYPTED_FIELD_PREFIX)
    assert stored_candidate.notes.startswith(ENCRYPTED_FIELD_PREFIX)
    assert stored_candidate.value != "1350"
    assert stored_account.login_password.startswith(ENCRYPTED_FIELD_PREFIX)
    assert stored_account.login_password != "fuel-secret"
    db.close()
    _fernet.cache_clear()
