#!/usr/bin/env bash
# Sign the Firefox WebExtension with Mozilla AMO (unlisted channel).
# Requires AMO_JWT_ISSUER and AMO_JWT_SECRET from addons.mozilla.org API keys.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

trap 'rm -f "$ROOT/extension/.amo-upload-uuid"' EXIT

if [[ -n ${AMO_JWT_ISSUER:-} && -n ${AMO_JWT_SECRET:-} ]]; then
  true
else
  echo 'error: AMO_JWT_ISSUER and AMO_JWT_SECRET must be set' >&2
  exit 1
fi

mkdir -p "$ROOT/web-ext-artifacts"

if ! WEB_EXT_API_KEY="$AMO_JWT_ISSUER" \
  WEB_EXT_API_SECRET="$AMO_JWT_SECRET" \
  npm_config_loglevel=error \
  npx --yes web-ext sign \
    --source-dir "$ROOT/extension" \
    --artifacts-dir "$ROOT/web-ext-artifacts" \
    --channel=unlisted \
    --timeout="${AMO_WEB_EXT_TIMEOUT:-180000}"; then
  # If this manifest version was already uploaded or web-ext timed out/dropped while polling,
  # poll AMO API v5 until the version is signed and download the signed XPI.
  python3 - "$ROOT" <<'PY'
import base64, hashlib, hmac, json, os, pathlib, sys, time, urllib.error, urllib.parse, urllib.request

root = pathlib.Path(sys.argv[1])
manifest = json.loads((root / "extension" / "manifest.json").read_text(encoding="utf-8"))
addon_id = manifest["browser_specific_settings"]["gecko"]["id"]
target_version = manifest["version"]
issuer = os.environ["AMO_JWT_ISSUER"]
secret = os.environ["AMO_JWT_SECRET"]
poll_timeout = max(0, int(os.environ.get("AMO_POLL_TIMEOUT", "180")))
poll_interval = 10

def make_token() -> str:
    now = int(time.time())
    b64 = lambda d: base64.urlsafe_b64encode(d).rstrip(b"=").decode("ascii")
    h = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    p = b64(json.dumps({"iss": issuer, "iat": now, "exp": now + 180, "jti": f"{now}.{os.urandom(4).hex()}"}).encode())
    s = b64(hmac.new(secret.encode(), f"{h}.{p}".encode(), hashlib.sha256).digest())
    return f"{h}.{p}.{s}"

url = f"https://addons.mozilla.org/api/v5/addons/addon/{urllib.parse.quote(addon_id)}/versions/{urllib.parse.quote(target_version)}/"
deadline = time.monotonic() + poll_timeout
last_status = None
file_info = {}

while True:
    try:
        req = urllib.request.Request(url, headers={"Authorization": f"JWT {make_token()}"})
        with urllib.request.urlopen(req, timeout=20) as resp:
            version_data = json.loads(resp.read().decode())
        file_info = version_data.get("file") or {}
        last_status = file_info.get("status")
        if last_status == "public" and file_info.get("url"):
            break
        if last_status not in (None, "unreviewed"):
            raise RuntimeError(f"AMO version {target_version} rejected or unexpected status={last_status}")
    except urllib.error.HTTPError as err:
        if err.code not in {404, 429, 500, 502, 503, 504}:
            raise
        last_status = f"http-{err.code}"
    except (urllib.error.URLError, TimeoutError, OSError) as err:
        last_status = f"network-error:{err}"

    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise RuntimeError(f"AMO version {target_version} is not signed yet (status={last_status})")
    time.sleep(min(poll_interval, remaining))

out_path = root / "web-ext-artifacts" / f"huginn_downloader-{target_version}-an+fx.xpi"
for attempt in range(3):
    try:
        dl_req = urllib.request.Request(file_info["url"], headers={"Authorization": f"JWT {make_token()}"})
        with urllib.request.urlopen(dl_req, timeout=30) as resp:
            out_path.write_bytes(resp.read())
        break
    except (urllib.error.URLError, TimeoutError, OSError):
        if attempt == 2:
            raise
        time.sleep(3)
PY
fi

newest="$(ls -t "$ROOT/web-ext-artifacts"/*.xpi 2>/dev/null | head -n 1 || true)"
if [[ -z "${newest:-}" ]]; then
  echo 'error: no signed .xpi found in web-ext-artifacts' >&2
  exit 1
fi

python3 -m zipfile -t "$newest"

OUT="$ROOT/dist/huginn-signed.xpi"
mkdir -p "$(dirname "$OUT")"
cp "$newest" "$OUT"
echo "$OUT"
