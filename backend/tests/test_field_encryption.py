from cryptography.fernet import Fernet
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.base import Base
from app.models.buyer import Buyer
from app.models.fuel_point_entry import FuelPointEntry
from app.models.fuel_reward_account import FuelRewardAccount
from app.models.purchase_batch import PurchaseBatch
from app.services.field_encryption import (
    ENCRYPTED_FIELD_PREFIX,
    _fernet,
    decrypt_field,
    encrypt_field,
    validate_field_encryption_configuration,
)


def make_session_factory():
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
