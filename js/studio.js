/*! ============================================================
    Xtal Studio v4.9.0 — редактор: ASCII / DOTS / MOSH / TRACK
    UI + экспорт PNG / SVG / GIF / MP4.
    ============================================================ */
(function (global) {
  "use strict";

  var VER = "4.9.0";

  /* ---------- утилиты ---------- */

  function $(id) { return document.getElementById(id); }
  function on(el, ev, fn) { if (el && el.addEventListener) el.addEventListener(ev, fn); }

  var toastTimer = 0;
  function toast(msg, ms) {
    var el = $("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, ms || 2600);
  }

  function downloadBlob(blob, name) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function fmtBytes(b) {
    if (!b) return "—";
    if (b > 1048576) return (b / 1048576).toFixed(1) + " МБ";
    return Math.round(b / 1024) + " КБ";
  }

  function hexToRgb(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
    if (!m) return [11, 14, 17];
    var n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function bytesToBase64(u8) {
    var s = "", CH = 0x8000;
    for (var i = 0; i < u8.length; i += CH)
      s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return btoa(s);
  }

  /* ---------- состояние ---------- */

  var state = {
    sourceType: "none",
    theme: "dark",
    effect: "ascii",
    cols: 120,
    colorMode: "mono",
    fg: "#ffffff",
    brightness: 0,
    contrast: 100,
    gamma: 1,
    invert: false,
    glow: 40,
    charScale: 1,
    dotScale: 1,
    moshLevel: 25,
    moshScale: 16,
    moshBleed: 50,
    moshMelt: 30,
    moshFocusX: 50,
    moshFocusY: 50,
    moshFocusRadius: 100,
    trackCount: 26,
    trackLines: 60,
    trackLabels: 60,
    trackDim: 0,
    bg: "#0b0e11",
    transparentBg: false,
    fmt: "png"
  };

  var inst = null;
  var capturing = false;
  var recording = false;

  var SLIDERS = [
    "cols", "glow", "charScale", "dotScale",
    "moshLevel", "moshScale", "moshBleed", "moshMelt",
    "moshFocusX", "moshFocusY", "moshFocusRadius",
    "trackCount", "trackLines", "trackLabels", "trackDim",
    "brightness", "contrast", "gamma"
  ];

  function fmtVal(k, v) {
    if (k === "gamma") return Number(v).toFixed(1);
    if (k === "charScale" || k === "dotScale") return Number(v).toFixed(2);
    return String(v);
  }

  function pushParams() {
    if (!inst) return;
    inst.setParams({
      effect: state.effect,
      cols: state.cols,
      colorMode: state.colorMode,
      fg: state.fg,
      brightness: state.brightness,
      contrast: state.contrast,
      gamma: state.gamma,
      invert: state.invert,
      glow: state.glow,
      charScale: state.charScale,
      dotScale: state.dotScale,
      moshLevel: state.moshLevel,
      moshScale: state.moshScale,
      moshBleed: state.moshBleed,
      moshMelt: state.moshMelt,
      moshFocusX: state.moshFocusX,
      moshFocusY: state.moshFocusY,
      moshFocusRadius: state.moshFocusRadius,
      trackCount: state.trackCount,
      trackLines: state.trackLines,
      trackLabels: state.trackLabels,
      trackDim: state.trackDim,
      bg: state.bg,
      transparentBg: state.transparentBg
    });
    updateExportInfo();
  }

  /* ---------- размеры / превью ---------- */

  function currentScale() {
    var s = $("scaleSel");
    return s ? parseFloat(s.value) || 1 : 1;
  }

  function computeExportSize(scale) {
    var info = inst.info || {};
    if (!info.srcW) return null;
    var aspect = info.srcH / info.srcW;
    var baseW = Math.max(info.srcW, state.cols * 12);
    return {
      w: Math.round(baseW * scale),
      h: Math.round(baseW * aspect * scale)
    };
  }

  function renderFrame(w, h) {
    if (inst.renderAt) return inst.renderAt(w, h);
    return inst.renderCanvas(Math.max(w, h));
  }

  function estimatePngBytes(scale) {
    var sz = computeExportSize(scale);
    if (!sz) return 0;
    var c = renderFrame(sz.w, sz.h);
    try { return Math.round(c.toDataURL("image/png").length * 0.75); } catch (e) { return 0; }
  }

  /* ---------- видимость блоков ---------- */

  function refreshEffectOpts() {
    var e = state.effect;
    var basic = (e === "ascii" || e === "dots");
    var map = {
      optDensity: basic,
      optTone:    basic,
      optGlow:    basic,
      optColor:   basic,
      asciiOpts:  e === "ascii",
      dotsOpts:   e === "dots",
      moshOpts:   e === "mosh",
      trackOpts:  e === "track"
    };
    for (var k in map) {
      var el = $(k);
      if (el) el.style.display = map[k] ? "" : "none";
    }
  }

  function refreshExportOpts() {
    var f = state.fmt;
    var p = $("pngOpts"), g = $("gifOpts"), v = $("vidOpts");
    if (p) p.style.display = (f === "png" || f === "svg") ? "" : "none";
    if (g) g.style.display = (f === "gif") ? "" : "none";
    if (v) v.style.display = (f === "mp4") ? "" : "none";
  }

  /* ---------- длительность / fps исходника ---------- */

  function sourceDuration() {
    if (!inst) return 2;
    if (state.sourceType === "video" && inst._video && isFinite(inst._video.duration) && inst._video.duration > 0)
      return inst._video.duration;
    if (state.sourceType === "gif" && inst._gif) {
      var s = 0;
      for (var i = 0; i < inst._gif.frames.length; i++) s += inst._gif.frames[i].delay;
      return s / 1000;
    }
    return 2;
  }

  function sourceFps() {
    if (state.sourceType === "gif" && inst._gif && inst._gif.frames.length) {
      var s = 0;
      for (var i = 0; i < inst._gif.frames.length; i++) s += inst._gif.frames[i].delay;
      return Math.max(1, Math.round(1000 / (s / inst._gif.frames.length)));
    }
    return 24;
  }

  /* ---------- пресеты качества ---------- */

  function resolveGif() {
    var q = ($("gifQuality") || {}).value || "med";
    if (q === "low") return { size: 360, fps: 12 };
    if (q === "max") return { size: 0, fps: 0 };
    return { size: 480, fps: 18 };
  }

  function resolveVideo() {
    var q = ($("vidQuality") || {}).value || "med";
    var info = inst.info || {};
    if (q === "low") return { w: Math.min(info.srcW, 480), bitrate: 2.5e6 };
    if (q === "max") return { w: info.srcW, bitrate: 10e6 };
    return { w: Math.min(info.srcW, 720), bitrate: 6e6 };
  }

  /* ---------- строка инфо ---------- */

  var expTimer = 0;
  function updateExportInfo() {
    var el = $("exportInfo");
    if (!el || !inst) return;
    var info = inst.info || {};
    var sz = computeExportSize(currentScale());
    if (!sz) { el.textContent = "Размер: —"; return; }
    var fmt = state.fmt;

    if (fmt === "gif") {
      var g = resolveGif();
      var gw = g.size === 0 ? Math.min(1024, info.srcW) : Math.min(info.srcW, g.size);
      var gh = Math.round(info.srcH * (gw / info.srcW));
      var fps = g.fps || Math.min(sourceFps(), 24);
      el.textContent = "GIF: " + gw + "×" + gh + " · " + fps + " FPS · " + sourceDuration().toFixed(1) + "с";
      return;
    }
    if (fmt === "mp4") {
      var v = resolveVideo();
      var vh = Math.round(info.srcH * (v.w / info.srcW));
      el.textContent = "MP4: " + v.w + "×" + vh + " · " + (v.bitrate / 1e6).toFixed(1) + " Mbps · " + sourceDuration().toFixed(1) + "с";
      return;
    }

    clearTimeout(expTimer);
    el.textContent = "Размер: " + sz.w + "×" + sz.h + " px · …";
    expTimer = setTimeout(function () {
      var bytes = fmt === "svg" ? (inst.toSVG() || "").length : estimatePngBytes(currentScale());
      el.textContent = "Размер: " + sz.w + "×" + sz.h + " px · ≈" + fmtBytes(bytes);
    }, 500);
  }

  /* ---------- PNG / SVG ---------- */

  function exportPNG(scale) {
    var sz = computeExportSize(scale);
    if (!sz) { toast("Нет источника"); return; }
    var c = renderFrame(sz.w, sz.h);
    var url = c.toDataURL("image/png");
    var a = document.createElement("a");
    a.href = url;
    a.download = "xtal-" + state.effect + ".png";
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast("PNG: " + sz.w + "×" + sz.h + " · " + fmtBytes(Math.round(url.length * 0.75)));
  }

  function exportSVG() {
    var svg = inst.toSVG();
    if (!svg) { toast("Для этого эффекта SVG недоступен"); return; }
    downloadBlob(new Blob([svg], { type: "image/svg+xml" }), "xtal-" + state.effect + ".svg");
    toast("SVG: " + fmtBytes(svg.length));
  }

  function doExport() {
    if (!inst || state.sourceType === "none") { toast("Сначала загрузите источник"); return; }
    if (state.fmt === "png") exportPNG(currentScale());
    else if (state.fmt === "svg") exportSVG();
    else if (state.fmt === "gif") captureGIF();
    else if (state.fmt === "mp4") captureVideo();
  }

  /* ================= GIF ================= */

  function ByteWriter() { this.buf = new Uint8Array(1 << 16); this.n = 0; }
  ByteWriter.prototype.ensure = function (k) {
    if (this.n + k <= this.buf.length) return;
    var cap = this.buf.length;
    while (cap < this.n + k) cap *= 2;
    var nb = new Uint8Array(cap);
    nb.set(this.buf.subarray(0, this.n));
    this.buf = nb;
  };
  ByteWriter.prototype.b = function (v) { this.ensure(1); this.buf[this.n++] = v & 255; };
  ByteWriter.prototype.u16 = function (v) { this.b(v & 255); this.b((v >> 8) & 255); };
  ByteWriter.prototype.str = function (s) { for (var i = 0; i < s.length; i++) this.b(s.charCodeAt(i)); };
  ByteWriter.prototype.bytes = function (u8) { this.ensure(u8.length); this.buf.set(u8, this.n); this.n += u8.length; };
  ByteWriter.prototype.out = function () { return this.buf.slice(0, this.n); };

  var PAL = new Uint8Array(256 * 3);
  (function () {
    for (var i = 0; i < 216; i++) {
      PAL[i * 3]     = Math.floor(i / 36) * 51;
      PAL[i * 3 + 1] = Math.floor(i / 6) % 6 * 51;
      PAL[i * 3 + 2] = (i % 6) * 51;
    }
  })();

  function quantizeOpaque(img, bg) {
    var d = img.data, n = d.length >> 2, idx = new Uint8Array(n);
    for (var i = 0; i < n; i++) {
      var o = i * 4, a = d[o + 3] / 255;
      var r = d[o] * a + bg[0] * (1 - a);
      var g = d[o + 1] * a + bg[1] * (1 - a);
      var b = d[o + 2] * a + bg[2] * (1 - a);
      idx[i] = Math.min(5, Math.floor((r * 5 + 127) / 255)) * 36 +
               Math.min(5, Math.floor((g * 5 + 127) / 255)) * 6 +
               Math.min(5, Math.floor((b * 5 + 127) / 255));
    }
    return idx;
  }

  function lzwOmggif(idx) {
    var raw = [];
    var min_code_size = 8, clear_code = 256, eoi_code = 257;
    var next_code = 258, cur_code_size = 9;
    var cur = 0, cur_shift = 0;
    var code_table = new Map();

    function emit_code(c) {
      cur |= c << cur_shift;
      cur_shift += cur_code_size;
      while (cur_shift >= 8) { raw.push(cur & 255); cur >>>= 8; cur_shift -= 8; }
    }

    var ib_code = idx[0];
    emit_code(clear_code);
    for (var i = 1; i < idx.length; i++) {
      var k = idx[i];
      var key = (ib_code << 8) | k;
      var found = code_table.get(key);
      if (found === undefined) {
        emit_code(ib_code);
        if (next_code === 4096) {
          emit_code(clear_code);
          next_code = eoi_code + 1;
          cur_code_size = min_code_size + 1;
          code_table = new Map();
        } else {
          if (next_code >= (1 << cur_code_size)) cur_code_size++;
          code_table.set(key, next_code);
          next_code++;
        }
        ib_code = k;
      } else {
        ib_code = found;
      }
    }
    emit_code(ib_code);
    emit_code(eoi_code);
    if (cur_shift > 0) raw.push(cur & 255);
    return raw;
  }

  function lzwSimple(idx) {
    var raw = [], clear = 256, eoi = 257, codeSize = 9;
    var acc = 0, bits = 0, since = 0;
    function emit(c) {
      acc |= c << bits;
      bits += codeSize;
      while (bits >= 8) { raw.push(acc & 255); acc >>>= 8; bits -= 8; }
    }
    emit(clear);
    for (var i = 0; i < idx.length; i++) {
      emit(idx[i]);
      since++;
      if (since >= 250) { emit(clear); since = 0; }
    }
    emit(eoi);
    if (bits > 0) raw.push(acc & 255);
    return raw;
  }

  function bboxDiff(a, b, gw, gh) {
    var minX = gw, minY = gh, maxX = -1, maxY = -1;
    for (var y = 0; y < gh; y++) {
      var row = y * gw;
      for (var x = 0; x < gw; x++) {
        if (a[row + x] !== b[row + x]) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }

  function extractRect(idx, gw, r) {
    var out = new Uint8Array(r.w * r.h);
    for (var y = 0; y < r.h; y++)
      for (var x = 0; x < r.w; x++)
        out[y * r.w + x] = idx[(r.y + y) * gw + (r.x + x)];
    return out;
  }

  function encodeGIF(list, gw, gh, enc) {
    var wr = new ByteWriter();
    wr.str("GIF89a"); wr.u16(gw); wr.u16(gh);
    wr.b(0xF7); wr.b(0); wr.b(0);
    wr.bytes(PAL);
    wr.b(0x21); wr.b(0xFF); wr.b(0x0B); wr.str("NETSCAPE2.0"); wr.b(3); wr.b(1); wr.u16(0); wr.b(0);
    for (var f = 0; f < list.length; f++) {
      var fr = list[f];
      wr.b(0x21); wr.b(0xF9); wr.b(4); wr.b(0x04); wr.u16(fr.delay); wr.b(0); wr.b(0);
      wr.b(0x2C); wr.u16(fr.x); wr.u16(fr.y); wr.u16(fr.w); wr.u16(fr.h); wr.b(0);
      wr.b(8);
      var raw = enc(fr.idx);
      for (var o = 0; o < raw.length; o += 255) {
        var s = Math.min(255, raw.length - o);
        wr.b(s);
        for (var i = 0; i < s; i++) wr.b(raw[o + i]);
      }
      wr.b(0);
    }
    wr.b(0x3B);
    return wr.out();
  }

  function gifValidInBrowser(bytes, expectIdx, gw, gh, done) {
    try {
      var im = new Image();
      im.onload = function () {
        try {
          var c = document.createElement("canvas");
          c.width = gw; c.height = gh;
          var cx = c.getContext("2d");
          cx.drawImage(im, 0, 0, gw, gh);
          var d = cx.getImageData(0, 0, gw, gh).data;
          var bad = 0, tot = 0;
          for (var i = 0; i < expectIdx.length; i += 97) {
            var o = i * 4, e3 = expectIdx[i] * 3;
            var dr = Math.abs(d[o] - PAL[e3]) + Math.abs(d[o + 1] - PAL[e3 + 1]) + Math.abs(d[o + 2] - PAL[e3 + 2]);
            tot++;
            if (dr > 90) bad++;
          }
          done(bad / tot < 0.05);
        } catch (e) { done(false); }
      };
      im.onerror = function () { done(false); };
      im.src = "data:image/gif;base64," + bytesToBase64(bytes);
    } catch (e) { done(false); }
  }

  function captureGIF() {
    if (!inst || capturing) return;
    if (state.sourceType === "none") { toast("Сначала загрузите источник"); return; }
    capturing = true;

    var cfg = resolveGif();
    var info = inst.info || {};
    var gw = cfg.size === 0 ? Math.min(1024, info.srcW) : Math.min(info.srcW, cfg.size);
    var gh = Math.max(2, Math.round(info.srcH * (gw / info.srcW)));
    var bg = hexToRgb(state.bg);
    var list = [], lastFull = null;

    function grabFull() {
      var c = renderFrame(gw, gh);
      var t = document.createElement("canvas");
      t.width = gw; t.height = gh;
      var tx = t.getContext("2d");
      tx.fillStyle = "rgb(" + bg[0] + "," + bg[1] + "," + bg[2] + ")";
      tx.fillRect(0, 0, gw, gh);
      tx.drawImage(c, 0, 0, gw, gh);
      return quantizeOpaque(tx.getImageData(0, 0, gw, gh), bg);
    }

    function pushFrame(idx, delayCs) {
      if (lastFull) {
        var bb = bboxDiff(lastFull, idx, gw, gh);
        if (!bb) {
          if (list.length) list[list.length - 1].delay += delayCs;
          return;
        }
        if (bb.w * bb.h > 0.85 * gw * gh) bb = { x: 0, y: 0, w: gw, h: gh };
        list.push({ x: bb.x, y: bb.y, w: bb.w, h: bb.h, idx: extractRect(idx, gw, bb), delay: delayCs });
      } else {
        list.push({ x: 0, y: 0, w: gw, h: gh, idx: idx, delay: delayCs });
      }
      lastFull = idx;
    }

    function ship(bytes) {
      var a = document.createElement("a");
      a.href = "data:image/gif;base64," + bytesToBase64(bytes);
      a.download = "xtal-" + state.effect + ".gif";
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast("GIF: " + gw + "×" + gh + ", " + list.length + " кадр · " + fmtBytes(bytes.length), 5000);
      capturing = false;
    }

    function finish() {
      try {
        if (!list.length) throw new Error("нет кадров");
        var compressed = encodeGIF(list, gw, gh, lzwOmggif);
        gifValidInBrowser(compressed, list[0].idx, list[0].w, list[0].h, function (ok) {
          if (ok) ship(compressed);
          else ship(encodeGIF(list, gw, gh, lzwSimple));
        });
      } catch (e) {
        toast("Ошибка GIF: " + (e && e.message || e), 6000);
        capturing = false;
      }
    }

    try {
      if (state.sourceType === "gif" && inst._gif) {
        var srcFps = sourceFps();
        var targetFps = cfg.fps || Math.min(srcFps, 24);
        var skip = Math.max(1, Math.round(srcFps / targetFps));
        var N = inst._gif.frames.length;
        for (var i = 0; i < N; i += skip) {
          var sum = 0;
          for (var s = 0; s < skip; s++) {
            inst._gifAdvance(performance.now(), true);
            sum += inst._gif.frames[inst._gif.idx].delay;
          }
          pushFrame(grabFull(), Math.max(2, Math.round(sum / 10)));
        }
        finish();
      } else if (state.sourceType === "video" && inst._video) {
        var dur = sourceDuration();
        var fps = cfg.fps || 20;
        var TOTAL = Math.max(1, Math.round(dur * fps));
        var STEP = 1000 / fps, got = 0;
        toast("Запись GIF (" + dur.toFixed(1) + "с)…", 1500);
        (function step() {
          pushFrame(grabFull(), Math.round(100 / fps));
          got++;
          if (got < TOTAL) setTimeout(step, STEP);
          else finish();
        })();
      } else {
        pushFrame(grabFull(), 10);
        finish();
      }
    } catch (e) {
      capturing = false;
      toast("Ошибка GIF: " + (e && e.message || e), 6000);
    }
  }

  /* ================= MP4 / WebM ================= */

  function pickMime() {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return "";
    var c = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"];
    for (var i = 0; i < c.length; i++)
      if (MediaRecorder.isTypeSupported(c[i])) return c[i];
    return "";
  }

  function captureVideo() {
    if (!inst || recording) return;
    if (state.sourceType === "none") { toast("Сначала загрузите источник"); return; }
    var mime = pickMime();
    if (!mime) { toast("Браузер не поддерживает запись видео"); return; }
    recording = true;

    var v = resolveVideo();
    var dur = sourceDuration();
    var info = inst.info || {};
    var w = v.w;
    var h = Math.max(2, Math.round(info.srcH * (w / info.srcW)));
    var c = document.createElement("canvas");
    c.width = w; c.height = h;
    var ctx = c.getContext("2d");

    var stream = c.captureStream(60);
    var track = (stream.getVideoTracks && stream.getVideoTracks()[0]) || null;
    var rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: v.bitrate });
    var chunks = [];

    rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = function () {
      recording = false;
      var ext = mime.indexOf("mp4") >= 0 ? "mp4" : "webm";
      var blob = new Blob(chunks, { type: mime });
      downloadBlob(blob, "xtal-" + state.effect + "." + ext);
      toast("Видео: " + w + "×" + h + " · " + dur.toFixed(1) + "с · " + fmtBytes(blob.size) + " (." + ext + ")", 5000);
    };

    var raf;
    function loop() {
      if (inst._renderTo) inst._renderTo(ctx, w, h);
      if (track && track.requestFrame) track.requestFrame();
      raf = requestAnimationFrame(loop);
    }
    function begin() {
      rec.start(500);
      loop();
      toast("Запись видео… " + dur.toFixed(1) + "с", 1500);
      setTimeout(function () { cancelAnimationFrame(raf); rec.stop(); }, dur * 1000);
    }

    var vid = inst._video;
    if (vid) {
      var started = false;
      var go = function () {
        if (started) return;
        started = true;
        vid.removeEventListener("seeked", go);
        var pp = vid.play();
        if (pp && pp.catch) pp.catch(function () {});
        begin();
      };
      if (Math.abs(vid.currentTime) < 0.01) go();
      else {
        vid.addEventListener("seeked", go);
        vid.currentTime = 0;
        setTimeout(go, 400);
      }
    } else {
      begin();
    }
  }

  /* ---------- источники ---------- */

  function guessType(u) {
    u = u.toLowerCase().split("?")[0].split("#")[0];
    if (u.slice(-4) === ".gif") return "gif";
    var e = u.slice(-5);
    if (e === ".mp4" || e === ".webm" || u.slice(-4) === ".mov" || u.slice(-4) === ".m4v") return "video";
    return "image";
  }

  function setSource(type, src, label) {
    if (!inst) return;
    state.sourceType = type;
    inst.setSource(type, src);
    var nm = $("srcName");
    if (nm) nm.textContent = label || type;
    updateHint();
    updateExportInfo();
  }

  function handleFile(file) {
    if (!file) return;
    var t = file.type || "";
    if (t.indexOf("video/") === 0) setSource("video", URL.createObjectURL(file), file.name);
    else if (t === "image/gif") {
      var fr = new FileReader();
      fr.onload = function () { setSource("gif", fr.result, file.name); };
      fr.readAsDataURL(file);
    } else if (t.indexOf("image/") === 0) {
      var f2 = new FileReader();
      f2.onload = function () { setSource("image", f2.result, file.name); };
      f2.readAsDataURL(file);
    } else {
      toast("Неподдерживаемый формат");
    }
  }

  /* ---------- UI ---------- */

  function setTheme(t) {
    state.theme = t;
    document.body.setAttribute("data-theme", t);
    var b = $("themeToggle");
    if (b) b.textContent = t === "light" ? "☾" : "☀";
  }

  function updateHint() {
    var h = $("stageHint");
    if (!h) return;
    if (state.sourceType === "none") {
      h.classList.remove("fade");
      h.textContent = "Перетащите файл — колесо: зум, драг: панорама";
    } else {
      h.textContent = state.effect.toUpperCase() + " • " + state.cols;
      setTimeout(function () { h.classList.add("fade"); }, 2500);
    }
  }

  function syncUI() {
    SLIDERS.forEach(function (k) {
      var el = $(k), o = $(k + "-val");
      if (el) el.value = state[k];
      if (o) o.textContent = fmtVal(k, state[k]);
    });
    var i = $("invert");    if (i) i.checked = state.invert;
    var t = $("transpBg");  if (t) t.checked = state.transparentBg;
    var oc = $("oneColor"); if (oc) oc.checked = state.colorMode === "mono";
    var f = $("fgColor");   if (f) f.value = state.fg;
    var b = $("bgColor");   if (b) b.value = state.bg;
  }

  function bindSliders() {
    SLIDERS.forEach(function (k) {
      var el = $(k), o = $(k + "-val");
      if (!el) return;
      on(el, "input", function () {
        state[k] = parseFloat(el.value) || 0;
        if (o) o.textContent = fmtVal(k, state[k]);
        pushParams();
      });
    });
  }

  function syncEffectSeg() {
    var btns = document.querySelectorAll("#effectSeg .seg-btn");
    Array.prototype.forEach.call(btns, function (b) {
      b.classList.toggle("active", b.getAttribute("data-effect") === state.effect);
    });
  }

  function bindEffectSeg() {
    var btns = document.querySelectorAll("#effectSeg .seg-btn");
    Array.prototype.forEach.call(btns, function (b) {
      on(b, "click", function () {
        state.effect = b.getAttribute("data-effect");
        syncEffectSeg();
        refreshEffectOpts();
        refreshExportOpts();
        pushParams();
        updateHint();
      });
    });
  }

  function bindLook() {
    on($("themeToggle"), "click", function () { setTheme(state.theme === "light" ? "dark" : "light"); });
    on($("oneColor"), "change", function (e) { state.colorMode = e.target.checked ? "mono" : "original"; pushParams(); });
    on($("invert"), "change", function (e) { state.invert = !!e.target.checked; pushParams(); });
    on($("transpBg"), "change", function (e) { state.transparentBg = !!e.target.checked; pushParams(); });
    on($("fgColor"), "input", function (e) { state.fg = e.target.value; pushParams(); });
    on($("bgColor"), "input", function (e) { state.bg = e.target.value; pushParams(); });
  }

  function bindSources() {
    var dz = $("dropzone"), fi = $("fileInput");
    if (dz) {
      on(dz, "click", function () { if (fi) fi.click(); });
      on(dz, "dragover", function (e) { e.preventDefault(); dz.classList.add("over"); });
      on(dz, "dragleave", function () { dz.classList.remove("over"); });
      on(dz, "drop", function (e) {
        e.preventDefault();
        dz.classList.remove("over");
        handleFile(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
      });
    }
    if (fi) on(fi, "change", function () { handleFile(fi.files && fi.files[0]); fi.value = ""; });

    var st = $("stage");
    if (st) {
      on(st, "dragover", function (e) { e.preventDefault(); });
      on(st, "drop", function (e) {
        e.preventDefault();
        handleFile(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
      });
    }
  }

  function bindExport() {
    var btns = document.querySelectorAll(".fmt-btn");
    Array.prototype.forEach.call(btns, function (b) {
      on(b, "click", function () {
        if (b.disabled) return;
        state.fmt = b.getAttribute("data-fmt");
        Array.prototype.forEach.call(btns, function (x) { x.classList.toggle("active", x === b); });
        refreshExportOpts();
        updateExportInfo();
      });
    });
    on($("scaleSel"), "change", updateExportInfo);
    on($("gifQuality"), "change", updateExportInfo);
    on($("vidQuality"), "change", updateExportInfo);
    on($("btnExport"), "click", doExport);
  }

  function startMeta() {
    var el = $("meta");
    if (!el) return;
    var f = 0, l = performance.now();
    (function loop() {
      f++;
      var n = performance.now();
      if (n - l >= 1000) {
        var fps = Math.round(f * 1000 / (n - l));
        f = 0;
        l = n;
        var i = inst ? inst.info || {} : {};
        el.textContent = (i.cols || 0) + "×" + (i.rows || 0) + " • " + fps + " fps";
      }
      requestAnimationFrame(loop);
    })();
  }

  /* ---------- старт ---------- */

  function init() {
    if (!global.FXStudio) { toast("Движок не загружен", 8000); return; }

    inst = FXStudio.mount("#stage", {
      effect: state.effect,
      cols: state.cols,
      colorMode: state.colorMode,
      fg: state.fg,
      brightness: state.brightness,
      contrast: state.contrast,
      gamma: state.gamma,
      invert: state.invert,
      glow: state.glow,
      charScale: state.charScale,
      dotScale: state.dotScale,
      moshLevel: state.moshLevel,
      moshScale: state.moshScale,
      moshBleed: state.moshBleed,
      moshMelt: state.moshMelt,
      moshFocusX: state.moshFocusX,
      moshFocusY: state.moshFocusY,
      moshFocusRadius: state.moshFocusRadius,
      trackCount: state.trackCount,
      trackLines: state.trackLines,
      trackLabels: state.trackLabels,
      trackDim: state.trackDim,
      bg: state.bg,
      transparentBg: state.transparentBg,
      onError: function (e) { toast("Ошибка: " + (e && e.message || e), 5000); }
    });

    setTheme(state.theme);
    bindSources();
    bindSliders();
    bindEffectSeg();
    syncEffectSeg();
    bindLook();
    bindExport();
    refreshEffectOpts();
    refreshExportOpts();
    syncUI();
    updateHint();
    updateExportInfo();
    startMeta();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

})(typeof window !== "undefined" ? window : this);
