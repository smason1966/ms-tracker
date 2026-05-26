import os
from pathlib import Path

os.environ.setdefault("UPLOAD_ROOT", "/private/tmp/ms-tracker-test-uploads")

from app.services.upload_storage import UPLOAD_ROOT, physical_upload_path


def test_physical_upload_path_resolves_public_upload_reference_with_leading_slash():
    assert physical_upload_path(
        "/uploads/card-images/example.jpg",
    ) == UPLOAD_ROOT / "card-images/example.jpg"


def test_physical_upload_path_resolves_public_upload_reference_without_leading_slash():
    assert physical_upload_path(
        "uploads/card-images/example.jpg",
    ) == UPLOAD_ROOT / "card-images/example.jpg"


def test_physical_upload_path_preserves_true_absolute_paths():
    absolute_path = Path("/var/tmp/card-images/example.jpg")

    assert physical_upload_path(str(absolute_path)) == absolute_path
