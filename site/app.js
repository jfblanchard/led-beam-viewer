/* LED Beam Viewer UI. All math lives in lbv-core.js (window.LBV). */
(function () {
  "use strict";
  const L = window.LBV;
  const $ = (id) => document.getElementById(id);

  const state = {
    units: "metric",
    source: "lambertian",
    params: {},
    scaleBy: "lumens",
    scaleValue: 200,
    distanceSlider: 500,
    zoom: 100,
  };

  // Measured distributions imported from IES files: key "ies:<n>" -> parsed dist.
  const measured = new Map();
  let measuredSeq = 0;
  const isMeasured = () => measured.has(state.source);
  // Bundled file shown on first load (no hash override); measured lab data is the
  // more interesting default than a synthetic Lambertian.
  const DEFAULT_IES = "ael_atbl_led_area.ies";

  function addMeasured(dist, fileName) {
    const kw = dist.keywords || {};
    const maker = (kw.MANUFAC || "").replace(/\s*AG$|Inc\.?|LLC/g, "").trim();
    const part = kw.LAMPCAT
      || (dist.name && dist.name !== "IES file" ? dist.name : null)
      || fileName.replace(/\.ies$/i, "").replace(/_?rayfile_?/i, "").replace(/_?\d{8}/g, "").replace(/_ies$/i, "");
    let label = [maker, part].filter(Boolean).join(" ") || fileName;
    if (label.length > 64) label = label.slice(0, 61) + "…";
    const key = `ies:${measuredSeq++}`;
    dist.name = label;
    dist.fileName = fileName;
    measured.set(key, dist);
    const opt = new Option(label, key);
    opt.dataset.measured = "1";
    $("source").add(opt);
    return key;
  }

  // ── Units ──────────────────────────────────────────────────────────────────
  const imperial = () => state.units === "imperial";
  const lenU = () => (imperial() ? "ft" : "m");
  const illumU = () => (imperial() ? "fc" : "lux");
  const toLen = (m) => (imperial() ? m / L.M_PER_FT : m);
  const toIllum = (lux) => (imperial() ? lux / L.LUX_PER_FC : lux);
  const num = (v, digits = 3) => {
    if (!isFinite(v)) return "n/a";
    if (v === 0) return "0";
    const a = Math.abs(v);
    if (a >= 1000) return Math.round(v).toLocaleString();
    return Number(v.toPrecision(digits)).toString();
  };

  // Distance slider 0..1000 maps logarithmically onto 0.2 m .. 30 m.
  const D_MIN = 0.2, D_MAX = 30;
  const sliderToDist = (s) => D_MIN * Math.pow(D_MAX / D_MIN, s / 1000);

  // ── Controls ───────────────────────────────────────────────────────────────
  function buildSourceSelect() {
    const sel = $("source");
    for (const [key, s] of Object.entries(L.SOURCES)) sel.add(new Option(s.label, key));
    sel.value = state.source;
    sel.addEventListener("change", () => {
      state.source = sel.value;
      if (!isMeasured() && state.scaleBy === "measured") state.scaleBy = "lumens";
      syncControls(null);
      buildParams();
      render();
    });
  }

  const HINTS = {
    lambertian: "A bare LED: brightness falls off as cos θ from the axis.",
    spot: "A narrow beam, cosⁿ θ. Larger n means a tighter beam; n = 20 gives about 30°.",
    batwing: "Brightest off-axis, typical of wide-spread fixtures.",
  };

  function measuredHint(dist) {
    const kw = dist.keywords || {};
    const bits = [kw.MANUFAC, kw.LUMINAIRE].filter(Boolean);
    if (dist.watts) bits.push(`${num(dist.watts, 4)} W`);
    bits.push("measured IES file");
    return bits.join(" — ");
  }

  function buildParams() {
    const box = $("params");
    box.innerHTML = "";
    if (isMeasured()) {
      $("source-hint").textContent = measuredHint(measured.get(state.source));
      return;
    }
    const src = L.SOURCES[state.source];
    for (const p of src.params) {
      if (state.params[p.key] == null) state.params[p.key] = p.value;
      const lab = document.createElement("label");
      lab.className = "field";
      lab.innerHTML = `${p.label} <span class="val"></span><input type="range" min="${p.min}" max="${p.max}" step="${p.step}">`;
      const input = lab.querySelector("input"), val = lab.querySelector(".val");
      input.value = state.params[p.key];
      val.textContent = state.params[p.key];
      input.addEventListener("input", () => { state.params[p.key] = +input.value; val.textContent = input.value; render(); });
      box.appendChild(lab);
    }
    $("source-hint").textContent = HINTS[state.source] || "";
  }

  function segmented(attr, key, after) {
    document.querySelectorAll(`[data-${attr}]`).forEach((b) => {
      b.addEventListener("click", () => {
        document.querySelectorAll(`[data-${attr}]`).forEach((x) => x.classList.toggle("on", x === b));
        state[key] = b.dataset[attr];
        if (after) after();
        render();
      });
    });
  }

  function buildControls() {
    buildSourceSelect();
    buildParams();
    segmented("units", "units");
    segmented("scale", "scaleBy", () => {
      $("scale-label").textContent = { lumens: "Total lumens", peakCd: "Peak intensity (cd)", measured: "Absolute photometry" }[state.scaleBy];
      $("scale-value").disabled = state.scaleBy === "measured";
    });
    const sv = $("scale-value");
    sv.addEventListener("input", () => { const v = +sv.value; if (v > 0) { state.scaleValue = v; render(); } });
    const iesFile = $("ies-file");
    $("ies-open").addEventListener("click", () => iesFile.click());
    iesFile.addEventListener("change", () => {
      let last = null;
      for (const f of iesFile.files) {
        const rd = new FileReader();
        rd.onload = () => {
          try { last = addMeasured(L.parseIES(rd.result), f.name); }
          catch (e) { $("source-hint").textContent = `${f.name}: ${e.message}`; return; }
          state.source = last; state.scaleBy = "measured";
          syncControls(null); $("source").value = last; buildParams(); render();
        };
        rd.readAsText(f);
      }
      iesFile.value = "";
    });
    const dist = $("distance");
    dist.value = state.distanceSlider = Math.round((1000 * Math.log(3 / D_MIN)) / Math.log(D_MAX / D_MIN));
    dist.addEventListener("input", () => { state.distanceSlider = +dist.value; render(); });
    const zoom = $("zoom");
    zoom.addEventListener("input", () => { state.zoom = +zoom.value; render(); });
    $("dl-ies").addEventListener("click", () => download(L.toIES(current.dist), `${fileStem()}.ies`, "text/plain"));
    $("dl-cd").addEventListener("click", () => download(L.candelaCSV(current.dist), `${fileStem()}_candela.csv`, "text/csv"));
    $("dl-wall").addEventListener("click", () => download(L.wallCSV(current.grid, state.units), `${fileStem()}_wall_${num(toLen(current.d))}${lenU()}.csv`, "text/csv"));
    $("dl-png").addEventListener("click", exportPNG);
  }

  // ── Canvas helpers ─────────────────────────────────────────────────────────
  function prep(canvas) {
    const dpr = window.devicePixelRatio || 1;
    if (!canvas.dataset.w) { canvas.dataset.w = canvas.width; canvas.dataset.h = canvas.height; }
    const w = +canvas.dataset.w, h = +canvas.dataset.h;
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = w + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = css("--canvas"); ctx.fillRect(0, 0, w, h);
    ctx.font = "11px system-ui, sans-serif";
    return { ctx, w, h };
  }
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
    return 10 * p;
  }

  // ── Polar plot (lighting convention: 0° straight down, 90° to the sides) ──
  function drawPolar(dist) {
    const { ctx, w, h } = prep($("polar"));
    const cx = w / 2, cy = h / 2 - 6, R = Math.min(w, h) / 2 - 34;
    const pk = L.peak(dist);
    const top = niceMax(pk);
    const pt = (theta, I, side) => {
      const r = (I / top) * R, t = theta * L.DEG;
      return [cx + side * r * Math.sin(t), cy + r * Math.cos(t)];
    };

    ctx.strokeStyle = css("--line"); ctx.fillStyle = css("--faint"); ctx.lineWidth = 1;
    for (const f of [0.25, 0.5, 0.75, 1]) {
      ctx.beginPath(); ctx.arc(cx, cy, f * R, 0, 2 * Math.PI); ctx.stroke();
      ctx.textAlign = "left";
      ctx.fillText(`${num(f * top)} cd`, cx + 4, cy - f * R + 12);
    }
    for (let a = 0; a < 360; a += 30) {
      const t = a * L.DEG;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + R * Math.sin(t), cy + R * Math.cos(t)); ctx.stroke();
      const shown = a <= 180 ? a : 360 - a;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(`${shown}°`, cx + (R + 16) * Math.sin(t), cy + (R + 14) * Math.cos(t));
    }
    ctx.textBaseline = "alphabetic";

    const curve = (phi, color, dash) => {
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash(dash);
      ctx.beginPath();
      for (let t = 0; t <= 180; t += 0.5) { const [x, y] = pt(t, L.intensity(dist, t, phi), 1); t === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
      for (let t = 180; t >= 0; t -= 0.5) { const [x, y] = pt(t, L.intensity(dist, t, phi + 180), -1); ctx.lineTo(x, y); }
      ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
    };
    curve(0, css("--accent"), []);
    curve(90, css("--plane2"), [6, 4]);

  }

  // ── Wall heat map ─────────────────────────────────────────────────────────
  const INFERNO = [[0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99], [212, 72, 66], [245, 125, 21], [250, 193, 39], [252, 255, 164]];
  function cmap(t) {
    t = Math.min(1, Math.max(0, t)) * (INFERNO.length - 1);
    const i = Math.min(INFERNO.length - 2, Math.floor(t)), f = t - i;
    return INFERNO[i].map((c, k) => Math.round(c + f * (INFERNO[i + 1][k] - c)));
  }

  function drawWall(grid) {
    const { ctx, w, h } = prep($("wall"));
    const pad = { l: 44, r: 80, t: 8, b: 30 };
    const size = Math.min(w - pad.l - pad.r, h - pad.t - pad.b);
    const n = grid.xs.length;
    const img = ctx.createImageData(n, n);
    for (let iy = 0; iy < n; iy++) for (let ix = 0; ix < n; ix++) {
      const [r, g, b] = cmap(grid.E[n - 1 - iy][ix] / grid.max);
      const o = 4 * (iy * n + ix);
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
    const off = document.createElement("canvas");
    off.width = n; off.height = n;
    off.getContext("2d").putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, pad.l, pad.t, size, size);

    // axes
    ctx.fillStyle = css("--dim"); ctx.strokeStyle = css("--line");
    const half = toLen(grid.xs[n - 1]);
    ctx.textAlign = "center";
    for (const f of [-1, -0.5, 0, 0.5, 1]) {
      const x = pad.l + ((f + 1) / 2) * size;
      ctx.fillText(num(f * half, 2), x, pad.t + size + 14);
      const y = pad.t + ((1 - f) / 2) * size;
      if (f > -1) { ctx.textAlign = "right"; ctx.fillText(num(f * half, 2), pad.l - 5, y + 4); ctx.textAlign = "center"; }
    }
    ctx.fillText(`wall position (${lenU()})`, pad.l + size / 2, pad.t + size + 27);

    // colour bar
    const bx = pad.l + size + 14, bw = 12;
    for (let i = 0; i < size; i++) {
      const [r, g, b] = cmap(1 - i / size);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(bx, pad.t + i, bw, 1);
    }
    ctx.fillStyle = css("--dim"); ctx.textAlign = "left";
    const top = toIllum(grid.max);
    for (const f of [1, 0.75, 0.5, 0.25, 0]) ctx.fillText(num(f * top), bx + bw + 4, pad.t + (1 - f) * size + 4);
    ctx.save(); ctx.translate(w - 4, pad.t + size / 2); ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center"; ctx.fillText(illumU(), 0, 0); ctx.restore();
  }

  function drawSection(grid) {
    const { ctx, w, h } = prep($("section"));
    const pad = { l: 44, r: 80, t: 10, b: 26 };
    const pw = Math.min(w - pad.l - pad.r, $("wall").dataset.h - 38), ph = h - pad.t - pad.b;
    const n = grid.xs.length, mid = (n - 1) / 2;
    const top = niceMax(toIllum(grid.max));
    ctx.strokeStyle = css("--line");
    ctx.strokeRect(pad.l, pad.t, pw, ph);
    ctx.fillStyle = css("--dim"); ctx.textAlign = "right";
    ctx.fillText(num(top), pad.l - 5, pad.t + 8);
    ctx.fillText("0", pad.l - 5, pad.t + ph);
    ctx.textAlign = "center";
    ctx.fillText(`cross-sections through the center (${illumU()} vs ${lenU()})`, pad.l + pw / 2, h - 6);
    const line = (get, color, dash) => {
      ctx.strokeStyle = color; ctx.lineWidth = 1.8; ctx.setLineDash(dash); ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = pad.l + (i / (n - 1)) * pw, y = pad.t + ph * (1 - toIllum(get(i)) / top);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke(); ctx.setLineDash([]);
    };
    line((i) => grid.E[mid][i], css("--accent"), []);
    line((i) => grid.E[i][mid], css("--plane2"), [6, 4]);
  }

  // ── Results panel ─────────────────────────────────────────────────────────
  function drawNumbers(dist, d, grid) {
    const beamH = L.spreadAngle(dist, 0.5, 0), beamV = L.spreadAngle(dist, 0.5, 90);
    const fieldH = L.spreadAngle(dist, 0.1, 0), fieldV = L.spreadAngle(dist, 0.1, 90);
    const sym = Math.abs(beamH - beamV) < 0.05;
    const spot = 2 * d * Math.tan(Math.min(beamH, 179) / 2 * L.DEG);
    const rows = [
      ["Total lumens", `${num(L.lumens(dist), 4)} lm`],
      ["Peak intensity", `${num(L.peak(dist), 4)} cd`],
      ["On-axis intensity", `${num(L.intensity(dist, 0, 0), 4)} cd`],
      [sym ? "Beam angle (50%)" : "Beam angle H / V", sym ? `${num(beamH)}°` : `${num(beamH)}° / ${num(beamV)}°`],
      [sym ? "Field angle (10%)" : "Field angle H / V", sym ? `${num(fieldH)}°` : `${num(fieldH)}° / ${num(fieldV)}°`],
      ["Wall distance", `${num(toLen(d))} ${lenU()}`],
      ["Center illuminance", `${num(toIllum(L.intensity(dist, 0, 0) / (d * d)))} ${illumU()}`],
      ["Peak illuminance", `${num(toIllum(grid.max))} ${illumU()}`],
      ["Beam spot diameter", beamH < 170 ? `${num(toLen(spot))} ${lenU()}` : "beam too wide"],
    ];
    $("numbers").innerHTML = rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("");
  }

  // ── Render ────────────────────────────────────────────────────────────────
  let current = {};
  let pending = false;
  function render() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; draw(); });
  }

  // Rescale a measured distribution to a lumen or peak-candela target.
  function scaled(dist) {
    if (state.scaleBy === "measured" || !isMeasured()) return dist;
    const target = state.scaleBy === "lumens" ? state.scaleValue / L.lumens(dist) : state.scaleValue / L.peak(dist);
    return { ...dist, cd: dist.cd.map((r) => r.map((v) => v * target)) };
  }

  function draw() {
    const scale = state.scaleBy === "lumens" ? { lumens: state.scaleValue } : { peakCd: state.scaleValue };
    const dist = isMeasured() ? scaled(measured.get(state.source)) : L.generate(state.source, state.params, scale);
    const d = sliderToDist(state.distanceSlider);
    const field = Math.max(L.spreadAngle(dist, 0.1, 0), L.spreadAngle(dist, 0.1, 90));
    const halfAngle = Math.min(Math.max(field / 2 * 1.15, 10), 75);
    const halfWidth = d * Math.tan(halfAngle * L.DEG) * (state.zoom / 100);
    const grid = L.wallGrid(dist, d, halfWidth, 161);
    current = { dist, d, grid };
    if (b3 && !$("balloon").hidden) rebuild3D();

    $("dist-val").textContent = `${num(toLen(d))} ${lenU()}`;
    $("zoom-val").textContent = `${num(toLen(2 * halfWidth))} ${lenU()}`;
    $("wall-caption").textContent = `${num(toLen(d))} ${lenU()} away, ${num(toLen(2 * halfWidth))} ${lenU()} wide`;
    drawPolar(dist);
    drawWall(grid);
    drawSection(grid);
    drawNumbers(dist, d, grid);
  }

  // ── Downloads ─────────────────────────────────────────────────────────────
  function fileStem() {
    const p = Object.entries(current.dist.params || {}).map(([k, v]) => `${k}${v}`).join("_");
    const src = isMeasured() ? current.dist.name : state.source;
    return ["lbv", src.replace(/[^a-z0-9._-]+/gi, "_"), p, `${Math.round(L.lumens(current.dist))}lm`].filter(Boolean).join("_");
  }

  function download(text, name, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportPNG() {
    const polar = $("polar"), wall = $("wall"), sec = $("section");
    const out = document.createElement("canvas");
    out.width = polar.width + wall.width;
    out.height = Math.max(polar.height, wall.height + sec.height);
    const ctx = out.getContext("2d");
    ctx.fillStyle = css("--canvas"); ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(polar, 0, 0);
    ctx.drawImage(wall, polar.width, 0);
    ctx.drawImage(sec, polar.width, wall.height);
    out.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), { href: url, download: `${fileStem()}.png` });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }

  // ── 3D intensity balloon (three.js, loaded lazily over http) ──────────────
  let b3 = null;

  async function ensure3D() {
    if (b3) return true;
    try {
      const [T, { OrbitControls }] = await Promise.all([
        import("three"), import("./vendor/three/OrbitControls.js"),
      ]);
      const renderer = new T.WebGLRenderer({ antialias: true });
      renderer.setSize(460, 460);
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      $("balloon").appendChild(renderer.domElement);
      const scene = new T.Scene();
      scene.background = new T.Color(getComputedStyle(document.body).getPropertyValue("--bg").trim() || "#0d1117");
      const camera = new T.PerspectiveCamera(35, 1, 0.01, 20);
      camera.position.set(0, -0.55, 1.75);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.9;
      controls.addEventListener("start", () => (controls.autoRotate = false));
      // beam axis guide: short tail behind the emitter, long line toward the wall
      scene.add(new T.Line(
        new T.BufferGeometry().setFromPoints([new T.Vector3(0, 0, 0.15), new T.Vector3(0, 0, -1.3)]),
        new T.LineBasicMaterial({ color: 0x335577 })));
      const axes = new T.AxesHelper(1.35);
      axes.material.transparent = true;
      axes.material.opacity = 0.5;
      scene.add(axes);
      b3 = { T, renderer, scene, camera, controls, mesh: null, wire: null, raf: 0 };
      rebuild3D();
      return true;
    } catch (e) {
      console.warn("3D view unavailable (needs http + WebGL):", e.message);
      return false;
    }
  }

  // Surface r(θ,φ) = I(θ,φ)/peak sampled on a regular grid; vertex colours use
  // the same inferno map as the wall heat map. Beam axis points −Z.
  function rebuild3D() {
    if (!b3 || !current) return;
    const { T, scene } = b3, dist = current.dist;
    const NT = 46, NP = 72, pk = L.peak(dist) || 1;
    const pos = new Float32Array(NT * NP * 3), col = new Float32Array(NT * NP * 3);
    let k = 0;
    for (let i = 0; i < NT; i++) {
      const th = (i / (NT - 1)) * 90, st = Math.sin(th * L.DEG), ct = Math.cos(th * L.DEG);
      for (let j = 0; j < NP; j++) {
        const ph = (j / NP) * 360;
        const v = L.intensity(dist, th, ph) / pk;
        pos[k] = v * st * Math.cos(ph * L.DEG);
        pos[k + 1] = v * st * Math.sin(ph * L.DEG);
        pos[k + 2] = -v * ct;
        const [r, g, bl] = cmap(v);
        col[k] = r / 255; col[k + 1] = g / 255; col[k + 2] = bl / 255;
        k += 3;
      }
    }
    const idx = [];
    for (let i = 0; i < NT - 1; i++) for (let j = 0; j < NP; j++) {
      const a = i * NP + j, b = i * NP + ((j + 1) % NP), c = (i + 1) * NP + j, d = (i + 1) * NP + ((j + 1) % NP);
      idx.push(a, c, b, b, c, d);
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.BufferAttribute(pos, 3));
    geo.setAttribute("color", new T.BufferAttribute(col, 3));
    geo.setIndex(idx);
    if (b3.mesh) { scene.remove(b3.mesh); b3.mesh.geometry.dispose(); }
    if (b3.wire) { scene.remove(b3.wire); b3.wire.geometry.dispose(); }
    b3.mesh = new T.Mesh(geo, new T.MeshBasicMaterial({
      vertexColors: true, side: T.DoubleSide, transparent: true, opacity: 0.82,
    }));
    b3.wire = new T.LineSegments(new T.WireframeGeometry(geo),
      new T.LineBasicMaterial({ color: 0x9fc4ff, transparent: true, opacity: 0.12 }));
    scene.add(b3.mesh, b3.wire);
  }

  function loop3D() {
    if (!b3 || $("balloon").hidden) { if (b3) b3.raf = 0; return; }
    b3.raf = requestAnimationFrame(loop3D);
    b3.controls.update();
    b3.renderer.render(b3.scene, b3.camera);
  }

  async function setIView(v) {
    const three = v === "3d";
    if (three && !(await ensure3D())) v = "2d"; // no WebGL/module support: stay on 2D
    document.querySelectorAll("[data-iview]").forEach((x) => x.classList.toggle("on", x.dataset.iview === v));
    $("polar").hidden = v === "3d";
    $("balloon").hidden = v !== "3d";
    if (v === "3d" && b3 && !b3.raf) loop3D();
  }

  // Settings from the URL hash, e.g. #source=batwing&k=3&units=imperial&dist=5&cd=200
  function readHash() {
    const h = new URLSearchParams(location.hash.slice(1));
    if (L.SOURCES[h.get("source")]) { state.source = h.get("source"); state.hashSource = true; }
    for (const p of L.SOURCES[state.source].params) if (h.has(p.key)) state.params[p.key] = +h.get(p.key);
    if (h.get("units") === "imperial") state.units = "imperial";
    if (h.has("lumens")) { state.scaleBy = "lumens"; state.scaleValue = +h.get("lumens"); state.scaleSet = true; }
    if (h.has("cd")) { state.scaleBy = "peakCd"; state.scaleValue = +h.get("cd"); state.scaleSet = true; }
    if (h.has("ies")) state.wantIes = h.get("ies");
    if (h.get("view") === "3d") state.wantIView = true;
    return h.has("dist") ? +h.get("dist") : null; // metres
  }
  function syncControls(distM) {
    for (const [attr, key] of [["units", "units"], ["scale", "scaleBy"]])
      document.querySelectorAll(`[data-${attr}]`).forEach((b) => b.classList.toggle("on", b.dataset[attr] === state[key]));
    const labels = { lumens: "Total lumens", peakCd: "Peak intensity (cd)", measured: "Absolute photometry" };
    $("scale-label").textContent = labels[state.scaleBy];
    $("scale-value").disabled = state.scaleBy === "measured";
    $("scale-value").value = state.scaleValue;
    if (distM) $("distance").value = state.distanceSlider = Math.round((1000 * Math.log(distM / D_MIN)) / Math.log(D_MAX / D_MIN));
  }

  // Bundled library: manifest.json under ies/ (redistributable) and
  // ies/vendor/ (local-only downloads). Fetch failures are ignored.
  async function loadLibrary() {
    // Clean files are bundled under ies/; vendor downloads (local-only) live
    // under ies/vendor/. See site/ies/LICENSES.md.
    for (const dir of ["ies", "ies/vendor"]) {
      try {
        const names = await (await fetch(dir + "/manifest.json")).json();
        for (const name of names) {
          try { addMeasured(L.parseIES(await (await fetch(`${dir}/${name}`)).text()), name); }
          catch (e) { console.warn(`${dir}/${name}: ${e.message}`); }
        }
      } catch { /* no library at this path */ }
    }
    function selectMeasured(key) {
      state.source = key;
      if (!state.scaleSet) state.scaleBy = "measured";
      $("source").value = key;
      syncControls(null);
      buildParams();
      render();
    }
    // Deep link: #ies=<fileName> selects a library file once loaded.
    if (state.wantIes) {
      const hit = [...measured].find(([, d]) => d.fileName === state.wantIes);
      if (hit) selectMeasured(hit[0]);
    } else if (!state.hashSource) {
      // No explicit source: default to the bundled measured file.
      const hit = [...measured].find(([, d]) => d.fileName === DEFAULT_IES);
      if (hit) selectMeasured(hit[0]);
    }
  }

  const hashDist = readHash();
  buildControls();
  syncControls(hashDist);
  draw();
  document.querySelectorAll("[data-iview]").forEach((b) => b.addEventListener("click", () => setIView(b.dataset.iview)));
  if (state.wantIView) setIView("3d");
  loadLibrary();
})();
