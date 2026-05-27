from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str
    sqlalchemy_echo: bool = False
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


settings = Settings()
