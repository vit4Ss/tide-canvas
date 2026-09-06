import contextlib
import datetime
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

import enable
import fix_upload


class UploadTests(unittest.TestCase):
    def test_proxy_preserves_signature_path_and_does_not_forward_session_cookies(self):
        text = fix_upload.storage_routes("lobe")
        self.assertIn("location = /lobe {", text)
        self.assertIn("location ^~ /lobe/ {", text)
        self.assertEqual(text.count("proxy_pass http://127.0.0.1:9000;"), 2)
        self.assertIn("proxy_set_header Host $http_host;", text)
        self.assertIn('proxy_set_header Cookie "";', text)
        self.assertNotIn("auth_request", text)
        for name in ("api", "trpc", "../private", "lobe; return 200"):
            with self.assertRaises(enable.SetupError):
                fix_upload.storage_routes(name)

    def test_signed_url_binds_method_host_path_and_has_short_expiry(self):
        now = datetime.datetime(2026, 9, 6, tzinfo=datetime.timezone.utc)
        args = ("https://chat.example", "lobe", "a b.png", "PUT", "test-access", "test-secret")
        url = fix_upload.signed_url(*args, now=now)
        parsed = urlsplit(url)
        query = parse_qs(parsed.query)
        self.assertEqual(parsed.path, "/lobe/a%20b.png")
        self.assertEqual(query["X-Amz-Expires"], ["60"])
        self.assertEqual(query["X-Amz-SignedHeaders"], ["host"])
        self.assertNotIn("test-secret", url)
        self.assertNotEqual(url, fix_upload.signed_url(*args[:3], "GET", *args[4:], now=now))
        self.assertNotEqual(query["X-Amz-Signature"], parse_qs(urlsplit(fix_upload.signed_url("https://other.example", *args[1:], now=now)).query)["X-Amz-Signature"])

    def test_probe_cleans_only_its_own_object_even_after_failed_readback(self):
        env = {"S3_BUCKET": "lobe", "S3_ACCESS_KEY_ID": "test-key", "S3_SECRET_ACCESS_KEY": "test-secret"}
        for fail in (False, True):
            calls = []
            def request(url, method, data=None):
                calls.append((urlsplit(url), method, data))
                if method == "GET":
                    return b"bad response" if fail else fix_upload.PNG
                return b""
            if fail:
                with self.assertRaises(enable.SetupError):
                    fix_upload.probe_upload(env, "https://chat.example", request=request)
            else:
                fix_upload.probe_upload(env, "https://chat.example", request=request)
            self.assertEqual([c[1] for c in calls], ["PUT", "GET", "DELETE"])
            self.assertTrue(calls[0][0].path.startswith("/lobe/" + fix_upload.PROBE_PREFIX))
            self.assertEqual(len({c[0].path for c in calls}), 1)
            self.assertEqual(calls[2][0].netloc, "127.0.0.1:9000")
            self.assertEqual(calls[0][2], fix_upload.PNG)

    def test_failed_verification_restores_config_and_only_restarts_lobe(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            compose = root / "compose.yml"
            nginx = root / "nginx.conf"
            snippet = root / "storage.conf"
            compose.write_text("services:\n  lobe:\n    image: lobehub/lobehub\n    env_file: .env\n    environment:\n      S3_ENDPOINT: https://missing.example\n      AUTH_SECRET: keep\n", encoding="utf-8")
            nginx.write_text("server { listen 443 ssl; server_name test-lobehub.tcmzhan.com; location / { proxy_pass http://127.0.0.1:3210; } }", encoding="utf-8")
            originals = {path: path.read_bytes() for path in (compose, nginx)}
            before = {"services": {"lobe": {"environment": {"AUTH_SECRET": "keep", "S3_ENDPOINT": "https://missing.example"}}}}
            env = {"APP_URL": enable.LOBE_URL, "S3_BUCKET": "lobe", "S3_ACCESS_KEY_ID": "test-key", "S3_SECRET_ACCESS_KEY": "test-secret"}
            restarts = []
            failed = False
            def fake_compose(path, project, *args):
                if args[0] == "config":
                    return json.dumps(before)
                if failed:
                    for target, data in originals.items():
                        self.assertEqual(target.read_bytes(), data)
                restarts.append((project, args))
                return ""
            def fake_probe(*args):
                nonlocal failed
                failed = True
                raise enable.SetupError("test upload rejected")
            def fake_command(args):
                if args[:2] == ["docker", "inspect"]:
                    return json.dumps([{"State": {"Status": "running"}, "NetworkSettings": {"Ports": {"9000/tcp": [{"HostPort": "9000"}]}}}])
                return ""
            with contextlib.ExitStack() as stack:
                for key, value in {"ROOT": root, "LOBE_COMPOSE": compose, "LOBE_NGINX": nginx}.items():
                    stack.enter_context(patch.object(enable, key, value))
                stack.enter_context(patch.object(fix_upload, "STORAGE_SNIPPET", snippet))
                stack.enter_context(patch.object(enable, "preflight", return_value=({}, before)))
                stack.enter_context(patch.object(fix_upload, "runtime_env", side_effect=[env, {**env, "S3_ENDPOINT": enable.LOBE_URL}]))
                stack.enter_context(patch.object(enable, "command", side_effect=fake_command))
                stack.enter_context(patch.object(enable, "compose", side_effect=fake_compose))
                stack.enter_context(patch.object(enable, "wait_ready"))
                stack.enter_context(patch.object(fix_upload, "probe_upload", side_effect=fake_probe))
                stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
                with self.assertRaises(enable.SetupError):
                    fix_upload.repair()
            for target, data in originals.items():
                self.assertEqual(target.read_bytes(), data)
            self.assertFalse(snippet.exists())
            self.assertFalse((root / "private/lobehub-storage.env").exists())
            self.assertEqual(len(restarts), 2)
            self.assertTrue(all(project == "lobehub" and args[-1] == "lobe" and "--no-deps" in args for project, args in restarts))


if __name__ == "__main__":
    unittest.main()
