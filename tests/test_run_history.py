"""Run snapshots and the history directory (U4).

CLI verifies with a non-red final verdict archive a content-addressed (and,
when a key is present, signed) snapshot to receipts/history/; reads are
defensive; serve excludes history/; ingest warns before discarding a run
that never reached history.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import sys
from pathlib import Path

import pytest

from tamper_signal.canonical import canonical_json_bytes
from tamper_signal.cli import main
from tamper_signal.history import (
    HISTORY_DIRNAME,
    build_run_snapshot,
    latest_snapshot,
    load_snapshots,
    snapshot_body_hash,
    write_run_snapshot,
)
from tamper_signal.keys import generate_keys
from tamper_signal.receipts import read_chain, read_receipt, verify_signature

PARITY_FIXTURE = Path(__file__).parent / "fixtures" / "snapshot-parity"

CSV = "day,amount\n2026-05-01,10.5\n2026-05-02,20\n"


def _seed(tmp_path, monkeypatch, csv: str = CSV) -> Path:
    """Scaffold keys + an ingested chain in tmp_path (cwd moves there)."""
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("TAMPER_SIGNAL_KEY", raising=False)
    generate_keys("keys")
    (tmp_path / "export.csv").write_text(csv, encoding="utf-8")
    assert main(["ingest", "export.csv", "--origin", "t"]) == 0
    return tmp_path / "receipts"


def _snapshots(receipts_dir: Path) -> list[Path]:
    history = receipts_dir / HISTORY_DIRNAME
    return sorted(history.glob("*.json")) if history.exists() else []


# ---------------------------------------------------------------------------
# Writing on the final verdict
# ---------------------------------------------------------------------------
def test_green_verify_writes_one_signed_content_addressed_snapshot(
    tmp_path, monkeypatch, capsys
):
    receipts_dir = _seed(tmp_path, monkeypatch)
    assert main(["verify", "receipts/chain.json"]) == 0

    files = _snapshots(receipts_dir)
    assert len(files) == 1
    snapshot = json.loads(files[0].read_text(encoding="utf-8"))

    # Content-addressed: the filename is the sha256 of the canonical body.
    body = {k: v for k, v in snapshot.items() if k != "signature"}
    assert files[0].name == hashlib.sha256(canonical_json_bytes(body)).hexdigest() + ".json"

    # Signed (keys/signing.key exists) and verifying under the chain key.
    chain = read_chain("receipts/chain.json")
    assert verify_signature(snapshot, chain["public_key"])

    # The snapshot points at the run chain.json records.
    last = chain["receipts"][-1]
    assert snapshot["chain_tail_hash"] == chain["receipt_hashes"][last]
    assert snapshot["source"]["filename"] == "export.csv"
    assert snapshot["source"]["columns"] == ["amount", "day"]
    assert snapshot["stages"][0]["totals"]["period_buckets"]


def test_reverify_of_the_same_chain_writes_no_new_snapshot(tmp_path, monkeypatch):
    receipts_dir = _seed(tmp_path, monkeypatch)
    assert main(["verify", "receipts/chain.json"]) == 0
    assert main(["verify", "receipts/chain.json"]) == 0
    assert len(_snapshots(receipts_dir)) == 1


def test_yellow_verify_still_writes_a_snapshot(tmp_path, monkeypatch, capsys):
    receipts_dir = _seed(tmp_path, monkeypatch)
    generate_keys("other")  # trusted set that does NOT include the chain key
    code = main(["verify", "receipts/chain.json", "--pub", "other/signing.pub"])
    assert code == 2
    assert len(_snapshots(receipts_dir)) == 1


def test_red_verify_writes_nothing(tmp_path, monkeypatch, capsys):
    receipts_dir = _seed(tmp_path, monkeypatch)
    # Tamper the receipt file after chain.json recorded its hash: red.
    source = receipts_dir / "000_source.json"
    receipt = json.loads(source.read_text(encoding="utf-8"))
    receipt["control_totals"]["row_count"] = 99
    source.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")

    assert main(["verify", "receipts/chain.json"]) == 1
    assert _snapshots(receipts_dir) == []
    assert not (receipts_dir / HISTORY_DIRNAME).exists()


@pytest.mark.skipif(
    sys.platform == "win32", reason="directory write bits are advisory on Windows"
)
@pytest.mark.skipif(
    hasattr(os, "geteuid") and os.geteuid() == 0,
    reason="root ignores directory write bits",
)
def test_readonly_history_keeps_verdict_and_notices_stderr(tmp_path, monkeypatch, capsys):
    receipts_dir = _seed(tmp_path, monkeypatch)
    history = receipts_dir / HISTORY_DIRNAME
    history.mkdir()
    history.chmod(0o555)
    capsys.readouterr()  # drop the ingest output
    try:
        code = main(["verify", "receipts/chain.json", "--json"])
        captured = capsys.readouterr()
        assert code == 0
        payload = json.loads(captured.out)  # stdout is pure JSON, untouched
        assert payload["verdict"] == "green"
        assert "could not archive run snapshot" in captured.err
    finally:
        history.chmod(0o755)
    assert _snapshots(receipts_dir) == []


def test_without_a_key_the_snapshot_is_unsigned_but_still_written(
    tmp_path, monkeypatch, capsys
):
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("TAMPER_SIGNAL_KEY", raising=False)
    # Sign the chain with a key OUTSIDE the default keys/ path, so verify
    # finds no private key to sign the snapshot with.
    generate_keys("elsewhere")
    (tmp_path / "export.csv").write_text(CSV, encoding="utf-8")
    assert main([
        "ingest", "export.csv", "--origin", "t", "--key", "elsewhere/signing.key",
    ]) == 0
    assert main(["verify", "receipts/chain.json"]) == 0

    files = _snapshots(tmp_path / "receipts")
    assert len(files) == 1
    snapshot = json.loads(files[0].read_text(encoding="utf-8"))
    assert "signature" not in snapshot

    items = load_snapshots("receipts")
    assert len(items) == 1
    assert items[0]["signed"] is False and items[0]["verified"] is False


# ---------------------------------------------------------------------------
# Defensive reads and the "latest" rule
# ---------------------------------------------------------------------------
def test_garbage_files_in_history_are_skipped_with_a_notice(tmp_path, monkeypatch, capsys):
    receipts_dir = _seed(tmp_path, monkeypatch)
    assert main(["verify", "receipts/chain.json"]) == 0
    history = receipts_dir / HISTORY_DIRNAME
    (history / "garbage.json").write_text("not json {", encoding="utf-8")
    (history / "list.json").write_text("[1, 2, 3]", encoding="utf-8")

    chain = read_chain("receipts/chain.json")
    notices: list[str] = []
    items = load_snapshots(
        "receipts", trusted_keys=[chain["public_key"]], on_notice=notices.append
    )
    assert len(items) == 1  # only the real snapshot survives
    assert any("garbage.json" in n for n in notices)
    assert any("list.json" in n for n in notices)

    # A re-verify over the polluted history stays green, notices on stderr.
    code = main(["verify", "receipts/chain.json"])
    captured = capsys.readouterr()
    assert code == 0
    assert "run history: skipping" in captured.err


def test_future_created_at_snapshots_are_skipped(tmp_path, monkeypatch):
    receipts_dir = _seed(tmp_path, monkeypatch)
    chain = read_chain("receipts/chain.json")
    receipts = [read_receipt("receipts", n) for n in chain["receipts"]]
    future = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=2)).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )
    snapshot = build_run_snapshot(
        receipts, chain, chain_dir="receipts", created_at=future
    )
    write_run_snapshot("receipts", snapshot)
    assert len(_snapshots(receipts_dir)) == 1

    notices: list[str] = []
    assert load_snapshots("receipts", on_notice=notices.append) == []
    assert any("in the future" in n for n in notices)
    assert latest_snapshot("receipts") is None


def test_latest_prefers_newest_created_at_and_breaks_ties_on_body_hash(
    tmp_path, monkeypatch
):
    receipts_dir = _seed(tmp_path, monkeypatch)
    chain = read_chain("receipts/chain.json")
    receipts = [read_receipt("receipts", n) for n in chain["receipts"]]
    older = build_run_snapshot(
        receipts, chain, chain_dir="receipts", created_at="2026-06-01T00:00:00Z"
    )
    newer = build_run_snapshot(
        receipts, chain, chain_dir="receipts", created_at="2026-06-02T00:00:00Z"
    )
    write_run_snapshot("receipts", older)
    write_run_snapshot("receipts", newer)
    assert len(_snapshots(receipts_dir)) == 2
    assert latest_snapshot("receipts")["snapshot"]["created_at"] == "2026-06-02T00:00:00Z"

    # Equal created_at: the larger body hash wins, deterministically.
    items = load_snapshots("receipts")
    tied = sorted([items[0], items[1]], key=lambda i: i["body_hash"], reverse=True)
    assert items == sorted(items, key=lambda i: (i["created_at"], i["body_hash"]), reverse=True)
    assert tied[0]["body_hash"] >= tied[1]["body_hash"]


def test_signed_snapshot_failing_verification_is_skipped(tmp_path, monkeypatch):
    receipts_dir = _seed(tmp_path, monkeypatch)
    assert main(["verify", "receipts/chain.json"]) == 0
    [path] = _snapshots(receipts_dir)
    snapshot = json.loads(path.read_text(encoding="utf-8"))
    chain = read_chain("receipts/chain.json")

    notices: list[str] = []
    good = load_snapshots(
        "receipts", trusted_keys=[chain["public_key"]], on_notice=notices.append
    )
    assert len(good) == 1 and good[0]["verified"] is True

    # Tamper the archived body: the signature no longer verifies, so the
    # snapshot is skipped (never red, never a crash).
    snapshot["chain_tail_hash"] = "ee" * 32
    path.write_text(json.dumps(snapshot, indent=2) + "\n", encoding="utf-8")
    notices.clear()
    assert load_snapshots(
        "receipts", trusted_keys=[chain["public_key"]], on_notice=notices.append
    ) == []
    assert any("signature does not verify" in n for n in notices)


def test_history_scanner_rejects_symlinks_out_of_the_history_dir(tmp_path, monkeypatch):
    receipts_dir = _seed(tmp_path, monkeypatch)
    history = receipts_dir / HISTORY_DIRNAME
    history.mkdir()
    secret = tmp_path / "secret.json"
    secret.write_text(json.dumps({"kind": "run_snapshot", "created_at": "2026-06-01T00:00:00Z"}), encoding="utf-8")
    try:
        (history / "escape.json").symlink_to(secret)
    except (OSError, NotImplementedError):
        pytest.skip("platform does not support symlinks here")

    notices: list[str] = []
    assert load_snapshots("receipts", on_notice=notices.append) == []
    assert any("outside the history directory" in n for n in notices)


def test_read_receipt_rejects_history_paths_in_chain_json(tmp_path):
    # Regression for the receipt-reader confinement: a crafted chain.json
    # entry like "history/x.json" must not make verify read history files.
    chain_dir = tmp_path / "receipts"
    history = chain_dir / HISTORY_DIRNAME
    history.mkdir(parents=True)
    (history / "x.json").write_text("{}", encoding="utf-8")
    with pytest.raises(ValueError, match="Unsafe receipt path"):
        read_receipt(str(chain_dir), "history/x.json")


# ---------------------------------------------------------------------------
# serve excludes history/
# ---------------------------------------------------------------------------
def test_serve_404s_history_and_serves_chain_with_cors(tmp_path, monkeypatch):
    import http.client
    import socketserver
    import threading

    from tamper_signal.cli import _serve_handler_class

    receipts_dir = _seed(tmp_path, monkeypatch)
    assert main(["verify", "receipts/chain.json"]) == 0
    [snapshot_path] = _snapshots(receipts_dir)

    handler = _serve_handler_class(str(receipts_dir.resolve()))
    with socketserver.TCPServer(("127.0.0.1", 0), handler) as httpd:
        port = httpd.server_address[1]
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        try:
            conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)

            conn.request("GET", "/chain.json")
            response = conn.getresponse()
            body = response.read()
            assert response.status == 200
            assert response.getheader("Access-Control-Allow-Origin") == "*"
            assert json.loads(body)["receipts"] == ["000_source.json"]

            for url in (
                f"/history/{snapshot_path.name}",
                "/history/",
                "/history",
            ):
                conn.request("GET", url)
                response = conn.getresponse()
                response.read()
                assert response.status == 404, url
                # CORS headers still apply to error responses.
                assert response.getheader("Access-Control-Allow-Origin") == "*"
            conn.close()
        finally:
            httpd.shutdown()
            thread.join(timeout=5)


# ---------------------------------------------------------------------------
# ingest warning before an un-archived reset
# ---------------------------------------------------------------------------
WARNING = "warning: previous run was never verified; its totals will not enter history"


def test_ingest_warns_when_resetting_an_unsnapshotted_chain(tmp_path, monkeypatch, capsys):
    _seed(tmp_path, monkeypatch)
    capsys.readouterr()
    assert main(["ingest", "export.csv", "--origin", "t"]) == 0
    assert WARNING in capsys.readouterr().err


def test_ingest_does_not_warn_when_the_run_was_snapshotted(tmp_path, monkeypatch, capsys):
    _seed(tmp_path, monkeypatch)
    assert main(["verify", "receipts/chain.json"]) == 0
    capsys.readouterr()
    assert main(["ingest", "export.csv", "--origin", "t"]) == 0
    assert WARNING not in capsys.readouterr().err


def test_first_ingest_into_a_fresh_directory_does_not_warn(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("TAMPER_SIGNAL_KEY", raising=False)
    generate_keys("keys")
    (tmp_path / "export.csv").write_text(CSV, encoding="utf-8")
    assert main(["ingest", "export.csv", "--origin", "t"]) == 0
    assert WARNING not in capsys.readouterr().err


# ---------------------------------------------------------------------------
# Cross-stack parity (fixture shared with node/test/history.test.js)
# ---------------------------------------------------------------------------
def test_parity_fixture_loads_and_verifies(tmp_path):
    chain = read_chain(str(PARITY_FIXTURE / "chain.json"))
    items = load_snapshots(str(PARITY_FIXTURE), trusted_keys=[chain["public_key"]])
    assert len(items) == 1
    item = items[0]
    assert item["signed"] is True and item["verified"] is True
    assert item["filename"] == item["body_hash"] + ".json"

    snapshot = item["snapshot"]
    assert snapshot["chain_tail_hash"] == chain["receipt_hashes"]["001_clean.json"]
    # "campaign" is a fully non-null text column, so it never surfaces in the
    # source control totals; the snapshot's column set is honest about that.
    assert snapshot["source"]["columns"] == ["day", "spend"]
    assert snapshot["tolerance"] == {
        "band": "0.05", "settle_hours": 72, "bucket_column": "day",
    }
    assert [s["name"] for s in snapshot["stages"]] == ["source", "clean"]
    assert "code_hash" not in snapshot["stages"][0]
    assert snapshot["stages"][1]["code_hash"]
    assert snapshot["stages"][1]["code_file"] == "pipeline.py"

    # Rebuilding the snapshot from the fixture chain reproduces the exact
    # content address (node/test/history.test.js asserts the same bytes).
    receipts = [read_receipt(str(PARITY_FIXTURE), n) for n in chain["receipts"]]
    rebuilt = build_run_snapshot(
        receipts, chain,
        chain_dir=str(PARITY_FIXTURE),
        created_at=snapshot["created_at"],
    )
    assert snapshot_body_hash(rebuilt) == item["body_hash"]


def test_snapshot_body_canonical_bytes_are_pinned_cross_stack():
    """A literal snapshot body canonicalizes to the same bytes in both stacks:
    node/test/history.test.js pins this exact body to this hash."""
    body = {
        "kind": "run_snapshot",
        "spec_version": "1.2",
        "created_at": "2026-06-12T00:05:00Z",
        "chain_tail_hash": "cc" * 32,
        "source": {
            "filename": "export.csv",
            "declared_origin": "parity pin",
            "columns": ["amount", "day"],
        },
        "tolerance": {"band": "0.05", "settle_hours": 72},
        "stages": [
            {
                "name": "source",
                "kind": "source_manifest",
                "totals": {
                    "row_count": 2,
                    "column_count": 2,
                    "numeric_sums": {"amount": "30.5"},
                    "date_ranges": {},
                    "null_counts": {},
                    "bucket_column": "day",
                    "period_buckets": {
                        "2026-05-01": {
                            "row_count": 1,
                            "numeric_sums": {"amount": "10.5"},
                            "null_counts": {},
                        },
                    },
                },
            },
            {
                "name": "clean",
                "kind": "transform_receipt",
                "code_hash": "dd" * 32,
                "code_file": "pipeline.py",
                "totals": {
                    "row_count": 1,
                    "column_count": 2,
                    "numeric_sums": {"amount": "10.5"},
                    "date_ranges": {},
                    "null_counts": {},
                },
            },
        ],
    }
    digest = hashlib.sha256(canonical_json_bytes(body)).hexdigest()
    assert digest == "ac291de942d4a592131389f8f50bcbde149e1c59cc87bffa9fd613de40f425a3"
