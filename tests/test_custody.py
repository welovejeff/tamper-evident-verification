"""Tests for `receipts custody` — the CLI-local rich custody view (plan U7)."""

from __future__ import annotations

import json

from tamper_signal.cli import main


def _ingest(tmp_path, name, content):
    (tmp_path / name).write_text(content, encoding="utf-8")
    return main(["ingest", name, "--origin", "refresh", "--key", "keys/signing.key", "--out", "receipts/"])


def test_custody_reverifies_archived_prior_chains(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    assert main(["keygen", "--out", "keys/"]) == 0
    _ingest(tmp_path, "v1.csv", "day,amount\n2026-05-01,10\n")
    # A second ingest (replace, the default) archives the prior chain.
    _ingest(tmp_path, "v2.csv", "day,amount\n2026-05-01,10\n2026-05-02,20\n")
    capsys.readouterr()

    assert main(["custody", "receipts/chain.json", "--json"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["current"] == "green"
    assert len(payload["priors"]) >= 1  # the archived v1 chain
    # R10: each archived prior state is independently re-verified.
    assert all(prior["verdict"] in ("green", "yellow") for prior in payload["priors"])


def test_custody_text_report_without_archive(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    main(["keygen", "--out", "keys/"])
    _ingest(tmp_path, "v1.csv", "day,amount\n2026-05-01,10\n")
    capsys.readouterr()
    assert main(["custody", "receipts/chain.json"]) == 0
    out = capsys.readouterr().out
    assert "Chain of custody (CLI-local; not published)" in out
    assert "archived prior chains: none" in out


def test_custody_is_read_only(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    main(["keygen", "--out", "keys/"])
    _ingest(tmp_path, "v1.csv", "day,amount\n2026-05-01,10\n")
    before = sorted(p.name for p in (tmp_path / "receipts").iterdir())
    capsys.readouterr()
    main(["custody", "receipts/chain.json", "--json"])
    after = sorted(p.name for p in (tmp_path / "receipts").iterdir())
    assert before == after  # never writes to the published receipts directory
