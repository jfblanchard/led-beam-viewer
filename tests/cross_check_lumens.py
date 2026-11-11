#!/usr/bin/env python3
"""Cross-validate lbv-core.js photometry against an independent Python implementation.

For every .ies file under site/ies/ (excluding vendor/):
  - parses the LM-63 numeric payload independently (token stream)
  - integrates total lumens via the zonal-band method
  - interpolates candela at a few (theta, phi) sample points
and compares against what lbv-core.js reports in Node.

Exit 0 if all files agree within tolerance, 1 otherwise.
"""
import json
import math
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
IES_DIR = ROOT / "site" / "ies"
CORE = ROOT / "site" / "lbv-core.js"

LUM_TOL = 0.01   # 1% on total lumens
CD_TOL = 0.02    # 2% on interpolated candela
CD_ABS = 0.5     # plus 0.5 cd absolute, so near-zero values don't false-fail


def parse_ies(text):
    """Minimal independent LM-63 Type C parser (token stream after TILT=NONE)."""
    lines = text.splitlines()
    i = next(i for i, l in enumerate(lines) if l.strip().upper().startswith("TILT"))
    if lines[i].strip().upper() != "TILT=NONE":
        raise ValueError("only TILT=NONE supported")
    tok = " ".join(lines[i + 1 :]).split()
    n_lamps, lum_per_lamp, mult = float(tok[0]), float(tok[1]), float(tok[2])
    nv, nh, ptype = int(tok[3]), int(tok[4]), int(tok[5])
    if ptype != 1:
        raise ValueError(f"photometric type {ptype}, need 1")
    p = 13  # 10-field header + ballast factor + future + input watts
    v = [float(x) for x in tok[p : p + nv]]; p += nv
    h = [float(x) for x in tok[p : p + nh]]; p += nh
    ballast = float(tok[10])
    cd = []
    for j in range(nh):
        cd.append([float(x) * mult * ballast for x in tok[p : p + nv]])
        p += nv
    return v, h, cd


def fold_phi(h, phi):
    """Fold phi into the listed azimuth range by mirror symmetry where the span
    tiles the circle (0-90, 0-180, 90-270, ...); otherwise clamp."""
    phi = phi % 360.0
    if len(h) == 1:
        return phi
    first, span = h[0], h[-1] - h[0]
    if span <= 0 or (first <= phi <= h[-1]):
        return max(first, min(h[-1], phi))
    if 360 % (2 * span) != 0:
        return max(first, min(h[-1], phi))
    b = (phi - first) % (2 * span)
    if b > span:
        b = 2 * span - b
    return first + b


def interp1(xs, ys, x):
    if x <= xs[0]:
        return ys[0]
    if x >= xs[-1]:
        return ys[-1]
    for i in range(len(xs) - 1):
        if xs[i] <= x <= xs[i + 1]:
            t = (x - xs[i]) / (xs[i + 1] - xs[i]) if xs[i + 1] != xs[i] else 0.0
            return ys[i] * (1 - t) + ys[i + 1] * t
    return ys[-1]


def intensity(v, h, cd, theta, phi):
    """Bilinear in (theta listed rows), linear across folded phi planes."""
    if len(h) == 1:
        return interp1(v, cd[0], theta)
    a = fold_phi(h, phi)
    # clamp into listed range
    a = max(h[0], min(h[-1], a))
    j = 0
    for j in range(len(h) - 1):
        if h[j] <= a <= h[j + 1]:
            break
    t = (a - h[j]) / (h[j + 1] - h[j]) if h[j + 1] != h[j] else 0.0
    i0 = interp1(v, cd[j], theta)
    i1 = interp1(v, cd[j + 1], theta)
    return i0 * (1 - t) + i1 * t


def lumens(v, h, cd):
    """Zonal-band integration: sum over bands of avg candela x solid angle x phi weight."""
    phi_w = []
    for j in range(len(h)):
        if len(h) == 1:
            phi_w.append(2 * math.pi)
            continue
        lo = h[j - 1] if j > 0 else h[0]
        hi = h[j + 1] if j < len(h) - 1 else h[-1]
        w = (hi - lo) / 2.0 if 0 < j < len(h) - 1 else (
            (h[1] - h[0]) / 2 if j == 0 else (h[-1] - h[-2]) / 2
        )
        phi_w.append(math.radians(w))
    # symmetry multiplier when the listed planes cover less than 360
    if len(h) > 1 and h[-1] < 360:
        span = h[-1] - h[0]
        phi_w = [w * (360.0 / span if span > 0 else 1.0) for w in phi_w]
    total = 0.0
    for i in range(len(v) - 1):
        band = math.radians(v[i + 1] - v[i])
        sa = 2 * math.pi * math.sin(math.radians((v[i] + v[i + 1]) / 2)) * band / (2 * math.pi)
        for j in range(len(h)):
            avg = (cd[j][i] + cd[j][i + 1]) / 2.0
            total += avg * sa * phi_w[j]
    return total


SAMPLES = [(0, 0), (12.5, 0), (37.5, 45), (60, 120), (77.5, 200), (88, 315)]


def main():
    files = sorted(p for p in IES_DIR.glob("*.ies"))
    if not files:
        print("no bundled .ies files found")
        return 1

    js_probe = f"""
const L = require({json.dumps(str(CORE))});
const fs = require("fs");
const files = {json.dumps([p.name for p in files])};
const out = {{}};
for (const f of files) {{
  const d = L.parseIES(fs.readFileSync({json.dumps(str(IES_DIR))} + "/" + f, "utf8"));
  out[f] = {{
    lumens: L.lumens(d),
    pts: {json.dumps(SAMPLES)}.map(([t, p]) => L.intensity(d, t, p)),
  }};
}}
console.log(JSON.stringify(out));
"""
    js = json.loads(subprocess.run(
        ["node", "-e", js_probe], capture_output=True, text=True, check=True
    ).stdout)

    ok = True
    for p in files:
        v, h, cd = parse_ies(p.read_text())
        py_lum = lumens(v, h, cd)
        js_lum = js[p.name]["lumens"]
        rel = abs(py_lum - js_lum) / js_lum if js_lum else 0
        status = "ok" if rel < LUM_TOL else "FAIL"
        if rel >= LUM_TOL:
            ok = False
        print(f"{status}  {p.name}: lumens py={py_lum:.1f} js={js_lum:.1f} ({rel*100:.2f}%)")
        for (th, ph), jv in zip(SAMPLES, js[p.name]["pts"]):
            pv = intensity(v, h, cd, th, ph)
            d = abs(pv - jv)
            if d > CD_ABS and d / max(jv, 1e-9) > CD_TOL:
                ok = False
                print(f"  FAIL  I({th},{ph}) py={pv:.2f} js={jv:.2f} ({d:.2f} cd)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
