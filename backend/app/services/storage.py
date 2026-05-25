from __future__ import annotations

import hashlib
import io
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO

from app.core.config import settings


@dataclass
class StoredObject:
    storage_backend: str
    bucket: str | None
    object_key: str
    original_filename: str | None
    content_type: str | None
    size_bytes: int
    checksum: str


class StorageBackend:
    name = "base"

    def save(
        self,
        *,
        object_key: str,
        data: bytes,
        original_filename: str | None = None,
        content_type: str | None = None,
    ) -> StoredObject:
        raise NotImplementedError

    def open(self, object_key: str) -> BinaryIO:
        raise NotImplementedError

    def read(self, object_key: str) -> bytes:
        with self.open(object_key) as stream:
            return stream.read()

    def generate_view_url(self, object_key: str, expires_in: int = 3600) -> str:
        raise NotImplementedError

    def delete_or_mark_purged(self, object_key: str) -> bool:
        raise NotImplementedError

    def local_path(self, object_key: str) -> Path | None:
        return None

    def materialize_to_local(self, object_key: str) -> Path:
        local_path = self.local_path(object_key)
        if local_path is not None:
            return local_path
        suffix = Path(object_key).suffix
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as target:
            target.write(self.read(object_key))
            return Path(target.name)


def normalize_object_key(object_key: str) -> str:
    cleaned = object_key.strip().lstrip("/")
    if cleaned.startswith("uploads/"):
        cleaned = cleaned[len("uploads/") :]
    return cleaned


def checksum_for(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class LocalStorageBackend(StorageBackend):
    name = "local"

    def __init__(self, root: Path) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def path_for(self, object_key: str) -> Path:
        key = normalize_object_key(object_key)
        path = self.root / key
        try:
            path.resolve().relative_to(self.root.resolve())
        except ValueError as exc:
            raise ValueError("Object key escapes upload root.") from exc
        return path

    def save(
        self,
        *,
        object_key: str,
        data: bytes,
        original_filename: str | None = None,
        content_type: str | None = None,
    ) -> StoredObject:
        key = normalize_object_key(object_key)
        path = self.path_for(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return StoredObject(
            storage_backend=self.name,
            bucket=None,
            object_key=key,
            original_filename=original_filename,
            content_type=content_type,
            size_bytes=len(data),
            checksum=checksum_for(data),
        )

    def open(self, object_key: str) -> BinaryIO:
        return self.path_for(object_key).open("rb")

    def generate_view_url(self, object_key: str, expires_in: int = 3600) -> str:
        return f"/uploads/{normalize_object_key(object_key)}"

    def delete_or_mark_purged(self, object_key: str) -> bool:
        path = self.path_for(object_key)
        if not path.exists() or not path.is_file():
            return False
        path.unlink()
        return True

    def local_path(self, object_key: str) -> Path | None:
        return self.path_for(object_key)


class S3StorageBackend(StorageBackend):
    name = "s3"

    def __init__(self, *, bucket: str, region: str | None = None, prefix: str = "") -> None:
        self.bucket = bucket
        self.region = region
        self.prefix = normalize_object_key(prefix) if prefix else ""
        try:
            import boto3
        except ImportError as exc:  # pragma: no cover - optional production dependency
            raise RuntimeError("boto3 is required when STORAGE_BACKEND=s3") from exc
        self.client = boto3.client("s3", region_name=region)

    def full_key(self, object_key: str) -> str:
        key = normalize_object_key(object_key)
        return f"{self.prefix}/{key}" if self.prefix else key

    def save(
        self,
        *,
        object_key: str,
        data: bytes,
        original_filename: str | None = None,
        content_type: str | None = None,
    ) -> StoredObject:
        key = normalize_object_key(object_key)
        extra_args = {"ContentType": content_type} if content_type else {}
        self.client.put_object(
            Bucket=self.bucket,
            Key=self.full_key(key),
            Body=data,
            **extra_args,
        )
        return StoredObject(
            storage_backend=self.name,
            bucket=self.bucket,
            object_key=key,
            original_filename=original_filename,
            content_type=content_type,
            size_bytes=len(data),
            checksum=checksum_for(data),
        )

    def open(self, object_key: str) -> BinaryIO:
        response = self.client.get_object(Bucket=self.bucket, Key=self.full_key(object_key))
        return response["Body"]

    def generate_view_url(self, object_key: str, expires_in: int = 3600) -> str:
        return self.client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket, "Key": self.full_key(object_key)},
            ExpiresIn=expires_in,
        )

    def delete_or_mark_purged(self, object_key: str) -> bool:
        self.client.delete_object(Bucket=self.bucket, Key=self.full_key(object_key))
        return True


def configured_storage() -> StorageBackend:
    backend = (settings.storage_backend or "local").lower()
    if backend == "local":
        upload_root = Path(
            os.getenv("UPLOAD_ROOT")
            or os.getenv("UPLOADS_DIR")
            or os.getenv("MS_TRACKER_UPLOADS_DIR")
            or settings.ms_tracker_uploads_dir
            or settings.uploads_dir
        ).expanduser()
        return LocalStorageBackend(upload_root)
    if backend == "s3":
        if not settings.s3_bucket:
            raise RuntimeError("S3_BUCKET is required when STORAGE_BACKEND=s3")
        return S3StorageBackend(
            bucket=settings.s3_bucket,
            region=settings.s3_region,
            prefix=settings.s3_prefix,
        )
    raise RuntimeError(f"Unsupported STORAGE_BACKEND: {backend}")


storage = configured_storage()


def object_key_for(*parts: str) -> str:
    return normalize_object_key("/".join(part.strip("/") for part in parts if part.strip("/")))


def bytes_from_stream(stream: BinaryIO | io.BytesIO) -> bytes:
    data = stream.read()
    return data if isinstance(data, bytes) else bytes(data)
