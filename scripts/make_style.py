#!/usr/bin/env python3
"""Train a reusable Recraft brand style from our best renders — the compounding step.

This is how past work feeds forward. Instead of re-describing the brand look in
every prompt, we learn a Recraft **custom style** from a handful of curated
reference images and get back a `style_id`. gen_images.py then passes that id on
every generation, so new renders inherit the learned look automatically. Re-run
this as the Assets collection grows (with more/better references) and the style
compounds.

Reads FAL_KEY from the environment. The reference images are converted to PNG,
zipped, uploaded to fal storage, and sent to `fal-ai/recraft/v3/create-style`.
The resulting style_id is saved to docs/media/thumbs/manifest.json under
`brand_style` (committed, so the whole team/CI shares one brand style).

Run:  FAL_KEY=... python3 scripts/make_style.py
      FAL_KEY=... python3 scripts/make_style.py --refs a.jpg b.jpg --base-style realistic_image
"""
import argparse
import os
import sys
import tempfile
import zipfile

import fal_client
from PIL import Image

import fal_assets

if not os.environ.get("FAL_KEY"):
    sys.exit("FAL_KEY not set in environment")

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), ".."))
THUMBS = os.path.join(ROOT, "docs", "media", "thumbs")

# Curated brand reference set: the canonical stoplight look + the published heroes.
# These ARE our history; swap in Assets winners as the library grows.
DEFAULT_REFS = [
    os.path.join(THUMBS, name) for name in (
        "stoplight.jpg", "faq.jpg", "post-receipts.jpg",
        "post-move.jpg", "post-show-your-work.jpg",
    )
]

MODEL = "fal-ai/recraft/v3/create-style"


def build_zip(paths, workdir):
    """Convert each reference to PNG and bundle into a single zip (Recraft wants
    PNGs in a zip). Returns the zip path."""
    zip_path = os.path.join(workdir, "refs.zip")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for i, p in enumerate(paths):
            if not os.path.exists(p):
                print(f"  ! missing reference, skipping: {p}", flush=True)
                continue
            png = os.path.join(workdir, f"ref-{i:02d}.png")
            Image.open(p).convert("RGB").save(png, "PNG")
            zf.write(png, os.path.basename(png))
            print(f"  + {os.path.relpath(p, ROOT)}", flush=True)
    return zip_path


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--refs", nargs="*", default=DEFAULT_REFS,
                    help="reference image paths (default: the brand finals)")
    ap.add_argument("--base-style", default="realistic_image",
                    help="Recraft base style to build on (default: realistic_image)")
    args = ap.parse_args()

    refs = [os.path.abspath(p) for p in args.refs]
    print(f"training brand style from {len(refs)} references:", flush=True)
    with tempfile.TemporaryDirectory() as workdir:
        zip_path = build_zip(refs, workdir)
        print("  uploading reference bundle to fal storage...", flush=True)
        zip_url = fal_client.upload_file(zip_path)
        print("  creating style...", flush=True)
        result = fal_client.subscribe(
            MODEL,
            arguments={"images_data_url": zip_url, "base_style": args.base_style},
            with_logs=False,
        )

    style_id = result["style_id"]
    manifest = fal_assets.load_manifest()
    manifest["brand_style"] = {
        "style_id": style_id,
        "base_style": args.base_style,
        "model": MODEL,
        "references": [os.path.relpath(p, ROOT) for p in refs],
    }
    fal_assets.save_manifest(manifest)
    print(f"\nbrand style_id = {style_id}", flush=True)
    print(f"saved to {fal_assets.MANIFEST} (brand_style). gen_images.py will use it automatically.", flush=True)


if __name__ == "__main__":
    main()
