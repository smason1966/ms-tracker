from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str
    app_env: str = "local"
    sqlalchemy_echo: bool = False
    auth_enabled: bool = False
    auth_dev_bypass: bool = False
    auth_public_docs: bool = False
    mfa_required: bool = False
    mfa_issuer: str = "Dotopoly"
    session_secret: str | None = None
    session_cookie_name: str = "dotopoly_session"
    session_cookie_secure: bool = True
    session_idle_timeout_minutes: int = 720
    session_absolute_timeout_days: int = 14
    storage_backend: str = "local"
    uploads_dir: str = "/app/uploads"
    ms_tracker_uploads_dir: str | None = None
    s3_bucket: str | None = None
    s3_region: str | None = None
    s3_prefix: str = ""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @model_validator(mode="after")
    def validate_auth_settings(self):
        protected_envs = {"staging", "production", "prod"}
        app_env = (self.app_env or "").strip().lower()
        if self.auth_enabled and app_env in protected_envs and not self.session_secret:
            raise ValueError(
                "SESSION_SECRET is required when AUTH_ENABLED=true in staging or production"
            )
        if self.auth_dev_bypass and app_env in {"production", "prod"}:
            raise ValueError("AUTH_DEV_BYPASS cannot be true in production")
        return self


settings = Settings()
