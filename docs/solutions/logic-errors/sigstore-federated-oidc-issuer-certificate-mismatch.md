---
title: Sigstore anchors recorded the token issuer, but verification compares the certificate issuer
date: 2026-06-11
category: logic-errors
module: anchor
problem_type: logic_error
component: authentication
symptoms:
  - "`receipts verify --anchor --anchor-staging` fails red with ANCHOR MISMATCH immediately after a successful interactive `receipts anchor --staging` browser login"
  - "Certificate's OIDCIssuer does not match (got 'https://github.com/login/oauth', expected 'https://oauth2.sigstage.dev/auth')"
  - "Anchor output shows 'integrated at (pending)' and verify shows 'existed at None' for Rekor v2 log entries"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [sigstore, oidc, fulcio, certificate-issuer, federated-identity, anchor, browser-login, der-utf8string, smoke-test]
---

# Sigstore anchors recorded the token issuer, but verification compares the certificate issuer

## Problem

`receipts anchor` stored the OIDC token's `issuer` in `anchor.json`, but `receipts verify --anchor` hands that stored value to `sigstore.verify.policy.Identity`, which compares it against the OIDC issuer embedded in the Fulcio signing certificate. For browser logins federated through the Sigstore OAuth server those two values differ, so every anchor created interactively by v1.5.0 failed its own verification.

## Symptoms

- `receipts anchor --staging` succeeds and prints `issuer https://oauth2.sigstage.dev/auth`.
- The immediate follow-up verify fails red:

  ```
  ✗ ANCHOR MISMATCH: chain.json does not verify against its anchor
    (Certificate's OIDCIssuer does not match
     (got 'https://github.com/login/oauth', expected 'https://oauth2.sigstage.dev/auth')).
    The chain changed after it was anchored, or the anchor was replaced.
  ```

- Secondary: `integrated at (pending)` / `existed at None` in output, because Rekor v2 logs record no `integrated_time` at all (it is not pending; it does not exist).

## What Didn't Work

- **Trusting the green test suite.** All 83 Python and 28 Node tests plus the 18-job CI matrix passed throughout, because the anchor-wiring tests monkeypatch `verify_anchor` at the module boundary; no test ever exercised a real Fulcio certificate, and the interactive browser flow cannot run in CI. Only the live staging smoke test (run minutes after the v1.5.0 release) surfaced the bug.
- **The first fix draft (short-form + 0x81 DER lengths only).** A two-byte long-form length (`0x82`, issuer URL over 255 bytes) would fall through to `raw.decode("utf-8")`, raise on the length bytes, get swallowed by `_certificate_issuer`'s best-effort `except Exception`, and silently fall back to `token.issuer` — reintroducing the bug exactly where it is hardest to notice. Caught in code review; the final parser handles 1-4 length bytes.

## Solution

Record the issuer from the signing certificate — the document the verifier actually reads — instead of the token (`tamper_signal/anchor.py`):

```python
# Before (v1.5.0): the token issuer, which diverges from the certificate for browser logins
"issuer": token.issuer,

# After (v1.5.1): what Fulcio embedded in the certificate
"issuer": _certificate_issuer(bundle) or token.issuer,
```

`_certificate_issuer` reads Fulcio's V2 issuer extension (OID `1.3.6.1.4.1.57264.1.8`, a DER-encoded UTF8String), falls back to the legacy extension (OID `1.3.6.1.4.1.57264.1.1`, raw bytes), and returns `None` on any failure so anchoring itself never breaks. The DER parser it relies on:

```python
def _der_utf8(raw: bytes) -> str:
    """Decode a DER-encoded UTF8String (tag 0x0c, length, content)."""
    if len(raw) >= 2 and raw[0] == 0x0C:
        if raw[1] < 0x80:  # short-form length
            return raw[2 : 2 + raw[1]].decode("utf-8")
        num = raw[1] & 0x7F  # long form: number of length bytes follows
        if 1 <= num <= 4 and len(raw) >= 2 + num:
            length = int.from_bytes(raw[2 : 2 + num], "big")
            return raw[2 + num : 2 + num + length].decode("utf-8")
    return raw.decode("utf-8")
```

Secondary wording fix (`tamper_signal/cli.py`): `integrated at (time not recorded by this log)` and `existed at the logged time` when the log provides no `integrated_time`.

A fielded bad anchor needs no migration: rewriting its `issuer` field to the certificate value (or simply re-anchoring with v1.5.1) makes it verify.

## Why This Works

Sigstore's interactive flow federates identity providers (GitHub, Google, Microsoft) through its own OAuth server, so the OIDC token's `iss` claim names the federation URL (`https://oauth2.sigstore.dev/auth`). Fulcio, however, embeds the *upstream* provider's issuer (`https://github.com/login/oauth`) in the certificate extension — and the certificate is what `policy.Identity` compares at verify time. Ambient CI tokens (GitHub Actions) never exposed the bug because their token issuer and certificate issuer coincide; only the federated browser path diverges. Reading the issuer from the certificate before writing `anchor.json` means the stored value and the verifier's comparison target are the same field of the same document, so they cannot diverge.

## Prevention

- **Run a live round-trip smoke test for every identity-provider path before release**: `receipts anchor` immediately followed by `receipts verify --anchor`, against the staging instance, with a real browser login. Tests that monkeypatch the verification boundary cannot catch wrong-recorded-metadata bugs; the same monkeypatch blind spot previously bit canonicalization (see Related Issues).
- **Record what the verifier compares against.** Before persisting any field of a credential record, trace what the verification layer reads at check time and source the stored value from that same place. Convenient-to-read fields (the token) are not necessarily the compared fields (the certificate).
- **Cover every length-encoding form when hand-parsing DER.** `test_der_utf8_decodes_certificate_issuer_extension` constructs short-form, one-byte (0x81), and two-byte (0x82) long-form values plus the non-DER passthrough.
- **A broad `except` feeding a fallback hides parser bugs.** `_certificate_issuer`'s best-effort catch is intentional (anchoring must not abort on a weird cert), but it converts any decode bug into a silent wrong-value fallback — so the parser behind it must be unit-tested independently.

## Related Issues

- Implementation issue: #13 (External anchoring: Sigstore), shipped in v1.5.0, fixed in v1.5.1 (PR #17)
- Same prevention lesson (monkeypatched boundaries hide real-path divergence): [numeric-text-canonicalization-cross-format-hash-mismatch](numeric-text-canonicalization-cross-format-hash-mismatch.md)
- Files: `tamper_signal/anchor.py` (`_certificate_issuer`, `_der_utf8`), `tamper_signal/cli.py`, `tests/test_tier4_hardening.py`
