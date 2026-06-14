#!/usr/bin/env python3
"""Generate on-brand blog/FAQ imagery with fal.ai Recraft V3.

Reads FAL_KEY from the environment (never hardcode it). Generates two variants
per slot into docs/media/thumbs/_gen/ so we can pick winners before wiring the
finals into the site.

Every generation is recorded to docs/media/thumbs/manifest.json with its prompt,
params, and fal request_id — the provenance that lets us reproduce a winner or
file it into fal Assets later. Pass --sync to assign each result straight into
an Assets collection as it is produced (see scripts/sync_assets.py to sync after
the fact).

Run:  FAL_KEY=... python3 scripts/gen_images.py
      FAL_KEY=... python3 scripts/gen_images.py --sync --collection <id>
"""
import argparse
import io
import os
import sys
import urllib.request

import fal_client
from PIL import Image

import fal_assets

if not os.environ.get("FAL_KEY"):
    sys.exit("FAL_KEY not set in environment")

OUT = os.path.join(os.path.dirname(__file__), "..", "docs", "media", "thumbs", "_gen")
os.makedirs(OUT, exist_ok=True)

MODEL = "fal-ai/recraft/v3/text-to-image"

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
    "takedata": "A matte charcoal 3D parcel or export box mid-lift in the "
                "center, a small glowing emerald-green wax-sealed tag attached "
                "to it by a short cord, as if the data is leaving with its "
                "receipt still attached.",
}

SIZE = {"width": 1280, "height": 800}  # 16:10, matches the card thumb aspect


def generate(slot, subject, variant, manifest, sync_collection=None, style_id=None):
    prompt = f"{subject} {STYLE}"
    print(f"  -> {slot}-{variant} generating...", flush=True)

    # Compounding: when a trained brand style_id exists, pass it so the render
    # inherits the learned look (it supersedes the generic `style` preset). The
    # colors palette lock still applies either way.
    arguments = {"prompt": prompt, "image_size": SIZE, "colors": COLORS}
    if style_id:
        arguments["style_id"] = style_id
    else:
        arguments["style"] = "realistic_image"

    # subscribe() returns only the result payload; on_enqueue hands us the
    # queue request_id (kept as provenance) for free.
    captured = {}
    result = fal_client.subscribe(
        MODEL,
        arguments=arguments,
        with_logs=False,
        on_enqueue=lambda rid: captured.update(request_id=rid),
    )
    request_id = captured.get("request_id")
    url = result["images"][0]["url"]
    raw = urllib.request.urlopen(url).read()
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    path = os.path.join(OUT, f"{slot}-{variant}.jpg")
    img.save(path, "JPEG", quality=86, optimize=True)
    rel = os.path.relpath(path, os.path.join(os.path.dirname(__file__), ".."))
    print(f"     saved {rel} ({img.width}x{img.height}) request_id={request_id}", flush=True)

    fal_assets.record(manifest, f"{slot}-{variant}", {
        "slot": slot,
        "variant": variant,
        "model": MODEL,
        "prompt": prompt,
        "image_size": SIZE,
        "style_id": style_id,
        "request_id": request_id,
        "result_url": url,
        "local_path": rel,
    })

    if sync_collection:
        try:
            asset = fal_assets.upload_to_collection(
                url, "image", sync_collection, prompt=prompt)
            fal_assets.record(manifest, f"{slot}-{variant}", {
                "synced": True,
                "collection": sync_collection,
                "vector_id": asset.get("vector_id"),
            })
            print(f"     synced to fal Assets ({asset.get('vector_id')})", flush=True)
        except Exception as e:  # noqa: BLE001
            print(f"     sync FAILED {slot}-{variant}: {e}", flush=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--sync", action="store_true",
                    help="assign each result into a fal Assets collection")
    ap.add_argument("--collection", default=fal_assets.DEFAULT_COLLECTION,
                    help="fal Assets collection id (or set FAL_ASSETS_COLLECTION)")
    ap.add_argument("--slots", nargs="*", choices=sorted(SLOTS),
                    help="only generate these slots (default: all)")
    ap.add_argument("--style-id", default=None,
                    help="override the trained brand style_id (see make_style.py)")
    ap.add_argument("--no-style", action="store_true",
                    help="ignore the trained brand style; use the generic preset")
    args = ap.parse_args()

    sync_collection = args.collection if args.sync else None
    if args.sync and not sync_collection:
        sys.exit("--sync needs a collection: pass --collection or set FAL_ASSETS_COLLECTION")

    manifest = fal_assets.load_manifest()
    # Compounding: default to the trained brand style if one exists.
    style_id = None if args.no_style else (args.style_id or manifest.get("brand_style", {}).get("style_id"))
    if style_id:
        print(f"using trained brand style {style_id}", flush=True)
    slots = args.slots or list(SLOTS)
    for slot in slots:
        print(f"[{slot}]", flush=True)
        for variant in ("a", "b"):
            try:
                generate(slot, SLOTS[slot], variant, manifest, sync_collection, style_id)
            except Exception as e:  # noqa: BLE001
                print(f"     FAILED {slot}-{variant}: {e}", flush=True)
            finally:
                fal_assets.save_manifest(manifest)  # persist incrementally
    print(f"done. previews in {OUT}; provenance in {fal_assets.MANIFEST}", flush=True)


if __name__ == "__main__":
    main()
