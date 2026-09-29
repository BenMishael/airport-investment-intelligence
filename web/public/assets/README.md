# Visual asset intake

Place candidate files in `inbox/`; do not reference that folder from application code. After reviewing license, safety, dimensions, and size, move approved files into the appropriate production folder and add their metadata to `manifest.json`.

## Installed motion assets

| File                         | Use                          | Technical status          | Release status                  |
| ---------------------------- | ---------------------------- | ------------------------- | ------------------------------- |
| `motion/route-network.json`  | Authentication route visual  | Valid, 42 KB, vector-only | Source URL and license required |
| `motion/evidence-scan.json`  | Evidence retrieval indicator | Valid, 35 KB, vector-only | Source URL and license required |
| `motion/result-resolve.json` | Completed evidence state     | Valid, 21 KB, vector-only | Source URL and license required |

The repository includes project-owned SVG posters, so reduced-motion mode or an animation-loading failure never breaks the UI. The installed Lotties have passed technical validation but remain marked `review` until their original download URLs and licenses are recorded. Production-ready assets must be public-domain, CC0, MIT, Apache, OFL, or otherwise redistribution-compatible. Do not use airline logos, editorial-only artwork, unknown licenses, embedded fonts or raster images in SVG, scripts, `foreignObject`, external URLs, or Lottie expression code.

Run `npm run assets:validate` during development. Run `npm run assets:validate:strict` before release; strict mode requires all three Lottie files to be present and production-ready.
