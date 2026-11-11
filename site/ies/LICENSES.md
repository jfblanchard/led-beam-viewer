# Bundled IES files — sources and licenses

Files in this directory (not `vendor/`) are safe to redistribute with the app.
Files under `vendor/` are **local use only**: they were downloaded from
manufacturer sites, which publish them for photometric simulation but grant
no redistribution right. Exclude `vendor/` from any public build.

## Clean-to-bundle files

| File | Source repo | Repo license | Contents |
|---|---|---|---|
| `bega_50975_6k3_downlight.ies` | [mrdoob/three.js](https://github.com/mrdoob/three.js) `examples/ies/` | MIT | BEGA LED downlight, 321 lm, axially symmetric |
| `bega_84659k4_62w.ies` | same | MIT | BEGA 62 W LED, 6400 lm, 37-plane table |
| `bega_50899_2k3_asym.ies` | same | MIT | BEGA 11.5 W LED, 24-plane asymmetric |
| `els_dt106_xicato_spot15.ies` | same | MIT | ELS track light, Xicato LED, 15° reflector |
| `ledalite_251602sn_t8_radiance_example.ies` | [LBNL-ETA/Radiance](https://github.com/LBNL-ETA/Radiance) `src/cv/mgflib/` | Radiance (BSD-style) | 1995 Ledalite T8 fluorescent, LM-63-95 format |
| `ael_atbl_led_area.ies` | [appleseedhq/appleseed](https://github.com/appleseedhq/appleseed) `sandbox/tests/` | MIT | AEL ATBL LED area light, LM-79 lab test LTL29483P14 |
| `ael_grsl30lede70_r2.ies` | same | MIT | AEL GRSL LED, LM-79 lab test LSCG675P50, 30-plane |

A third appleseed file (`test_iesparser_2`, AEL 100 W HPS 6×6 roadway) was
excluded: it is Type B floodlight photometry, which the viewer's parser does
not interpret. All three remain available upstream under MIT.

MIT license text: <https://github.com/mrdoob/three.js/blob/dev/LICENSE>
Radiance license: <https://github.com/LBNL-ETA/Radiance/blob/master/License.txt>

## Local-only vendor files (`vendor/`)

ams-OSRAM LED rayfile IES files fetched via the OSRAM download center
(`fetch_osram_ies.py` in the strobe-lens analysis folder). Loaded by
`loadLibrary()` from `vendor/manifest.json` when present.
