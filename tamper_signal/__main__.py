"""Entry point for `python -m tamper_signal`.

A fallback for when the `receipts` console script is not on PATH. pip installs
console scripts into the interpreter's bin directory, which is not on PATH on a
python.org framework Python (the common macOS setup), so `receipts` can come up
as "command not found". `python -m tamper_signal ...` always works, because it
runs through the same interpreter that ran pip.
"""

from .cli import main

if __name__ == "__main__":
    raise SystemExit(main())
