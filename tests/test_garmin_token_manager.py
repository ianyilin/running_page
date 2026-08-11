import json
import sys
import tempfile
import unittest
from pathlib import Path

from cryptography.fernet import Fernet


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "run_page"))

from garmin_token_manager import decrypt_token_file, encrypt_token_file


class GarminTokenManagerTests(unittest.TestCase):
    def test_encrypted_token_round_trip(self) -> None:
        token = {
            "di_token": "access-token",
            "di_refresh_token": "refresh-token",
            "di_client_id": "client-id",
        }
        key = Fernet.generate_key().decode()

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "garmin_tokens.json"
            encrypted = root / "garmin_tokens.enc"
            restored = root / "restored.json"
            source.write_text(json.dumps(token), encoding="utf-8")

            encrypt_token_file(source, encrypted, key)
            decrypt_token_file(encrypted, restored, key)

            self.assertEqual(json.loads(restored.read_text()), token)
            self.assertNotIn(b"refresh-token", encrypted.read_bytes())

    def test_wrong_key_is_rejected(self) -> None:
        token = {
            "di_token": "access-token",
            "di_refresh_token": "refresh-token",
            "di_client_id": "client-id",
        }

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "garmin_tokens.json"
            encrypted = root / "garmin_tokens.enc"
            source.write_text(json.dumps(token), encoding="utf-8")
            encrypt_token_file(source, encrypted, Fernet.generate_key().decode())

            with self.assertRaisesRegex(SystemExit, "Could not decrypt"):
                decrypt_token_file(
                    encrypted,
                    root / "restored.json",
                    Fernet.generate_key().decode(),
                )


if __name__ == "__main__":
    unittest.main()
