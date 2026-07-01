"""Build the two v2 live-demo weather chains from live Open-Meteo data.

- examples/chains/weather-live/      a green, watched hourly-temperature chain
- examples/chains/weather-withheld/  the same source after a settled day's
                                     temperature was edited — caught, withheld,
                                     and surfaced as "awaiting review"

Run:  .venv/bin/python scripts/build_weather_demo.py
Commits only what the browser console fetches (chain.json, 000_source.json,
timeline.json) — never the pending event (candidate data) or CLI-local history.
The signing key is a throwaway demo key; its public half is embedded in the
chain, which is all the console needs to verify.
"""

from __future__ import annotations

import csv
import os
import shutil
import tempfile
from pathlib import Path

from tamper_signal import sources
from tamper_signal.cli import main
from tamper_signal.watcher import run_tick

REPO = Path(__file__).resolve().parent.parent
URL = (
    "https://api.open-meteo.com/v1/forecast?latitude=40.71&longitude=-74.01"
    "&hourly=temperature_2m&past_days=7&forecast_days=1&timezone=UTC"
)
BAND, SETTLE = "3%", "48h"
PUBLISHED = ("chain.json", "000_source.json", "timeline.json")


def _write_csv(path: Path, records: list[dict[str, str]]) -> None:
    with open(path, "w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=["time", "temperature_2m"], lineterminator="\n")
        writer.writeheader()
        writer.writerows(records)


def _publish(work: Path, dest_name: str) -> None:
    # Flat layout, matching the existing examples/chains/<name>/chain.json demos.
    # Publishes ONLY what the browser console fetches — never pending/ (candidate
    # data) or history/ (CLI-local run snapshots), which Pages would serve openly.
    dest = REPO / "examples" / "chains" / dest_name
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    for name in PUBLISHED:
        src = work / "receipts" / name
        if src.exists():
            shutil.copy2(src, dest / name)
    print(f"published {dest_name}: {sorted(p.name for p in dest.glob('*'))}")


def build_live(records: list[dict[str, str]]) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        os.chdir(work)
        main(["keygen", "--out", "keys/"])
        _write_csv(work / "seed.csv", records)
        main(["ingest", "seed.csv", "--origin", URL, "--key", "keys/signing.key",
              "--out", "receipts/", "--band", BAND, "--settle", SETTLE, "--bucket-column", "time"])
        main(["annotate", "receipts/chain.json", "--key", "keys/signing.key",
              "--author", "tamper-signal watcher",
              "--reason", "Live source: Open-Meteo hourly temperature (NYC), polled on a schedule."])
        main(["timeline", "receipts/chain.json"])
        _publish(work, "weather-live")


def build_withheld(records: list[dict[str, str]]) -> None:
    # Pick a settled day straight from the fetched data — an early one, well
    # older than the 48h window — rather than a computed date that might fall
    # outside the API window at a boundary. Nudge its temperature beyond the 3%
    # band: the kind of retroactive edit the watcher must catch.
    days = sorted({r["time"][:10] for r in records})
    if len(days) < 3:
        raise RuntimeError(f"need >=3 days of data to build the withheld demo, got {days}")
    settled_day = days[1]  # definitely older than the 48h settle window
    seed = [r for r in records if r["time"][:10] != days[-1]]  # drop the latest day
    edited = [dict(r) for r in records]
    n_edited = 0
    for row in edited:
        if row["time"][:10] == settled_day:
            row["temperature_2m"] = f"{float(row['temperature_2m']) * 1.12:.1f}"
            n_edited += 1
    if n_edited == 0:
        raise RuntimeError(f"no rows matched settled day {settled_day}; cannot build the withheld demo")

    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        os.chdir(work)
        main(["keygen", "--out", "keys/"])
        _write_csv(work / "seed.csv", seed)
        main(["ingest", "seed.csv", "--origin", URL, "--key", "keys/signing.key",
              "--out", "receipts/", "--band", BAND, "--settle", SETTLE, "--bucket-column", "time"])
        # Establishing tick (adds the latest day) so the watcher has its own baseline.
        est = run_tick(records, source_id="weather:nyc", origin=URL,
                       chain_dir="receipts/", key_path="keys/signing.key")
        print("establishing tick:", est["action"])
        # The retroactive edit to the settled day → withheld for review.
        held = run_tick(edited, source_id="weather:nyc", origin=URL,
                        chain_dir="receipts/", key_path="keys/signing.key")
        print("edit of settled day", settled_day, "->", held["action"], held.get("caveats"))
        if held["action"] != "withheld":
            raise RuntimeError(
                f"expected the settled edit to be withheld, got {held['action']!r}; "
                "the demo would misrepresent the feature — aborting."
            )
        main(["timeline", "receipts/chain.json"])
        _publish(work, "weather-withheld")


def main_build() -> None:
    result = sources.fetch(URL)
    records = sources.json_records(
        result.body, columnar={"path": "hourly", "columns": ["time", "temperature_2m"]}
    )
    print(f"fetched {len(records)} hourly records: {records[0]['time']} … {records[-1]['time']}")
    build_live(records)
    build_withheld(records)
    os.chdir(REPO)


if __name__ == "__main__":
    main_build()
