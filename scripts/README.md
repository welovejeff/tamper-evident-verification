# Brand imagery workflow (fal.ai + fal Assets)

On-brand blog/FAQ thumbnails are generated with fal.ai **Recraft V3** and
catalogued in **fal Assets** so winners are reproducible and re-findable instead
of ephemeral.

## Files

| File | Role |
|------|------|
| `gen_images.py` | Generate variants, record provenance, apply the brand style, optionally sync. |
| `make_style.py` | **Compounding**: train a reusable Recraft brand style from past winners. |
| `sync_assets.py` | File recorded generations into a fal Assets collection after the fact. |
| `fal_assets.py` | Shared helpers: the manifest + the Assets ingest call. |
| `../docs/media/thumbs/manifest.json` | **Provenance record** (committed): per-render prompt/params/`style_id`/result URL/vector_id, plus the trained `brand_style`. |
| `../docs/media/thumbs/_gen/` | Scratch variants to pick winners from (gitignored). |

## Compounding: the brand style

Storing renders in Assets is passive memory; the feedback loop is the **Recraft
custom style**. `make_style.py` learns a style from a handful of curated
references (the canonical `stoplight.jpg` + the published heroes), uploads them
to `fal-ai/recraft/v3/create-style`, and saves the returned `style_id` to the
manifest under `brand_style`. `gen_images.py` then passes that `style_id` on
every render automatically (it supersedes the generic `style` preset; the
`colors` lock still applies), so new images inherit the learned look instead of
leaning on the prompt scaffold alone.

```bash
FAL_KEY=… python3 scripts/make_style.py             # (re)train from the brand finals
FAL_KEY=… python3 scripts/make_style.py --refs a.png b.png   # or specific references
FAL_KEY=… python3 scripts/gen_images.py --no-style  # opt out for one run
```

As the Assets collection accumulates better winners, re-run `make_style.py` with
those as references — the style (and the brand consistency) compounds. The
current brand style id lives in `manifest.json` → `brand_style.style_id`.

## How the sync works

A generation returns a **fal-hosted result URL** (`*.fal.media`). We hand that URL
to the Assets ingest endpoint, which pulls the bytes from fal's own CDN — nothing
is re-uploaded through us — registers it as an asset, indexes the prompt for
semantic search, and files it into a collection, all in one call:

```
POST https://api.fal.ai/v1/assets/uploads
Authorization: Key $FAL_KEY
{"url": "<result_url>", "type": "image", "prompt": "<prompt>", "collection_id": "<id>"}
→ {"asset": {"vector_id": "...", ...}}
```

Required fields are `url` + `type`; the `url` must be fal-hosted (for arbitrary
local media, `fal_client.upload_file()` it to fal storage first). The returned
`vector_id` is derived from the URL, so re-ingesting the same URL is a no-op —
sync is naturally idempotent. Verified against `https://api.fal.ai/v1/openapi.json`
(title: "Platform APIs"). The project's brand collection is
**`d8nf53kregj0m3bnnbmg`** ("Tamper Signal — brand imagery").

> The queue `request_id` is **not** a handle for Assets — that API ingests by
> media URL, not by queue id (posting an unknown id returns a no-op `success`).
> Renders produced *before* provenance recording have no recorded URL; re-generate
> them to bring them in. Tag assignment needs an ADMIN key (a standard key 403s),
> so this workflow organizes by collection, not tags.

## Run

```bash
# Generate variants + record provenance (no Assets sync):
FAL_KEY=… python3 scripts/gen_images.py

# Generate and file each result straight into a collection:
FAL_KEY=… python3 scripts/gen_images.py --sync --collection <collection-id>

# Or sync everything recorded so far, idempotently:
FAL_KEY=… FAL_ASSETS_COLLECTION=<collection-id> python3 scripts/sync_assets.py
```

Set `FAL_ASSETS_COLLECTION` once in your env to skip `--collection`. Create a
collection in the fal dashboard (or via the collections API) to get its id.

### TLS gotcha (python.org build behind a proxy)

If `urllib`/`httpx` fail with `CERTIFICATE_VERIFY_FAILED` while `curl` works,
build a combined CA bundle and export `SSL_CERT_FILE`:

```bash
security find-certificate -a -p /System/Library/Keychains/SystemRootCertificates.keychain > /tmp/kc.pem
security find-certificate -a -p /Library/Keychains/System.keychain >> /tmp/kc.pem
cat "$(python3 -m certifi)" /tmp/kc.pem > /tmp/cacert.pem
export SSL_CERT_FILE=/tmp/cacert.pem
```

> The Assets wire calls are isolated in `fal_assets._request` /
> `upload_to_collection` — the single place to adjust if fal's contract changes.
> `fal_assets.list_collections()` / `create_collection()` help you find or make a
> collection id.
