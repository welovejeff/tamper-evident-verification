#!/usr/bin/env python3
"""Sync recorded fal generations into a fal Assets collection.

Reads docs/media/thumbs/manifest.json and ingests every entry that has a
fal-hosted `result_url` but hasn't been synced yet into the target collection
(fal pulls the bytes from its own CDN — nothing is re-uploaded). Idempotent and
re-runnable: each entry is marked `synced` in the manifest once filed, and the
asset's vector_id is derived from the URL, so a second run is a no-op.

Run:  FAL_KEY=... python3 scripts/sync_assets.py --collection <id>
      FAL_KEY=... FAL_ASSETS_COLLECTION=<id> python3 scripts/sync_assets.py
      ... --force        # re-ingest even entries already marked synced

Note: only generations produced *after* gen_images.py started recording the
result_url can be synced this way. Older finals on disk have no recorded URL and
would need re-generating.
"""
import argparse
import sys
import urllib.error

import fal_assets


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--collection", default=fal_assets.DEFAULT_COLLECTION,
                    help="fal Assets collection id (or set FAL_ASSETS_COLLECTION)")
    ap.add_argument("--force", action="store_true",
                    help="re-assign entries already marked synced")
    args = ap.parse_args()

    if not args.collection:
        sys.exit("No collection: pass --collection or set FAL_ASSETS_COLLECTION")

    manifest = fal_assets.load_manifest()
    entries = manifest.get("entries", {})
    if not entries:
        sys.exit(f"No entries in {fal_assets.MANIFEST} — run gen_images.py first.")

    synced = skipped = failed = 0
    for key, entry in sorted(entries.items()):
        url = entry.get("result_url")
        if not url:
            print(f"  skip {key}: no result_url (pre-provenance render)", flush=True)
            skipped += 1
            continue
        if entry.get("synced") and entry.get("collection") == args.collection and not args.force:
            print(f"  skip {key}: already synced", flush=True)
            skipped += 1
            continue
        try:
            asset = fal_assets.upload_to_collection(
                url, "image", args.collection, prompt=entry.get("prompt"))
            fal_assets.record(manifest, key, {
                "synced": True,
                "collection": args.collection,
                "vector_id": asset.get("vector_id"),
            })
            fal_assets.save_manifest(manifest)  # persist after each success
            print(f"  synced {key} ({asset.get('vector_id')})", flush=True)
            synced += 1
        except urllib.error.HTTPError as e:
            hint = " — result URL no longer fal-hosted; re-generate" if e.code in (400, 404) else ""
            print(f"  FAILED {key}: HTTP {e.code}{hint}", flush=True)
            failed += 1
        except Exception as e:  # noqa: BLE001
            print(f"  FAILED {key}: {e}", flush=True)
            failed += 1

    print(f"done. synced={synced} skipped={skipped} failed={failed} "
          f"-> collection {args.collection}", flush=True)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
