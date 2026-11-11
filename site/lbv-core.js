/* LED Beam Viewer core: light distributions, photometry, IES LM-63.
 *
 * A distribution is a candela table in IES "type C" form:
 *   { name, vAngles: [deg, 0 = beam axis .. 180], hAngles: [deg], cd: [h][v] }
 * hAngles = [0] means rotationally symmetric. Otherwise the last horizontal angle sets
 * the symmetry, as in LM-63: 90 = quadrant, 180 = bilateral, 360 = none.
 *
 * Plain script: in the browser it defines window.LBV; in Node it is a CommonJS module.
 */
(function (root, factory) {
  const lib = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = lib;
  else root.LBV = lib;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DEG = Math.PI / 180;
  const LUX_PER_FC = 10.7639; // 1 footcandle = 10.7639 lux
  const M_PER_FT = 0.3048;

  // ── Generated sources ──────────────────────────────────────────────────────
  // Each profile f(θ) is relative intensity for θ in [0, 90°], zero beyond.
  // relLumens = 2π ∫ f(θ) sin θ dθ, analytic, used to scale to a lumen target.

  const SOURCES = {
    lambertian: {
      label: "Lambertian (bare LED)",
      params: [],
      f: () => (t) => Math.cos(t),
      relLumens: () => Math.PI,
    },
    spot: {
      label: "Narrow spot (cosⁿ)",
      params: [{ key: "n", label: "Exponent n", min: 1, max: 200, step: 1, value: 20 }],
      f: (p) => (t) => Math.pow(Math.cos(t), p.n),
      relLumens: (p) => (2 * Math.PI) / (p.n + 1),
    },
    batwing: {
      // cos θ (1 + k sin²θ), normalised so its peak is 1. Peak moves off-axis for k > 0.5.
      label: "Batwing (wide spread)",
      params: [{ key: "k", label: "Wing strength k", min: 0, max: 10, step: 0.1, value: 3 }],
      f: (p) => {
        const raw = (t) => Math.cos(t) * (1 + p.k * Math.sin(t) ** 2);
        const peak = batwingPeak(p.k);
        return (t) => raw(t) / peak;
      },
      relLumens: (p) => (2 * Math.PI * (0.5 + p.k / 4)) / batwingPeak(p.k),
    },
  };

  function batwingPeak(k) {
    // max of cos t (1 + k sin² t): at t = 0 when k <= 0.5, else sin² t = (2k - 1) / (3k)
    if (k <= 0.5) return 1;
    const s2 = (2 * k - 1) / (3 * k);
    return Math.sqrt(1 - s2) * (1 + k * s2);
  }

  /** Build a symmetric distribution from a generated source.
   *  scale: { lumens } or { peakCd }. step: vertical angle step in degrees. */
  function generate(type, params, scale, step = 0.5) {
    const src = SOURCES[type];
    if (!src) throw new Error("unknown source " + type);
    const p = {};
    for (const d of src.params) p[d.key] = params && params[d.key] != null ? +params[d.key] : d.value;
    const f = src.f(p);
    const peakCd = scale.peakCd != null ? scale.peakCd : scale.lumens / src.relLumens(p);
    const vAngles = [];
    for (let a = 0; a <= 180 + 1e-9; a += step) vAngles.push(+a.toFixed(6));
    const row = vAngles.map((a) => (a <= 90 ? Math.max(0, peakCd * f(a * DEG)) : 0));
    row[vAngles.indexOf(90)] = 0; // exactly zero at the horizon, avoids cos(90°) round-off
    return { name: src.label, type, params: p, vAngles, hAngles: [0], cd: [row] };
  }

  // ── Interpolation ──────────────────────────────────────────────────────────

  function interp1(xs, ys, x) {
    if (x <= xs[0]) return ys[0];
    const n = xs.length;
    if (x >= xs[n - 1]) return ys[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] <= x) lo = mid; else hi = mid;
    }
    const t = (x - xs[lo]) / (xs[hi] - xs[lo]);
    return ys[lo] + t * (ys[hi] - ys[lo]);
  }

  /** Fold an azimuth (deg) into the range the table covers, using its symmetry. */
  function foldAzimuth(dist, phi) {
    const hs = dist.hAngles;
    const first = hs[0], last = hs[hs.length - 1];
    const span = last - first;
    let a = ((phi % 360) + 360) % 360;
    if (span <= 0 || (a >= first && a <= last)) return Math.min(Math.max(a, first), last);
    // Only fold when mirror reflections across the span endpoints tile the circle
    // (e.g. quadrant 0-90, bilateral 0-180 or 90-270, hex 0-60). Otherwise clamp.
    if (span % 1 !== 0 || 360 % (2 * span) !== 0) return Math.min(Math.max(a, first), last);
    const period = 2 * span;
    let b = (((a - first) % period) + period) % period;
    if (b > span) b = period - b;
    return first + b;
  }

  /** Intensity (cd) at polar angle theta (deg from axis) and azimuth phi (deg). */
  function intensity(dist, theta, phi = 0) {
    const { vAngles, hAngles, cd } = dist;
    if (hAngles.length === 1) return interp1(vAngles, cd[0], theta);
    const a = foldAzimuth(dist, phi);
    // linear in azimuth between the two bracketing planes (360 wraps to 0)
    const hs = hAngles;
    let j = 0;
    while (j < hs.length - 2 && hs[j + 1] <= a) j++;
    const h0 = hs[j], h1 = hs[j + 1];
    const t = h1 > h0 ? Math.min(1, Math.max(0, (a - h0) / (h1 - h0))) : 0;
    const i0 = interp1(vAngles, cd[j], theta), i1 = interp1(vAngles, cd[j + 1], theta);
    return i0 + t * (i1 - i0);
  }

  // ── Photometry ─────────────────────────────────────────────────────────────

  /** Total lumens by the zonal method: each sample owns the band half-way to its
   *  neighbours, weighted by solid angle 2π (cos θ_lo − cos θ_hi) scaled by azimuth width. */
  function lumens(dist) {
    const { vAngles, hAngles, cd } = dist;
    const nv = vAngles.length;
    const edges = [vAngles[0]];
    for (let i = 1; i < nv; i++) edges.push((vAngles[i - 1] + vAngles[i]) / 2);
    edges.push(vAngles[nv - 1]);
    const bandSolid = []; // solid angle of each polar band over the full 2π of azimuth
    for (let i = 0; i < nv; i++) bandSolid.push(2 * Math.PI * (Math.cos(edges[i] * DEG) - Math.cos(edges[i + 1] * DEG)));

    const nh = hAngles.length;
    if (nh === 1) return cd[0].reduce((s, I, i) => s + I * bandSolid[i], 0);
    const span = hAngles[nh - 1] - hAngles[0] || 1;
    // azimuth weights: half-way between neighbouring planes, as a fraction of the covered
    // span; by symmetry the mean over the listed span equals the mean over the full circle
    const w = [];
    for (let j = 0; j < nh; j++) {
      const lo = j === 0 ? hAngles[0] : (hAngles[j - 1] + hAngles[j]) / 2;
      const hi = j === nh - 1 ? hAngles[nh - 1] : (hAngles[j] + hAngles[j + 1]) / 2;
      w.push((hi - lo) / span);
    }
    let total = 0;
    for (let j = 0; j < nh; j++) for (let i = 0; i < nv; i++) total += w[j] * cd[j][i] * bandSolid[i];
    return total;
  }

  function peak(dist) {
    let m = 0;
    for (const row of dist.cd) for (const v of row) if (v > m) m = v;
    return m;
  }

  /** Full angle (deg) out to `frac` of peak intensity in plane phi: the widest θ on each
   *  side where I ≥ frac · peak, summed. Beam angle: frac 0.5; field angle: 0.1. */
  function spreadAngle(dist, frac, phi = 0) {
    const target = frac * peak(dist);
    const side = (az) => {
      let last = 0;
      for (let t = 0; t <= 180; t += 0.05) if (intensity(dist, t, az) >= target) last = t;
      return last;
    };
    return side(phi) + side(phi + 180);
  }

  /** Illuminance grid on a wall facing the source along its axis, at distance d (m).
   *  E = I(θ, φ) cos³θ / d², in lux. Returns { xs, ys, E, max }. */
  function wallGrid(dist, d, halfWidth, n = 161) {
    const xs = [], E = [];
    for (let i = 0; i < n; i++) xs.push(-halfWidth + (2 * halfWidth * i) / (n - 1));
    let max = 0;
    for (let iy = 0; iy < n; iy++) {
      const y = xs[iy];
      const row = new Float64Array(n);
      for (let ix = 0; ix < n; ix++) {
        const x = xs[ix];
        const r = Math.sqrt(d * d + x * x + y * y);
        const cosT = d / r;
        const theta = Math.acos(cosT) / DEG;
        const phi = Math.atan2(y, x) / DEG;
        const e = (intensity(dist, theta, phi) * cosT * cosT * cosT) / (d * d);
        row[ix] = e;
        if (e > max) max = e;
      }
      E.push(row);
    }
    return { xs, ys: xs, E, max };
  }

  // ── IES LM-63-2002 ─────────────────────────────────────────────────────────

  function fmt(v) { return Number(v.toPrecision(6)).toString(); }
  function wrap(values, perLine = 10) {
    const lines = [];
    for (let i = 0; i < values.length; i += perLine) lines.push(values.slice(i, i + perLine).map(fmt).join(" "));
    return lines.join("\r\n");
  }

  /** Write an LM-63-2002 file. Absolute photometry (lumens per lamp −1), metres, point source. */
  function toIES(dist, meta = {}) {
    const date = meta.date || new Date().toISOString().slice(0, 10);
    const out = [
      "IESNA:LM-63-2002",
      "[TEST] Generated by LED Beam Viewer",
      "[TESTLAB] LED Beam Viewer (computed, not measured)",
      `[ISSUEDATE] ${date}`,
      "[MANUFAC] LED Beam Viewer",
      `[LUMCAT] ${meta.catalog || dist.type || "custom"}`,
      `[LUMINAIRE] ${meta.description || dist.name}`,
      `[OTHER] Total lumens ${lumens(dist).toFixed(1)}`,
      "TILT=NONE",
      // lamps, lumens/lamp (−1 absolute), multiplier, n vertical, n horizontal,
      // photometric type (1 = C), units (2 = metres), width, length, height (0 = point)
      `1 -1 1 ${dist.vAngles.length} ${dist.hAngles.length} 1 2 0 0 0`,
      // ballast factor, future use, input watts
      "1 1 0",
      wrap(dist.vAngles),
      wrap(dist.hAngles),
      ...dist.cd.map((row) => wrap(row)),
    ];
    return out.join("\r\n") + "\r\n";
  }

  /** Parse an IES LM-63 file (1995, 2002, 2019) with TILT=NONE or TILT=INCLUDE. */
  function parseIES(text) {
    const lines = text.split(/\r?\n/);
    const tiltIdx = lines.findIndex((l) => /^\s*TILT\s*=/i.test(l));
    if (tiltIdx < 0) throw new Error("no TILT line: not an IES file");
    const keywords = {};
    for (const l of lines.slice(0, tiltIdx)) {
      const m = l.match(/^\s*\[([^\]]+)\]\s*(.*)$/);
      if (m) keywords[m[1].toUpperCase()] = m[2].trim();
    }
    let nums = lines.slice(tiltIdx + 1).join(" ").trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if (/INCLUDE/i.test(lines[tiltIdx])) {
      // lamp-to-luminaire geometry, pair count, then angles and multipliers
      const pairs = nums[1];
      nums = nums.slice(2 + 2 * pairs);
    }
    let k = 0;
    const take = (n) => { const a = nums.slice(k, k + n); k += n; return a; };
    const [, , mult, nv, nh, ptype, units, width, length, height] = take(10);
    const [ballast, , watts] = take(3);
    const vAngles = take(nv);
    const hAngles = take(nh);
    const cd = [];
    for (let j = 0; j < nh; j++) cd.push(take(nv).map((v) => v * mult * ballast));
    if (cd.some((r) => r.some(Number.isNaN)) || cd.length !== nh) throw new Error("IES file ended early");
    return {
      name: keywords.LUMINAIRE || keywords.LUMCAT || "IES file",
      keywords, photometricType: ptype, units, size: { width, length, height }, watts,
      vAngles, hAngles, cd,
    };
  }

  // ── CSV exports ────────────────────────────────────────────────────────────

  function candelaCSV(dist) {
    const head = ["theta_deg", ...dist.hAngles.map((h) => `cd_C${h}`)].join(",");
    const rows = dist.vAngles.map((v, i) => [v, ...dist.cd.map((r) => fmt(r[i]))].join(","));
    return [head, ...rows].join("\n") + "\n";
  }

  function wallCSV(grid, units) {
    const imperial = units === "imperial";
    const L = imperial ? 1 / M_PER_FT : 1, Eu = imperial ? 1 / LUX_PER_FC : 1;
    const head = imperial ? "x_ft,y_ft,illuminance_fc" : "x_m,y_m,illuminance_lux";
    const out = [head];
    for (let iy = 0; iy < grid.ys.length; iy++)
      for (let ix = 0; ix < grid.xs.length; ix++)
        out.push(`${fmt(grid.xs[ix] * L)},${fmt(grid.ys[iy] * L)},${fmt(grid.E[iy][ix] * Eu)}`);
    return out.join("\n") + "\n";
  }

  return {
    DEG, LUX_PER_FC, M_PER_FT, SOURCES,
    generate, batwingPeak, interp1, intensity, lumens, peak, spreadAngle, wallGrid,
    toIES, parseIES, candelaCSV, wallCSV,
  };
});
