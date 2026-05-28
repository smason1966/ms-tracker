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
    role: str | None = None,
) -> AdminUser:
    cleaned_username = username.strip().lower()
    if not cleaned_username:
        raise ValueError("Username is required")
    if not password:
        raise ValueError("Password is required")
    if role is not None and role not in {"admin", "tester"}:
        raise ValueError("Role must be admin or tester")

    admin = db.query(AdminUser).filter(AdminUser.username == cleaned_username).first()
    if admin is None:
        admin = AdminUser(
            username=cleaned_username,
            password_hash=hash_password(password),
            role=role or "admin",
            active=True,
        )
        db.add(admin)
    else:
        admin.password_hash = hash_password(password)
        if role is not None:
            admin.role = role
        admin.active = True
        admin.failed_login_count = 0
        admin.locked_until = None
        admin.updated_at = utc_now()

    db.commit()
    db.refresh(admin)
    return admin


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create or update a Dotopoly app user password and role."
    )
    parser.add_argument("--username", default=os.getenv("ADMIN_USERNAME"))
    parser.add_argument(
        "--password",
        default=os.getenv("ADMIN_PASSWORD"),
        help="Optional for automation. Prefer interactive prompt.",
    )
    parser.add_argument(
        "--role",
        choices=["admin", "tester"],
        default=os.getenv("ADMIN_ROLE"),
        help="Optional role. Existing users keep their role unless this is provided.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    username = args.username or input("Username: ").strip()
    password = args.password or getpass.getpass(f"Password for {username}: ")
    if not args.password:
        confirmation = getpass.getpass(f"Confirm password for {username}: ")
        if password != confirmation:
            print("Passwords do not match.", file=sys.stderr)
            return 1

    db = SessionLocal()
    try:
        admin = create_or_update_admin_user(
            db,
            username=username,
            password=password,
            role=args.role,
        )
    finally:
        db.close()

    print(f"Admin user ready: {admin.username} (role: {admin.role})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
