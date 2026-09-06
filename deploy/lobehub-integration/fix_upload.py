"""Repair uploads on the confirmed Hong Kong RustFS deployment, without DNS changes."""
import base64
import contextlib
import datetime
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

import enable
import prepare

STORAGE_SNIPPET = Path("/etc/nginx/snippets/flowinglight-lobehub-storage.conf")
MANAGED = {"S3_ENDPOINT", "S3_PUBLIC_DOMAIN", "S3_ENABLE_PATH_STYLE"}
PROBE_PREFIX = "__flowinglight_upload_probe__/"
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")


def runtime_env(container):
    item = json.loads(enable.command(["docker", "inspect", container]))[0]
    return dict(value.split("=", 1) for value in item["Config"].get("Env", []) if "=" in value)


def storage_routes(bucket):
    if not re.fullmatch(r"[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]", bucket) or bucket in {"api", "trpc", "webapi", "flowinglight", "signin"}:
        raise enable.SetupError("存储桶名称不适合映射到聊天域名")
    settings = """    # Preserve both the bucket path and Host used by the S3 signature.
    proxy_pass http://127.0.0.1:9000;
    proxy_set_header Host $http_host;
    proxy_set_header Cookie "";
    proxy_hide_header Set-Cookie;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_request_buffering off;
    proxy_buffering off;
    proxy_cache off;
    client_max_body_size 200m;
    proxy_connect_timeout 10s;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
    # Authentication is provided by S3 signatures, including model-side GETs.
    access_log off;
"""
    return (f"location = /{bucket} {{\n{settings}}}\n"
            f"location ^~ /{bucket}/ {{\n{settings}}}\n")


def signed_url(endpoint, bucket, key, method, access_key, secret_key, region="us-east-1", now=None):
    target = urllib.parse.urlsplit(endpoint)
    if target.scheme not in {"https", "http"} or target.username or target.password or target.path not in {"", "/"} or target.query or target.fragment:
        raise enable.SetupError("存储端点必须是完整域名地址")
    now = now or datetime.datetime.now(datetime.timezone.utc)
    stamp, day = now.strftime("%Y%m%dT%H%M%SZ"), now.strftime("%Y%m%d")
    scope = f"{day}/{region}/s3/aws4_request"
    query = {
        "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
        "X-Amz-Credential": access_key + "/" + scope,
        "X-Amz-Date": stamp,
        "X-Amz-Expires": "60",
        "X-Amz-SignedHeaders": "host",
    }
    path = urllib.parse.quote("/" + bucket + "/" + key, safe="/~")
    encoded = urllib.parse.urlencode(sorted(query.items()), quote_via=urllib.parse.quote, safe="~")
    canonical = f"{method}\n{path}\n{encoded}\nhost:{target.netloc}\n\nhost\nUNSIGNED-PAYLOAD"
    to_sign = "AWS4-HMAC-SHA256\n" + stamp + "\n" + scope + "\n" + hashlib.sha256(canonical.encode()).hexdigest()
    signing = ("AWS4" + secret_key).encode()
    for value in (day, region, "s3", "aws4_request"):
        signing = hmac.new(signing, value.encode(), hashlib.sha256).digest()
    signature = hmac.new(signing, to_sign.encode(), hashlib.sha256).hexdigest()
    return f"{target.scheme}://{target.netloc}{path}?{encoded}&X-Amz-Signature={signature}"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def storage_request(url, method, data=None):
    req = urllib.request.Request(url, method=method, data=data,
        headers={"Content-Type": "image/png"} if data is not None else {})
    try:
        with urllib.request.build_opener(NoRedirect).open(req, timeout=20) as response:
            return response.read(1024 * 1024)
    except urllib.error.HTTPError as error:
        code = ""
        with contextlib.suppress(ET.ParseError, OSError):
            root = ET.fromstring(error.read(8192))
            code = next((item.text for item in root.iter() if item.tag.split("}")[-1] == "Code"), "")
        raise enable.SetupError(f"附件存储校验失败：{method} HTTP {error.code} {code}") from None
    except (OSError, ValueError):
        # Never print a presigned URL: it is a temporary credential.
        raise enable.SetupError(f"附件存储校验失败：{method} 无法连接或证书校验失败") from None


def probe_upload(env, endpoint, cleanup_endpoint="http://127.0.0.1:9000", request=storage_request):
    key = PROBE_PREFIX + secrets.token_hex(16) + ".png"
    bucket = env["S3_BUCKET"]
    def url(method, host):
        return signed_url(host, bucket, key, method, env["S3_ACCESS_KEY_ID"], env["S3_SECRET_ACCESS_KEY"], env.get("S3_REGION") or "us-east-1")
    try:
        request(url("PUT", endpoint), "PUT", PNG)
        if request(url("GET", endpoint), "GET") != PNG:
            raise enable.SetupError("附件存储校验失败：读回图片与上传内容不同")
    finally:
        # Only the freshly generated test key is ever deleted. Do not list,
        # overwrite, or clean any user objects or change bucket permissions.
        request(url("DELETE", cleanup_endpoint), "DELETE")


def repair():
    before = enable.preflight()[1]
    env = runtime_env("lobehub")
    if env.get("APP_URL") != enable.LOBE_URL or env.get("S3_BUCKET") != "lobe":
        raise enable.SetupError("当前实例与已确认的测试环境不一致，停止自动修复")
    if not env.get("S3_ACCESS_KEY_ID") or not env.get("S3_SECRET_ACCESS_KEY"):
        raise enable.SetupError("LobeHub 未配置存储访问密钥")
    rustfs = json.loads(enable.command(["docker", "inspect", "lobe-rustfs"]))[0]
    bindings = rustfs["NetworkSettings"]["Ports"].get("9000/tcp") or []
    if rustfs["State"]["Status"] != "running" or not any(p.get("HostPort") == "9000" for p in bindings):
        raise enable.SetupError("RustFS 未在已确认的 9000 端口运行")
    private = enable.ROOT / "private"
    private.mkdir(mode=0o700, exist_ok=True)
    os.chmod(private, 0o700)
    fragment = private / "lobehub-storage.env"
    import time
    backups = enable.Backups(private / "backups" / ("upload-" + str(time.time_ns())), [enable.LOBE_COMPOSE, enable.LOBE_NGINX, STORAGE_SNIPPET, fragment])
    print("已备份上传相关配置：", backups.directory, flush=True)
    nginx_touched = lobe_touched = False
    try:
        prepare.atomic_private(fragment, f"S3_ENDPOINT={enable.LOBE_URL}\nS3_PUBLIC_DOMAIN=\nS3_ENABLE_PATH_STYLE=1\n")
        enable.write_config(enable.LOBE_COMPOSE, enable.patch_compose(enable.LOBE_COMPOSE.read_text(encoding="utf-8"), "lobe", fragment, MANAGED))
        enable.write_config(STORAGE_SNIPPET, storage_routes(env["S3_BUCKET"]))
        enable.write_config(enable.LOBE_NGINX, enable.nginx_include(enable.LOBE_NGINX.read_text(encoding="utf-8"), "test-lobehub.tcmzhan.com", STORAGE_SNIPPET, STORAGE_SNIPPET))
        after = json.loads(enable.compose(enable.LOBE_COMPOSE, "lobehub", "config", "--format", "json"))
        enable.unchanged_config(before, after, "lobe", MANAGED)
        enable.command(["nginx", "-t"])
        nginx_touched = True
        enable.command(["systemctl", "reload", "nginx"])
        lobe_touched = True
        print("正在更新 LobeHub 上传端点…", flush=True)
        enable.compose(enable.LOBE_COMPOSE, "lobehub", "up", "-d", "--no-deps", "--force-recreate", "lobe")
        enable.wait_ready(lambda: enable.get_json("http://127.0.0.1:3210/api/auth/get-session") is not False, "LobeHub")
        active = runtime_env("lobehub")
        if active.get("S3_ENDPOINT") != enable.LOBE_URL:
            raise enable.SetupError("LobeHub 没有加载新的上传端点")
        print("正在验证图片上传、读回与临时文件清理…", flush=True)
        probe_upload(active, enable.LOBE_URL)
    except BaseException:
        failures = backups.restore()
        if nginx_touched:
            try:
                enable.command(["nginx", "-t"])
                enable.command(["systemctl", "reload", "nginx"])
            except Exception:
                failures.append("nginx")
        if lobe_touched:
            try:
                enable.compose(enable.LOBE_COMPOSE, "lobehub", "up", "-d", "--no-deps", "--force-recreate", "lobe")
            except Exception:
                failures.append("lobe")
        print("修复失败。" + ("部分恢复操作失败，请检查备份。" if failures else "已恢复原配置。"), flush=True)
        raise
    print("附件上传修复完成，上传/读回/清理测试已通过。请刷新 LobeHub 页面后重试附件。", flush=True)


if __name__ == "__main__":
    try:
        if not hasattr(os, "geteuid") or os.geteuid() != 0 or enable.ROOT != Path("/root/lobehub-integration"):
            raise enable.SetupError("请在香港测试服务器执行 /root/lobehub-integration/fix_upload.py")
        import fcntl
        with (enable.ROOT / ".enable.lock").open("a") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise enable.SetupError("已有配置脚本正在执行，请等待结束") from None
            repair()
    except enable.SetupError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except BaseException:
        print("上传修复未完成，请检查备份和服务日志；密钥不会打印到终端。", file=sys.stderr)
        sys.exit(1)
