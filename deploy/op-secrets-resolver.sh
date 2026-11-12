#!/usr/bin/env bash
# OpenClaw exec SecretRef provider — resolves ids via 1Password service account.

set -euo pipefail
set -a
# shellcheck source=/dev/null
source "${HOME}/.config/openclaw/op-service-account.env"
for env_file in \
  "${HOME}/.config/openclaw/openrouter.env" \
  "${HOME}/.config/openclaw/tavily.env" \
  "${HOME}/.config/openclaw/composio.env"; do
  [[ -f "$env_file" ]] && source "$env_file"
done
set +a

OP_BIN="${OP_BIN:-/home/linuxbrew/.linuxbrew/bin/op}"
PYTHON_BIN="${PYTHON_BIN:-/home/linuxbrew/.linuxbrew/bin/python3}"

exec "$PYTHON_BIN" -c '
import json
import os
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

OP_BIN = os.environ.get("OP_BIN", "/home/linuxbrew/.linuxbrew/bin/op")
CACHE_PATH = Path(
    os.environ.get(
        "OPENCLAW_SECRET_CACHE",
        str(Path.home() / ".cache/openclaw/op-secrets.json"),
    )
)
READ_TIMEOUT_SECONDS = float(os.environ.get("OP_READ_TIMEOUT_SECONDS", "3"))

MAP = {
    "gateway-token": ["op://Example Vault/example-gateway-token/password"],
    "discord-bot-token": ["op://Example Vault/example-discord-token/password"],
    "composio-api-key": [
        "op://Example Vault/example-composio/API Key",
        "op://Example Vault/example-composio-legacy/API Key",
    ],
    "tavily-api-key": [
        "op://Example Vault/example-tavily/API Key",
        "op://Example Vault/example-tavily-legacy/password",
    ],
    "openrouter-api-key": [
        "op://Example Vault/example-openrouter/password",
        "op://Example Vault/example-openrouter/API Key",
        "op://Example Vault/example-openrouter-alt/password",
        "op://Example Vault/example-openrouter-alt/API Key",
    ],
}

ENV_MAP = {
    "openrouter-api-key": "OPENROUTER_API_KEY",
    "tavily-api-key": "TAVILY_API_KEY",
    "composio-api-key": "COMPOSIO_API_KEY",
}


def read_secret(id: str, refs: list[str]) -> tuple[str, str]:
    env_name = ENV_MAP.get(id)
    if env_name and os.environ.get(env_name):
        return id, os.environ[env_name]
    last_error = f"no 1Password references configured for {id}"
    for ref in refs:
        r = subprocess.run(
            [OP_BIN, "read", ref],
            capture_output=True,
            text=True,
            timeout=READ_TIMEOUT_SECONDS,
        )
        if r.returncode == 0 and r.stdout.strip():
            return id, r.stdout.strip()
        last_error = r.stderr.strip() or f"op read failed for {id}"
    raise RuntimeError(last_error)


def load_cache() -> dict[str, str]:
    try:
        data = json.loads(CACHE_PATH.read_text())
        return data if isinstance(data, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}


def save_cache(values: dict[str, str]) -> None:
    CACHE_PATH.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(CACHE_PATH.parent, 0o700)
    fd, tmp_name = tempfile.mkstemp(prefix="op-secrets.", dir=CACHE_PATH.parent)
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(values, f)
            f.write("\n")
        os.chmod(tmp_name, 0o600)
        os.replace(tmp_name, CACHE_PATH)
    finally:
        try:
            os.unlink(tmp_name)
        except FileNotFoundError:
            pass


payload = json.load(sys.stdin)
ids = payload.get("ids", [])
cache = load_cache()
fresh = {}
errors: list[str] = []

with ThreadPoolExecutor(max_workers=len(ids) or 1) as pool:
    futures = {}
    for id in ids:
        refs = MAP.get(id)
        if not refs:
            sys.stderr.write(f"unknown secret id: {id}\n")
            sys.exit(1)
        futures[pool.submit(read_secret, id, refs)] = id
    for future in as_completed(futures):
        try:
            id, value = future.result()
            fresh[id] = value
        except (RuntimeError, subprocess.TimeoutExpired) as e:
            errors.append(f"{futures[future]}: {e}")

values = {}
missing = []
for id in ids:
    if id in fresh:
        values[id] = fresh[id]
    elif id in cache:
        values[id] = cache[id]
    else:
        missing.append(id)

if fresh:
    cache.update(fresh)
    save_cache(cache)

if missing:
    sys.stderr.write("; ".join(errors) + "\n")
    sys.stderr.write("missing uncached secrets: " + ", ".join(missing) + "\n")
    sys.exit(1)

if errors:
    sys.stderr.write("1Password unavailable; used last-known-good secret cache\n")

print(json.dumps({"protocolVersion": 1, "values": values}))
'
