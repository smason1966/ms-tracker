#!/usr/bin/env python
from __future__ import annotations

import argparse
import getpass
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from app.db.session import SessionLocal
from app.models.admin_user import AdminUser
from app.services.auth_security import hash_password
from app.utils.time import utc_now


def create_or_update_admin_user(
    db,
    *,
    username: str,
    password: str,
) -> AdminUser:
    cleaned_username = username.strip().lower()
    if not cleaned_username:
        raise ValueError("Admin username is required")
    if not password:
        raise ValueError("Admin password is required")

    admin = db.query(AdminUser).filter(AdminUser.username == cleaned_username).first()
    if admin is None:
        admin = AdminUser(
            username=cleaned_username,
            password_hash=hash_password(password),
            active=True,
        )
        db.add(admin)
    else:
        admin.password_hash = hash_password(password)
        admin.active = True
        admin.failed_login_count = 0
        admin.locked_until = None
        admin.updated_at = utc_now()

    db.commit()
    db.refresh(admin)
    return admin


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create or rotate the single Dotopoly admin user password."
    )
    parser.add_argument("--username", default=os.getenv("ADMIN_USERNAME"))
    parser.add_argument(
        "--password",
        default=os.getenv("ADMIN_PASSWORD"),
        help="Optional for automation. Prefer interactive prompt.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    username = args.username or input("Admin username: ").strip()
    password = args.password or getpass.getpass("Admin password: ")
    if not args.password:
        confirmation = getpass.getpass("Confirm admin password: ")
        if password != confirmation:
            print("Passwords do not match.", file=sys.stderr)
            return 1

    db = SessionLocal()
    try:
        admin = create_or_update_admin_user(
            db,
            username=username,
            password=password,
        )
    finally:
        db.close()

    print(f"Admin user ready: {admin.username}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
