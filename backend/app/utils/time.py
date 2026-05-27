from datetime import UTC, datetime


def utc_now() -> datetime:
    """Return the current UTC time in the app's existing naive DB format."""
    return datetime.now(UTC).replace(tzinfo=None)
