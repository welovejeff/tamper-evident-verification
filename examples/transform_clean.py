"""Re-export of tamper_signal/_demo/transform_clean.py.

The sample transform lives in the package so `tamper-signal demo` works
after a plain pip install. This shim keeps examples/make_demo_chains.py and
any script run from the repo clone importing it by its old name.
"""

from tamper_signal._demo.transform_clean import transform_clean  # noqa: F401
