"""Configure the existing Hong Kong test deployment; never recreate data services."""
import argparse
import copy
import importlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

import prepare

ROOT = Path(__file__).resolve().parent
MAIN_URL = "https://test-flowlight.tcmzhan.com"
LOBE_URL = "https://test-lobehub.tcmzhan.com"
MAIN_COMPOSE = Path("/root/flowfinght/docker-compose.yml")
LOBE_COMPOSE = Path("/root/lobehub-db/docker-compose.yml")
LOBE_ENV = Path("/root/lobehub-db/.env")
MAIN_NGINX = Path("/etc/nginx/sites-available/flowlight.tcmzhan.com.conf")
LOBE_NGINX = Path("/etc/nginx/sites-available/test-lobehub.tcmzhan.com.conf")
MAIN_SNIPPET = Path("/etc/nginx/snippets/flowinglight-main.conf")
LOBE_SNIPPET = Path("/etc/nginx/snippets/flowinglight-lobehub.conf")
KEY_TARGET = "/run/secrets/lobehub-oidc.pem"


class SetupError(Exception):
    pass


def command(args, timeout=180, cwd=None):
    # Compose can expand credentials. Never print its rendered configuration,
    # stdout, stderr, or a parser exception containing the source line.
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=timeout, cwd=cwd)
    except (OSError, subprocess.TimeoutExpired):
        raise SetupError("命令无法执行或超时：" + " ".join(map(str, args))) from None
    if result.returncode:
        raise SetupError("命令执行失败：" + " ".join(map(str, args)))
    return result.stdout


def compose(path, project, *args):
    return command(["docker", "compose", "-p", project, "-f", str(path), *args], cwd=str(path.parent))


def env_values(text):
    result = {}
    for line in text.splitlines():
        if line.strip() and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            result[key.strip()] = value
    return result


def yaml_load(text):
    import yaml
    # Compose follows YAML 1.2: an unquoted "on" must remain a string.
    class Loader(yaml.SafeLoader):
        yaml_implicit_resolvers = copy.deepcopy(yaml.SafeLoader.yaml_implicit_resolvers)
    for key, rules in Loader.yaml_implicit_resolvers.items():
        Loader.yaml_implicit_resolvers[key] = [(tag, pattern) for tag, pattern in rules if tag != "tag:yaml.org,2002:bool"]
    Loader.add_implicit_resolver("tag:yaml.org,2002:bool", re.compile(r"^(?:true|false)$", re.I), list("tTfF"))
    result = yaml.load(text, Loader=Loader)
    if not isinstance(result, dict):
        raise SetupError("Compose 文件不是有效的配置对象")
    return result


def patch_compose(text, service_name, env_file, managed_keys, key_mount=None):
    import yaml
    data = yaml_load(text)
    service = data.get("services", {}).get(service_name)
    if not isinstance(service, dict):
        raise SetupError("Compose 中找不到服务：" + service_name)
    files = service.get("env_file", [])
    if not isinstance(files, list):
        files = [files]
    files = [item for item in files if (item.get("path") if isinstance(item, dict) else item) != str(env_file)]
    service["env_file"] = files + [str(env_file)]
    env = service.get("environment", {})
    if isinstance(env, list):
        service["environment"] = [item for item in env if str(item).split("=", 1)[0] not in managed_keys]
    elif isinstance(env, dict):
        service["environment"] = {key: value for key, value in env.items() if key not in managed_keys}
    else:
        raise SetupError("无法识别现有 environment 格式")
    if key_mount:
        volumes = []
        for item in service.get("volumes", []):
            target = item.get("target") if isinstance(item, dict) else str(item).split(":")[1] if ":" in str(item) else str(item)
            if target != KEY_TARGET:
                volumes.append(item)
        service["volumes"] = volumes + [f"{key_mount}:{KEY_TARGET}:ro"]
    return yaml.safe_dump(data, allow_unicode=True, sort_keys=False)


def nginx_include(text, domain, snippet, previous):
    # Tokenize quotes/comments so braces inside JSON error responses do not
    # change the nesting depth. Modify only the matching HTTPS server block.
    pattern = r'''"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\#[^\n]*|[{};]|[^\s{};]+'''
    tokens = [(m.group(), m.start(), m.end()) for m in re.finditer(pattern, text) if not m.group().startswith("#")]
    matches = []
    for i, (value, _, _) in enumerate(tokens[:-1]):
        if value != "server" or tokens[i + 1][0] != "{":
            continue
        depth, j, directives, current = 1, i + 2, [], []
        while j < len(tokens) and depth:
            token = tokens[j]
            if token[0] == "{":
                depth += 1
                current = []
            elif token[0] == "}":
                depth -= 1
                current = []
            elif depth == 1:
                if token[0] == ";":
                    if current:
                        directives.append((current, token))
                    current = []
                else:
                    current.append(token)
            j += 1
        if depth:
            raise SetupError("Nginx 配置括号不匹配")
        names = [t[0].strip("\"'") for row, _ in directives if row[0][0] == "server_name" for t in row[1:]]
        tls = any(row[0][0] == "listen" and any(t[0] == "443" or t[0].endswith(":443") for t in row[1:]) for row, _ in directives)
        if domain in names and tls:
            matches.append((tokens[j - 1][1], directives))
    if len(matches) != 1:
        raise SetupError("未找到唯一的 HTTPS server 配置：" + domain)
    end, directives = matches[0]
    includes = [(row, semi) for row, semi in directives if row[0][0] == "include" and len(row) == 2 and row[1][0].strip("\"'") in (str(snippet), str(previous))]
    if len(includes) == 1 and includes[0][0][1][0].strip("\"'") == str(snippet):
        return text
    edits = [(end, end, f"    include {snippet};\n")]
    edits += [(row[0][1], semi[2], "") for row, semi in includes]
    for start, stop, replacement in sorted(edits, reverse=True):
        text = text[:start] + replacement + text[stop:]
    return text


def unchanged_config(before, after, service, managed_keys, remove_key_mount=False):
    def normalized(value):
        value = copy.deepcopy(value)
        target = value["services"][service]
        target.pop("env_file", None)
        target["environment"] = {key: val for key, val in target.get("environment", {}).items() if key not in managed_keys}
        if remove_key_mount:
            target["volumes"] = [v for v in target.get("volumes", []) if v.get("target") != KEY_TARGET]
        return value
    if normalized(before) != normalized(after):
        raise SetupError("检测到接入范围以外的配置发生变化，已停止启用")


class Backups:
    def __init__(self, directory, paths):
        self.directory = directory
        directory.mkdir(parents=True, mode=0o700)
        os.chmod(directory, 0o700)
        self.records = []
        manifest = []
        for index, source in enumerate(paths):
            path = source.resolve()
            data = path.read_bytes() if path.exists() else None
            mode = path.stat().st_mode & 0o777 if data is not None else 0o600
            saved = directory / f"{index:02d}-{path.name}"
            if data is not None:
                saved.write_bytes(data)
                os.chmod(saved, 0o600)
            self.records.append((path, data, mode))
            manifest.append({"path": str(path), "backup": saved.name if data is not None else None, "mode": mode})
        prepare.atomic_private(directory / "manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))

    def restore(self):
        failures = []
        for path, data, mode in reversed(self.records):
            try:
                if data is None:
                    path.unlink(missing_ok=True)
                else:
                    restore_bytes(path, data, mode)
            except OSError:
                failures.append(str(path))
        return failures


def restore_bytes(path, data, mode):
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as output:
            temporary = Path(output.name)
            output.write(data)
        os.chmod(temporary, mode)
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def write_config(path, text):
    path = path.resolve()
    mode = path.stat().st_mode & 0o777 if path.exists() else 0o600
    path.parent.mkdir(parents=True, exist_ok=True)
    prepare.atomic_private(path, text)
    os.chmod(path, mode)


def get_json(url):
    with urllib.request.urlopen(url, timeout=5) as response:
        return json.load(response)


def wait_ready(check, description, timeout=120):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            if check():
                return
        except (OSError, ValueError):
            pass
        time.sleep(2)
    raise SetupError(description + "未在等待时间内就绪")


def check_oidc_login():
    request = urllib.request.Request("http://127.0.0.1:3210/api/auth/sign-in/oauth2",
        data=json.dumps({"providerId": "generic-oidc", "callbackURL": LOBE_URL + "/"}).encode(),
        headers={"Host": "test-lobehub.tcmzhan.com", "Origin": LOBE_URL, "X-Forwarded-Proto": "https", "Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=20) as response:
        target = urllib.parse.urlsplit(json.load(response).get("url", ""))
    expected = urllib.parse.urlsplit(MAIN_URL + "/api/lobehub/oidc/authorize")
    query = urllib.parse.parse_qs(target.query)
    return (target.scheme, target.netloc, target.path) == (expected.scheme, expected.netloc, expected.path) and query.get("code_challenge_method") == ["S256"]


def preflight():
    if ROOT != Path("/root/lobehub-integration"):
        raise SetupError("请将配置包解压到 /root，脚本应位于 /root/lobehub-integration")
    for path in (MAIN_COMPOSE, LOBE_COMPOSE, LOBE_ENV, MAIN_NGINX, LOBE_NGINX):
        if not path.is_file():
            raise SetupError("缺少预期的现有配置：" + str(path))
    for name, project, service in (("tidecanvas-backend", "flowfinght", "backend"), ("lobehub", "lobehub", "lobe")):
        item = json.loads(command(["docker", "inspect", name]))[0]
        labels = item["Config"].get("Labels") or {}
        if labels.get("com.docker.compose.project") != project or labels.get("com.docker.compose.service") != service:
            raise SetupError("现有容器归属与测试环境不符：" + name)
    command(["nginx", "-t"])
    return (json.loads(compose(MAIN_COMPOSE, "flowfinght", "config", "--format", "json")),
            json.loads(compose(LOBE_COMPOSE, "lobehub", "config", "--format", "json")))


# Operator-tunable settings: a re-run must not reset what they chose here.
PRESERVED_MAIN_KEYS = (
    "TIDECANVAS_LOBEHUB_MAXCONCURRENT",
    "TIDECANVAS_LOBEHUB_DAILYLIMIT",
)


def apply_configuration(before):
    private = ROOT / "private"
    private.mkdir(mode=0o700, exist_ok=True)
    os.chmod(private, 0o700)
    old_main = env_values((private / "main.env").read_text(encoding="utf-8")) if (private / "main.env").exists() else {}
    backups = Backups(private / "backups" / str(time.time_ns()), [MAIN_COMPOSE, LOBE_COMPOSE, LOBE_ENV, MAIN_NGINX, LOBE_NGINX, MAIN_SNIPPET, LOBE_SNIPPET, private / "main.env", private / "lobehub.env"])
    touched = {"main": False, "lobe": False, "nginx": False}
    print("已备份配置：", backups.directory, flush=True)
    try:
        prepare.init(MAIN_URL, LOBE_URL)
        main = env_values((private / "main.env").read_text(encoding="utf-8"))
        for key in PRESERVED_MAIN_KEYS:
            if key in old_main:
                main[key] = old_main[key]
        prepare.atomic_private(private / "main.env", "".join(f"{key}={value}\n" for key, value in main.items()))
        lobe = env_values((private / "lobehub.env").read_text(encoding="utf-8"))
        write_config(MAIN_COMPOSE, patch_compose(MAIN_COMPOSE.read_text(encoding="utf-8"), "backend", private / "main.env", main, private / "oidc-private.pem"))
        # The existing .env is shared by search/storage services. Overlay SSO
        # variables only on lobe; do not add the OIDC secret to every container.
        write_config(LOBE_COMPOSE, patch_compose(LOBE_COMPOSE.read_text(encoding="utf-8"), "lobe", private / "lobehub.env", lobe))
        for source, target, config, domain in (("nginx-main-locations.conf", MAIN_SNIPPET, MAIN_NGINX, "test-flowlight.tcmzhan.com"), ("nginx-lobehub-locations.conf", LOBE_SNIPPET, LOBE_NGINX, "test-lobehub.tcmzhan.com")):
            write_config(target, (ROOT / source).read_text(encoding="utf-8"))
            write_config(config, nginx_include(config.read_text(encoding="utf-8"), domain, target, ROOT / source))
        unchanged_config(before[0], json.loads(compose(MAIN_COMPOSE, "flowfinght", "config", "--format", "json")), "backend", main, True)
        unchanged_config(before[1], json.loads(compose(LOBE_COMPOSE, "lobehub", "config", "--format", "json")), "lobe", lobe)
        command(["nginx", "-t"])
        print("配置检查通过，正在启用主站接入…", flush=True)
        touched["main"] = True
        compose(MAIN_COMPOSE, "flowfinght", "up", "-d", "--no-deps", "backend")
        wait_ready(lambda: get_json("http://127.0.0.1:8081/api/lobehub/config").get("data", {}).get("enabled") is True, "主站")
        touched["lobe"] = True
        print("正在更新 LobeHub 登录配置…", flush=True)
        compose(LOBE_COMPOSE, "lobehub", "up", "-d", "--no-deps", "--force-recreate", "lobe")
        wait_ready(lambda: get_json("http://127.0.0.1:3210/api/auth/get-session") is not False, "LobeHub")
        touched["nginx"] = True
        command(["systemctl", "reload", "nginx"])
        wait_ready(lambda: get_json(MAIN_URL + "/api/lobehub/config").get("data", {}).get("enabled") is True, "公网主站")
        wait_ready(check_oidc_login, "统一登录", timeout=60)
    except BaseException:
        print("启用失败，正在恢复原配置…", flush=True)
        failures = backups.restore()
        actions = []
        if touched["main"]:
            actions.append(lambda: compose(MAIN_COMPOSE, "flowfinght", "up", "-d", "--no-deps", "backend"))
        if touched["lobe"]:
            actions.append(lambda: compose(LOBE_COMPOSE, "lobehub", "up", "-d", "--no-deps", "--force-recreate", "lobe"))
        if touched["nginx"]:
            actions.append(lambda: (command(["nginx", "-t"]), command(["systemctl", "reload", "nginx"])))
        for action in actions:
            try:
                action()
            except Exception:
                failures.append("服务恢复失败")
        if failures:
            print("部分恢复操作失败，请使用备份检查：", backups.directory, flush=True)
        else:
            print("原配置已恢复。", flush=True)
        raise
    print("配置完成。请刷新主站 AI 聊天页面，再点击进入完成个人账号绑定。", flush=True)


def main():
    parser = argparse.ArgumentParser(description="一键接通现有香港测试服务器的 LobeHub")
    parser.add_argument("--check", action="store_true", help="仅检查现有部署，不修改配置")
    args = parser.parse_args()
    if not hasattr(os, "geteuid") or os.geteuid() != 0:
        raise SetupError("请在香港测试服务器上使用 root 执行")
    if ROOT != Path("/root/lobehub-integration"):
        raise SetupError("请先将配置包解压到 /root/lobehub-integration")
    for module in ("yaml", "cryptography"):
        try:
            importlib.import_module(module)
        except ImportError:
            if args.check:
                raise SetupError("缺少 Python 依赖，检查模式不会安装软件") from None
            print("正在安装配置工具依赖…", flush=True)
            command(["apt-get", "update"], timeout=300)
            command(["apt-get", "install", "-y", "python3-yaml", "python3-cryptography"], timeout=300)
            os.execv(sys.executable, [sys.executable, *sys.argv])
    if args.check:
        preflight()
        print("现有部署检查通过；未修改配置。")
        return
    import fcntl
    with (ROOT / ".enable.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SetupError("已有启用脚本正在执行，请等待它结束") from None
        before = preflight()
        apply_configuration(before)


if __name__ == "__main__":
    try:
        main()
    except SetupError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except BaseException:
        # YAML/Compose exception source lines can contain existing secrets.
        print("配置未完成，请检查上方提示和备份目录；现有密钥不会打印到终端。", file=sys.stderr)
        sys.exit(1)
