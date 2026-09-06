"""Generate deployment fragments. No services are restarted and no secret is printed."""
import argparse
from pathlib import Path
import os
import re
import secrets
import tempfile
import time
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent


def atomic_private(path, text):
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as f:
            temporary = Path(f.name)
            f.write(text)
        os.chmod(temporary, 0o600)
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def init(main_url, lobe_url, supports_tools=False):
    for value in (main_url, lobe_url):
        parsed = urlsplit(value)
        if parsed.scheme != "https" or not parsed.netloc or parsed.path not in ("", "/") or parsed.query or parsed.fragment or parsed.username:
            raise ValueError("Use HTTPS origins without paths or credentials")
    main_url, lobe_url = main_url.rstrip("/"), lobe_url.rstrip("/")
    private = ROOT / "private"
    private.mkdir(mode=0o700, exist_ok=True)
    os.chmod(private, 0o700)
    secret_file = private / "client-secret"
    if not secret_file.exists():
        atomic_private(secret_file, secrets.token_hex(32))
    client_secret = secret_file.read_text().strip()
    if not re.fullmatch(r"[A-Za-z0-9_-]{32,128}", client_secret):
        raise ValueError("Existing client secret is invalid; restore it from your backup")
    os.chmod(secret_file, 0o600)
    key_file = private / "oidc-private.pem"
    if not key_file.exists():
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.hazmat.primitives.serialization import Encoding, PrivateFormat, NoEncryption
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        atomic_private(key_file, key.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, NoEncryption()).decode())
    from cryptography.hazmat.primitives.serialization import load_pem_private_key
    from cryptography.hazmat.primitives.asymmetric import rsa
    key = load_pem_private_key(key_file.read_bytes(), password=None)
    if not isinstance(key, rsa.RSAPrivateKey) or key.key_size < 2048:
        raise ValueError("Existing signing key must be RSA 2048 or stronger")
    os.chmod(key_file, 0o600)
    issuer = main_url + "/api/lobehub/oidc"
    main = {
        "TIDECANVAS_LOBEHUB_ENABLED": "true",
        "TIDECANVAS_LOBEHUB_PUBLICURL": lobe_url,
        "TIDECANVAS_LOBEHUB_ISSUERURL": issuer,
        "TIDECANVAS_LOBEHUB_INTERNALURL": "http://127.0.0.1:3210",
        "TIDECANVAS_LOBEHUB_CLIENTID": "flowinglight-lobehub",
        "TIDECANVAS_LOBEHUB_CLIENTSECRET": client_secret,
        "TIDECANVAS_LOBEHUB_SIGNINGKEYFILE": "/run/secrets/lobehub-oidc.pem",
        "TIDECANVAS_LOBEHUB_MAXCONCURRENT": "2",
        "TIDECANVAS_LOBEHUB_DAILYLIMIT": "0",
        # Enable only after deploying the companion apirouter protocol changes.
        "TIDECANVAS_LOBEHUB_SUPPORTSTOOLS": str(supports_tools).lower(),
    }
    lobe = {
        "AUTH_SSO_PROVIDERS": "generic-oidc",
        "AUTH_GENERIC_OIDC_ID": "flowinglight-lobehub",
        "AUTH_GENERIC_OIDC_SECRET": client_secret,
        "AUTH_GENERIC_OIDC_ISSUER": issuer,
        "AUTH_DISABLE_EMAIL_PASSWORD": "1",
        "AUTH_ALLOWED_EMAILS": "",
        "AUTH_EMAIL_VERIFICATION": "0",
    }
    for name, values in (("main.env", main), ("lobehub.env", lobe)):
        atomic_private(private / name, "\n".join(f"{key}={value}" for key, value in values.items()) + "\n")
    print("Configuration generated in", private)
    print("Issuer:", issuer)
    print("LobeHub:", lobe_url)
    print("Existing signing key and client secret were preserved")


def merge_env(target, fragment):
    target, fragment = Path(target).resolve(), Path(fragment).resolve()
    if not target.is_file() or not fragment.is_file() or target == fragment:
        raise ValueError("Both target and fragment must be different existing files")
    values = {}
    for line in fragment.read_text(encoding="utf-8").splitlines():
        if line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
                raise ValueError("Invalid environment key in fragment")
            values[key] = value
    original = target.read_text(encoding="utf-8")
    backup = target.with_name(target.name + ".before-lobehub-" + str(time.time_ns()))
    atomic_private(backup, original)
    lines = []
    for line in original.splitlines():
        match = re.match(r"\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=", line)
        if not match or match.group(1) not in values:
            lines.append(line)
    lines += [f"{key}={value}" for key, value in values.items()]
    atomic_private(target, "\n".join(lines) + "\n")
    print("Environment updated; original backed up to", backup)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    setup = sub.add_parser("init")
    setup.add_argument("--main-url", default="https://test-flowlight.tcmzhan.com")
    setup.add_argument("--lobe-url", default="https://test-lobehub.tcmzhan.com")
    setup.add_argument("--supports-tools", action="store_true", help="Use only after deploying the apirouter protocol update")
    merge = sub.add_parser("merge-env")
    merge.add_argument("--target", required=True)
    merge.add_argument("--fragment", required=True)
    args = parser.parse_args()
    if args.command == "init":
        init(args.main_url, args.lobe_url, args.supports_tools)
    else:
        merge_env(args.target, args.fragment)
