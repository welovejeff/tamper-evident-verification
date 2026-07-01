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
import datetime as dt
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
    # A settled day (well older than the 48h window) whose temperature we nudge
    # beyond the 3% band — the kind of retroactive edit the watcher must catch.
    settled_day = (dt.datetime.now(dt.timezone.utc).date() - dt.timedelta(days=5)).isoformat()
    seed = [r for r in records if not r["time"].startswith(records[-1]["time"][:10])]  # drop last day
    edited = [dict(r) for r in records]
    for row in edited:
        if row["time"].startswith(settled_day):
            row["temperature_2m"] = f"{float(row['temperature_2m']) * 1.12:.1f}"

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
