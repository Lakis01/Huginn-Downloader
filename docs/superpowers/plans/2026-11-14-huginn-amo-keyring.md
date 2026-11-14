# Huginn Downloader Local AMO Keyring Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the maintainer sign later Huginn Downloader XPI releases from a local KWallet without re-entering credentials or exposing them to the LLM conversation.

**Architecture:** The maintainer enters the AMO issuer and secret directly in KDE Wallet Manager under a dedicated Huginn folder. A local Bash wrapper reads the two entries with `kwallet-query` and invokes the existing `scripts/sign-xpi.sh` using environment variables only for that process. No credential setup script or file is added; the existing CI/environment signing path remains unchanged.

**Tech Stack:** Bash, KDE Wallet (`kwallet-query`), Mozilla `web-ext` AMO signing.

**Spec:** `docs/superpowers/specs/2026-11-14-huginn-amo-keyring-design.md`.

## Global Constraints

- KWallet is the selected local credential store; the maintainer creates folder `Huginn Downloader` in KDE Wallet Manager.
- Store the issuer and secret as password entries named exactly `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`.
- `scripts/sign-xpi-kwallet.sh` reads values only into process memory, never prints them, never places them in argv, and clears them on exit.
- Leave `scripts/sign-xpi.sh`'s current environment-variable interface unchanged for CI and manually provisioned environments.
- Missing `kwallet-query`, inaccessible wallet, or missing/empty entries fails closed with actionable guidance; never fall back to files or network credential retrieval.
- No setup helper prompts for or stores credential values. Tagging, GitHub pushes, draft creation, and publication remain explicit actions.

## Review Focus

1. Special characters in issuer/secret survive KWallet stdout-to-environment transfer without entering argv or visible output.
2. Missing client, inaccessible wallet, and missing/empty entries fail before invoking the signer and print actionable guidance without credential values.
3. The signer receives both values in its environment while wrapper stdout/stderr contain neither.
4. The wrapper works from a checkout path containing spaces and passes ordinary signer arguments unchanged.
5. Documentation identifies exact KWallet Manager folder/entry names, unlock requirements, and the same-user-process security boundary; no setup helper remains.

---

### Task 1: Document manual KWallet enrollment

**Files:** Modify `README.md`, `docs/AMO-PUBLISHING.md`, `tests/test_firefox_extension.js`.

**Interfaces:** KDE Wallet Manager folder `Huginn Downloader`; password entries `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`; local signing command `scripts/sign-xpi-kwallet.sh`.

- [ ] Update `testReadmeBrandAndSetupGuidance` to require manual KWallet folder/entry instructions and the local signer, and assert that docs do not recommend a credential-entry helper.
- [ ] Run `node tests/test_firefox_extension.js`; expected: RED because README still describes scripted credential entry.
- [ ] Document how to create both password entries in KDE Wallet Manager, run `scripts/sign-xpi-kwallet.sh`, handle wallet unlocking, retain the CI environment path, and explain the same-user-process boundary.
- [ ] Run `node tests/test_firefox_extension.js`; expected: PASS.

### Task 2: Retain only the KWallet-backed signer

**Files:** Keep `scripts/sign-xpi-kwallet.sh`; remove `scripts/setup-amo-credentials-kwallet.sh`; modify `tests/test_amo_kwallet.py`.

**Interfaces:** `scripts/sign-xpi-kwallet.sh` reads entries `AMO_JWT_ISSUER` and `AMO_JWT_SECRET` from the `Huginn Downloader` folder in `${HUGINN_AMO_WALLET:-kdewallet}`, then invokes the sibling `scripts/sign-xpi.sh` with those values in its environment.

- [ ] Keep fake-wallet tests for signer environment delivery, output/argv secrecy, special characters, missing entries, and repository paths with spaces; remove setup-helper tests and fixtures.
- [ ] Remove the setup helper so the LLM-driven shell never prompts for issuer/secret; the signer wrapper may read them locally but must not return values in output.
- [ ] Run `python3 -m unittest discover -s tests -p 'test_amo_kwallet.py' -v`; expected: all signer tests pass without accessing the real wallet.
- [ ] Run `python3 -m unittest discover -s tests -v`, `node tests/test_firefox_extension.js`, `bash tests/test_shortcut.sh`, `bash -n scripts/sign-xpi-kwallet.sh scripts/sign-xpi.sh`, and `git diff --check`; expected: every command exits 0.
