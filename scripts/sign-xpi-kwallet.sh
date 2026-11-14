#!/usr/bin/env bash
set -euo pipefail
set +x

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
WALLET=${HUGINN_AMO_WALLET:-kdewallet}
FOLDER='Huginn Downloader'
ISSUER_ENTRY=AMO_JWT_ISSUER
SECRET_ENTRY=AMO_JWT_SECRET

if ! command -v kwallet-query >/dev/null 2>&1; then
    printf '%s\n' 'kwallet-query was not found. Install KDE Wallet tools or run the environment-based signer.' >&2
    exit 1
fi

read_wallet_entry() {
    local entry=$1 value
    if ! value=$(kwallet-query --read-password "$entry" --folder "$FOLDER" "$WALLET" 2>/dev/null); then
        return 1
    fi
    [[ -n $value ]] || return 1
    printf '%s' "$value"
}

if ! issuer=$(read_wallet_entry "$ISSUER_ENTRY"); then
    printf 'KWallet credentials are missing or empty. In KWallet Manager, create folder "%s" and password entries "%s" and "%s", then retry.\n' \
        "$FOLDER" "$ISSUER_ENTRY" "$SECRET_ENTRY" >&2
    exit 1
fi
if ! secret=$(read_wallet_entry "$SECRET_ENTRY"); then
    unset issuer
    printf 'KWallet credentials are missing or empty. In KWallet Manager, create folder "%s" and password entries "%s" and "%s", then retry.\n' \
        "$FOLDER" "$ISSUER_ENTRY" "$SECRET_ENTRY" >&2
    exit 1
fi

cleanup() {
    unset issuer secret
}
trap cleanup EXIT

if AMO_JWT_ISSUER="$issuer" AMO_JWT_SECRET="$secret" \
    "$ROOT/scripts/sign-xpi.sh" "$@"; then
    status=0
else
    status=$?
fi
unset issuer secret
trap - EXIT
exit "$status"
