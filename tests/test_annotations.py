"""Tests for the signed annotation record (plan U1).

An annotation carries a reason + self-declared author bound to a receipt by the
receipt's content hash, signed so the binding is tamper-evident; corrections
supersede by hash and nothing is overwritten.
"""

from __future__ import annotations

import hashlib

from tamper_signal.annotations import (
    annotation_body_hash,
    build_annotation,
    read_annotations,
    resolve_annotations,
    write_annotation,
)
from tamper_signal.canonical import canonical_json_bytes, semantic_hash
from tamper_signal.keys import generate_keys, load_private_key, public_hex_from_private
from tamper_signal.receipts import (
    SOURCE_RECEIPT_NAME,
    build_source_manifest,
    read_chain,
    receipt_file_hashes,
    verify_signature,
    write_chain,
    write_receipt,
)

from test_tamper_signal import sample_records


def _seed(tmp_path):
    """Keys + a one-receipt chain; return (private, public_hex, chain_dir, target_hash)."""
    generate_keys(str(tmp_path / "keys"))
    private = load_private_key(str(tmp_path / "keys" / "signing.key"))
    public_hex = public_hex_from_private(private)
    records = sample_records()
    manifest = build_source_manifest(
        filename="s.xlsx", evidence_hash="00", byte_size=1, declared_origin="t",
        semantic_hash=semantic_hash(records), records=records, private_key=private,
    )
    chain_dir = str(tmp_path / "receipts")
    write_receipt(chain_dir, SOURCE_RECEIPT_NAME, manifest)
    write_chain(chain_dir, [SOURCE_RECEIPT_NAME], public_hex)
    target = receipt_file_hashes(chain_dir, [SOURCE_RECEIPT_NAME])[SOURCE_RECEIPT_NAME]
    return private, public_hex, chain_dir, target


def _valid_targets(chain_dir):
    chain = read_chain(f"{chain_dir}/chain.json")
    return set(chain["receipt_hashes"].values())


# ---------------------------------------------------------------------------
# Signature covers reason / author / target (R4)
# ---------------------------------------------------------------------------
def test_signed_annotation_verifies(tmp_path):
    private, public_hex, _, target = _seed(tmp_path)
    ann = build_annotation(target=target, reason="fixed a typo", author="Jeff", private_key=private)
    assert ann["kind"] == "annotation"
    assert verify_signature(ann, public_hex)


def test_tampering_reason_author_or_target_breaks_verification(tmp_path):
    private, public_hex, _, target = _seed(tmp_path)
    for field, value in (("reason", "different"), ("author", "Mallory"), ("target", "0" * 64)):
        ann = build_annotation(target=target, reason="r", author="a", private_key=private)
        ann[field] = value  # tamper after signing, signature unchanged
        assert not verify_signature(ann, public_hex), f"{field} tamper not caught"


def test_missing_author_is_allowed_and_verifies(tmp_path):
    private, public_hex, _, target = _seed(tmp_path)
    ann = build_annotation(target=target, reason="no author given", private_key=private)
    assert ann["author"] == ""
    assert verify_signature(ann, public_hex)


# ---------------------------------------------------------------------------
# Canonicalization: numeric-looking author stays a string (decimal-coercion trap)
# ---------------------------------------------------------------------------
def test_numeric_looking_author_stays_string(tmp_path):
    private, public_hex, _, target = _seed(tmp_path)
    for author in ("030", "1E+2", "30.00"):
        ann = build_annotation(target=target, reason="r", author=author, private_key=private)
        body = {k: v for k, v in ann.items() if k != "signature"}
        # The author leaf is the literal string, not coerced to a number.
        assert f'"author":"{author}"' in canonical_json_bytes(body).decode("utf-8")
        assert verify_signature(ann, public_hex)


# ---------------------------------------------------------------------------
# Supersession (R5): newest-wins, both retained, dangling ignored
# ---------------------------------------------------------------------------
def test_supersede_marks_prior_both_retained(tmp_path):
    private, public_hex, chain_dir, target = _seed(tmp_path)
    first = build_annotation(target=target, reason="hasty note", author="a",
                             private_key=private, created_at="2026-06-01T00:00:00Z")
    write_annotation(chain_dir, first)
    correction = build_annotation(target=target, reason="corrected note", author="a",
                                  supersedes=annotation_body_hash(first), private_key=private,
                                  created_at="2026-06-02T00:00:00Z")
    write_annotation(chain_dir, correction)

    resolved = resolve_annotations(read_annotations(chain_dir), public_hex, _valid_targets(chain_dir))
    assert len(resolved) == 2  # both files retained
    by_hash = {a["_hash"]: a for a in resolved}
    assert by_hash[annotation_body_hash(first)]["_superseded"] is True
    assert by_hash[annotation_body_hash(correction)]["_superseded"] is False


def test_annotation_with_unknown_target_is_dropped(tmp_path):
    private, public_hex, chain_dir, _ = _seed(tmp_path)
    stray = build_annotation(target="f" * 64, reason="bound to nothing", private_key=private)
    write_annotation(chain_dir, stray)
    resolved = resolve_annotations(read_annotations(chain_dir), public_hex, _valid_targets(chain_dir))
    assert resolved == []


def test_dangling_supersedes_is_ignored(tmp_path):
    private, public_hex, chain_dir, target = _seed(tmp_path)
    ann = build_annotation(target=target, reason="r", supersedes="a" * 64, private_key=private)
    write_annotation(chain_dir, ann)
    resolved = resolve_annotations(read_annotations(chain_dir), public_hex, _valid_targets(chain_dir))
    # Survives (its own target is valid); the dangling pointer marks nothing.
    assert len(resolved) == 1
    assert resolved[0]["_superseded"] is False


def test_forged_signature_annotation_is_dropped(tmp_path):
    private, public_hex, chain_dir, target = _seed(tmp_path)
    ann = build_annotation(target=target, reason="r", author="a", private_key=private)
    ann["reason"] = "rewritten after signing"  # signature no longer matches
    write_annotation(chain_dir, ann)
    resolved = resolve_annotations(read_annotations(chain_dir), public_hex, _valid_targets(chain_dir))
    assert resolved == []


# ---------------------------------------------------------------------------
# Content addressing
# ---------------------------------------------------------------------------
def test_content_addressed_filename_matches_body_hash(tmp_path):
    private, _, chain_dir, target = _seed(tmp_path)
    ann = build_annotation(target=target, reason="r", private_key=private)
    path = write_annotation(chain_dir, ann)
    assert path.name == f"{annotation_body_hash(ann)}.json"


def test_annotation_canonical_bytes_are_pinned_cross_stack():
    """An annotation body canonicalizes to the same bytes in both stacks:
    node/test/annotations.test.js pins this exact body to this hash."""
    body = {
        "kind": "annotation",
        "spec_version": "1.2",
        "created_at": "2026-06-12T00:00:00Z",
        "target": "aa" * 32,
        "reason": "corrected the spend total",
        "author": "030",
        "supersedes": "bb" * 32,
    }
    assert hashlib.sha256(canonical_json_bytes(body)).hexdigest() == (
        "5122e95e7ded8b937d8f8ed3a8ea9197addd9e2f93dd6575af5b1fbdc3a9fefb"
    )
