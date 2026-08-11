import argparse
import getpass
import json
import os
import tempfile
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken
from garminconnect import Garmin
from garminconnect.exceptions import (
    GarminConnectAuthenticationError,
    GarminConnectTooManyRequestsError,
)


DEFAULT_ENCRYPTED_TOKEN = Path(__file__).with_name("garmin_tokens.enc")
TOKEN_KEY_ENV = "GARMIN_TOKEN_KEY"
TOKEN_FILENAME = "garmin_tokens.json"
REQUIRED_TOKEN_FIELDS = ("di_token", "di_refresh_token", "di_client_id")


def token_cipher(key: str) -> Fernet:
    try:
        return Fernet(key.strip().encode())
    except (TypeError, ValueError) as exc:
        raise SystemExit(
            f"{TOKEN_KEY_ENV} is not a valid Fernet key. Generate a new one with "
            "garmin_token_manager.py generate-key."
        ) from exc


def validate_token_data(data: bytes) -> None:
    try:
        payload = json.loads(data)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise SystemExit("Garmin token data is not valid JSON.") from exc

    missing = [field for field in REQUIRED_TOKEN_FIELDS if not payload.get(field)]
    if missing:
        raise SystemExit(
            "Garmin token data is missing required field(s): " + ", ".join(missing)
        )


def atomic_write(path: Path, data: bytes, mode: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    try:
        temporary.write_bytes(data)
        temporary.chmod(mode)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def encrypt_token_file(token_file: Path, encrypted_file: Path, key: str) -> None:
    data = token_file.read_bytes()
    validate_token_data(data)
    atomic_write(encrypted_file, token_cipher(key).encrypt(data), 0o600)


def decrypt_token_file(encrypted_file: Path, token_file: Path, key: str) -> None:
    try:
        data = token_cipher(key).decrypt(encrypted_file.read_bytes())
    except InvalidToken as exc:
        raise SystemExit(
            f"Could not decrypt {encrypted_file}. Check the {TOKEN_KEY_ENV} secret."
        ) from exc
    validate_token_data(data)
    atomic_write(token_file, data, 0o600)


def bootstrap(email: str, encrypted_file: Path, key: str, is_cn: bool) -> None:
    password = getpass.getpass("Garmin password: ")
    with tempfile.TemporaryDirectory(prefix="garmin-login-") as directory:
        token_file = Path(directory) / TOKEN_FILENAME
        client = Garmin(
            email=email,
            password=password,
            is_cn=is_cn,
            prompt_mfa=lambda: input("Garmin MFA code: ").strip(),
        )
        try:
            client.login(str(token_file))
        except GarminConnectTooManyRequestsError as exc:
            raise SystemExit(
                "Garmin rate-limited the initial login. Do not retry repeatedly; "
                "wait and run bootstrap once from your home network."
            ) from exc
        except GarminConnectAuthenticationError as exc:
            raise SystemExit(
                "Garmin rejected the login. Check the account, password, and MFA code."
            ) from exc
        encrypt_token_file(token_file, encrypted_file, key)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Create and manage the encrypted Garmin DI OAuth token."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("generate-key", help="print a new GARMIN_TOKEN_KEY")

    bootstrap_parser = subparsers.add_parser(
        "bootstrap", help="log in once and create the encrypted token file"
    )
    bootstrap_parser.add_argument("--email", default=os.environ.get("GARMIN_EMAIL"))
    bootstrap_parser.add_argument("--output", type=Path, default=DEFAULT_ENCRYPTED_TOKEN)
    bootstrap_parser.add_argument("--is-cn", action="store_true")

    args = parser.parse_args()
    if args.command == "generate-key":
        print(Fernet.generate_key().decode())
        return

    existing_key = os.environ.get(TOKEN_KEY_ENV)
    key = existing_key or Fernet.generate_key().decode()
    email = args.email or input("Garmin email: ").strip()
    bootstrap(email, args.output, key, args.is_cn)
    print(f"Encrypted Garmin token written to {args.output}")
    if not existing_key:
        print(f"Add this exact value as the GitHub Actions secret {TOKEN_KEY_ENV}:")
        print(key)


if __name__ == "__main__":
    main()
