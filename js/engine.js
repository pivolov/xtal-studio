/*! ============================================================
    Xtal Studio v4.9.0 — движок: ASCII / DOTS / MOSH / TRACK
    MOSH: JPEG-датабендинг + мягкий фокус.
    TRACK: computer-vision оверлей (детект углов + KLT-трекинг).
    ============================================================ */
(function (global) {
  "use strict";
  if (global.FXStudio) return;

  var VERSION = "4.9.0";

  var FX_FILTER = (function () {
    try { return "filter" in document.createElement("canvas").getContext("2d"); }
    catch (e) { return false; }
  })();

  var EFFECTS = [
    { id: "ascii", label: "ASCII" },
    { id: "dots",  label: "DOTS"  },
    { id: "mosh",  label: "MOSH"  },
    { id: "track", label: "TRACK" }
  ];
  var DOT_SHAPES = [
    { id: "circle", label: "Круг"    },
    { id: "square", label: "Квадрат" }
  ];
  var CHARSETS = {
    detailed: " .':;!ivxcLfo%#W@",
    standard: " .:-=+*#%@",
    blocks:   " ░▒▓█",
    binary:   " 01",
    numeric:  " 0123456789",
    minimal:  " .-*#"
  };
  var CHARSET_LABELS = [
    { id: "detailed", label: "Detailed" },
    { id: "standard", label: "Standard" },
    { id: "blocks",   label: "Blocks"   },
    { id: "binary",   label: "Binary"   },
    { id: "numeric",  label: "Numeric"  },
    { id: "minimal",  label: "Minimal"  }
  ];

  var DEFAULTS = {
    effect: "ascii",
    cols: 120, charset: "detailed", colorMode: "mono", fg: "#ffffff",
    brightness: 0, contrast: 100, gamma: 1, invert: false, glow: 40, charScale: 1,
    dotScale: 1, dotShape: "circle",
    moshLevel: 25, moshScale: 16, moshBleed: 50, moshMelt: 30,
    moshFocusX: 50, moshFocusY: 50, moshFocusRadius: 100,
    trackCount: 26, trackLines: 60, trackLabels: 60, trackDim: 85,
    bg: "#0b0e11", transparentBg: false
  };

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function hexToRgb(hex) {
    var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || "").trim());
    if (!m) return [16, 18, 22];
    var h = m[1];
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    var n = parseInt(h, 16);
    return [(n>>16)&255, (n>>8)&255, n&255];
  }
  function lumOf(r, g, b) { return (0.2126*r + 0.7152*g + 0.0722*b) / 255; }
  function rgbStr(r, g, b) { return "rgb(" + (r|0) + "," + (g|0) + "," + (b|0) + ")"; }
  function escXml(s) {
    return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  /* ---------- JPEG-утилиты ---------- */
  function jrnd(n) { var s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); }
  function b64ToBytes(b64) {
    var bin = atob(b64);
    var u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  function bytesToB64(u) {
    var s = "";
    for (var i = 0; i < u.length; i += 0x8000)
      s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  }

  /* Нелинейный датабендинг: внизу — деликатный спекл, вверху — тяжёлый mosh */
  function corruptJPEG(u8, seed, dataAmt, quantAmt) {
    var i = 2;
    while (i < u8.length - 4) {
      if (u8[i] !== 0xFF) { i++; continue; }
      var mk = u8[i + 1];

      if (mk === 0xDB) {
        var len = (u8[i + 2] << 8) | u8[i + 3];
        var n = Math.floor(quantAmt * quantAmt * len * 0.35);
        for (var k = 0; k < n; k++) {
          var p = i + 4 + Math.floor(jrnd(seed + k * 13) * (len - 2));
          if (p > i + 3 && p < i + 2 + len) {
            var dv = Math.floor((jrnd(seed + k * 7) - 0.2) * quantAmt * 90);
            u8[p] = Math.max(1, Math.min(255, u8[p] + dv));
          }
        }
        i += 2 + len;

      } else if (mk === 0xDA) {
        var sl = (u8[i + 2] << 8) | u8[i + 3];
        var start = i + 2 + sl, end = u8.length;
        for (var j = start; j < u8.length - 1; j++) {
          if (u8[j] === 0xFF && u8[j + 1] !== 0x00) { end = j; break; }
        }
        var span = Math.max(1, end - start);

        var nP = Math.floor(span * dataAmt * 0.015);
        for (k = 0; k < nP; k++) {
          var pp = start + Math.floor(jrnd(seed * 1.7 + k * 7) * span);
          u8[pp] = (u8[pp] + 1 + Math.floor(jrnd(seed + k) * 3)) & 0xFF;
          if (u8[pp] === 0xFF) u8[pp] = 0xFE;
        }
        var nZ = Math.floor(span * dataAmt * dataAmt * 0.05);
        for (k = 0; k < nZ; k++) {
          u8[start + Math.floor(jrnd(seed * 3 + k * 17) * span)] = 0x00;
        }
        var nS = Math.floor(Math.pow(dataAmt, 1.6) * 30);
        for (k = 0; k < nS; k++) {
          var a = start + Math.floor(jrnd(seed * 5 + k * 29) * span * 0.9);
          var b = start + Math.floor(jrnd(seed * 7 + k * 31) * span * 0.9);
          var cl = Math.floor(jrnd(seed * 11 + k * 37) * (4 + dataAmt * dataAmt * span * 0.02)) + 4;
          for (var q = 0; q < cl && a + q < end && b + q < end; q++) u8[a + q] = u8[b + q];
        }
        break;

      } else if (mk >= 0xC0 && mk !== 0xC4 && mk !== 0xC8) {
        var l2 = (u8[i + 2] << 8) | u8[i + 3];
        i += 2 + l2;
      } else {
        i += 2;
      }
    }
  }

  /* ---------- GIF-декодер ---------- */
  function lzwDecode(bytes, minCode, out) {
    var clear = 1 << minCode, eoi = clear + 1;
    var pfx = new Int32Array(4096), suf = new Int32Array(4096), stack = new Int32Array(4096);
    var codeSize = minCode + 1, next = eoi + 1;
    var acc = 0, bits = 0, bi = 0, oi = 0, prev = -1;
    function reset() { next = eoi + 1; codeSize = minCode + 1; }
    function readCode() {
      while (bits < codeSize) { if (bi >= bytes.length) return eoi; acc |= bytes[bi++] << bits; bits += 8; }
      var c = acc & ((1 << codeSize) - 1); acc >>>= codeSize; bits -= codeSize; return c;
    }
    reset(); readCode();
    while (oi < out.length) {
      var c = readCode();
      if (c === eoi) break;
      if (c === clear) { reset(); prev = -1; continue; }
      if (prev === -1) { out[oi++] = c; prev = c; continue; }
      var inTable = c < next, code = inTable ? c : prev, top = 0, cc = code;
      while (cc >= clear) { stack[top++] = suf[cc]; cc = pfx[cc]; }
      stack[top++] = cc; var first = cc;
      while (top > 0) out[oi++] = stack[--top];
      if (!inTable) out[oi++] = first;
      if (next < 4096) {
        pfx[next] = prev; suf[next] = first; next++;
        if (next > (1 << codeSize) - 1 && codeSize < 12) codeSize++;
      }
      prev = c;
    }
    return out;
  }
  function deinterlace(src, w, h) {
    var dst = new Uint8Array(w * h), passes = [[0,8],[4,8],[2,4],[1,2]], si = 0;
    for (var p = 0; p < 4; p++)
      for (var y = passes[p][0]; y < h; y += passes[p][1])
        for (var x = 0; x < w; x++)
          dst[y * w + x] = src[si++];
    return dst;
  }
  function parseGif(buf) {
    var u8 = new Uint8Array(buf), pos = 0;
    function u16() { var v = u8[pos] | (u8[pos + 1] << 8); pos += 2; return v; }
    function skipBlocks() { while (pos < u8.length) { var n = u8[pos++]; if (!n) break; pos += n; } }
    if (u8.length < 13 || u8[0] !== 0x47 || u8[1] !== 0x49 || u8[2] !== 0x46) return null;
    pos = 6; var W = u16(), H = u16(), packed = u8[pos++]; pos += 2; var gct = null;
    if (packed & 0x80) { var n = 1 << ((packed & 7) + 1); gct = u8.slice(pos, pos + n * 3); pos += n * 3; }
    var frames = [], gce = null;
    while (pos < u8.length) {
      var sig = u8[pos++];
      if (sig === 0x3B) break;
      if (sig === 0x21) {
        var lab = u8[pos++];
        if (lab === 0xF9 && u8[pos] === 4) {
          var p = u8[pos + 1];
          gce = { disposal: (p >> 2) & 7, transparent: (p & 1) ? u8[pos + 4] : -1,
                  delay: Math.max(20, (u8[pos + 2] | (u8[pos + 3] << 8)) * 10) };
        }
        skipBlocks();
      } else if (sig === 0x2C) {
        var x = u16(), y = u16(), w = u16(), h = u16(), ip = u8[pos++], pal = gct;
        if (ip & 0x80) { var m = 1 << ((ip & 7) + 1); pal = u8.slice(pos, pos + m * 3); pos += m * 3; }
        if (!pal) pal = new Uint8Array(768);
        var minCode = u8[pos++], chunks = [], total = 0;
        while (pos < u8.length) { var sz = u8[pos++]; if (!sz) break; chunks.push(u8.subarray(pos, pos + sz)); pos += sz; total += sz; }
        var data = new Uint8Array(total), o = 0;
        for (var ci = 0; ci < chunks.length; ci++) { data.set(chunks[ci], o); o += chunks[ci].length; }
        var idx = new Uint8Array(w * h); lzwDecode(data, minCode, idx);
        if (ip & 0x40) idx = deinterlace(idx, w, h);
        frames.push({ x: x, y: y, w: w, h: h, indices: idx, palette: pal,
                      delay: gce ? gce.delay : 80, disposal: gce ? gce.disposal : 0,
                      transparent: gce ? gce.transparent : -1 });
        gce = null;
      } else break;
    }
    if (!frames.length) return null;
    return { w: W, h: H, frames: frames };
  }

  /* ================= Engine ================= */
  function Engine(targetEl, opts) {
    var self = this;
    self.dead = false; self.opts = opts || {}; self.p = {};
    for (var k in DEFAULTS) self.p[k] = DEFAULTS[k];
    if (opts && typeof opts === "object") for (k in opts) self.p[k] = opts[k];

    self.host = typeof targetEl === "string" ? document.querySelector(targetEl) : targetEl;
    self.canvas = document.createElement("canvas");
    self.canvas.style.cssText = "display:block;width:100%;height:100%;cursor:grab;";
    self.host.appendChild(self.canvas);
    self.ctx = self.canvas.getContext("2d");
    self.dpr = Math.min(global.devicePixelRatio || 1, 2);

    self._srcType = "none"; self._srcReady = false;
    self._img = null; self._video = null; self._gif = null;
    self._srcW = 1; self._srcH = 1;
    self._mosh = null; self._track = null;

    self._sampler = document.createElement("canvas");
    self._samplerCtx = self._sampler.getContext("2d", { willReadFrequently: true });
    self._art = document.createElement("canvas"); self._artCtx = self._art.getContext("2d");
    self._layerC = document.createElement("canvas"); self._layerCtx = self._layerC.getContext("2d");

    self.view = { z: 1, x: 0, y: 0 }; self._drag = null;
    self.playing = true; self._raf = 0; self._time = 0; self._lastT = 0;
    self.info = { cols: 0, rows: 0, srcW: 0, srcH: 0, outW: 0, outH: 0 };
    self._asciiGrid = null;

    self._bindView(); self._fit();
    if (typeof ResizeObserver !== "undefined") {
      self._ro = new ResizeObserver(function () { if (!self.dead) { self._fit(); self._render(); } });
      self._ro.observe(self.host);
    }
    self._render();
  }
  var P = Engine.prototype;

  /* ---------- зум / панорама ---------- */
  P._bindView = function () {
    var self = this, cv = self.canvas;
    cv.addEventListener("wheel", function (e) {
      e.preventDefault(); if (!self._srcReady) return;
      var r = cv.getBoundingClientRect();
      var mx = (e.clientX - r.left) * self.dpr, my = (e.clientY - r.top) * self.dpr;
      var W = cv.width, H = cv.height;
      var z0 = self.view.z, z1 = clamp(z0 * Math.exp(-e.deltaY * 0.0012), 0.2, 8);
      var s0 = Math.min(W / self._srcW, H / self._srcH) * 0.92;
      var aw0 = self._srcW * s0 * z0, aw1 = self._srcW * s0 * z1;
      var ah0 = self._srcH * s0 * z0, ah1 = self._srcH * s0 * z1;
      var ax0 = (W - aw0) / 2 + self.view.x, ay0 = (H - ah0) / 2 + self.view.y;
      self.view.x = (mx - (mx - ax0) * (z1 / z0)) - (W - aw1) / 2;
      self.view.y = (my - (my - ay0) * (z1 / z0)) - (H - ah1) / 2;
      self.view.z = z1; self._render();
    }, { passive: false });
    cv.addEventListener("pointerdown", function (e) {
      self._drag = { x: e.clientX, y: e.clientY, vx: self.view.x, vy: self.view.y };
      if (cv.setPointerCapture) { try { cv.setPointerCapture(e.pointerId); } catch (err) {} }
      cv.style.cursor = "grabbing";
    });
    cv.addEventListener("pointermove", function (e) {
      if (!self._drag) return;
      self.view.x = self._drag.vx + (e.clientX - self._drag.x) * self.dpr;
      self.view.y = self._drag.vy + (e.clientY - self._drag.y) * self.dpr;
      self._render();
    });
    function end() { self._drag = null; cv.style.cursor = "grab"; }
    cv.addEventListener("pointerup", end);
    cv.addEventListener("pointercancel", end);
    cv.addEventListener("dblclick", function () { self.view.z = 1; self.view.x = 0; self.view.y = 0; self._render(); });
  };
  P._fit = function () {
    var w = this.host.clientWidth || 2, h = this.host.clientHeight || 2;
    this.canvas.width = Math.max(2, Math.round(w * this.dpr));
    this.canvas.height = Math.max(2, Math.round(h * this.dpr));
  };

  /* ---------- источники ---------- */
  P._clearSource = function () {
    if (this._video) { try { this._video.pause(); } catch (e) {} }
    this._img = null; this._video = null; this._gif = null;
    this._mosh = null; this._track = null;
    this._srcReady = false; this.info.srcW = 0; this.info.srcH = 0;
  };
  P.setSource = function (type, src) {
    var self = this;
    self._clearSource(); self._stopLoop();
    self._srcType = type; self._mosh = null; self._track = null;
    self.view.z = 1; self.view.x = 0; self.view.y = 0;

    if (type === "image") {
      var img = new Image(); img.crossOrigin = "anonymous";
      img.onload = function () {
        if (self.dead) return;
        self._img = img;
        self._srcW = img.naturalWidth || 1; self._srcH = img.naturalHeight || 1;
        self.info.srcW = self._srcW; self.info.srcH = self._srcH;
        self._srcReady = true; self._render(); self._startLoop();
      };
      img.onerror = function () { self._err("Не удалось загрузить изображение"); };
      img.src = src;

    } else if (type === "video") {
      var v = document.createElement("video");
      v.style.cssText = "position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;";
      v.muted = true; v.loop = true; v.playsInline = true;
      v.setAttribute("playsinline", ""); v.crossOrigin = "anonymous";
      v.addEventListener("canplay", function () {
        if (self.dead) return;
        self._srcW = v.videoWidth || 1; self._srcH = v.videoHeight || 1;
        self.info.srcW = self._srcW; self.info.srcH = self._srcH;
        self._srcReady = true; self._startLoop();
        var pr = v.play(); if (pr && pr.catch) pr.catch(function () {});
      }, { once: true });
      v.addEventListener("error", function () { self._err("Видео недоступно"); });
      v.src = src; (document.body || self.host).appendChild(v); self._video = v;
      var pr2 = v.play(); if (pr2 && pr2.catch) pr2.catch(function () {});

    } else if (type === "gif") {
      if (global.fetch) {
        fetch(src)
          .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.arrayBuffer(); })
          .then(function (buf) {
            if (self.dead) return;
            var g = parseGif(buf); if (!g) throw new Error("bad gif");
            g.canvas = document.createElement("canvas"); g.canvas.width = g.w; g.canvas.height = g.h;
            g.ctx = g.canvas.getContext("2d");
            g.temp = document.createElement("canvas"); g.tempCtx = g.temp.getContext("2d");
            g.idx = -1; g.nextAt = 0; g.snap = null;
            self._gif = g;
            self._srcW = g.w; self._srcH = g.h;
            self.info.srcW = g.w; self.info.srcH = g.h;
            self._gifAdvance(performance.now(), true);
            self._srcReady = true; self._render(); self._startLoop();
          })
          .catch(function (e) { self._err("GIF недоступен: " + (e && e.message || e)); });
      } else self._err("fetch недоступен");
    }
  };
  P._err = function (msg) {
    if (this.opts && typeof this.opts.onError === "function") {
      try { this.opts.onError(new Error(msg)); } catch (e) {}
    }
  };
  P._gifAdvance = function (now, force) {
    var g = this._gif; if (!g) return false;
    if (!force && now < g.nextAt) return false;
    g.idx = (g.idx + 1) % g.frames.length;
    var f = g.frames[g.idx], pi = g.idx - 1; if (pi < 0) pi = g.frames.length - 1;
    var pf = g.frames[pi];
    if (pf.disposal === 2) g.ctx.clearRect(pf.x, pf.y, pf.w, pf.h);
    else if (pf.disposal === 3 && g.snap) { g.ctx.putImageData(g.snap, 0, 0); g.snap = null; }
    if (f.disposal === 3) { try { g.snap = g.ctx.getImageData(0, 0, g.w, g.h); } catch (e) { g.snap = null; } }
    g.temp.width = f.w; g.temp.height = f.h;
    var id = g.tempCtx.createImageData(f.w, f.h), pal = f.palette, tr = f.transparent;
    for (var i = 0; i < f.indices.length; i++) {
      var ix = f.indices[i]; if (ix === tr) continue;
      id.data[i * 4] = pal[ix * 3]; id.data[i * 4 + 1] = pal[ix * 3 + 1];
      id.data[i * 4 + 2] = pal[ix * 3 + 2]; id.data[i * 4 + 3] = 255;
    }
    g.tempCtx.putImageData(id, 0, 0);
    g.ctx.drawImage(g.temp, f.x, f.y);
    g.nextAt = now + f.delay;
    return true;
  };
  P._sourceDrawable = function () {
    if (this._srcType === "image") return this._img;
    if (this._srcType === "video") return this._video;
    if (this._srcType === "gif") return this._gif ? this._gif.canvas : null;
    return null;
  };

  /* ---------- параметры / цикл ---------- */
  P.setParams = function (p) {
    if (!p || typeof p !== "object") return;
    for (var k in p) this.p[k] = p[k];
    if (this._mosh) this._mosh.dirty = true;
    this._render();
  };
  P.play = function () { this.playing = true; this._startLoop(); };
  P.pause = function () { this.playing = false; this._stopLoop(); this._render(); };
  P._needsAnim = function () {
    return this._srcType === "gif" || this._srcType === "video" ||
           this.p.effect === "mosh" || this.p.effect === "track";
  };
  P._startLoop = function () {
    var self = this;
    if (self._raf || !self.playing) return;
    if (!self._needsAnim()) return;
    self._lastT = performance.now();
    (function tick(now) {
      if (self.dead || !self.playing) { self._raf = 0; return; }
      self._raf = requestAnimationFrame(tick);
      self._lastT = now; self._time = now / 1000;
      if (self._srcType === "gif") self._gifAdvance(now, false);
      self._render();
    })(performance.now());
  };
  P._stopLoop = function () { if (this._raf) cancelAnimationFrame(this._raf); this._raf = 0; };

  /* ---------- цветокор ---------- */
  P._adjChannel = function (v) {
    var c = this.p.contrast / 100, b = this.p.brightness * 1.2;
    return clamp((v - 128) * c + 128 + b, 0, 255);
  };
  P._gammaNorm = function (n) { return Math.pow(clamp(n, 0, 1), 1 / clamp(this.p.gamma, 0.2, 3)); };
  P._sample = function (cols, rows) {
    var self = this, sc = self._samplerCtx;
    self._sampler.width = cols; self._sampler.height = rows;
    sc.imageSmoothingEnabled = true; sc.imageSmoothingQuality = "high";
    sc.clearRect(0, 0, cols, rows);
    var src = self._sourceDrawable();
    try { sc.drawImage(src, 0, 0, cols, rows); } catch (e) { return null; }
    try { return sc.getImageData(0, 0, cols, rows).data; } catch (e) { return null; }
  };
  P._cellColor = function (orig, ar, ag, ab) {
    if (orig) return rgbStr(ar, ag, ab);
    var fg = hexToRgb(this.p.fg);
    return rgbStr(fg[0], fg[1], fg[2]);
  };

  /* ---------- ASCII ---------- */
  P._renderAscii = function (ctx, W, H) {
    var self = this, src = self._sourceDrawable();
    if (!self._srcReady || !src) { self._asciiGrid = null; return; }
    var cols = clamp(Math.round(self.p.cols), 24, 220);
    var rows = Math.max(8, Math.round(cols * (self._srcH / self._srcW) * 0.5));
    var data = self._sample(cols, rows);
    if (!data) { self._asciiGrid = null; return; }
    var cellW = W / cols, cellH = H / rows;
    var cs = CHARSETS[self.p.charset] || CHARSETS.detailed;
    var orig = self.p.colorMode === "original";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "700 " + ((cellW / 0.6) * clamp(self.p.charScale, 0.5, 1.5)).toFixed(1) +
               "px ui-monospace, Menlo, Consolas, monospace";
    var grid = "";
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var o = (r * cols + c) * 4, a = data[o + 3] / 255;
        if (a <= 0.04) { grid += " "; continue; }
        var ar = self._adjChannel(data[o]), ag = self._adjChannel(data[o + 1]), ab = self._adjChannel(data[o + 2]);
        var lumN = self._gammaNorm(lumOf(ar, ag, ab) * a);
        var ink = clamp(self.p.invert ? lumN : 1 - lumN, 0, 1);
        var idx = clamp(Math.round(ink * (cs.length - 1)), 0, cs.length - 1);
        var ch = cs.charAt(idx);
        if (ch === " ") { grid += " "; continue; }
        ctx.fillStyle = self._cellColor(orig, ar, ag, ab);
        ctx.fillText(ch, c * cellW + cellW / 2, r * cellH + cellH / 2);
        grid += ch;
      }
      grid += "\n";
    }
    self._asciiGrid = grid;
    self.info.cols = cols; self.info.rows = rows;
  };

  /* ---------- DOTS ---------- */
  P._renderDots = function (ctx, W, H) {
    var self = this, src = self._sourceDrawable();
    if (!self._srcReady || !src) return;
    var cols = clamp(Math.round(self.p.cols), 24, 220);
    var rows = Math.max(8, Math.round(cols * (self._srcH / self._srcW)));
    var data = self._sample(cols, rows);
    if (!data) return;
    var cellW = W / cols, cellH = H / rows;
    var orig = self.p.colorMode === "original";
    var maxR = cellW * 0.5 * clamp(self.p.dotScale, 0.3, 1.5);
    var sq = self.p.dotShape === "square";
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var o = (r * cols + c) * 4, a = data[o + 3] / 255;
        if (a <= 0.04) continue;
        var ar = self._adjChannel(data[o]), ag = self._adjChannel(data[o + 1]), ab = self._adjChannel(data[o + 2]);
        var lumN = self._gammaNorm(lumOf(ar, ag, ab) * a);
        var ink = clamp(self.p.invert ? lumN : 1 - lumN, 0, 1);
        if (ink <= 0.02) continue;
        var rad = maxR * Math.sqrt(ink);
        var cx = c * cellW + cellW / 2, cy = r * cellH + cellH / 2;
        ctx.fillStyle = self._cellColor(orig, ar, ag, ab);
        if (sq) ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
        else { ctx.beginPath(); ctx.arc(cx, cy, rad, 0, 6.2832); ctx.fill(); }
      }
    }
    self.info.cols = cols; self.info.rows = rows;
  };

  /* ================= MOSH ================= */
  P._moshMelt = function (out, iw, ih, melt, seed) {
    if (melt <= 0) return;
    var nCols = Math.round(2 + melt * 14);
    for (var c = 0; c < nCols; c++) {
      var x0 = Math.floor(jrnd(seed + c * 3.7) * iw);
      var wdt = 1 + Math.floor(jrnd(seed + c * 3.7 + 1) * iw * 0.02);
      var amt = 1 + Math.floor(jrnd(seed + c * 3.7 + 2) * ih * 0.12 * melt);
      for (var x = x0; x < Math.min(iw, x0 + wdt); x++)
        for (var y = ih - 1; y >= amt; y--) {
          var a4 = (y * iw + x) * 4, b4 = ((y - amt) * iw + x) * 4;
          out[a4] = out[b4]; out[a4 + 1] = out[b4 + 1]; out[a4 + 2] = out[b4 + 2];
        }
    }
  };

  P._moshKick = function (now) {
    var self = this;
    var m = self._mosh || (self._mosh = { busy: false, last: 0, dirty: true, result: null, seed: 1 });
    if (m.busy) return;
    var animated = self._srcType !== "image";
    if (!m.dirty && !animated && m.result) return;
    if (!m.dirty && now - m.last < 140) return;
    m.dirty = false; m.last = now; m.busy = true;
    if (animated) m.seed = (m.seed + 1) >>> 0;

    var src = self._sourceDrawable();
    if (!src) { m.busy = false; return; }

    var scale = clamp(self.p.moshScale, 8, 32);
    var inten = clamp(self.p.moshLevel, 0, 100) / 100;
    var bleed = clamp(self.p.moshBleed, 0, 100) / 100;
    var melt  = clamp(self.p.moshMelt,  0, 100) / 100;
    var fx = clamp(self.p.moshFocusX, 0, 100) / 100;
    var fy = clamp(self.p.moshFocusY, 0, 100) / 100;
    var fr = clamp(self.p.moshFocusRadius, 0, 100) / 100;

    var baseW = Math.min(self._srcW, 520);
    var f = 1 - ((scale - 8) / 24) * 0.65;
    var iw = Math.max(96, Math.round(baseW * f));
    var ih = Math.max(96, Math.round(self._srcH * (iw / self._srcW)));

    var t = document.createElement("canvas");
    t.width = iw; t.height = ih;
    var tx = t.getContext("2d");
    try { tx.drawImage(src, 0, 0, iw, ih); } catch (e) { m.busy = false; return; }

    var url;
    try { url = t.toDataURL("image/jpeg", 0.7); } catch (e) { m.busy = false; return; }
    var u8 = b64ToBytes(url.split(",")[1]);
    corruptJPEG(u8, m.seed, inten, bleed);

    var img = new Image();
    img.onload = function () {
      if (!m.result || m.result.width !== iw || m.result.height !== ih) {
        m.result = document.createElement("canvas");
        m.result.width = iw; m.result.height = ih;
      }
      var rx = m.result.getContext("2d");

      var gc = document.createElement("canvas");
      gc.width = iw; gc.height = ih;
      var gx = gc.getContext("2d");
      gx.drawImage(img, 0, 0, iw, ih);
      if (melt > 0) {
        var id = gx.getImageData(0, 0, iw, ih);
        self._moshMelt(id.data, iw, ih, melt, m.seed % 97);
        gx.putImageData(id, 0, 0);
      }

      if (fr >= 0.99) {
        rx.drawImage(gc, 0, 0);
      } else if (fr > 0.01) {
        rx.drawImage(t, 0, 0);
        var R = fr * Math.min(iw, ih) * 0.5;
        var cx = fx * iw, cy = fy * ih;
        var mc = document.createElement("canvas");
        mc.width = iw; mc.height = ih;
        var mx2 = mc.getContext("2d");
        var grad = mx2.createRadialGradient(cx, cy, R * 0.4, cx, cy, Math.max(R, 1));
        grad.addColorStop(0, "rgba(0,0,0,1)");
        grad.addColorStop(1, "rgba(0,0,0,0)");
        mx2.fillStyle = grad;
        mx2.fillRect(0, 0, iw, ih);
        gx.globalCompositeOperation = "destination-in";
        gx.drawImage(mc, 0, 0);
        gx.globalCompositeOperation = "source-over";
        rx.drawImage(gc, 0, 0);
      } else {
        rx.drawImage(t, 0, 0);
      }
      m.busy = false;
    };
    img.onerror = function () { m.busy = false; m.dirty = true; };
    img.src = "data:image/jpeg;base64," + bytesToB64(u8);
  };

  P._renderMosh = function (ctx, W, H) {
    var self = this;
    self._moshKick(self._time * 1000);
    var m = self._mosh;
    if (m && m.result) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(m.result, 0, 0, m.result.width, m.result.height, 0, 0, W, H);
      ctx.imageSmoothingEnabled = true;
      self.info.cols = m.result.width; self.info.rows = m.result.height;
    } else {
      var src = self._sourceDrawable();
      if (src) ctx.drawImage(src, 0, 0, W, H);
    }
  };

  /* ================= TRACK ================= */
  P._trackEnergy = function (gray, lw, lh) {
    var e = new Float32Array(lw * lh);
    for (var y = 1; y < lh - 1; y++)
      for (var x = 1; x < lw - 1; x++) {
        var i = y * lw + x;
        e[i] = Math.abs(gray[i + 1] - gray[i - 1]) + Math.abs(gray[i + lw] - gray[i - lw]);
      }
    return e;
  };

  P._trackScore = function (gray, w, h) {
    var e = this._trackEnergy(gray, w, h);
    var s = new Float32Array(w * h);
    for (var i = 0; i < w * h; i++) {
      var l = gray[i] / 255;
      s[i] = e[i] + l * l * l * 300;
    }
    return s;
  };

  P._trackDetect = function (tr) {
    tr.trackers = [];
    tr.links = [];
    tr.nextId = 1;
    tr.spawnSeed = 1;
  };

  P._trackFlow = function (tr, gray, fw, fh) {
    var prev = tr.prevGray;
    if (!tr.trackers) this._trackDetect(tr);
    if (!prev) return; 

    var cell = 4, R = 4, HP = 2;
    var gw = Math.ceil(fw / cell), gh = Math.ceil(fh / cell);
    if (!tr.flowX || tr.flowX.length !== gw * gh) {
      tr.flowX = new Float32Array(gw * gh);
      tr.flowY = new Float32Array(gw * gh);
    }
    var fx = tr.flowX, fy = tr.flowY;
    for (var cy = 0; cy < gh; cy++) {
      for (var cx = 0; cx < gw; cx++) {
        var x0 = cx * cell + 2, y0 = cy * cell + 2;
        var gi = cy * gw + cx;
        if (x0 < HP+1 || y0 < HP+1 || x0 > fw-HP-2 || y0 > fh-HP-2) { fx[gi]=0; fy[gi]=0; continue; }
        var best = 1e9, bx = 0, by = 0;
        for (var dy = -R; dy <= R; dy++) {
          var yy = y0 + dy; if (yy < HP+1 || yy > fh-HP-2) continue;
          for (var dx = -R; dx <= R; dx++) {
            var xx = x0 + dx; if (xx < HP+1 || xx > fw-HP-2) continue;
            var s = 0;
            for (var py = -HP; py <= HP; py++) {
              var rn = (yy+py)*fw, ro = (y0+py)*fw;
              for (var px = -HP; px <= HP; px++) s += Math.abs(gray[rn+xx+px] - prev[ro+x0+px]);
            }
            if (s < best) { best = s; bx = dx; by = dy; }
          }
        }
        fx[gi] = bx; fy[gi] = by;
      }
    }

    var score = this._trackScore(gray, fw, fh);
    var frameMax = 1;
    for (var i = 0; i < score.length; i++) if (score[i] > frameMax) frameMax = score[i];

    var dt = 0.033, alive = [];
    for (i = 0; i < tr.trackers.length; i++) {
      var t = tr.trackers[i];
      var c2 = clamp(Math.floor(t.y/cell),0,gh-1)*gw + clamp(Math.floor(t.x/cell),0,gw-1);
      t.x = clamp(t.x + fx[c2], 1, fw-2);
      t.y = clamp(t.y + fy[c2], 1, fh-2);
      t.age += dt;
      var ain = Math.min(1, t.age/0.15), aout = Math.min(1, (t.life-t.age)/0.3);
      t.alpha = Math.max(0, Math.min(ain, aout));
      if (t.age < t.life) alive.push(t);
    }
    tr.trackers = alive;

    var links = [];
    for (i = 0; i < tr.links.length; i++) {
      var L = tr.links[i];
      if (alive.indexOf(L.a) >= 0 && alive.indexOf(L.b) >= 0) links.push(L);
    }
    tr.links = links;

    var target = Math.round(clamp(this.p.trackCount, 4, 80));
    var attempts = 0;
    while (tr.trackers.length < target && attempts < 50) {
      attempts++;
      var ri = Math.floor(jrnd(attempts*3.3 + tr.spawnSeed*7.7) * fw * fh);
      if (score[ri] < frameMax * 0.18) continue;
      var nx = ri % fw, ny = (ri / fw) | 0;
      var t2 = { x:nx, y:ny, sx:nx, sy:ny, age:0,
                 life: 0.6 + jrnd(ri + tr.spawnSeed) * 1.2,
                 size: 0.6 + jrnd(ri*1.7 + tr.spawnSeed) * 1.2,
                 id: tr.nextId++, alpha: 0 };
      if (tr.trackers.length > 0) {
        var other = tr.trackers[Math.floor(jrnd(t2.id*13.7) * tr.trackers.length)];
        tr.links.push({ a: t2, b: other });
        if (jrnd(t2.id*7.1) > 0.5) {
          var o2 = tr.trackers[Math.floor(jrnd(t2.id*3.1) * tr.trackers.length)];
          if (o2 !== other) tr.links.push({ a: t2, b: o2 });
        }
      }
      tr.trackers.push(t2);
    }
    tr.spawnSeed++;
  };

  function hexLabel(id) {
    var v = (((id + 1) * 2654435761) >>> 24) & 0xFF;
    var s = v.toString(16).toUpperCase();
    return s.length < 2 ? "0" + s : s;
  }

  P._renderTrack = function (ctx, W, H) {
    var self = this, src = self._sourceDrawable();
    if (!self._srcReady || !src) return;

    var fw = 72;
    var fh = Math.max(36, Math.round(72 * self._srcH / self._srcW));
    var tr = self._track || (self._track = {});
    var now = self._time * 1000;

    var data = self._sample(fw, fh);
    if (!data) return;
    var gray = new Float32Array(fw * fh);
    for (var i = 0; i < fw * fh; i++)
      gray[i] = 0.2126*data[i*4] + 0.7152*data[i*4+1] + 0.0722*data[i*4+2];

    if (tr.fw !== fw || tr.fh !== fh) {
      tr.trackers = [];
      tr.links = [];
      tr.prevGray = null;
      tr.fw = fw;
      tr.fh = fh;
    }
    if (now - (tr.last || 0) > 33) { self._trackFlow(tr, gray, fw, fh); tr.last = now; }
    tr.prevGray = gray;

    var dim = clamp(self.p.trackDim, 0, 100) / 100;
    ctx.globalAlpha = 1 - dim * 0.9;
    ctx.drawImage(src, 0, 0, W, H);
    ctx.globalAlpha = 1;

    var sx = W / fw, sy = H / fh;

    for (i = 0; i < tr.trackers.length; i++) {
      var q = tr.trackers[i];
      q.sx += (q.x - q.sx) * 0.5;
      q.sy += (q.y - q.sy) * 0.5;
    }

    // Линии-связи (свечение, индивидуальная прозрачность)
    var lineA = clamp(self.p.trackLines, 0, 100) / 100;
    var maxLinks = Math.round(tr.links.length * lineA);
    ctx.save();
    ctx.lineWidth = 1;
    ctx.shadowColor = "rgba(190,235,255,0.9)";
    ctx.shadowBlur = 5;
    for (i = 0; i < maxLinks; i++) {
      var L = tr.links[i];
      var la = Math.min(L.a.alpha, L.b.alpha);
      if (la < 0.05) continue;
      ctx.globalAlpha = la * 0.6;
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.beginPath();
      ctx.moveTo(L.a.sx*sx, L.a.sy*sy);
      ctx.lineTo(L.b.sx*sx, L.b.sy*sy);
      ctx.stroke();
    }
    ctx.restore();

    // Рамки + hex-подписи
    var base = Math.max(6, W * 0.012);
    var fs = Math.max(7, Math.round(W * 0.012));
    ctx.font = "300 " + fs + "px ui-monospace, Menlo, Consolas, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (i = 0; i < tr.trackers.length; i++) {
      var t = tr.trackers[i];
      if (t.alpha < 0.03) continue;
      var bw = base * t.size, bh = bw * 1.8;
      var px = t.sx*sx, py = t.sy*sy;
      ctx.save();
      ctx.globalAlpha = t.alpha;
      ctx.shadowColor = "rgba(120,220,255,0.9)";
      ctx.shadowBlur = 8;
      ctx.strokeStyle = "rgba(120,220,255,0.95)";
      ctx.lineWidth = 1;
      ctx.strokeRect(px-bw/2+0.5, py-bh/2+0.5, bw, bh);
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(225,245,255,0.9)";
      ctx.fillText("0x" + hexLabel(t.id), px+bw/2+3, py+bh/2+fs*0.6);
      ctx.restore();
    }

    self.info.cols = fw;
    self.info.rows = fh;
  };

  /* ---------- превью ---------- */
  P._drawChecker = function (ctx, x, y, w, h) {
    var s = Math.max(6, Math.round(8 * this.dpr));
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.fillStyle = "#ffffff"; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "#e2e2e6";
    for (var j = 0; j < Math.ceil(h / s); j++)
      for (var i = 0; i < Math.ceil(w / s); i++)
        if ((i + j) % 2) ctx.fillRect(x + i * s, y + j * s, s, s);
    ctx.restore();
  };
  P._render = function () {
    var self = this, ctx = self.ctx, W = self.canvas.width, H = self.canvas.height;
    ctx.clearRect(0, 0, W, H); ctx.fillStyle = "#262626"; ctx.fillRect(0, 0, W, H);
    var src = self._sourceDrawable();
    if (!self._srcReady || !src) { self.info.cols = 0; self.info.rows = 0; return; }
    var s = Math.min(W / self._srcW, H / self._srcH) * 0.92 * self.view.z;
    var aw = Math.max(8, Math.round(self._srcW * s)), ah = Math.max(8, Math.round(self._srcH * s));
    var ax = Math.round((W - aw) / 2 + self.view.x), ay = Math.round((H - ah) / 2 + self.view.y);
    if (self.p.transparentBg) self._drawChecker(ctx, ax, ay, aw, ah);
    var art = self._art;
    if (art.width !== aw || art.height !== ah) { art.width = aw; art.height = ah; }
    self._renderTo(self._artCtx, aw, ah);
    ctx.drawImage(art, ax, ay);
    ctx.strokeStyle = "rgba(255,255,255,0.18)"; ctx.lineWidth = 1;
    ctx.strokeRect(ax + 0.5, ay + 0.5, aw - 1, ah - 1);
  };
  P._renderTo = function (ctx, W, H) {
    var self = this;
    ctx.save(); ctx.clearRect(0, 0, W, H);
    if (!self.p.transparentBg) { ctx.fillStyle = self.p.bg; ctx.fillRect(0, 0, W, H); }
    var src = self._sourceDrawable();
    if (!self._srcReady || !src) { ctx.restore(); return; }
    var lc = self._layerC, lctx = self._layerCtx;
    if (lc.width !== W || lc.height !== H) { lc.width = W; lc.height = H; }
    lctx.clearRect(0, 0, W, H);
    if (self.p.effect === "dots") self._renderDots(lctx, W, H);
    else if (self.p.effect === "mosh") self._renderMosh(lctx, W, H);
    else if (self.p.effect === "track") self._renderTrack(lctx, W, H);
    else self._renderAscii(lctx, W, H);
    var bloom = clamp(self.p.glow, 0, 100) / 100;
    if (bloom > 0 && FX_FILTER) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = bloom * 0.85;
      ctx.filter = "blur(" + Math.max(3, Math.round(W * 0.008)) + "px)";
      ctx.drawImage(lc, 0, 0);
      ctx.restore();
    }
    ctx.drawImage(lc, 0, 0);
    ctx.restore();
  };

  /* ---------- экспорт ---------- */
  P.renderTo = function (ctx, W, H) { this._renderTo(ctx, W, H); };
  P.renderAt = function (w, h) {
    w = Math.max(8, Math.round(w)); h = Math.max(8, Math.round(h));
    var c = document.createElement("canvas"); c.width = w; c.height = h;
    this._renderTo(c.getContext("2d"), w, h);
    this.info.outW = w; this.info.outH = h;
    return c;
  };
  P.renderCanvas = function (maxSide) {
    var w = Math.max(8, Math.round(this._srcW)), h = Math.max(8, Math.round(this._srcH));
    if (maxSide) { var k = Math.min(1, maxSide / Math.max(w, h)); w = Math.max(8, Math.round(w * k)); h = Math.max(8, Math.round(h * k)); }
    return this.renderAt(w, h);
  };
  P.snapshotPNG = function () { var c = this.renderCanvas(4096); try { return c.toDataURL("image/png"); } catch (e) { return null; } };
  P.toAsciiText = function () {
    if (this.p.effect !== "ascii" || !this._asciiGrid) return "";
    var lines = this._asciiGrid.split("\n"), first = -1, last = -1;
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].replace(/\s/g, "").length) { if (first < 0) first = i; last = i; }
    }
    if (first < 0) return "";
    var out = [];
    for (var r = first; r <= last; r++) out.push(lines[r].replace(/\s+$/, ""));
    return out.join("\n");
  };
  P.toSVG = function () {
    var self = this;
    if (!self._srcReady) return null;
    if (self.p.effect === "mosh" || self.p.effect === "track") return null;
    var cols = clamp(Math.round(self.p.cols), 24, 220);

    if (self.p.effect === "dots") {
      var rowsD = Math.max(8, Math.round(cols * (self._srcH / self._srcW)));
      var cw = 10, chh = 10, W = cols * cw, H = rowsD * chh;
      var dataD = self._sample(cols, rowsD);
      if (!dataD) return null;
      var origD = self.p.colorMode === "original";
      var maxR = cw * 0.5 * clamp(self.p.dotScale, 0.3, 1.5);
      var sqD = self.p.dotShape === "square";
      var outD = ['<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">'];
      if (!self.p.transparentBg) outD.push('<rect width="' + W + '" height="' + H + '" fill="' + self.p.bg + '"/>');
      var cnt = 0;
      for (var rd = 0; rd < rowsD; rd++) {
        for (var cd = 0; cd < cols; cd++) {
          var od = (rd * cols + cd) * 4, ad = dataD[od + 3] / 255;
          if (ad <= 0.04) continue;
          var ard = self._adjChannel(dataD[od]), agd = self._adjChannel(dataD[od + 1]), abd = self._adjChannel(dataD[od + 2]);
          var lumD = self._gammaNorm(lumOf(ard, agd, abd) * ad);
          var inkD = clamp(self.p.invert ? lumD : 1 - lumD, 0, 1);
          if (inkD <= 0.02) continue;
          var radD = maxR * Math.sqrt(inkD), cxD = cd * cw + cw / 2, cyD = rd * chh + chh / 2;
          var colD = origD ? rgbStr(ard, agd, abd) : rgbStr.apply(null, hexToRgb(self.p.fg));
          if (sqD) outD.push('<rect x="' + (cxD - radD).toFixed(2) + '" y="' + (cyD - radD).toFixed(2) + '" width="' + (radD * 2).toFixed(2) + '" height="' + (radD * 2).toFixed(2) + '" fill="' + colD + '"/>');
          else outD.push('<circle cx="' + cxD.toFixed(2) + '" cy="' + cyD.toFixed(2) + '" r="' + radD.toFixed(2) + '" fill="' + colD + '"/>');
          if (++cnt > 30000) return null;
        }
      }
      outD.push('</svg>');
      return outD.join("");
    }

    var rows = Math.max(8, Math.round(cols * (self._srcH / self._srcW) * 0.5));
    var cellW = 10, cellH = 20, W2 = cols * cellW, H2 = rows * cellH;
    var data = self._sample(cols, rows);
    if (!data) return null;
    var cs = CHARSETS[self.p.charset] || CHARSETS.detailed;
    var orig = self.p.colorMode === "original";
    var out = ['<svg xmlns="http://www.w3.org/2000/svg" width="' + W2 + '" height="' + H2 + '" viewBox="0 0 ' + W2 + ' ' + H2 + '">'];
    if (!self.p.transparentBg) out.push('<rect width="' + W2 + '" height="' + H2 + '" fill="' + self.p.bg + '"/>');
    var count = 0;
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var o = (r * cols + c) * 4, a = data[o + 3] / 255;
        if (a <= 0.04) continue;
        var ar = self._adjChannel(data[o]), ag = self._adjChannel(data[o + 1]), ab = self._adjChannel(data[o + 2]);
        var lumN = self._gammaNorm(lumOf(ar, ag, ab) * a);
        var ink = clamp(self.p.invert ? lumN : 1 - lumN, 0, 1);
        var idx = clamp(Math.round(ink * (cs.length - 1)), 0, cs.length - 1);
        var ch = cs.charAt(idx);
        if (ch === " ") continue;
        var col = orig ? rgbStr(ar, ag, ab) : rgbStr.apply(null, hexToRgb(self.p.fg));
        out.push('<text x="' + (c * cellW + cellW / 2) + '" y="' + (r * cellH + cellH / 2) + '" font-family="ui-monospace,Menlo,Consolas,monospace" font-weight="700" font-size="' + (cellW / 0.6).toFixed(1) + '" fill="' + col + '" text-anchor="middle" dominant-baseline="central">' + escXml(ch) + '</text>');
        if (++count > 30000) return null;
      }
    }
    out.push('</svg>');
    return out.join("");
  };

  P.destroy = function () {
    this.dead = true; this._stopLoop();
    if (this._ro) { try { this._ro.disconnect(); } catch (e) {} }
    this._clearSource();
    if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
  };
  Object.defineProperties(P, {
    params: {
      get: function () { var o = {}; for (var k in this.p) o[k] = this.p[k]; return o; }
    }
  });

  function mount(target, opts) {
    var el = typeof target === "string" ? document.querySelector(target) : target;
    if (!el) return null;
    return new Engine(el, opts);
  }

  global.FXStudio = {
    version: VERSION,
    effects: EFFECTS,
    charsets: CHARSET_LABELS,
    dotShapes: DOT_SHAPES,
    mount: mount
  };
})(typeof window !== "undefined" ? window : this);
