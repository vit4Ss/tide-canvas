"""Prepare and verify the isolated Hong Kong test deployment; never print keys."""
import argparse
import base64
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parent
URL = "https://test-lobehub.tcmzhan.com"
EMAIL = "lobehub-test@tcmzhan.com"


def run(args, **kwargs):
    return subprocess.run(args, check=True, cwd=ROOT, **kwargs)


def write_private(path, content):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(content)


def replace_private(path, content):
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, prefix=".lobehub-update-", delete=False) as f:
        temporary = Path(f.name)
        f.write(content)
    try:
        os.chmod(temporary, 0o600)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def configure_domain():
    """Migrate public URLs only; never regenerate passwords, keys or data."""
    env_path = ROOT / ".env"
    env = dict(line.split("=", 1) for line in env_path.read_text().splitlines() if "=" in line and not line.startswith("#"))
    env.update(APP_URL=URL, NEXT_PUBLIC_AUTH_URL=URL, S3_ENDPOINT=URL)
    replace_private(env_path, "\n".join(f"{name}={value}" for name, value in env.items()) + "\n")
    credentials_path = ROOT / ".bootstrap-login.json"
    if credentials_path.exists():
        credentials = json.loads(credentials_path.read_text())
        credentials["url"] = URL
        replace_private(credentials_path, json.dumps(credentials))
        if (ROOT / ".test-access.txt").exists():
            replace_private(ROOT / ".test-access.txt", f"URL: {URL}\nEmail: {credentials['email']}\nPassword: {credentials['password']}\n")
    print("Public URL configured:", URL)
    print("Existing passwords and encryption keys preserved")


def prepare():
    if (ROOT / ".env").exists():
        print("Existing environment preserved")
        return
    from cryptography.hazmat.primitives.asymmetric import rsa
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048).private_numbers()
    def b64int(number):
        return base64.urlsafe_b64encode(number.to_bytes((number.bit_length() + 7) // 8, "big")).decode().rstrip("=")
    jwk = {"kty": "RSA", "alg": "RS256", "use": "sig", "kid": secrets.token_hex(12)}
    for name, value in {"n": key.public_numbers.n, "e": key.public_numbers.e, "d": key.d,
                        "p": key.p, "q": key.q, "dp": key.dmp1, "dq": key.dmq1, "qi": key.iqmp}.items():
        jwk[name] = b64int(value)
    env = {
        "APP_URL": URL, "NEXT_PUBLIC_AUTH_URL": URL,
        "AUTH_SECRET": secrets.token_hex(32),
        "KEY_VAULTS_SECRET": base64.b64encode(secrets.token_bytes(32)).decode(),
        "JWKS_KEY": json.dumps({"keys": [jwk]}, separators=(",", ":")),
        "POSTGRES_PASSWORD": secrets.token_hex(24),
        "S3_ENDPOINT": URL, "S3_ACCESS_KEY_ID": secrets.token_hex(12),
        "S3_SECRET_ACCESS_KEY": secrets.token_hex(32),
        "AUTH_ALLOWED_EMAILS": EMAIL, "AUTH_EMAIL_VERIFICATION": "0",
        "OPENAI_PROXY_URL": "https://test-relay.tcmzhan.com/v1",
    }
    # Read only the existing test relay credential, without exposing it in output.
    metadata = json.loads(run(["docker", "inspect", "tidecanvas-backend"], capture_output=True, text=True).stdout)[0]
    existing = dict(item.split("=", 1) for item in metadata["Config"]["Env"] if "=" in item)
    relay_key = existing.get("TIDECANVAS_RELAY_APIKEY", "")
    if relay_key:
        request = urllib.request.Request(env["OPENAI_PROXY_URL"] + "/models", headers={"Authorization": "Bearer " + relay_key})
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                catalog = json.load(response)
            items = catalog if isinstance(catalog, list) else catalog.get("data", [])
            if any(item.get("id") == "gpt-6-astra" for item in items):
                env["OPENAI_API_KEY"] = relay_key
                env["OPENAI_MODEL_LIST"] = "-all,+gpt-6-astra=GPT-6 Astra"
        except Exception:
            print("Relay catalog unavailable; model credentials will remain unconfigured")
    if not (ROOT / ".bootstrap-login.json").exists():
        password = secrets.token_urlsafe(24)
        write_private(ROOT / ".bootstrap-login.json", json.dumps({"url": URL, "email": EMAIL, "password": password}))
    write_private(ROOT / ".env", "\n".join(f"{name}={value}" for name, value in env.items()) + "\n")
    print("Environment created; single-account registration allowlist enabled")
    print("Test relay configured:", "OPENAI_API_KEY" in env)


def account():
    credentials = json.loads((ROOT / ".bootstrap-login.json").read_text())
    def auth(path, payload):
        req = urllib.request.Request("http://127.0.0.1:3210/api/auth/" + path,
            data=json.dumps(payload).encode(), headers={"Content-Type": "application/json", "Origin": URL,
                "Host": urllib.parse.urlsplit(URL).netloc, "X-Forwarded-Proto": "https", "Referer": URL + "/"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, json.load(resp)
    payload = {"email": credentials["email"], "password": credentials["password"], "name": "LobeHub Test"}
    try:
        status, _ = auth("sign-up/email", payload)
        print("Test account created:", status)
    except urllib.error.HTTPError as err:
        if err.code not in (400, 409, 422):
            raise RuntimeError("Account creation failed, HTTP " + str(err.code)) from None
    status, response = auth("sign-in/email", payload)
    if not response.get("user"):
        raise RuntimeError("Login returned no user")
    (ROOT / ".account-ready").touch(mode=0o600)
    # The user can download this file over the authenticated ATerminal SFTP session.
    if not (ROOT / ".test-access.txt").exists():
        write_private(ROOT / ".test-access.txt", f"URL: {URL}\nEmail: {credentials['email']}\nPassword: {credentials['password']}\n")
    print("Test account sign-in verified:", status)


def relay():
    """Probe only the existing test gateway; save a key only after validation."""
    metadata = json.loads(run(["docker", "inspect", "tidecanvas-backend"], capture_output=True, text=True).stdout)[0]
    existing = dict(item.split("=", 1) for item in metadata["Config"]["Env"] if "=" in item)
    key = existing.get("TIDECANVAS_RELAY_APIKEY", "").strip()
    if not key:
        print("No runtime relay key found; model setup deferred")
        return
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for probe, configured in [
        ("https://test-relay.tcmzhan.com/v1", "https://test-relay.tcmzhan.com/v1"),
        ("http://127.0.0.1:8080/v1", "http://host.docker.internal:8080/v1"),
    ]:
        try:
            req = urllib.request.Request(probe + "/models", headers={"Authorization": "Bearer " + key})
            with opener.open(req, timeout=20) as resp:
                catalog = json.load(resp)
            items = catalog if isinstance(catalog, list) else catalog.get("data", [])
            ids = [item.get("id") for item in items if isinstance(item, dict)]
            print("Catalog available:", probe, "models:", len(ids), "astra:", "gpt-6-astra" in ids)
            if "gpt-6-astra" not in ids:
                continue
            env_path = ROOT / ".env"
            env = dict(line.split("=", 1) for line in env_path.read_text().splitlines() if "=" in line)
            if env.get("AUTH_ALLOWED_EMAILS") != EMAIL:
                raise RuntimeError("Refusing shared test gateway outside the single-account allowlist")
            env.update(OPENAI_API_KEY=key, OPENAI_PROXY_URL=configured, OPENAI_MODEL_LIST="-all,+gpt-6-astra=GPT-6 Astra")
            replace_private(env_path, "\n".join(f"{name}={value}" for name, value in env.items()) + "\n")
            print("Test model configured:", "gpt-6-astra")
            return
        except urllib.error.HTTPError as err:
            print("Catalog probe HTTP status:", err.code)
        except urllib.error.URLError:
            print("Catalog probe could not connect:", probe)
    print("Test model setup needs follow-up")


def apply_nginx(source_name):
    target = Path("/etc/nginx/sites-available/test-lobehub.tcmzhan.com.conf")
    enabled = Path("/etc/nginx/sites-enabled/test-lobehub.tcmzhan.com.conf")
    source = (ROOT / source_name).read_text()
    known = [(ROOT / name).read_text() for name in ("nginx.conf", "nginx-http.conf")]
    if target.is_symlink():
        raise RuntimeError("Refusing an unexpected symlink in sites-available")
    previous = target.read_text() if target.exists() else None
    if previous is not None and previous not in known:
        raise RuntimeError("Existing nginx site was edited; review and apply the config manually")
    created = False
    if enabled.is_symlink():
        if enabled.resolve() != target.resolve():
            raise RuntimeError("Existing enabled site points elsewhere")
    elif enabled.exists():
        raise RuntimeError("Existing enabled site is not our symlink")
    else:
        enabled.symlink_to(target)
        created = True
    target.write_text(source)
    try:
        run(["nginx", "-t"])
    except Exception:
        if created:
            enabled.unlink()
        if previous is not None:
            target.write_text(previous)
        raise
    run(["systemctl", "reload", "nginx"])
    print("Nginx config enabled:", source_name)


def nginx_http():
    Path("/var/www/lobehub-acme/.well-known/acme-challenge").mkdir(parents=True, exist_ok=True, mode=0o755)
    apply_nginx("nginx-http.conf")


def nginx():
    if not (ROOT / ".account-ready").exists():
        raise RuntimeError("Verify the test account before exposing the login page")
    for name in ("fullchain.pem", "privkey.pem"):
        if not (Path("/etc/letsencrypt/live/test-lobehub.tcmzhan.com") / name).is_file():
            raise RuntimeError("Obtain the new domain certificate before enabling HTTPS")
    apply_nginx("nginx.conf")
    print("HTTPS entry enabled:", URL)


def logs():
    result = subprocess.run(["docker", "compose", "-f", "compose.yml", "logs", "--tail", "80", "app", "storage"], cwd=ROOT, capture_output=True, text=True)
    output = result.stdout + result.stderr
    for line in (ROOT / ".env").read_text().splitlines():
        name, _, value = line.partition("=")
        if any(word in name for word in ("SECRET", "PASSWORD", "KEY")) and value:
            output = output.replace(value, "[REDACTED]")
    print(output)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["prepare", "configure-domain", "account", "nginx-http", "nginx", "logs", "relay"])
    args = parser.parse_args()
    globals()[args.action.replace("-", "_")]()
