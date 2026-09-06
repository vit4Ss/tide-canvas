import contextlib
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import prepare


class PrepareTest(unittest.TestCase):
    def test_init_preserves_keys_and_does_not_print_secrets(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(prepare, "ROOT", Path(tmp)):
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                prepare.init("https://main.example", "https://chat.example")
                private = Path(tmp) / "private"
                secret = (private / "client-secret").read_text()
                key = (private / "oidc-private.pem").read_bytes()
                prepare.init("https://main.example", "https://chat.example", True)
            self.assertEqual(secret, (private / "client-secret").read_text())
            self.assertEqual(key, (private / "oidc-private.pem").read_bytes())
            self.assertNotIn(secret, output.getvalue())
            self.assertIn("SUPPORTSTOOLS=true", (private / "main.env").read_text())

    def test_merge_preserves_lobe_encryption_secrets_and_backup(self):
        with tempfile.TemporaryDirectory() as tmp:
            target, fragment = Path(tmp) / ".env", Path(tmp) / "fragment"
            original = "# keep\nAUTH_SECRET=original\nKEY_VAULTS_SECRET=vault\nJWKS=existing\nAUTH_SSO_PROVIDERS=old\nAUTH_SSO_PROVIDERS=duplicate\n"
            target.write_text(original, encoding="utf-8")
            fragment.write_text("AUTH_SSO_PROVIDERS=generic-oidc\nAUTH_GENERIC_OIDC_ID=main\n", encoding="utf-8")
            with contextlib.redirect_stdout(io.StringIO()):
                prepare.merge_env(target, fragment)
            merged = target.read_text()
            self.assertIn("KEY_VAULTS_SECRET=vault", merged)
            self.assertIn("JWKS=existing", merged)
            self.assertEqual(merged.count("AUTH_SSO_PROVIDERS="), 1)
            backups = list(Path(tmp).glob(".env.before-lobehub-*"))
            self.assertEqual(len(backups), 1)
            self.assertEqual(backups[0].read_text(), original)

    def test_invalid_origin_or_existing_secret_fails_without_replacement(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(prepare, "ROOT", Path(tmp)):
            for origin in ("http://example.test", "https://example.test/path", "https://user:pass@example.test"):
                with self.assertRaises(ValueError):
                    prepare.init(origin, "https://chat.example")
            private = Path(tmp) / "private"
            private.mkdir()
            (private / "client-secret").write_text("broken")
            with self.assertRaises(ValueError):
                prepare.init("https://main.example", "https://chat.example")
            self.assertEqual((private / "client-secret").read_text(), "broken")


if __name__ == "__main__":
    unittest.main()
