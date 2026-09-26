"""`tamper-signal demo` after a plain pip install, outside a repo clone.

The quickstart promises `pip install tamper-signal` then `tamper-signal demo`.
Run from any other directory, the demo must find its sample data inside the
package and must never touch the caller's own keys/ or receipts/.
"""

from __future__ import annotations

import os
import subprocess
import sys


def test_demo_runs_outside_a_clone_in_its_own_workspace(tmp_path):
    (tmp_path / "keys").mkdir()
    (tmp_path / "keys" / "signing.key").write_text("caller's key\n")
    (tmp_path / "receipts").mkdir()
    (tmp_path / "receipts" / "chain.json").write_text("caller's chain\n")

    result = subprocess.run(
        [sys.executable, "-m", "tamper_signal", "demo", "--no-serve"],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        encoding="utf-8",
        env={**os.environ, "PYTHONUTF8": "1", "NO_COLOR": "1"},
        timeout=300,
    )

    assert result.returncode == 0, result.stderr
    assert "DATA MISMATCH" in result.stdout
    assert "https://github.com/welovejeff/tamper-evident-verification" in result.stdout
    workspace = tmp_path / "tamper-signal-demo"
    assert (workspace / "receipts" / "chain.json").is_file()
    assert (workspace / "receipts_tampered" / "chain.json").is_file()
    assert (tmp_path / "keys" / "signing.key").read_text() == "caller's key\n"
    assert (tmp_path / "receipts" / "chain.json").read_text() == "caller's chain\n"
