// Analytic checks for lbv-core.js. Run: node tests/test_core.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const L = require("../site/lbv-core.js");

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log("ok  " + name);
}
const close = (a, b, rel, msg) =>
  assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${msg}: ${a} vs ${b} (tol ${rel * 100}%)`);

test("Lambertian lumens = π · I0", () => {
  const d = L.generate("lambertian", {}, { peakCd: 100 });
  close(L.lumens(d), Math.PI * 100, 1e-4, "lumens");
});

test("cosⁿ lumens = 2π · I0 / (n + 1)", () => {
  for (const n of [1, 5, 20, 80]) {
    const d = L.generate("spot", { n }, { peakCd: 1000 });
    close(L.lumens(d), (2 * Math.PI * 1000) / (n + 1), 1e-3, `n=${n}`);
  }
});

test("batwing lumens match the analytic integral and its peak is the requested peak", () => {
  for (const k of [0, 0.5, 3, 8]) {
    const d = L.generate("batwing", { k }, { peakCd: 500 });
    close(L.lumens(d), (2 * Math.PI * 500 * (0.5 + k / 4)) / L.batwingPeak(k), 1e-3, `k=${k}`);
    close(L.peak(d), 500, 1e-3, `peak k=${k}`);
  }
});

test("scaling by lumens reproduces the lumen target", () => {
  for (const type of ["lambertian", "spot", "batwing"]) {
    const d = L.generate(type, {}, { lumens: 250 });
    close(L.lumens(d), 250, 1e-3, type);
  }
});

test("cosⁿ beam angle = 2 acos(0.5^(1/n))", () => {
  const n = 20;
  const d = L.generate("spot", { n }, { peakCd: 1 });
  const expected = (2 * Math.acos(Math.pow(0.5, 1 / n))) / L.DEG;
  assert.ok(Math.abs(L.spreadAngle(d, 0.5) - expected) < 0.2, `${L.spreadAngle(d, 0.5)} vs ${expected}`);
});

test("on-axis wall illuminance follows I0 / d²", () => {
  const d = L.generate("lambertian", {}, { peakCd: 100 });
  for (const dist of [1, 2, 5]) {
    const g = L.wallGrid(d, dist, 1, 21);
    close(g.E[10][10], 100 / (dist * dist), 1e-9, `d=${dist}`);
  }
});

test("off-axis wall illuminance = I(θ) cos³θ / d²", () => {
  const d = L.generate("lambertian", {}, { peakCd: 100 });
  const g = L.wallGrid(d, 2, 2, 3); // corners at x = y = ±2 m
  const r = Math.sqrt(4 + 4 + 4), cosT = 2 / r;
  close(g.E[2][2], (100 * cosT * cosT * cosT * cosT) / 4, 1e-3, "corner"); // I = 100 cos θ
});

test("IES export reads back identically", () => {
  const d = L.generate("batwing", { k: 3 }, { lumens: 400 }, 2.5);
  const back = L.parseIES(L.toIES(d, { date: "2026-11-03" }));
  assert.deepEqual(back.vAngles, d.vAngles);
  assert.deepEqual(back.hAngles, d.hAngles);
  for (let i = 0; i < d.vAngles.length; i++) close(back.cd[0][i] + 1e-12, d.cd[0][i] + 1e-12, 1e-5, `cd[${i}]`);
  close(L.lumens(back), L.lumens(d), 1e-5, "lumens");
});

test("2024 contract file Example_01.ies integrates to 381 lm", () => {
  const f = process.env.LBV_EXAMPLE_IES || "";
  if (!f || !fs.existsSync(f)) return console.log("    (skipped: set LBV_EXAMPLE_IES to enable)");
  const d = L.parseIES(fs.readFileSync(f, "utf8"));
  close(L.lumens(d), 381, 0.005, "Example_01");
});

test("quadrant-symmetric tables fold azimuths correctly", () => {
  const d = { name: "q", vAngles: [0, 90], hAngles: [0, 90], cd: [[10, 10], [20, 20]] };
  assert.equal(L.intensity(d, 0, 0), 10);
  assert.equal(L.intensity(d, 0, 90), 20);
  assert.equal(L.intensity(d, 0, 180), 10);
  assert.equal(L.intensity(d, 0, 270), 20);
  assert.equal(L.intensity(d, 0, 45), 15);
});

test("offset plane ranges (90..270) fold and integrate by span, not last angle", () => {
  // Regression: weights were normalized by hAngles[-1], losing 1/3 of lumens.
  const row = [10, 20, 10];
  const d = { name: "b", vAngles: [0, 45, 90], hAngles: [90, 180, 270], cd: [row, row, row] };
  // mirror symmetry: φ=0 must equal φ=180, and lumens must match a 0..180 file
  close(L.intensity(d, 45, 0), L.intensity(d, 45, 180), 1e-9, "fold 0->180");
  close(L.intensity(d, 45, 315), L.intensity(d, 45, 225), 1e-9, "fold 315->225");
  const ref = { name: "r", vAngles: [0, 45, 90], hAngles: [0, 90, 180], cd: [row, row, row] };
  close(L.lumens(d), L.lumens(ref), 1e-9, "span lumens");
  const uni = { name: "u", vAngles: [0, 45, 90], hAngles: [90, 180, 270], cd: [[100, 100, 100], [100, 100, 100], [100, 100, 100]] };
  close(L.lumens(uni), 200 * Math.PI, 1e-9, "uniform 100 cd hemisphere");
});

test("every bundled site/ies file parses and integrates sanely", () => {
  const dir = path.join(__dirname, "..", "site", "ies");
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".ies"))) {
    const d = L.parseIES(fs.readFileSync(path.join(dir, f), "utf8"));
    assert.ok(L.lumens(d) > 0, `${f}: lumens`);
    assert.ok(L.peak(d) > 0, `${f}: peak`);
    close(L.intensity(d, 0, 0), d.cd[0][0], 1e-9, `${f}: I(0,0)`);
  }
});

test("wall grid on a measured file still gives I0 / d² on axis", () => {
  const f = path.join(__dirname, "..", "site", "ies", "bega_50975_6k3_downlight.ies");
  const d = L.parseIES(fs.readFileSync(f, "utf8"));
  const g = L.wallGrid(d, 2, 1, 21);
  close(g.E[10][10], L.intensity(d, 0, 0) / 4, 1e-3, "center lux");
});

console.log(`\n${passed} passed`);
