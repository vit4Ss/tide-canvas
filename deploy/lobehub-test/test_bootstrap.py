import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("lobehub_bootstrap", Path(__file__).with_name("bootstrap.py"))
bootstrap = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bootstrap)


class DeploymentPreparationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.previous_root = bootstrap.ROOT
        bootstrap.ROOT = Path(self.directory.name)
        self.env = {
            "APP_URL": "https://test-flowlight.tcmzhan.com:8443",
            "NEXT_PUBLIC_AUTH_URL": "https://test-flowlight.tcmzhan.com:8443",
            "S3_ENDPOINT": "https://test-flowlight.tcmzhan.com:8443",
            "POSTGRES_PASSWORD": "existing-database-password",
            "AUTH_SECRET": "existing-auth-secret",
            "KEY_VAULTS_SECRET": "existing-vault-value==",
            "OPENAI_API_KEY": "existing-api-key",
            "AUTH_ALLOWED_EMAILS": bootstrap.EMAIL,
        }
        self.write_env()
        (bootstrap.ROOT / ".bootstrap-login.json").write_text(json.dumps({
            "url": self.env["APP_URL"], "email": bootstrap.EMAIL, "password": "existing-password",
        }))

    def tearDown(self):
        bootstrap.ROOT = self.previous_root
        self.directory.cleanup()

    def write_env(self):
        (bootstrap.ROOT / ".env").write_text("\n".join(f"{key}={value}" for key, value in self.env.items()) + "\n")

    def read_env(self):
        return dict(line.split("=", 1) for line in (bootstrap.ROOT / ".env").read_text().splitlines())

    def test_domain_change_preserves_secrets_and_is_repeatable(self):
        (bootstrap.ROOT / ".test-access.txt").write_text("old-login-url")
        with contextlib.redirect_stdout(io.StringIO()) as output:
            bootstrap.configure_domain()
            first = self.read_env()
            bootstrap.configure_domain()
        self.assertEqual(first, self.read_env())
        for name, value in self.env.items():
            self.assertEqual(first[name], bootstrap.URL if name in ("APP_URL", "NEXT_PUBLIC_AUTH_URL", "S3_ENDPOINT") else value)
        credentials = json.loads((bootstrap.ROOT / ".bootstrap-login.json").read_text())
        self.assertEqual(credentials["password"], "existing-password")
        self.assertEqual(credentials["url"], "https://test-lobehub.tcmzhan.com")
        self.assertIn(bootstrap.URL, (bootstrap.ROOT / ".test-access.txt").read_text())
        self.assertNotIn("existing-password", output.getvalue())
        if os.name == "posix":
            self.assertEqual((bootstrap.ROOT / ".env").stat().st_mode & 0o777, 0o600)

    def test_prepare_preserves_existing_environment_without_docker_calls(self):
        with patch.object(bootstrap, "run", side_effect=AssertionError("must not call docker")), contextlib.redirect_stdout(io.StringIO()):
            bootstrap.prepare()
        self.assertEqual(self.read_env(), self.env)

    def test_relay_accepts_array_and_openai_model_catalogs_without_printing_keys(self):
        for catalog in ([{"id": "gpt-6-astra"}], {"data": [{"id": "gpt-6-astra"}]}):
            with self.subTest(catalog=type(catalog).__name__):
                self.write_env()
                metadata = [{"Config": {"Env": ["TIDECANVAS_RELAY_APIKEY=scrw_test_only_key"]}}]
                opener = types.SimpleNamespace(open=lambda *args, **kwargs: io.BytesIO(json.dumps(catalog).encode()))
                with patch.object(bootstrap, "run", return_value=types.SimpleNamespace(stdout=json.dumps(metadata))), \
                     patch.object(bootstrap.urllib.request, "build_opener", return_value=opener), \
                     contextlib.redirect_stdout(io.StringIO()) as output:
                    bootstrap.relay()
                self.assertEqual(self.read_env()["OPENAI_API_KEY"], "scrw_test_only_key")
                self.assertEqual(self.read_env()["POSTGRES_PASSWORD"], self.env["POSTGRES_PASSWORD"])
                self.assertNotIn("scrw_test_only_key", output.getvalue())


if __name__ == "__main__":
    unittest.main()
