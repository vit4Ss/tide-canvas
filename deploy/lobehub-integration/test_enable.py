import contextlib
import copy
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import enable


class ConfigurationTests(unittest.TestCase):
    def test_compose_preserves_user_configuration_and_repeated_run(self):
        original = """services:
  backend:
    image: existing:image
    environment:
      EXISTING_SECRET: never-change-me
      MODE: on
      TIDECANVAS_LOBEHUB_ENABLED: 'false'
    env_file: existing.env
    volumes:
      - uploads-data:/app/data/uploads
  frontend:
    image: existing:frontend
volumes:
  uploads-data: {}
"""
        first = enable.patch_compose(original, "backend", "/private/main.env", {"TIDECANVAS_LOBEHUB_ENABLED"}, "/private/key.pem")
        second = enable.patch_compose(first, "backend", "/private/main.env", {"TIDECANVAS_LOBEHUB_ENABLED"}, "/private/key.pem")
        self.assertEqual(first, second)
        result = enable.yaml_load(first)
        service = result["services"]["backend"]
        self.assertEqual(service["environment"], {"EXISTING_SECRET": "never-change-me", "MODE": "on"})
        self.assertEqual(service["env_file"], ["existing.env", "/private/main.env"])
        self.assertIn("uploads-data:/app/data/uploads", service["volumes"])
        self.assertEqual(result["services"]["frontend"], {"image": "existing:frontend"})

    def test_lobe_list_environment_retains_encryption_secrets(self):
        original = """services:
  lobe:
    env_file: .env
    environment:
      - KEY_VAULTS_SECRET=${KEY_VAULTS_SECRET}
      - AUTH_SECRET=${AUTH_SECRET}
      - AUTH_SSO_PROVIDERS=old
"""
        result = enable.yaml_load(enable.patch_compose(original, "lobe", "/root/lobehub-db/.env", {"AUTH_SSO_PROVIDERS"}))
        self.assertEqual(result["services"]["lobe"]["environment"], ["KEY_VAULTS_SECRET=${KEY_VAULTS_SECRET}", "AUTH_SECRET=${AUTH_SECRET}"])

    def test_nginx_changes_only_https_and_understands_json_braces(self):
        original = """server {
  listen 80;
  server_name chat.example;
  return 301 https://$host$request_uri;
}
server {
  listen 443 ssl;
  server_name chat.example;
  # a comment with an unmatched brace }
  location / { return 200 '{"object":{"ok":true}}'; }
}
"""
        changed = enable.nginx_include(original, "chat.example", "/new/snippet.conf", "/old/snippet.conf")
        self.assertEqual(changed[:changed.index("server {", 1)], original[:original.index("server {", 1)])
        self.assertEqual(changed.count("include /new/snippet.conf;"), 1)
        self.assertEqual(enable.nginx_include(changed, "chat.example", "/new/snippet.conf", "/old/snippet.conf"), changed)

    def test_nginx_replaces_the_old_manual_include(self):
        original = 'server { listen 443 ssl; server_name chat.example; include /old/snippet.conf; location / { proxy_pass http://127.0.0.1:3210; } }'
        changed = enable.nginx_include(original, "chat.example", "/new/snippet.conf", "/old/snippet.conf")
        self.assertNotIn("include /old/", changed)
        self.assertEqual(changed.count("include /new/snippet.conf;"), 1)

    def test_ambiguous_server_is_rejected(self):
        block = 'server { listen 443 ssl; server_name chat.example; }'
        with self.assertRaises(enable.SetupError):
            enable.nginx_include(block + block, "chat.example", "/new.conf", "/old.conf")

    def test_semantic_guard_rejects_changes_to_other_services_or_secrets(self):
        before = {"services": {"backend": {"environment": {"SECRET": "original"}, "volumes": []}, "database": {"image": "db:old"}}}
        after = copy.deepcopy(before)
        after["services"]["backend"]["environment"]["MANAGED"] = "true"
        after["services"]["backend"]["volumes"].append({"type": "bind", "target": enable.KEY_TARGET})
        enable.unchanged_config(before, after, "backend", {"MANAGED"}, True)
        for field in ("database", "secret"):
            changed = copy.deepcopy(after)
            if field == "database":
                changed["services"]["database"]["image"] = "db:changed"
            else:
                changed["services"]["backend"]["environment"]["SECRET"] = "changed"
            with self.assertRaises(enable.SetupError):
                enable.unchanged_config(before, changed, "backend", {"MANAGED"}, True)

    def test_backups_restore_exact_bytes_and_remove_only_new_managed_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            original, added, untouched = root / "old.conf", root / "new.conf", root / "unrelated.conf"
            original.write_bytes(b"old\r\nconfiguration\r\n")
            untouched.write_bytes(b"keep")
            backups = enable.Backups(root / "backups", [original, added])
            original.write_bytes(b"modified")
            added.write_bytes(b"created")
            self.assertEqual(backups.restore(), [])
            self.assertEqual(original.read_bytes(), b"old\r\nconfiguration\r\n")
            self.assertFalse(added.exists())
            self.assertEqual(untouched.read_bytes(), b"keep")


class RollbackTests(unittest.TestCase):
    def test_failure_after_backend_restart_restores_configs_before_restarting_again(self):
        self.check_rollback("主站")

    def test_failure_after_lobe_and_nginx_updates_restores_both_applications(self):
        self.check_rollback("统一登录")

    def check_rollback(self, fail_at):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = Path(enable.__file__).parent
            main = root / "main.yml"
            lobe = root / "lobe.yml"
            env = root / ".env"
            main_nginx, lobe_nginx = root / "main.conf", root / "lobe.conf"
            main.write_text("services:\n  backend:\n    environment: {EXISTING: keep}\n    volumes: []\n", encoding="utf-8")
            lobe.write_text("services:\n  lobe:\n    env_file: .env\n", encoding="utf-8")
            env.write_text("AUTH_SECRET=existing-secret\nKEY_VAULTS_SECRET=existing-vault\n", encoding="utf-8")
            main_nginx.write_text("server { listen 443 ssl; server_name test-flowlight.tcmzhan.com; }", encoding="utf-8")
            lobe_nginx.write_text("server { listen 443 ssl; server_name test-lobehub.tcmzhan.com; }", encoding="utf-8")
            for name in ("nginx-main-locations.conf", "nginx-lobehub-locations.conf"):
                (root / name).write_bytes((source / name).read_bytes())
            files = (main, lobe, env, main_nginx, lobe_nginx)
            originals = {p: p.read_bytes() for p in files}
            calls = []
            failed = False
            def fake_ready(check, description, **kwargs):
                nonlocal failed
                if description == fail_at:
                    failed = True
                    raise enable.SetupError("simulated unavailable service")
            def fake_compose(path, project, *args):
                calls.append((project, args))
                if args[:1] == ("config",):
                    return '{"services":{}}'
                if failed:
                    for path in files:
                        self.assertEqual(path.read_bytes(), originals[path])
                return ""
            replacements = {"ROOT": root, "MAIN_COMPOSE": main, "LOBE_COMPOSE": lobe, "LOBE_ENV": env, "MAIN_NGINX": main_nginx, "LOBE_NGINX": lobe_nginx, "MAIN_SNIPPET": root / "new-main.conf", "LOBE_SNIPPET": root / "new-lobe.conf"}
            with contextlib.ExitStack() as stack:
                for key, value in replacements.items():
                    stack.enter_context(patch.object(enable, key, value))
                stack.enter_context(patch.object(enable.prepare, "ROOT", root))
                stack.enter_context(patch.object(enable, "compose", side_effect=fake_compose))
                stack.enter_context(patch.object(enable, "command", return_value=""))
                stack.enter_context(patch.object(enable, "unchanged_config"))
                stack.enter_context(patch.object(enable, "wait_ready", side_effect=fake_ready))
                stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
                with self.assertRaises(enable.SetupError):
                    enable.apply_configuration(({}, {}))
            for path in files:
                self.assertEqual(path.read_bytes(), originals[path])
            expected = ["flowfinght", "flowfinght"] if fail_at == "主站" else ["flowfinght", "lobehub", "flowfinght", "lobehub"]
            self.assertEqual([project for project, args in calls if args[:1] == ("up",)], expected)


if __name__ == "__main__":
    unittest.main()
