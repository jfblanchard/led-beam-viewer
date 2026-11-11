# Validation

Pre-release verification, run 2026-11-11 against the release commit.

## Unit and cross-checks

- `node tests/test_core.cjs`: **13 checks pass**, covering analytic lumen
  integrals for all three generated sources, beam angle, 1/d² and cos³θ wall
  illuminance, IES export round trip, azimuth folding on quadrant-symmetric and
  offset-plane tables, and every bundled `site/ies/` file parsing sanely.
- `python3 tests/cross_check_lumens.py`: an independent Python re-implementation
  of the zonal integration agrees with the JavaScript core on all 7 bundled
  measured files, worst difference 1.0%.

## Browser end-to-end (Playwright, headless Firefox)

25 scripted checks against a local serve, all passing with zero console errors:

- Page loads, numbers table fills, polar, wall and section canvases paint.
- Lambertian, cosⁿ spot and batwing sources each render.
- File import: `Example_01.ies` (a real lab file with a known reference value)
  loads and integrates to **381 lm**, matching the unit-test expectation.
- Scale modes (lumens, peak candela, as measured) switch correctly.
- Distance and view-width sliders update the wall map.
- 3D view renders a real WebGL surface and toggles back to 2D.
- All four exports fire: IES file, candela CSV, wall-grid CSV, plots PNG.
- Metric/imperial toggle switches units.
- Deep links apply on fresh load: `#view=3d`, `#ies=<file>`,
  `#source=<src>&k=<n>&units=<m|i>&dist=<m>&cd=<cd>`.

## Deployment

- `wrangler deploy` serves `site/` as Cloudflare Workers static assets.
- Live site verified: `https://led-beam-viewer.jonfblanchard.workers.dev`.
- `site/ies/vendor/` is gitignored and returns 404 on the live site: local
  manufacturer files never ship.
