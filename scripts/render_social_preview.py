"""Render docs/media/social-preview.png (1280x640) for the GitHub repo settings.

GitHub's social preview is what Slack, X, LinkedIn, and HN unfurls show for a
repo link. It reuses docs/media/og-card.html (the 1200x630 site card), centred
on the same background, plus one line saying what the project is.

Needs Playwright with a Chromium: pip install playwright. Set CHROMIUM to an
existing browser binary to skip Playwright's own download.
Run from the repo root: python scripts/render_social_preview.py
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path

from playwright.async_api import async_playwright

CARD = Path("docs/media/og-card.html")
OUT = Path("docs/media/social-preview.png")
TAGLINE = '<div class="tagline">The light is green, the data is clean.</div>'
DESCRIPTOR = (
    '<div style="font-size:22px;letter-spacing:1px;color:#8b98a5;margin-top:-22px">'
    "signed receipts for every stage of a data pipeline &middot; python + js &middot; MIT</div>"
)
FRAME = (
    "html{background:#0b0f14;width:1280px;height:640px;display:flex;"
    "align-items:center;justify-content:center;overflow:hidden}\n</style>"
)


async def main() -> None:
    html = CARD.read_text(encoding="utf-8")
    html = html.replace(TAGLINE, TAGLINE + DESCRIPTOR, 1).replace("</style>", FRAME, 1)
    async with async_playwright() as p:
        executable = os.environ.get("CHROMIUM")
        browser = await p.chromium.launch(executable_path=executable) if executable else await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1280, "height": 640})
        await page.set_content(html)
        await page.wait_for_timeout(300)
        await page.screenshot(path=str(OUT), clip={"x": 0, "y": 0, "width": 1280, "height": 640})
        await browser.close()
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    asyncio.run(main())
