#!/usr/bin/env python3
"""Generate on-brand blog/FAQ imagery with fal.ai Recraft V3.

Reads FAL_KEY from the environment (never hardcode it). Generates two variants
per slot into docs/media/thumbs/_gen/ so we can pick winners before wiring the
finals into the site.

Run:  FAL_KEY=... python3 scripts/gen_images.py
"""
import io
import os
import sys
import urllib.request

import fal_client
from PIL import Image

if not os.environ.get("FAL_KEY"):
    sys.exit("FAL_KEY not set in environment")

OUT = os.path.join(os.path.dirname(__file__), "..", "docs", "media", "thumbs", "_gen")
os.makedirs(OUT, exist_ok=True)

# Shared brand scaffold: the stoplight.jpg clay-render look.
STYLE = (
    "Minimalist 3D product render, near-black blue-black background, "
    "soft studio lighting, matte charcoal rubberized material, gentle soft "
    "shadows, subtle radial vignette, generous negative space, single centered "
    "hero object, one emerald-green glow as the only saturated light source "
    "with a soft bloom halo, shallow depth of field, premium and restrained, "
    "no text, no lettering, no logos, high detail, octane render."
)

# Recraft brand palette: emerald green accent on near-black.
COLORS = [{"r": 52, "g": 211, "b": 153}, {"r": 11, "g": 15, "b": 20}]

SLOTS = {
    "faq": "A single rounded matte-charcoal 3D question mark floating in the "
           "center, the dot of the question mark glowing emerald green like a "
           "small indicator light.",
    "receipts": "A single long paper receipt curling gently in the center, "
                "rendered in matte charcoal tones, sealed at the bottom with a "
                "glowing emerald-green wax dot.",
    "move": "A row of matte 3D vertical bars of varying heights like a bar "
            "chart, a translucent emerald-green horizontal tolerance band "
            "sweeping across them, subtle motion blur suggesting movement, one "
            "bar lit emerald green.",
    "showwork": "A matte 3D chart card lifting at one corner to reveal a "
                "glowing grid of data rows beneath it, the revealed rows lit "
                "emerald green, as if showing the work behind the numbers.",
}

SIZE = {"width": 1280, "height": 800}  # 16:10, matches the card thumb aspect


def generate(slot, subject, variant):
    prompt = f"{subject} {STYLE}"
    print(f"  -> {slot}-{variant} generating...", flush=True)
    result = fal_client.subscribe(
        "fal-ai/recraft/v3/text-to-image",
        arguments={
            "prompt": prompt,
            "image_size": SIZE,
            "style": "realistic_image",
            "colors": COLORS,
        },
        with_logs=False,
    )
    url = result["images"][0]["url"]
    raw = urllib.request.urlopen(url).read()
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    path = os.path.join(OUT, f"{slot}-{variant}.jpg")
    img.save(path, "JPEG", quality=86, optimize=True)
    print(f"     saved {path} ({img.width}x{img.height})", flush=True)


def main():
    for slot, subject in SLOTS.items():
        print(f"[{slot}]", flush=True)
        for variant in ("a", "b"):
            try:
                generate(slot, subject, variant)
            except Exception as e:  # noqa: BLE001
                print(f"     FAILED {slot}-{variant}: {e}", flush=True)
    print("done. previews in docs/media/thumbs/_gen/", flush=True)


if __name__ == "__main__":
    main()
