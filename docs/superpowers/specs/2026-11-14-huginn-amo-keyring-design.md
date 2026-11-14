# Huginn Downloader — Local AMO Credential Storage Design

## Intent

Allow the maintainer to sign future Huginn Downloader XPI releases without
re-entering AMO credentials, while keeping the issuer and secret out of the
repository, `.env` files, shell history, command arguments, and LLM-visible tool
output. The maintainer enters both values directly in KDE Wallet Manager once;
no setup script or LLM shell command reads them during enrollment.

## Current State

- `scripts/sign-xpi.sh` already accepts `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`
  and submits the XPI through `web-ext sign --channel=unlisted`.
- These environment variables are not currently available to the OpenCode
  shell. Mozilla's API-auth documentation says credentials come from the AMO
  API Credentials Management Page, but does not promise that a previously
  created secret can be displayed again. Treat the secret as unrecoverable
  unless the maintainer saved a copy.
- This KDE machine has `kwallet-query` and `secret-tool`; no wallet contents or
  credential values have been inspected.

## Goals and Non-Goals

- Store both values in the user's KDE Wallet, in a Huginn-specific folder with
  stable entry names.
- The maintainer creates a `Huginn Downloader` folder in KDE Wallet Manager and
  adds password entries named `AMO_JWT_ISSUER` and `AMO_JWT_SECRET` directly in
  the GUI. Do not add a credential-entry/setup script.
- Provide a local signing helper that reads the two wallet entries into its
  process memory, calls the existing signing script, suppresses credential
  values from stdout/stderr, and unsets them on exit.
- Leave `scripts/sign-xpi.sh`'s environment-variable interface intact for
  existing CI or manually provisioned environments. The KWallet wrapper is a
  local convenience, not an automatic GitHub Actions integration.
- Signing does not create a tag or publish a release; release publication
  remains an explicit maintainer action.

## Approaches

1. **KDE Wallet via GUI enrollment and `kwallet-query` signing (chosen).** Native
   to the maintainer's KDE setup and already installed. Credentials are entered
   directly into Wallet Manager once and protected by the wallet's lock/unlock
   policy; subsequent local signing reads them without re-entry. If KWallet is
   locked, its normal unlock behavior applies.
2. **Freedesktop Secret Service via `secret-tool`.** More portable across Linux
   desktops and also installed here, but depends on the active Secret Service
   provider and its unlock state. It adds a second provider-integration path
   without benefit for the current KDE workstation.
3. **A `0600` credential file or CI secrets.** Easier to automate, but leaves a
   plaintext local file or expands trust to GitHub Actions. Neither fits the
   chosen local-keyring goal as well as KWallet.

The user selected KWallet. **Security boundary:** secret values remain available
to same-user processes while the wallet is unlocked; this design prevents
accidental disclosure to the LLM conversation and persistent repository files,
but is not a defense against malware or another process running as the same
user.

## User Experience

1. In KDE Wallet Manager, open the wallet to use, create a `Huginn Downloader`
   folder, and add password entries `AMO_JWT_ISSUER` and `AMO_JWT_SECRET` with
   the AMO values. Values are entered in Wallet Manager, never in an LLM prompt
   or agent-run terminal.
2. For a release, run `scripts/sign-xpi-kwallet.sh`. It retrieves the entries
   locally, calls `scripts/sign-xpi.sh`, and produces the usual signed XPI.
3. If a wallet entry is missing or KWallet is unavailable, fail with an
   actionable message and do not fall back to prompting, files, or network
   credential retrieval.

The issuer and secret are never echoed, written to `.env`, passed as arguments,
or included in logs. To rotate credentials, replace the two entries in KDE
Wallet Manager.
