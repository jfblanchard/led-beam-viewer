# Changelog

Development history leading up to the first public commit (2026-11-11).

## 2026-11-11

- Retook the README screenshot at desktop width: three-column layout with the
  2D/3D toggle visible
- Added a Try it live section linking the deployed site

## 2026-11-06

- Added a 3D intensity-balloon view on vendored three.js with OrbitControls:
  translucent surface, XYZ axes, 2D/3D toggle, `#view=3d` deep link
- Default load now opens a bundled measured file in As-measured scale
- Added IES import (multi-file), a bundled-library loader, and `#ies=` deep links
- Added "As measured" scale mode for absolute photometry from real files
- Bundled a license-clean measured IES library: 7 real lab files from three.js,
  appleseed, and Radiance sources, documented in `site/ies/LICENSES.md`
- Fixed an azimuth-span lumen undercount on partial-span files; added an
  independent Python cross-check (`tests/cross_check_lumens.py`)
- Deployed to Cloudflare Workers static assets

## 2026-11-03

- Phase 1: generated sources (Lambertian, cosⁿ spot, batwing), polar plot in two
  planes, wall heat map with distance and view-width sliders, cross-sections,
  key numbers, IES LM-63 + CSV + PNG exports, metric/feet toggle, URL hash
  presets, dark theme
