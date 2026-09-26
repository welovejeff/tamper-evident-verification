"""Re-export of tamper_signal/_demo/make_sample_export.py.

The sample generator lives in the package so `tamper-signal demo` works after
a plain pip install. This shim keeps examples/make_demo_chains.py and
`python examples/make_sample_export.py` working from the repo clone.
"""

from tamper_signal._demo.make_sample_export import build_rows, make  # noqa: F401

if __name__ == "__main__":
    out = make()
    print(f"Wrote {out}")
