"""Streamlit helpers: the signal pill and the verified dataframe.

Streamlit apps cannot easily serve a static receipts directory for the
in-browser walk, so these helpers verify SERVER-SIDE with the Python verifier
and say so on the pill. That is a weaker trust story than the browser
re-verification (you are trusting the server that renders the page), and the
honest move is to label it rather than fake the stronger one.

    import streamlit as st
    from tamper_signal.streamlit_ext import signal, verified_dataframe

    result = signal("receipts/")          # the pill, in the sidebar or body
    verified_dataframe("receipts/", df)   # st.dataframe + verdict caption

Streamlit is not a dependency of tamper-signal; imports are lazy.
"""

from __future__ import annotations

from pathlib import Path

from .receipts import load_receipts, read_chain, verify_chain

_COLORS = {"green": "#34d399", "yellow": "#fbbf24", "red": "#f87171"}
_WORDS = {"green": "VERIFIED", "yellow": "CAVEAT", "red": "BROKEN"}


def _verify(chain_dir: str):
    chain = read_chain(str(Path(chain_dir) / "chain.json"))
    receipts = load_receipts(str(chain_dir))
    return verify_chain(
        receipts,
        chain.get("public_key"),
        chain_public_hex=chain.get("public_key"),
        receipt_names=chain.get("receipts", []),
    )


def signal(chain_dir: str = "receipts/", *, height: int = 46):
    """Render the signal pill for a chain, verified server-side.

    Returns the ChainResult so the app can branch on result.verdict.
    """
    import streamlit.components.v1 as components

    result = _verify(chain_dir)
    color = _COLORS[result.verdict]
    word = _WORDS[result.verdict]
    sub = (
        "chain intact"
        if result.verdict == "green"
        else (result.caveats[0].split(":")[0] if result.caveats else "see report")
        if result.verdict == "yellow"
        else (result.lines[0].removeprefix("✗ ").lower() if result.lines else "broken")
    )
    title = "Tamper Signal: verified server-side by the Python verifier"
    html = f"""
    <div style="font-family:ui-monospace,'SF Mono',Menlo,monospace" title="{title}">
      <span style="display:inline-flex;align-items:center;gap:8px;border:1px solid #1f2937;
        background:#0b0f14;color:#e5e7eb;border-radius:999px;padding:7px 14px 7px 10px;
        font-size:11px;letter-spacing:0.3px;white-space:nowrap">
        <span style="width:10px;height:10px;border-radius:50%;background:{color};
          box-shadow:0 0 6px 0 {color}b3"></span>
        <span style="font-weight:700;color:{color}">{word}</span>
        <span style="color:#8b98a5">· {sub} · server-side check</span>
      </span>
    </div>"""
    components.html(html, height=height)
    return result


def verified_dataframe(chain_dir: str, records_or_df, **dataframe_kwargs):
    """st.dataframe with an honest verdict caption above it.

    Verifies the chain server-side and, when given a list of records or a
    DataFrame, checks its semantic hash against the final receipt so the
    caption can say whether the rows shown are the attested data.
    """
    import streamlit as st

    from .adapters import to_records
    from .canonical import semantic_hash
    from .receipts import output_hash_of

    result = _verify(chain_dir)
    receipts = load_receipts(str(chain_dir))
    attested = None
    if receipts:
        try:
            attested = semantic_hash(to_records(records_or_df)) == output_hash_of(receipts[-1])
        except TypeError:
            attested = None

    if result.verdict == "red":
        st.error("The light is red, the chain is broken. " + (result.lines[0] if result.lines else ""))
    elif attested is False:
        st.error("This table does not match the final receipt; it is not the attested data.")
    elif result.verdict == "yellow":
        st.warning("The light is yellow, a human should look: " + "; ".join(result.caveats))
    else:
        st.caption("The light is green, the data is clean. Verified server-side against the receipt chain.")
    st.dataframe(records_or_df, **dataframe_kwargs)
    return result
