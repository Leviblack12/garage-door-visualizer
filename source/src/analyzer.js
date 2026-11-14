/*
 * analyzer.js — Garage Door Visualizer song analyzer, pure JavaScript.
 *
 *   analyzeAudio(mono: Float32Array @ 22050 Hz, sr, {name, onProgress}) -> garage-door-viz/1 object
 *
 * Browser/Web Worker/Node port of analyze.py. No neural nets are available in the
 * browser, so:
 *   - Demucs stems   -> median-filter harmonic/percussive separation (Fitzgerald HPSS,
 *                       librosa-style soft masks) + frequency bands
 *   - Beat This!     -> log-mel spectral-flux onset envelope, autocorrelation tempo with a
 *                       log-normal prior, Ellis dynamic-programming beat tracker, then a
 *                       steady grid snapped to real drum transients
 *   - downbeats      -> meter (3 vs 4) and bar phase from beat-synchronous kick, bass-onset
 *                       and chord-change evidence
 * Everything else (drum hit labelling, envelopes, sections, key) follows analyze.py.
 * No DOM, no Node APIs, no external libraries.
 */
'use strict';

var GDV_SR = 22050;
var GDV_FPS = 60;

var GDV_CFG = {
  nfftA: 2048, hopA: 256,        // timing-critical spectrogram (93 ms window, 11.6 ms hop); 2048 keeps kicks percussive in HPSS
  nfftB: 4096, hopB: 512,        // harmonic features (chroma / MFCC / pitch)
  hpssTime: 23, hpssFreq: 17,    // median kernel sizes (frames, bins) for HPSS
  nMels: 64,
  drumLatency: -0.0355,          // seconds; drum onset times are shifted by -drumLatency (measured on synthetic ground truth, nfft 2048)
  onsetLatency: -0.03,           // seconds; harmonic / mix onsets
  beatLatency: 0.024,            // seconds; DP beat grid (onset envelope frame times)
  startBpm: 120, stdBpm: 1.0,
  tightness: 100,
  minBpm: 55, maxBpm: 160,
  snapTol: 0.045,
};

/* ------------------------------------------------------------------ small utils */
function percentile(arr, q) {
  var n = arr.length;
  if (!n) return 0;
  var a = Float64Array.from(arr);
  a.sort();
  var pos = (q / 100) * (n - 1), lo = Math.floor(pos), hi = Math.min(n - 1, lo + 1);
  return a[lo] + (a[hi] - a[lo]) * (pos - lo);
}
function meanOf(a, i0, i1) {
  i0 = i0 || 0; i1 = (i1 === undefined) ? a.length : i1;
  if (i1 <= i0) return 0;
  var s = 0;
  for (var i = i0; i < i1; i++) s += a[i];
  return s / (i1 - i0);
}
function stdOf(a, ddof) {
  var n = a.length; if (n - (ddof || 0) <= 0) return 0;
  var m = meanOf(a), s = 0;
  for (var i = 0; i < n; i++) { var d = a[i] - m; s += d * d; }
  return Math.sqrt(s / (n - (ddof || 0)));
}
function clip(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function roundHalfEven(x) {
  var r = Math.round(x);
  if (Math.abs(x % 1) === 0.5 && r % 2 !== 0) r -= 1;
  return r;
}
function r3(x) { return Math.round(x * 1000) / 1000; }
function r2(x) { return Math.round(x * 100) / 100; }
function lowerBound(arr, v) { // first index with arr[i] >= v
  var lo = 0, hi = arr.length;
  while (lo < hi) { var m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; }
  return lo;
}
function nearestIdx(sorted, v) {
  var n = sorted.length; if (!n) return -1;
  var i = lowerBound(sorted, v);
  if (i <= 0) return 0;
  if (i >= n) return n - 1;
  return (v - sorted[i - 1] <= sorted[i] - v) ? i - 1 : i;
}
function hannPeriodic(n) {
  var w = new Float64Array(n);
  for (var i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n);
  return w;
}

/* ------------------------------------------------------------------ FFT (real input, radix-2) */
function RealFFT(n) {
  this.n = n;
  var m = n >> 1; this.m = m;
  var bits = 0; while ((1 << bits) < m) bits++;
  this.rev = new Uint32Array(m);
  for (var i = 0; i < m; i++) {
    var r = 0, x = i;
    for (var b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>= 1; }
    this.rev[i] = r;
  }
  var h = Math.max(1, m >> 1);
  this.cs = new Float64Array(h); this.sn = new Float64Array(h);
  for (var k = 0; k < h; k++) { this.cs[k] = Math.cos(2 * Math.PI * k / m); this.sn[k] = Math.sin(2 * Math.PI * k / m); }
  this.c2 = new Float64Array(m + 1); this.s2 = new Float64Array(m + 1);
  for (var k2 = 0; k2 <= m; k2++) { this.c2[k2] = Math.cos(2 * Math.PI * k2 / n); this.s2[k2] = Math.sin(2 * Math.PI * k2 / n); }
  this.zr = new Float64Array(m); this.zi = new Float64Array(m);
}
/* x: real array length n -> outRe/outIm length n/2+1 */
RealFFT.prototype.forward = function (x, outRe, outIm) {
  var m = this.m, rev = this.rev, zr = this.zr, zi = this.zi, cs = this.cs, sn = this.sn;
  for (var i = 0; i < m; i++) { var j = rev[i]; zr[j] = x[2 * i]; zi[j] = x[2 * i + 1]; }
  for (var size = 2; size <= m; size <<= 1) {
    var half = size >> 1, step = m / size;
    for (var s = 0; s < m; s += size) {
      for (var q = 0, k = 0; q < half; q++, k += step) {
        var wr = cs[k], wi = -sn[k];
        var a = s + q, bb = a + half;
        var tr = wr * zr[bb] - wi * zi[bb], ti = wr * zi[bb] + wi * zr[bb];
        zr[bb] = zr[a] - tr; zi[bb] = zi[a] - ti;
        zr[a] += tr; zi[a] += ti;
      }
    }
  }
  outRe[0] = zr[0] + zi[0]; outIm[0] = 0;
  outRe[m] = zr[0] - zi[0]; outIm[m] = 0;
  var c2 = this.c2, s2 = this.s2;
  for (var kk = 1; kk < m; kk++) {
    var ar = zr[kk], ai = zi[kk], br = zr[m - kk], bi = zi[m - kk];
    var fer = 0.5 * (ar + br), fei = 0.5 * (ai - bi);
    var fOr = 0.5 * (ai + bi), fOi = -0.5 * (ar - br);
    var c = c2[kk], sv = s2[kk];
    outRe[kk] = fer + c * fOr + sv * fOi;
    outIm[kk] = fei + c * fOi - sv * fOr;
  }
};

/* STFT, centred frames, zero padding (librosa center=True, pad_mode='constant').
   onFrame(t, re, im) gets the n/2+1 complex bins of frame t. */
function stftFrames(x, nfft, hop, onFrame) {
  var n = x.length, T = 1 + Math.floor(n / hop), B = (nfft >> 1) + 1, half = nfft >> 1;
  var win = hannPeriodic(nfft), fft = new RealFFT(nfft);
  var buf = new Float64Array(nfft), re = new Float64Array(B), im = new Float64Array(B);
  for (var t = 0; t < T; t++) {
    var s0 = t * hop - half;
    if (s0 >= 0 && s0 + nfft <= n) {
      for (var i = 0; i < nfft; i++) buf[i] = x[s0 + i] * win[i];
    } else {
      for (var i2 = 0; i2 < nfft; i2++) { var j = s0 + i2; buf[i2] = (j >= 0 && j < n) ? x[j] * win[i2] : 0; }
    }
    fft.forward(buf, re, im);
    onFrame(t, re, im);
  }
  return T;
}

/* ------------------------------------------------------------------ sliding median (scipy 'reflect') */
function reflectIdx(i, L) {
  while (i < 0 || i >= L) { if (i < 0) i = -i - 1; else i = 2 * L - i - 1; }
  return i;
}
/* src[off + i*stride], i < L  ->  out[i] ; win: Float32Array(k) scratch, k odd */
function medfilt1(src, off, stride, L, k, out, win) {
  var h = k >> 1, j;
  for (j = -h; j <= h; j++) win[j + h] = src[off + reflectIdx(j, L) * stride];
  win.sort();
  out[0] = win[h];
  var interiorLo = h + 1, interiorHi = L - h - 1;
  for (var i = 1; i < L; i++) {
    var vOut, vIn;
    if (i >= interiorLo && i <= interiorHi) { vOut = src[off + (i - 1 - h) * stride]; vIn = src[off + (i + h) * stride]; }
    else { vOut = src[off + reflectIdx(i - 1 - h, L) * stride]; vIn = src[off + reflectIdx(i + h, L) * stride]; }
    if (vOut !== vIn) {
      var lo = 0, hi = k - 1;
      while (lo < hi) { var mid = (lo + hi) >> 1; if (win[mid] < vOut) lo = mid + 1; else hi = mid; }
      var p = lo;
      if (vIn > vOut) { while (p < k - 1 && win[p + 1] < vIn) { win[p] = win[p + 1]; p++; } }
      else { while (p > 0 && win[p - 1] > vIn) { win[p] = win[p - 1]; p--; } }
      win[p] = vIn;
    }
    out[i] = win[h];
  }
}

/* ------------------------------------------------------------------ mel filterbank (Slaney, librosa default) */
function hzToMel(f) { return f < 1000 ? f / (200 / 3) : 15 + Math.log(f / 1000) / (Math.log(6.4) / 27); }
function melToHz(m) { return m < 15 ? m * (200 / 3) : 1000 * Math.exp((m - 15) * Math.log(6.4) / 27); }
function melFilterbank(sr, nfft, nMels, fmin, fmax) {
  var B = (nfft >> 1) + 1, mmin = hzToMel(fmin), mmax = hzToMel(fmax);
  var hz = new Float64Array(nMels + 2);
  for (var i = 0; i < nMels + 2; i++) hz[i] = melToHz(mmin + (mmax - mmin) * i / (nMels + 1));
  var bands = [];
  for (var m = 0; m < nMels; m++) {
    var enorm = 2 / (hz[m + 2] - hz[m]);
    var start = -1, w = [];
    for (var k = 0; k < B; k++) {
      var f = k * sr / nfft;
      var lower = (f - hz[m]) / (hz[m + 1] - hz[m]), upper = (hz[m + 2] - f) / (hz[m + 2] - hz[m + 1]);
      var v = Math.max(0, Math.min(lower, upper)) * enorm;
      if (v > 0) { if (start < 0) start = k; w.push(v); }
      else if (start >= 0) break;
    }
    if (start < 0) { start = 0; w = []; }
    bands.push({ start: start, w: Float64Array.from(w), center: hz[m + 1] });
  }
  return bands;
}
function applyMel(bands, pow, out, off) {
  for (var m = 0; m < bands.length; m++) {
    var b = bands[m], s = 0, w = b.w, st = b.start;
    for (var j = 0; j < w.length; j++) s += w[j] * pow[st + j];
    out[off + m] = s;
  }
}

/* ------------------------------------------------------------------ peak picking (port of pick_peaks) */
function movingAvgSame(f, w) {
  var n = f.length, out = new Float64Array(n), cs = new Float64Array(n + 1);
  for (var i = 0; i < n; i++) cs[i + 1] = cs[i] + f[i];
  var back = w - 1 - ((w - 1) >> 1), fwd = (w - 1) >> 1;
  for (var j = 0; j < n; j++) {
    var a = Math.max(0, j - back), b = Math.min(n - 1, j + fwd);
    out[j] = (cs[b + 1] - cs[a]) / w;
  }
  return out;
}
/* returns {t: frame-times(float, sub-frame refined), s: strengths 0..1, idx: integer frames} */
function pickPeaks(flux, hopT, minGap, kThresh, absFloor) {
  absFloor = absFloor || 0;
  var n = flux.length, mx = 0, i;
  for (i = 0; i < n; i++) if (flux[i] > mx) mx = flux[i];
  if (mx <= 0 || n < 3) return { t: [], s: [], idx: [] };
  var norm = percentile(flux, 99.5) + 1e-9;
  var f = new Float64Array(n);
  for (i = 0; i < n; i++) f[i] = flux[i] / norm;
  var w = Math.max(3, Math.floor(0.5 / hopT));
  var med = movingAvgSame(f, w);
  var gap = Math.max(1, Math.floor(minGap / hopT));
  var peaks = [], last = -1e9;
  for (i = 1; i < n - 1; i++) {
    var thr = Math.max(med[i] * kThresh + 0.06, absFloor);
    if (f[i] > thr && f[i] >= f[i - 1] && f[i] >= f[i + 1]) {
      if (i - last >= gap) { peaks.push(i); last = i; }
      else if (f[i] > f[last]) { peaks[peaks.length - 1] = i; last = i; }
    }
  }
  if (!peaks.length) return { t: [], s: [], idx: [] };
  var s = peaks.map(function (p) { return clip(f[p], 0, 1.5) / 1.5; });
  var p90 = percentile(s, 90) + 1e-9;
  s = s.map(function (v) { return clip(v / p90, 0, 1); });
  var t = peaks.map(function (p) { return p * hopT; });
  return { t: t, s: s, idx: peaks };
}

/* ------------------------------------------------------------------ envelopes (ports) */
function frameRms(x, sr, fps) {
  var hop = sr / fps, n = Math.ceil(x.length / hop), win = Math.floor(hop * 2), half = win >> 1;
  var N = x.length, cs = new Float64Array(N + half + win + 1);
  for (var i = 0; i < half + N + win; i++) {
    var j = i - half, v = (j >= 0 && j < N) ? x[j] : 0;
    cs[i + 1] = cs[i] + v * v;
  }
  var out = new Float32Array(n);
  for (var k = 0; k < n; k++) {
    var s = Math.floor(k * hop);
    out[k] = Math.sqrt(Math.max(0, (cs[s + win] - cs[s]) / win));
  }
  return out;
}
function toDbArr(r) { var o = new Float32Array(r.length); for (var i = 0; i < r.length; i++) o[i] = 20 * Math.log10(Math.max(r[i], 1e-6)); return o; }
function normEnv(db, refHi, floorDb) {
  var o = new Float32Array(db.length);
  for (var i = 0; i < db.length; i++) o[i] = clip((db[i] - (refHi + floorDb)) / (-floorDb), 0, 1);
  return o;
}
function smoothAR(x, fps, attack, release) {
  var a = Math.exp(-1 / Math.max(1e-4, attack * fps)), r = Math.exp(-1 / Math.max(1e-4, release * fps));
  var o = new Float32Array(x.length), v = 0;
  for (var i = 0; i < x.length; i++) { var c = x[i] > v ? a : r; v = c * v + (1 - c) * x[i]; o[i] = v; }
  return o;
}
/* resample a per-STFT-frame series (frame t centred at t*hop/sr) onto n frames at fps */
function framesToFps(series, hopT, n, fps) {
  var o = new Float32Array(n), T = series.length;
  for (var i = 0; i < n; i++) {
    var pos = (i / fps) / hopT, k = Math.floor(pos), fr = pos - k;
    if (k >= T - 1) o[i] = series[T - 1];
    else o[i] = series[k] * (1 - fr) + series[k + 1] * fr;
  }
  return o;
}

/* ------------------------------------------------------------------ onset strength (librosa-style log-mel flux) */
function melFlux(mel, T, NM, m0, m1, agg) {
  // mel: Float32Array T*NM power. Bands [m0, m1). dB with top_db 80 against global max of the selection.
  var nb = m1 - m0, db = new Float32Array(T * nb), mx = -Infinity, t, m;
  for (t = 0; t < T; t++) for (m = 0; m < nb; m++) {
    var v = 10 * Math.log10(Math.max(1e-10, mel[t * NM + m0 + m]));
    db[t * nb + m] = v; if (v > mx) mx = v;
  }
  var floor = mx - 80;
  for (var i = 0; i < db.length; i++) if (db[i] < floor) db[i] = floor;
  var out = new Float32Array(T), tmp = new Float64Array(nb);
  for (t = 1; t < T; t++) {
    var o = t * nb, p = (t - 1) * nb;
    if (agg === 'median') {
      for (m = 0; m < nb; m++) tmp[m] = Math.max(0, db[o + m] - db[p + m]);
      tmp.sort();
      out[t] = nb % 2 ? tmp[nb >> 1] : 0.5 * (tmp[nb / 2 - 1] + tmp[nb / 2]);
    } else {
      var s = 0;
      for (m = 0; m < nb; m++) { var d = db[o + m] - db[p + m]; if (d > 0) s += d; }
      out[t] = s / nb;
    }
  }
  return out;
}
function melRange(bands, lo, hi) {
  var m0 = -1, m1 = -1;
  for (var m = 0; m < bands.length; m++) {
    if (bands[m].center >= lo && m0 < 0) m0 = m;
    if (bands[m].center < hi) m1 = m + 1;
  }
  if (m0 < 0) m0 = 0; if (m1 <= m0) m1 = Math.min(bands.length, m0 + 1);
  return [m0, m1];
}

/* ------------------------------------------------------------------ tempo + Ellis DP beat tracker */
function estimateTempo(env, fps, startBpm, stdBpm, maxTempo) {
  var n = env.length, winLen = Math.floor(8.0 * fps), half = winLen >> 1;
  if (n < 16) return startBpm;
  var w = hannPeriodic(winLen);
  var N = 1; while (N < 2 * winLen) N <<= 1;
  var fft = new RealFFT(N), buf = new Float64Array(N), re = new Float64Array(N / 2 + 1), im = new Float64Array(N / 2 + 1);
  var full = new Float64Array(N), re2 = new Float64Array(N / 2 + 1), im2 = new Float64Array(N / 2 + 1);
  var acc = new Float64Array(winLen), cnt = 0;
  // linear-ramp padded onset envelope (librosa tempogram center=True)
  var padded = new Float64Array(n + 2 * half);
  for (var i = 0; i < n; i++) padded[half + i] = env[i];
  for (var j = 0; j < half; j++) { padded[j] = env[0] * j / half; padded[half + n + half - 1 - j] = env[n - 1] * j / half; }
  var stepF = Math.max(1, Math.floor(n / 1500));
  for (var t = 0; t < n; t += stepF) {
    buf.fill(0);
    for (var k = 0; k < winLen; k++) buf[k] = padded[t + k] * w[k];
    fft.forward(buf, re, im);
    for (var b = 0; b <= N / 2; b++) { var p = re[b] * re[b] + im[b] * im[b]; full[b] = p; if (b > 0 && b < N / 2) full[N - b] = p; }
    fft.forward(full, re2, im2);
    var a0 = re2[0];
    if (a0 <= 1e-12) continue;
    var mx = 0;
    for (var l = 0; l < winLen; l++) { var v = Math.abs(re2[l]); if (v > mx) mx = v; }
    for (var l2 = 0; l2 < winLen; l2++) acc[l2] += re2[l2] / mx;
    cnt++;
  }
  if (!cnt) return startBpm;
  var best = -Infinity, bestBpm = startBpm;
  for (var lag = 1; lag < winLen; lag++) {
    var bpm = 60 * fps / lag;
    if (bpm >= maxTempo) continue;
    var tg = Math.max(0, acc[lag] / cnt);
    var sc = Math.log1p(1e6 * tg) - 0.5 * Math.pow((Math.log2(bpm) - Math.log2(startBpm)) / stdBpm, 2);
    if (sc > best) { best = sc; bestBpm = bpm; }
  }
  return bestBpm;
}
function beatTrackDP(onset, fps, bpm, tightness) {
  var n = onset.length;
  if (n < 4) return [];
  var period = Math.round(60 * fps / bpm);
  var sd = stdOf(onset, 1) + 1e-12;
  var norm = new Float64Array(n), i, j;
  for (i = 0; i < n; i++) norm[i] = onset[i] / sd;
  var W = 2 * period + 1, win = new Float64Array(W);
  for (j = 0; j < W; j++) { var z = (j - period) * 32 / period; win[j] = Math.exp(-0.5 * z * z); }
  var local = new Float64Array(n);
  for (i = 0; i < n; i++) {
    var s = 0;
    for (j = 0; j < W; j++) { var idx = i - j + period; if (idx >= 0 && idx < n) s += norm[idx] * win[j]; }
    local[i] = s;
  }
  var lmax = 0; for (i = 0; i < n; i++) if (local[i] > lmax) lmax = local[i];
  var thresh = 0.01 * lmax;
  var dMin = Math.round(period / 2), dMax = 2 * period;
  var tx = new Float64Array(dMax + 1);
  for (var d = dMin; d <= dMax; d++) { var lg = Math.log(d) - Math.log(period); tx[d] = -tightness * lg * lg; }
  var cum = new Float64Array(n), back = new Int32Array(n), first = true;
  for (i = 0; i < n; i++) {
    var best = -Infinity, loc = -1;
    for (var dd = dMin; dd <= dMax; dd++) {
      var l = i - dd; if (l < 0) break;
      var sc = cum[l] + tx[dd];
      if (sc > best) { best = sc; loc = l; }
    }
    cum[i] = loc >= 0 ? local[i] + best : local[i];
    if (first && local[i] < thresh) back[i] = -1;
    else { back[i] = loc; first = false; }
  }
  // last beat: last local max of cumscore above half the median local-max score
  var maxima = [];
  for (i = 1; i < n - 1; i++) if (cum[i] > cum[i - 1] && cum[i] >= cum[i + 1]) maxima.push(i);
  if (!maxima.length) return [];
  var med = percentile(maxima.map(function (k) { return cum[k]; }), 50);
  var last = maxima[maxima.length - 1];
  for (var q = maxima.length - 1; q >= 0; q--) if (cum[maxima[q]] >= 0.5 * med) { last = maxima[q]; break; }
  var beats = [last];
  while (back[beats[beats.length - 1]] >= 0) beats.push(back[beats[beats.length - 1]]);
  beats.reverse();
  // trim weak leading/trailing beats (librosa _trim_beats)
  var hw = [0, 0.5, 1, 0.5, 0], nb = beats.length, sm = new Float64Array(nb), ms = 0;
  for (i = 0; i < nb; i++) {
    var acc = 0;
    for (j = 0; j < 5; j++) { var bi = i + 2 - j; if (bi >= 0 && bi < nb) acc += local[beats[bi]] * hw[j]; }
    sm[i] = acc; ms += acc * acc;
  }
  var th = 0.5 * Math.sqrt(ms / Math.max(1, nb));
  var v0 = -1, v1 = -1;
  for (i = 0; i < nb; i++) if (sm[i] > th) { if (v0 < 0) v0 = i; v1 = i; }
  if (v0 < 0) return beats;
  return beats.slice(v0, Math.max(v0 + 1, v1));
}
/* port of regularize_beats: one metrical level, steady grid snapped to detections */
function regularizeBeats(beats, duration, minBpm, maxBpm) {
  if (beats.length < 8) return beats.slice();
  var lib = [];
  for (var i = 1; i < beats.length; i++) lib.push(Math.log2(Math.max(1e-3, beats[i] - beats[i - 1])));
  var lo = Math.min.apply(null, lib), hi = Math.max.apply(null, lib), nb = 60, h = new Int32Array(nb);
  var wdt = (hi - lo) / nb || 1e-9;
  lib.forEach(function (v) { h[Math.min(nb - 1, Math.floor((v - lo) / wdt))]++; });
  var k = 0; for (var q = 1; q < nb; q++) if (h[q] > h[k]) k = q;
  var T = Math.pow(2, lo + (k + 0.5) * wdt);
  var bpm = 60 / T;
  if (bpm > maxBpm) T *= 2; else if (bpm < minBpm) T /= 2;
  var det = beats, start = beats[0], grid = [start], curT = T, t = start;
  function nearestIn(pred, tol) {
    var a = lowerBound(det, pred - tol), best = -1, bd = 1e9;
    for (var j = a; j < det.length && det[j] < pred + tol; j++) {
      if (det[j] > pred - tol) { var dd = Math.abs(det[j] - pred); if (dd < bd) { bd = dd; best = det[j]; } }
    }
    return best;
  }
  for (;;) {
    var pred = t + curT;
    if (pred > duration - 0.05) break;
    var nbv = nearestIn(pred, 0.22 * curT);
    if (nbv >= 0) curT = clip(0.85 * curT + 0.15 * (nbv - t), T * 0.8, T * 1.25);
    else nbv = pred;
    grid.push(nbv); t = nbv;
  }
  t = start;
  var backArr = [];
  while (t - T > 0) {
    var pr = t - T, nv = nearestIn(pr, 0.22 * T);
    if (nv < 0) nv = pr;
    backArr.push(nv); t = nv;
  }
  return backArr.sort(function (a, b) { return a - b; }).concat(grid);
}

/* ------------------------------------------------------------------ drum hits (port of drum_hits on the percussive part) */
function drumHits(P, cfg) {
  var T = P.T, hopT = P.hopT, bdb = P.bdb;
  var on = pickPeaks(P.fluxBroad, hopT, 0.045, cfg.kBroad || 1.3);
  var names = ['low', 'lowmid', 'mid', 'high'], ref = {};
  names.forEach(function (k) { ref[k] = percentile(bdb[k], 98); });
  var out = { kick: [[], []], snare: [[], []], hats: [[], []] };
  var pre = Math.max(1, cfg.preFrames || Math.floor(0.03 / hopT)), post = Math.max(1, Math.floor(0.05 / hopT));
  function rmax(v, a, b) { var m = -Infinity; for (var i = a; i < b; i++) if (v[i] > m) m = v[i]; return m; }
  function rmin(v, a, b) { var m = Infinity; for (var i = a; i < b; i++) if (v[i] < m) m = v[i]; return m; }
  var th = cfg.drumTh;
  for (var q = 0; q < on.t.length; q++) {
    var i = on.idx[q], t = on.t[q];
    var a = Math.max(0, i - pre), b = Math.min(T, i + post);
    if (b <= a + 1 || i >= T) continue;
    var rise = {}, lvl = {};
    for (var z = 0; z < 4; z++) {
      var k = names[z], v = bdb[k], mx = rmax(v, i, b);
      rise[k] = mx - rmin(v, a, Math.max(a + 1, i - 1));
      lvl[k] = mx - ref[k];
    }
    var isKick = rise.low > th.kickRise && lvl.low > th.kickLvl;
    // snare/clap: strong mid band near its loudest, body in low-mids, and mid not far below the highs (hats are all highs)
    var isSnare = rise.mid > th.snMidRise && lvl.mid > th.snMidLvl && rise.lowmid > th.snLmRise && lvl.lowmid > th.snLmLvl &&
      lvl.mid >= lvl.high - 6;
    var isHat = (!isSnare) && rise.high > th.hatRise && lvl.high > th.hatLvl;
    if (isKick) { out.kick[0].push(t); out.kick[1].push(clip(1 + lvl.low / 14, 0.15, 1)); }
    if (isSnare) { out.snare[0].push(t); out.snare[1].push(clip(1 + lvl.mid / 14, 0.15, 1)); }
    if (isHat) { out.hats[0].push(t); out.hats[1].push(clip(1 + lvl.high / 14, 0.15, 1)); }
  }
  // sub-band kick pass (kicks merged into a clap/hat onset), snapped back to the broadband onset
  var lf = P.fluxLow, lgate = new Float64Array(T);
  for (var u = 0; u < T; u++) lgate[u] = bdb.low[u] > ref.low - 8 ? lf[u] : 0;
  var kp = pickPeaks(lgate, hopT, 0.09, 1.5);
  var havek = out.kick[0].slice().sort(function (x, y) { return x - y; });
  for (var r = 0; r < kp.t.length; r++) {
    var ii = kp.idx[r], tt = kp.t[r];
    var aa = Math.max(0, ii - pre), bb = Math.min(T, ii + post);
    if (bb <= aa + 1) continue;
    var riseLow = rmax(bdb.low, ii, bb) - rmin(bdb.low, aa, Math.max(aa + 1, ii - 1));
    var bestP = -1, bd = 1e9;
    for (var c = 0; c < on.t.length; c++) {
      var ot = on.t[c];
      if (ot >= tt - 0.09 && ot <= tt + 0.01) { var dd = Math.abs(ot - (tt - 0.05)); if (dd < bd) { bd = dd; bestP = ot; } }
    }
    if (bestP >= 0) tt = bestP;
    var ni = nearestIdx(havek, tt);
    if (riseLow > th.kick2Rise && (ni < 0 || Math.abs(havek[ni] - tt) > 0.09)) {
      havek.splice(lowerBound(havek, tt), 0, tt);
      out.kick[0].push(tt); out.kick[1].push(clip(1 + (rmax(bdb.low, ii, bb) - ref.low) / 14, 0.15, 1));
    }
  }
  // quiet hats: high-band-only pass
  var hf = P.fluxHigh, hg = new Float64Array(T);
  for (var e = 0; e < T; e++) hg[e] = bdb.high[e] > ref.high - 22 ? hf[e] : 0;
  var hp = pickPeaks(hg, hopT, 0.05, th.hatK2);
  var have = out.hats[0].concat(out.snare[0]).sort(function (x, y) { return x - y; });
  for (var g = 0; g < hp.t.length; g++) {
    var ht = hp.t[g], nh = nearestIdx(have, ht);
    if (nh < 0 || Math.abs(have[nh] - ht) > 0.03) { out.hats[0].push(ht); out.hats[1].push(clip(hp.s[g], 0.15, 1)); }
  }
  var res = {};
  Object.keys(out).forEach(function (k) {
    var ts = out[k][0], ss = out[k][1], o = ts.map(function (_, ix) { return ix; }).sort(function (x, y) { return ts[x] - ts[y]; });
    res[k] = { t: o.map(function (ix) { return Math.max(0, ts[ix] - cfg.drumLatency); }), s: o.map(function (ix) { return ss[ix]; }) };
  });
  return res;
}

/* ------------------------------------------------------------------ key */
var KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
var KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
var NOTES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
function corr(a, b) {
  var n = a.length, ma = meanOf(a), mb = meanOf(b), sab = 0, saa = 0, sbb = 0;
  for (var i = 0; i < n; i++) { var x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
  return sab / Math.sqrt(saa * sbb + 1e-30);
}
function keyEstimate(cm) {
  var best = -9, name = 'C major';
  for (var i = 0; i < 12; i++) {
    [['major', KS_MAJOR], ['minor', KS_MINOR]].forEach(function (pr) {
      var rolled = new Array(12);
      for (var j = 0; j < 12; j++) rolled[j] = pr[1][((j - i) % 12 + 12) % 12];
      var r = corr(rolled, cm);
      if (r > best) { best = r; name = NOTES[i] + ' ' + pr[0]; }
    });
  }
  return name;
}

/* ------------------------------------------------------------------ meter + downbeats */
function zscore(a) {
  var m = meanOf(a), s = stdOf(a, 0) + 1e-9, o = new Float64Array(a.length);
  for (var i = 0; i < a.length; i++) o[i] = (a[i] - m) / s;
  return o;
}
function eventStrengthAt(ev, times, tolLo, tolHi) {
  var o = new Float64Array(times.length);
  for (var i = 0; i < times.length; i++) {
    var a = lowerBound(ev.t, times[i] - tolLo), m = 0;
    for (var j = a; j < ev.t.length && ev.t[j] <= times[i] + tolHi; j++) if (ev.s[j] > m) m = ev.s[j];
    o[i] = m;
  }
  return o;
}
function seriesMaxAt(series, hopT, times, lo, hi) {
  var o = new Float64Array(times.length), T = series.length;
  for (var i = 0; i < times.length; i++) {
    var a = Math.max(0, Math.floor((times[i] - lo) / hopT)), b = Math.min(T - 1, Math.ceil((times[i] + hi) / hopT)), m = 0;
    for (var j = a; j <= b; j++) if (series[j] > m) m = series[j];
    o[i] = m;
  }
  return o;
}
/* mean chroma vector (12) of frames in [t0, t1) */
function chromaSpan(C, TB, hopT, t0, t1) {
  var a = clip(Math.floor(t0 / hopT), 0, TB - 1), b = clip(Math.floor(t1 / hopT), a + 1, TB), v = new Float64Array(12);
  for (var f = a; f < b; f++) for (var p = 0; p < 12; p++) v[p] += C[f * 12 + p];
  return v;
}
function cosDist(a, b) {
  var ab = 0, aa = 0, bb = 0;
  for (var i = 0; i < a.length; i++) { ab += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  if (aa < 1e-12 || bb < 1e-12) return 0;
  return 1 - ab / Math.sqrt(aa * bb);
}
function detectMeter(beats, F, cfg, dbg) {
  var nb = beats.length;
  if (nb < 12) return { bpb: 4, phase: 0, downIdx: beats.map(function (_, i) { return i; }).filter(function (i) { return i % 4 === 0; }) };
  var kick = eventStrengthAt(F.kick, beats, 0.06, 0.06);
  var snare = eventStrengthAt(F.snare, beats, 0.06, 0.06);
  var bassOn = seriesMaxAt(F.bassOnset, F.hopA, beats, 0.05, 0.08);
  var mixOn = seriesMaxAt(F.mixOnset, F.hopA, beats, 0.04, 0.06);
  var chg = new Float64Array(nb), bchg = new Float64Array(nb);
  for (var i = 0; i < nb; i++) {
    var t0 = i > 0 ? beats[i - 1] : Math.max(0, beats[i] - (beats[1] - beats[0]));
    var t2 = i < nb - 1 ? beats[i + 1] : beats[i] + (beats[i] - beats[i - 1]);
    // compare one beat before vs one beat after (skip 60 ms around the beat itself)
    chg[i] = cosDist(chromaSpan(F.chroma, F.TB, F.hopB, t0, beats[i] - 0.03), chromaSpan(F.chroma, F.TB, F.hopB, beats[i] + 0.03, t2));
    bchg[i] = cosDist(chromaSpan(F.bassChroma, F.TB, F.hopB, t0, beats[i] - 0.03), chromaSpan(F.bassChroma, F.TB, F.hopB, beats[i] + 0.03, t2));
  }
  var w = cfg.meterW;
  var feats = { kick: zscore(kick), snare: zscore(snare), bassOn: zscore(bassOn), mixOn: zscore(mixOn), chg: zscore(chg), bchg: zscore(bchg) };
  if (!F.drumsPresent) { feats.kick = new Float64Array(nb); feats.snare = new Float64Array(nb); }
  var D = new Float64Array(nb);
  for (var j = 0; j < nb; j++) {
    D[j] = w.kick * feats.kick[j] - w.snare * feats.snare[j] + w.bassOn * feats.bassOn[j] + w.mixOn * feats.mixOn[j] +
      w.chg * feats.chg[j] + w.bchg * feats.bchg[j];
  }
  function phaseScores(M, arr) {
    var sc = [];
    for (var ph = 0; ph < M; ph++) {
      var s = 0, c = 0;
      for (var k = ph; k < nb; k += M) { s += arr[k]; c++; }
      sc.push(c ? s / c : 0);
    }
    return sc;
  }
  // meter: per-phase contrast of downbeat salience + periodicity of beat-synchronous features
  var res = {};
  // bar-scale evidence (idea from SequenceStarter): harmony and sound change most across a real bar line,
  // so compare the whole bar before each beat with the whole bar after it.
  function barChange(M) {
    var ch = new Float64Array(nb), tb = new Float64Array(nb);
    for (var i = M; i + M < nb; i++) {
      ch[i] = cosDist(chromaSpan(F.chroma, F.TB, F.hopB, beats[i - M], beats[i]), chromaSpan(F.chroma, F.TB, F.hopB, beats[i], beats[i + M]));
      if (F.secFeat) { var a0 = Math.round(beats[i - M] / F.hopB), a1 = Math.round(beats[i] / F.hopB), b1 = Math.round(beats[i + M] / F.hopB), dsum = 0;
        for (var d = 12; d < 24; d++) { var ma = 0, mb = 0; for (var f = a0; f < a1; f++) ma += F.secFeat[f * F.secDim + d]; for (var f2 = a1; f2 < b1; f2++) mb += F.secFeat[f2 * F.secDim + d]; ma /= Math.max(1, a1 - a0); mb /= Math.max(1, b1 - a1); dsum += (ma - mb) * (ma - mb); }
        tb[i] = Math.sqrt(dsum); }
    }
    return { ch: zscore(ch), tb: zscore(tb) };
  }
  var DM = {};
  [3, 4].forEach(function (M) {
    var bc = barChange(M), Dm = new Float64Array(nb);
    for (var j2 = 0; j2 < nb; j2++) Dm[j2] = D[j2] + (cfg.barChordW || 1.6) * bc.ch[j2] + (cfg.barTimbreW || 0.8) * bc.tb[j2];
    DM[M] = Dm;
    var sc = phaseScores(M, Dm), bi = 0;
    for (var p = 1; p < M; p++) if (sc[p] > sc[bi]) bi = p;
    var others = 0; for (var p2 = 0; p2 < M; p2++) if (p2 !== bi) others += sc[p2];
    others /= (M - 1);
    res[M] = { scores: sc, phase: bi, contrast: sc[bi] - others };
  });
  // periodicity: comb contrast of beat-synchronous chroma self-similarity
  var BC = [];
  for (var b = 0; b < nb; b++) {
    var t1 = b < nb - 1 ? beats[b + 1] : beats[b] + 0.5;
    var v = chromaSpan(F.chroma, F.TB, F.hopB, beats[b], t1), vb = chromaSpan(F.bassChroma, F.TB, F.hopB, beats[b], t1);
    var acc = [], nrm = 0, nrm2 = 0;
    for (var q = 0; q < 12; q++) { nrm += v[q] * v[q]; nrm2 += vb[q] * vb[q]; }
    nrm = Math.sqrt(nrm) + 1e-9; nrm2 = Math.sqrt(nrm2) + 1e-9;
    for (var q2 = 0; q2 < 12; q2++) acc.push(v[q2] / nrm, 0.7 * vb[q2] / nrm2);
    acc.push(feats.mixOn[b] * 0.15, feats.bassOn[b] * 0.15, feats.kick[b] * 0.15);
    BC.push(acc);
  }
  function simLag(L) {
    var s = 0, c = 0;
    for (var a = 0; a + L < nb; a++) {
      var x = BC[a], y = BC[a + L], ab = 0, aa = 0, bb = 0;
      for (var z = 0; z < x.length; z++) { ab += x[z] * y[z]; aa += x[z] * x[z]; bb += y[z] * y[z]; }
      s += ab / Math.sqrt(aa * bb + 1e-12); c++;
    }
    return c ? s / c : 0;
  }
  var S = [0];
  for (var L = 1; L <= 26; L++) S.push(simLag(L));
  function comb(M, other) {
    var s = 0, c = 0;
    for (var k = 1; k * M <= 24; k++) {
      var L = k * M; if (L % other === 0) continue;
      s += S[L] - 0.5 * (S[L - 1] + S[L + 1]); c++;
    }
    return c ? s / c : 0;
  }
  var comb3 = comb(3, 4), comb4 = comb(4, 3);
  var score3 = res[3].contrast + cfg.meterCombW * comb3, score4 = res[4].contrast + cfg.meterCombW * comb4;
  var M = (score3 > score4 * cfg.meter3Bias + cfg.meter3Margin) ? 3 : 4;
  if (dbg) dbg.meter = { c3: res[3].contrast, c4: res[4].contrast, comb3: comb3, comb4: comb4, score3: score3, score4: score4, S: S.slice(1, 17), sc4: res[4].scores, sc3: res[3].scores };
  // phase: global best, then local Viterbi allowing occasional re-anchoring (irregular bars)
  var phase = res[M].phase;
  var downIdx = viterbiDownbeats(DM[M], M, phase, cfg);
  return { bpb: M, phase: phase, downIdx: downIdx, D: DM[M] };
}
/* states: bar position 0..M-1 of each beat. Normal move pos -> pos+1 mod M; a bar can be cut
   short or lengthened by one beat at a penalty. Emission rewards downbeat salience at pos 0. */
function viterbiDownbeats(D, M, phase0, cfg) {
  var nb = D.length, pen = cfg.barChangePenalty, NEG = -1e18;
  var score = new Float64Array(M), next = new Float64Array(M), bp = [];
  for (var s = 0; s < M; s++) score[s] = (s === ((M - phase0) % M) ? 0 : -pen * 0.5) + (s === 0 ? D[0] : 0);
  for (var i = 1; i < nb; i++) {
    var arg = new Int8Array(M);
    for (var t = 0; t < M; t++) {
      var best = NEG, bi = 0;
      for (var f = 0; f < M; f++) {
        var tr;
        if ((f + 1) % M === t) tr = 0;
        else if (t === 0 || f === t) tr = -pen;     // cut a bar short / hold a position (lengthen)
        else tr = NEG;
        var v = score[f] + tr;
        if (v > best) { best = v; bi = f; }
      }
      next[t] = best + (t === 0 ? D[i] : 0);
      arg[t] = bi;
    }
    bp.push(arg);
    score.set(next);
  }
  var st = 0; for (var s2 = 1; s2 < M; s2++) if (score[s2] > score[st]) st = s2;
  var pos = new Int8Array(nb); pos[nb - 1] = st;
  for (var k = nb - 1; k > 0; k--) { st = bp[k - 1][st]; pos[k - 1] = st; }
  var down = [];
  for (var q = 0; q < nb; q++) if (pos[q] === 0) down.push(q);
  return down;
}
/* port of bar_positions with a fixed beats-per-bar */
function barPositions(nb, downIdx, bpb) {
  var pos = new Array(nb).fill(0), bar = new Array(nb).fill(0);
  if (!downIdx.length) { for (var i = 0; i < nb; i++) { pos[i] = i % bpb + 1; bar[i] = Math.floor(i / bpb); } return { pos: pos, bar: bar }; }
  var first = downIdx[0], set = new Set(downIdx), b = -1, count = 0;
  for (var j = 0; j < first; j++) { var k = first - j; pos[j] = (((bpb - k) % bpb) + bpb) % bpb + 1; bar[j] = -1; }
  for (var q = first; q < nb; q++) {
    if (set.has(q) || count >= bpb) { b++; count = 0; }
    count++; pos[q] = count; bar[q] = b;
  }
  return { pos: pos, bar: bar };
}

/* ------------------------------------------------------------------ sections (port of sections()) */
function sectionsPort(F, beats, downbeats, energyEnv, fps, duration) {
  if (beats.length < 16) return [{ start: 0, end: r3(duration), energy: 0.5, level: 1, label: 'A', drop: false }];
  var TB = F.TB, D = F.secDim, X = F.secFeat, hopB = F.hopB;
  // librosa.util.sync boundaries
  var bf = beats.map(function (b) { return clip(Math.floor(b / hopB + 1e-9), 0, TB); });
  var idx = Array.from(new Set([0].concat(bf, [TB]))).sort(function (a, b) { return a - b; });
  var nseg = idx.length - 1, Fs = [];
  var tmp = new Float64Array(TB);
  for (var d = 0; d < D; d++) {
    var row = new Float64Array(nseg);
    for (var s = 0; s < nseg; s++) {
      var a = idx[s], b = idx[s + 1], L = b - a;
      for (var f = 0; f < L; f++) tmp[f] = X[(a + f) * D + d];
      var sub = tmp.subarray(0, L); sub.sort();
      row[s] = L % 2 ? sub[L >> 1] : 0.5 * (sub[L / 2 - 1] + sub[L / 2]);
    }
    var m = meanOf(row), sd = stdOf(row, 0) + 1e-6;
    for (var s2 = 0; s2 < nseg; s2++) row[s2] = (row[s2] - m) / sd;
    Fs.push(row);
  }
  var n = nseg, Xn = new Float64Array(n * D);
  for (var c = 0; c < n; c++) {
    var nn = 0; for (var d2 = 0; d2 < D; d2++) nn += Fs[d2][c] * Fs[d2][c];
    nn = Math.sqrt(nn) + 1e-9;
    for (var d3 = 0; d3 < D; d3++) Xn[c * D + d3] = Fs[d3][c] / nn;
  }
  var SSM = new Float64Array(n * n);
  for (var i = 0; i < n; i++) for (var j = i; j < n; j++) {
    var v = 0; for (var d4 = 0; d4 < D; d4++) v += Xn[i * D + d4] * Xn[j * D + d4];
    SSM[i * n + j] = v; SSM[j * n + i] = v;
  }
  var Lk = 8, K2 = 2 * Lk, K = new Float64Array(K2 * K2);
  for (var u = 0; u < K2; u++) for (var w = 0; w < K2; w++) {
    var gu = u < Lk ? -1 : 1, gw = w < Lk ? -1 : 1;
    var xu = -2 + 4 * u / (K2 - 1), xw = -2 + 4 * w / (K2 - 1);
    K[u * K2 + w] = gu * gw * Math.exp(-0.5 * (xu * xu + xw * xw));
  }
  var nov = new Float64Array(n), nmax = 0;
  for (var p = 0; p < n; p++) {
    var acc = 0;
    for (var u2 = 0; u2 < K2; u2++) {
      var r = clip(p + u2 - Lk, 0, n - 1);
      for (var w2 = 0; w2 < K2; w2++) acc += SSM[r * n + clip(p + w2 - Lk, 0, n - 1)] * K[u2 * K2 + w2];
    }
    nov[p] = Math.max(0, acc); if (nov[p] > nmax) nmax = nov[p];
  }
  for (var p2 = 0; p2 < n; p2++) nov[p2] /= (nmax + 1e-9);
  var bpb = 4, minDist = 4 * bpb;
  var order = Array.from(nov, function (_, k) { return k; }).sort(function (a, b) { return nov[b] - nov[a]; });
  var chosen = [];
  for (var o = 0; o < order.length; o++) {
    var ci = order[o];
    if (nov[ci] < 0.12) break;
    if (chosen.every(function (cc) { return Math.abs(ci - cc) >= minDist; }) && ci > bpb && ci < n - bpb) chosen.push(ci);
  }
  var bset = new Set([0, duration]);
  chosen.forEach(function (cc) {
    var tb = beats[Math.min(cc, beats.length - 1)];
    if (downbeats.length) { var di = nearestIdx(downbeats, tb); bset.add(downbeats[di]); } else bset.add(tb);
  });
  var bounds = Array.from(bset).sort(function (a, b) { return a - b; });
  var merged = [bounds[0]];
  for (var bi = 1; bi < bounds.length; bi++) {
    var bb = bounds[bi];
    if (bb - merged[merged.length - 1] < 6.0 && bb !== duration) continue;
    merged.push(bb);
  }
  if (merged.length > 2 && duration - merged[merged.length - 2] < 6.0) merged.splice(merged.length - 2, 1);
  var secs = [], feats = [];
  for (var q = 0; q + 1 < merged.length; q++) {
    var A = merged[q], Bq = merged[q + 1];
    var i0 = Math.floor(A * fps), i1 = Math.max(i0 + 1, Math.floor(Bq * fps));
    var e = meanOf(energyEnv, Math.min(i0, energyEnv.length - 1), Math.min(i1, energyEnv.length));
    var ia = lowerBound(beats, A), ib = Math.max(ia + 1, lowerBound(beats, Bq));
    var fv = new Float64Array(D);
    if (ia < n) {
      var e1 = Math.min(ib, n);
      for (var d5 = 0; d5 < D; d5++) fv[d5] = meanOf(Fs[d5], ia, e1);
    }
    feats.push(fv);
    secs.push({ start: r3(A), end: r3(Bq), energy: r3(e) });
  }
  var es = secs.map(function (x) { return x.energy; }), rel;
  if (es.length > 2) {
    var lo = percentile(es, 10), hi = percentile(es, 90);
    rel = es.map(function (x) { return clip((x - lo) / (hi - lo + 1e-9), 0, 1); });
  } else if (es.length === 2) {
    var mn = Math.min.apply(null, es), mx = Math.max.apply(null, es);
    rel = es.map(function (x) { return (x - mn) / (mx - mn + 1e-9); });
  } else rel = [0.5];
  var spread = es.length > 1 ? Math.max.apply(null, es) - Math.min.apply(null, es) : 0;
  var trust = Math.min(1, spread / 0.25);
  secs.forEach(function (sx, k) {
    var vv = trust * (0.65 * rel[k] + 0.35 * sx.energy) + (1 - trust) * sx.energy;
    sx.level = clip(roundHalfEven(vv * 3), 0, 3);
  });
  var protos = [];
  secs.forEach(function (sx, k) {
    var f = feats[k], nrm = 0;
    for (var z = 0; z < D; z++) nrm += f[z] * f[z];
    nrm = Math.sqrt(nrm) + 1e-9;
    var fn = Array.from(f, function (x) { return x / nrm; }), best = -1, bj = -1;
    protos.forEach(function (pp, jj) {
      var cc = 0; for (var z2 = 0; z2 < D; z2++) cc += fn[z2] * pp[z2];
      if (cc > best) { best = cc; bj = jj; }
    });
    if (best > 0.8) sx.label = String.fromCharCode(65 + bj);
    else { protos.push(fn); sx.label = String.fromCharCode(65 + protos.length - 1); }
  });
  secs.forEach(function (sx, k) {
    var prev = k ? secs[k - 1].level : 0;
    sx.drop = k > 0 && sx.level >= 2 && sx.level - prev >= 2;
  });
  return secs.map(function (sx) { return { start: sx.start, end: sx.end, energy: sx.energy, level: sx.level, label: sx.label, drop: sx.drop }; });
}


/* ------------------------------------------------------------------ sections at bar level, with part names
   Ideas borrowed from SequenceStarter (GPL; re-implemented here, no code copied): judge boundaries per bar,
   add a loudness-change term, favour 4-bar phrase lines, label repeats from a 2-bar embedding, then name
   the parts (Intro / Verse / Chorus / Pre-Chorus / Bridge / Break / Outro). */
function sectionsBars(F, beats, downbeats, energyEnv, fps, duration, fixedStarts) {
  var TB = F.TB, D = F.secDim, X = F.secFeat, hopB = F.hopB;
  var lines = downbeats.slice(); if (!lines.length) return null;
  if (lines[0] > 0.05) lines.unshift(0);
  lines.push(duration);
  var nBars = lines.length - 1;
  if (nBars < 8) return null;
  function fr(t) { return clip(Math.round(t / hopB), 0, TB - 1); }
  var feats = [], db = [];
  for (var b = 0; b < nBars; b++) {
    var f0 = fr(lines[b]), f1 = Math.max(f0 + 1, fr(lines[b + 1])), n = f1 - f0;
    var v = new Float64Array(25);
    for (var f = f0; f < f1; f++) for (var d = 0; d < 25; d++) v[d] += X[f * D + d] / n;
    var cn = 0; for (var c = 0; c < 12; c++) cn += v[c] * v[c]; cn = Math.sqrt(cn) || 1;
    var o = []; for (var c2 = 0; c2 < 12; c2++) o.push(v[c2] / cn);
    for (var m = 12; m < 24; m++) o.push(v[m]);
    feats.push(o); db.push(v[24] * 20);
  }
  // z-score timbre dims, weight 0.3
  for (var dd = 12; dd < 24; dd++) {
    var mu = 0, sd = 0; feats.forEach(function (o) { mu += o[dd]; }); mu /= nBars;
    feats.forEach(function (o) { sd += (o[dd] - mu) * (o[dd] - mu); }); sd = Math.sqrt(sd / nBars) || 1;
    feats.forEach(function (o) { o[dd] = 0.3 * (o[dd] - mu) / sd; });
  }
  function ssm(V) {
    var N = V.length, Dm = [], all = [];
    for (var i = 0; i < N; i++) { Dm.push(new Float64Array(N)); }
    for (var i2 = 0; i2 < N; i2++) for (var j = i2; j < N; j++) { var q = 0; for (var k = 0; k < V[i2].length; k++) { var e = V[i2][k] - V[j][k]; q += e * e; } Dm[i2][j] = q; Dm[j][i2] = q; if (j > i2) all.push(q); }
    all.sort(function (a, b2) { return a - b2; }); var s2 = all[all.length >> 1] || 1;
    for (var i3 = 0; i3 < N; i3++) for (var j2 = 0; j2 < N; j2++) Dm[i3][j2] = Math.exp(-Dm[i3][j2] / s2);
    return Dm;
  }
  var Sb = ssm(feats);
  var S2 = ssm(feats.map(function (o, i) { return o.concat(feats[Math.min(nBars - 1, i + 1)]); }));
  var K = Math.min(4, Math.floor(nBars / 4)), nov = new Float64Array(nBars);
  for (var i = 1; i < nBars; i++) {
    var sum = 0, wsum = 0;
    for (var a = -K; a < K; a++) for (var bb = -K; bb < K; bb++) {
      var ia = i + a, ib = i + bb; if (ia < 0 || ib < 0 || ia >= nBars || ib >= nBars) continue;
      var g = Math.exp(-((a + 0.5) * (a + 0.5) + (bb + 0.5) * (bb + 0.5)) / (2 * (K / 2) * (K / 2)));
      sum += ((a < 0) === (bb < 0) ? 1 : -1) * g * Sb[ia][ib]; wsum += g;
    }
    nov[i] = wsum ? Math.max(0, sum / wsum) : 0;
  }
  var loud = new Float64Array(nBars);
  for (var i4 = 2; i4 < nBars - 1; i4++) loud[i4] = Math.abs((db[i4] + db[i4 + 1]) / 2 - (db[i4 - 1] + db[i4 - 2]) / 2);
  var nm = Math.max.apply(null, nov) || 1, lm = Math.max.apply(null, loud) || 1, score = new Float64Array(nBars);
  for (var i5 = 0; i5 < nBars; i5++) score[i5] = nov[i5] / nm + 0.5 * loud[i5] / lm;
  var ph = [0, 1, 2, 3].map(function (q) { var t = 0; for (var i6 = q; i6 < nBars; i6 += 4) t += score[i6]; return t; });
  var q0 = ph.indexOf(Math.max.apply(null, ph));
  for (var i7 = 0; i7 < nBars; i7++) if (((i7 - q0) % 4 + 4) % 4 === 0) score[i7] *= 1.25;
  var mean = 0; for (var i8 = 0; i8 < nBars; i8++) mean += score[i8] / nBars;
  var cands = []; for (var i9 = 2; i9 < nBars - 2; i9++) if (score[i9] >= score[i9 - 1] && score[i9] >= score[i9 + 1]) cands.push(i9);
  cands.sort(function (x, y) { return score[y] - score[x]; });
  var maxSec = Math.max(4, Math.min(16, Math.round(duration / 15))), chosen = [];
  for (var ci = 0; ci < cands.length; ci++) { var c3 = cands[ci]; if (score[c3] < mean || chosen.length >= maxSec - 1) break; if (chosen.some(function (x) { return Math.abs(x - c3) < 4; })) continue; chosen.push(c3); }
  chosen.sort(function (x, y) { return x - y; });
  if (fixedStarts) { // boundaries from the beat-level novelty (agrees best with the stem-based studio analyzer); bars only name and label them
    chosen = Array.from(new Set(fixedStarts.slice(1).map(function (t) { var bi = 0, bd = 1e9; for (var k = 0; k <= nBars; k++) { var dd2 = Math.abs(lines[k] - t); if (dd2 < bd) { bd = dd2; bi = k; } } return bi; })))
      .filter(function (x) { return x > 0 && x < nBars; }).sort(function (x, y) { return x - y; });
  }
  var starts = [0].concat(chosen), segs = starts.map(function (b0, k) { return { b0: b0, b1: k + 1 < starts.length ? starts[k + 1] : nBars }; });
  function segSim(A, B) { var len = Math.min(A.b1 - A.b0, B.b1 - B.b0), best = 0; for (var sh = -1; sh <= 1; sh++) { var t = 0, c = 0; for (var k = 0; k < len; k++) { var x = A.b0 + k, y = B.b0 + k + sh; if (y < B.b0 || y >= B.b1) continue; t += S2[x][y]; c++; } if (c) best = Math.max(best, t / c); } return best; }
  var sims = []; for (var u = 0; u < segs.length; u++) for (var w = 0; w < u; w++) sims.push(segSim(segs[w], segs[u]));
  var smu = sims.length ? meanOf(sims) : 0, ssd = sims.length ? stdOf(sims, 0) : 0, thr = Math.max(0.45, smu + 0.6 * ssd), next = 0;
  segs.forEach(function (sg, k) { var best = -1, bs = thr; for (var j = 0; j < k; j++) { var v2 = segSim(segs[j], sg); if (v2 > bs) { bs = v2; best = j; } } sg.label = best >= 0 ? segs[best].label : String.fromCharCode(65 + next++); });
  // loudness per part: relative within the song, trusted only if parts really differ
  segs.forEach(function (sg) { var t = 0; for (var k = sg.b0; k < sg.b1; k++) t += Math.pow(10, db[k] / 10); sg.db = 10 * Math.log10(t / (sg.b1 - sg.b0) + 1e-12);
    var t0 = lines[sg.b0], t1 = lines[sg.b1], i0 = Math.floor(t0 * fps), i1 = Math.max(i0 + 1, Math.floor(t1 * fps)), e = 0; for (var k2 = i0; k2 < i1 && k2 < energyEnv.length; k2++) e += energyEnv[k2]; sg.abs = e / (i1 - i0); });
  var lo = Math.min.apply(null, segs.map(function (x) { return x.db; })), hi = Math.max.apply(null, segs.map(function (x) { return x.db; }));
  var trust = Math.min(1, (hi - lo) / 6);
  segs.forEach(function (sg) { sg.rel = hi > lo ? (sg.db - lo) / (hi - lo) : 0.5; sg.energy = trust * sg.rel + (1 - trust) * sg.abs; sg.level = clip(Math.round(sg.energy * 3), 0, 3); });
  // names
  var byL = {}; segs.forEach(function (sg) { (byL[sg.label] = byL[sg.label] || []).push(sg); });
  var rep = Object.keys(byL).filter(function (l) { return byL[l].length > 1; });
  var avgE = function (l) { return byL[l].reduce(function (a2, x) { return a2 + x.energy; }, 0) / byL[l].length; };
  var chorus = null, verse = null;
  if (rep.length) { chorus = rep.reduce(function (a2, b2) { return avgE(b2) > avgE(a2) + 0.02 ? b2 : a2; });
    var others = rep.filter(function (l) { return l !== chorus && avgE(l) <= avgE(chorus); });
    if (others.length) verse = others.reduce(function (a2, b2) { return segs.indexOf(byL[b2][0]) < segs.indexOf(byL[a2][0]) ? b2 : a2; }); }
  var firstCh = segs.findIndex(function (x) { return x.label === chorus; });
  segs.forEach(function (sg, k) {
    var nb = sg.b1 - sg.b0, single = byL[sg.label].length === 1;
    if (sg.label === chorus) sg.kind = 'Chorus';
    else if (sg.label === verse) sg.kind = 'Verse';
    else if (k === 0 && (single || sg.energy < 0.4) && nb <= 12) sg.kind = 'Intro';
    else if (k === segs.length - 1 && (single || sg.energy < 0.5)) sg.kind = 'Outro';
    else if (k + 1 < segs.length && segs[k + 1].label === chorus && nb <= 8) sg.kind = 'Pre-Chorus';
    else if (sg.energy < 0.25) sg.kind = 'Break';
    else if (firstCh >= 0 && k > firstCh && single) sg.kind = 'Bridge';
    else sg.kind = 'Part ' + sg.label;
  });
  var cnt = {}, seen = {}; segs.forEach(function (sg) { cnt[sg.kind] = (cnt[sg.kind] || 0) + 1; });
  segs.forEach(function (sg) { seen[sg.kind] = (seen[sg.kind] || 0) + 1; sg.name = cnt[sg.kind] > 1 ? sg.kind + ' ' + seen[sg.kind] : sg.kind; });
  return segs.map(function (sg, k) {
    var prev = k ? segs[k - 1].level : sg.level;
    return { start: r3(k === 0 ? 0 : lines[sg.b0]), end: r3(k === segs.length - 1 ? duration : lines[sg.b1]), energy: r3(sg.energy), level: sg.level, label: sg.label, name: sg.name, kind: sg.kind.replace(/ [A-Z]$/, ''),
      bars: sg.b1 - sg.b0, drop: k > 0 && sg.level >= 2 && sg.level - prev >= 2 };
  });
}

/* ------------------------------------------------------------------ resampling fallback (app normally sends 22050) */
function resampleTo(x, srIn, srOut) {
  var ratio = srIn / srOut, n = Math.floor(x.length / ratio), o = new Float32Array(n);
  var src = x;
  if (ratio > 1) { // crude anti-alias: moving average over the decimation span
    var w = Math.max(1, Math.round(ratio)), cs = new Float64Array(x.length + 1);
    for (var i = 0; i < x.length; i++) cs[i + 1] = cs[i] + x[i];
    src = new Float32Array(x.length);
    for (var j = 0; j < x.length; j++) { var a = Math.max(0, j - (w >> 1)), b = Math.min(x.length, a + w); src[j] = (cs[b] - cs[a]) / (b - a); }
  }
  for (var k = 0; k < n; k++) {
    var p = k * ratio, q = Math.floor(p), f = p - q;
    o[k] = q + 1 < src.length ? src[q] * (1 - f) + src[q + 1] * f : src[Math.min(q, src.length - 1)];
  }
  return o;
}

/* ================================================================== main */
function analyzeAudio(mono, sr, opts) {
  opts = opts || {};
  var cfg = Object.assign({}, GDV_CFG, {
    drumTh: { kickRise: 8, kickLvl: -12, snMidRise: 6, snMidLvl: -11, snLmRise: 3, snLmLvl: -16, snHighSlack: 2, hatRise: 4, hatLvl: -16, kick2Rise: 14, hatK2: 1.4 },
    meterW: { kick: 1.0, snare: 0.5, bassOn: 0.8, mixOn: 0.3, chg: 0.8, bchg: 0.8 },
    meterCombW: 2.0, meter3Bias: 1.0, meter3Margin: 0.1, barChangePenalty: 6.0,
  }, opts.cfg || {});
  var progress = function (f, label) { if (typeof opts.onProgress === 'function') { try { opts.onProgress(f, label); } catch (e) { /* ignore */ } } };
  var tStart = Date.now();
  var x = mono instanceof Float32Array ? mono : Float32Array.from(mono || []);
  sr = sr || GDV_SR;
  if (sr !== GDV_SR) { x = resampleTo(x, sr, GDV_SR); sr = GDV_SR; }
  var nameIn = opts.name || 'song';
  var base = String(nameIn).split(/[\\/]/).pop();
  var song = base.replace(/\.[^.]+$/, '') || base;
  var fps = GDV_FPS, N = x.length, duration = N / sr;
  var dbg = opts.debug ? {} : null;
  if (N < sr * 0.5) {
    var nE = Math.ceil(N / (sr / fps)), zeros = new Array(nE).fill(0);
    return {
      format: 'garage-door-viz/1', song: song, source: base, duration: r3(duration), fps: fps, tempo: 120, beatsPerBar: 4, key: 'C major',
      beats: [], beatPos: [], beatBar: [], downbeats: [], beatPitch: [],
      sections: [{ start: 0, end: r3(duration), energy: 0, level: 0, label: 'A', drop: false }],
      env: { mix: zeros, drums: zeros, bass: zeros, vocals: zeros, melody: zeros, bright: zeros, energy: zeros }, vocalPitch: zeros,
      events: { kick: [], snare: [], hats: [], drums: [], bass: [], melody: [], vocals: [] },
      stats: { kick: 0, snare: 0, hats: 0, drums: 0, bass: 0, melody: 0, vocals: 0 },
    };
  }
  progress(0.02, 'spectrogram');

  /* ---------------- STFT A (1024 / 256) magnitudes */
  var nfft = cfg.nfftA, hop = cfg.hopA, BA = (nfft >> 1) + 1, hopA = hop / sr;
  var TA = 1 + Math.floor(N / hop);
  var S = new Float32Array(TA * BA);
  stftFrames(x, nfft, hop, function (t, re, im) {
    var o = t * BA;
    for (var k = 0; k < BA; k++) S[o + k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
  });
  progress(0.12, 'separating harmonic / percussive');

  /* ---------------- HPSS: horizontal (time) median per bin */
  var Hm = new Float32Array(TA * BA);
  (function () {
    var out = new Float32Array(TA), win = new Float32Array(cfg.hpssTime);
    for (var b = 0; b < BA; b++) {
      medfilt1(S, b, BA, TA, cfg.hpssTime, out, win);
      for (var t = 0; t < TA; t++) Hm[t * BA + b] = out[t];
      if ((b & 63) === 0) progress(0.12 + 0.18 * b / BA, 'separating harmonic / percussive');
    }
  })();
  progress(0.30, 'spectral features');

  /* ---------------- per-frame features from mix / percussive / harmonic power */
  var NM = cfg.nMels, melA = melFilterbank(sr, nfft, NM, 0, sr / 2);
  var mixMel = new Float32Array(TA * NM), percMel = new Float32Array(TA * NM), harmMel = new Float32Array(TA * NM);
  var binHz = sr / nfft;
  function binRange(lo, hi) { return [Math.max(0, Math.ceil(lo / binHz - 1e-9)), Math.min(BA, Math.ceil(hi / binHz - 1e-9))]; } // lo <= f < hi
  var bLow = binRange(35, 120), bLm = binRange(150, 400), bMid = binRange(1200, 5000), bHigh = binRange(7000, 16000);
  var bBroad = [Math.floor(30 / binHz) + 1, BA]; // 30 < f
  var bBass = binRange(30, 250), bMel = binRange(250, 8000), bVoc = binRange(300, 3500);
  var P = {
    T: TA, hopT: hopA,
    bdb: { low: new Float32Array(TA), lowmid: new Float32Array(TA), mid: new Float32Array(TA), high: new Float32Array(TA) },
    fluxBroad: new Float32Array(TA), fluxLow: new Float32Array(TA), fluxHigh: new Float32Array(TA),
    mixLow: new Float32Array(TA), mixLm: new Float32Array(TA), fluxMixLow: new Float32Array(TA),
  };
  var percPow = new Float32Array(TA), mixPow = new Float32Array(TA), hBass = new Float32Array(TA), hMel = new Float32Array(TA), hVoc = new Float32Array(TA);
  var centroid = new Float32Array(TA);
  (function () {
    var col = new Float32Array(BA), pm = new Float32Array(BA), winf = new Float32Array(cfg.hpssFreq);
    var pp = new Float64Array(BA), hp = new Float64Array(BA), mp = new Float64Array(BA);
    var pdb = new Float32Array(BA), prev = new Float32Array(BA), mlPrev = new Float32Array(BA);
    var tiny = 1.1754944e-38;
    for (var t = 0; t < TA; t++) {
      var o = t * BA, k;
      medfilt1(S, o, 1, BA, cfg.hpssFreq, pm, winf);
      var cNum = 0, cDen = 0, tot = 0, ptot = 0;
      for (k = 0; k < BA; k++) {
        var s = S[o + k], h = Hm[o + k], p = pm[k];
        var mxv = h > p ? h : p, mh = 0, mpk = 0;
        if (mxv >= tiny) { var h2 = h * h, p2 = p * p, den = h2 + p2; mh = h2 / den; mpk = p2 / den; }
        var s2 = s * s;
        mp[k] = s2; hp[k] = s2 * mh * mh; pp[k] = s2 * mpk * mpk;
        cNum += k * binHz * s; cDen += s; tot += s2; if (k > 0) ptot += pp[k];
      }
      centroid[t] = cDen > 1e-12 ? cNum / cDen : 0;
      mixPow[t] = tot; percPow[t] = ptot;
      applyMel(melA, mp, mixMel, t * NM); applyMel(melA, pp, percMel, t * NM); applyMel(melA, hp, harmMel, t * NM);
      var sl = 0, slm = 0, smd = 0, shi = 0;
      for (k = bLow[0]; k < bLow[1]; k++) sl += pp[k];
      for (k = bLm[0]; k < bLm[1]; k++) slm += pp[k];
      for (k = bMid[0]; k < bMid[1]; k++) smd += pp[k];
      for (k = bHigh[0]; k < bHigh[1]; k++) shi += pp[k];
      P.bdb.low[t] = 10 * Math.log10(sl + 1e-10); P.bdb.lowmid[t] = 10 * Math.log10(slm + 1e-10);
      P.bdb.mid[t] = 10 * Math.log10(smd + 1e-10); P.bdb.high[t] = 10 * Math.log10(shi + 1e-10);
      // full-mix low bands: sub-heavy kicks (808 style) are partly 'harmonic' to HPSS, so kicks are judged on the mix
      var ml = 0, mlm = 0, mfl = 0;
      for (k = bLow[0]; k < bLow[1]; k++) { ml += mp[k]; var mdb = 10 * Math.log10(mp[k] + 1e-10); if (t > 0) { var dm = mdb - mlPrev[k]; if (dm > 0) mfl += dm; } mlPrev[k] = mdb; }
      for (k = bLm[0]; k < bLm[1]; k++) mlm += mp[k];
      P.mixLow[t] = 10 * Math.log10(ml + 1e-10); P.mixLm[t] = 10 * Math.log10(mlm + 1e-10); P.fluxMixLow[t] = mfl / (bLow[1] - bLow[0]);
      var hb = 0, hmv = 0, hv = 0;
      for (k = bBass[0]; k < bBass[1]; k++) hb += hp[k];
      for (k = bMel[0]; k < bMel[1]; k++) hmv += hp[k];
      for (k = bVoc[0]; k < bVoc[1]; k++) hv += hp[k];
      hBass[t] = hb; hMel[t] = hmv; hVoc[t] = hv;
      for (k = 0; k < BA; k++) pdb[k] = 10 * Math.log10(pp[k] + 1e-10);
      if (t > 0) {
        var fb = 0, fl = 0, fh = 0, d;
        for (k = bBroad[0]; k < bBroad[1]; k++) { d = pdb[k] - prev[k]; if (d > 0) fb += d; }
        for (k = bLow[0]; k < bLow[1]; k++) { d = pdb[k] - prev[k]; if (d > 0) fl += d; }
        for (k = bHigh[0]; k < bHigh[1]; k++) { d = pdb[k] - prev[k]; if (d > 0) fh += d; }
        P.fluxBroad[t] = fb / (bBroad[1] - bBroad[0]); P.fluxLow[t] = fl / (bLow[1] - bLow[0]); P.fluxHigh[t] = fh / Math.max(1, bHigh[1] - bHigh[0]);
      }
      prev.set(pdb);
      if ((t & 1023) === 0) progress(0.30 + 0.12 * t / TA, 'spectral features');
    }
  })();
  if (dbg) dbg.P = P;
  S = null; Hm = null; // free
  progress(0.42, 'harmonic features');

  /* ---------------- STFT B (4096 / 512): chroma, bass chroma, MFCC, pitch salience */
  var nfftB = cfg.nfftB, hopBs = cfg.hopB, BB = (nfftB >> 1) + 1, hopB = hopBs / sr, binHzB = sr / nfftB;
  var TB = 1 + Math.floor(N / hopBs);
  var chroma = new Float32Array(TB * 12), bassChroma = new Float32Array(TB * 12);
  var NMB = 128, melB = melFilterbank(sr, nfftB, NMB, 0, sr / 2), melBuf = new Float32Array(TB * NMB);
  var pcIdx = new Int8Array(BB).fill(-1), pcW = new Float32Array(BB);
  for (var kb = 1; kb < BB; kb++) {
    var fq = kb * binHzB;
    if (fq < 50 || fq > 4200) continue;
    var midi = 69 + 12 * Math.log2(fq / 440), nearest = Math.round(midi), dist = Math.abs(midi - nearest);
    var wv = Math.max(0, 1 - 2 * dist);
    if (wv <= 0) continue;
    pcIdx[kb] = ((nearest % 12) + 12) % 12; pcW[kb] = wv;
  }
  var bassHi = Math.ceil(260 / binHzB);
  var vpMidi = new Float32Array(TB), vpConf = new Float32Array(TB);
  var cand = []; for (var mc = 50; mc <= 81; mc++) cand.push(mc);
  (function () {
    var mag = new Float64Array(BB), pw = new Float64Array(BB), lg = new Float64Array(BB);
    stftFrames(x, nfftB, hopBs, function (t, re, im) {
      var k, sum = 0;
      for (k = 0; k < BB; k++) { var p = re[k] * re[k] + im[k] * im[k]; pw[k] = p; mag[k] = Math.sqrt(p); sum += mag[k]; }
      applyMel(melB, pw, melBuf, t * NMB);
      var o = t * 12;
      for (k = 2; k < BB - 1; k++) {
        if (pcIdx[k] < 0) continue;
        if (mag[k] > mag[k - 1] && mag[k] >= mag[k + 1]) {
          var v = mag[k] * pcW[k];
          chroma[o + pcIdx[k]] += v;
          if (k <= bassHi) bassChroma[o + pcIdx[k]] += v;
        }
      }
      // rough lead-pitch salience: weighted harmonic sum on log-compressed magnitude
      var meanMag = sum / BB + 1e-12;
      for (k = 0; k < BB; k++) lg[k] = Math.log(1 + mag[k] / meanMag);
      var best = -1, bestM = 0, tot = 0;
      for (var c = 0; c < cand.length; c++) {
        var f0 = 440 * Math.pow(2, (cand[c] - 69) / 12), sal = 0, wgt = 1;
        for (var hh = 1; hh <= 6; hh++) {
          var kk = Math.round(hh * f0 / binHzB);
          if (kk + 1 >= BB) break;
          sal += wgt * Math.max(lg[kk - 1], lg[kk], lg[kk + 1]);
          wgt *= 0.8;
        }
        tot += sal;
        if (sal > best) { best = sal; bestM = cand[c]; }
      }
      vpMidi[t] = bestM; vpConf[t] = best / (tot / cand.length + 1e-9);
    });
  })();
  // MFCC (librosa: power_to_db(ref=1, top_db=80) + DCT-II ortho) and RMS for section features
  var secDim = 25, secFeat = new Float32Array(TB * secDim);
  (function () {
    var mx = -Infinity, i, t;
    for (i = 0; i < melBuf.length; i++) { var v = 10 * Math.log10(Math.max(1e-10, melBuf[i])); melBuf[i] = v; if (v > mx) mx = v; }
    for (i = 0; i < melBuf.length; i++) if (melBuf[i] < mx - 80) melBuf[i] = mx - 80;
    var dct = new Float64Array(13 * NMB);
    for (var c = 0; c < 13; c++) for (var m = 0; m < NMB; m++) dct[c * NMB + m] = Math.cos(Math.PI * c * (2 * m + 1) / (2 * NMB)) * (c === 0 ? Math.sqrt(1 / NMB) : Math.sqrt(2 / NMB));
    // RMS (frame 2048, centred) in dB with top_db 80
    var cs = new Float64Array(N + 1);
    for (i = 0; i < N; i++) cs[i + 1] = cs[i] + x[i] * x[i];
    var rdb = new Float64Array(TB), rmx = -Infinity;
    for (t = 0; t < TB; t++) {
      var a = Math.max(0, t * hopBs - 1024), b = Math.min(N, t * hopBs + 1024);
      var r = Math.sqrt(Math.max(0, (cs[b] - cs[a]) / 2048));
      rdb[t] = 20 * Math.log10(Math.max(1e-5, r)); if (rdb[t] > rmx) rmx = rdb[t];
    }
    for (t = 0; t < TB; t++) {
      var o = t * secDim, cmax = 0, q;
      for (q = 0; q < 12; q++) if (chroma[t * 12 + q] > cmax) cmax = chroma[t * 12 + q];
      for (q = 0; q < 12; q++) secFeat[o + q] = cmax > 1e-12 ? chroma[t * 12 + q] / cmax : 0;
      for (var c2 = 1; c2 < 13; c2++) {
        var s = 0;
        for (var m2 = 0; m2 < NMB; m2++) s += dct[c2 * NMB + m2] * melBuf[t * NMB + m2];
        secFeat[o + 12 + c2 - 1] = s / 50;
      }
      secFeat[o + 24] = Math.max(rdb[t], rmx - 80) / 20;
    }
  })();
  melBuf = null;
  progress(0.55, 'tempo + beats');

  /* ---------------- onset envelopes */
  var mFull = [0, NM];
  var mixOnset = melFlux(mixMel, TA, NM, mFull[0], mFull[1], 'mean');
  var percOnsetMed = melFlux(percMel, TA, NM, mFull[0], mFull[1], 'median');
  var mixOnsetMed = melFlux(mixMel, TA, NM, mFull[0], mFull[1], 'median');
  var rb = melRange(melA, 0, 300), rm = melRange(melA, 300, 8000), rv = melRange(melA, 300, 3500);
  var bassOnset = melFlux(harmMel, TA, NM, rb[0], rb[1], 'median');
  var melOnset = melFlux(harmMel, TA, NM, rm[0], rm[1], 'median');
  var vocOnset = melFlux(harmMel, TA, NM, rv[0], rv[1], 'median');
  var bassOnsetMean = melFlux(harmMel, TA, NM, rb[0], rb[1], 'mean');
  var percOnsetMean = melFlux(percMel, TA, NM, mFull[0], mFull[1], 'mean');
  var beatEnv = new Float32Array(TA);
  var wPerc = cfg.beatPercW === undefined ? 0.5 : cfg.beatPercW;
  var lowN = percentile(P.fluxLow, 99) + 1e-9, mixN = percentile(mixOnset, 99) + 1e-9, percN = percentile(percOnsetMean, 99) + 1e-9;
  for (var be = 0; be < TA; be++) beatEnv[be] = (1 - wPerc) * mixOnset[be] / mixN + wPerc * percOnsetMean[be] / percN + 0.6 * Math.min(1.5, P.fluxLow[be] / lowN);

  /* ---------------- tempo + DP beats */
  var fpsA = sr / hop;
  var bpm0 = estimateTempo(beatEnv, fpsA, cfg.startBpm, cfg.stdBpm, 320);
  var bpm = bpm0;
  while (bpm > cfg.maxBpm) bpm /= 2;
  while (bpm < cfg.minBpm) bpm *= 2;
  var dpFrames = beatTrackDP(beatEnv, fpsA, bpm, cfg.tightness);
  var dpBeats = dpFrames.map(function (f) { return f * hopA + cfg.beatLatency; });
  var beats = regularizeBeats(dpBeats, duration, cfg.minBpm, cfg.maxBpm);
  var steadyGrid = false;
  // Most produced songs hold one tempo. Fit a single steady grid (period + phase) to the whole song's onset
  // evidence; use it when local windows agree with it, otherwise keep the DP/regularized beats (live / rubato songs).
  (function () {
    if (beats.length < 16) return;
    var p0 = (beats[beats.length - 1] - beats[0]) / (beats.length - 1);
    function envAt(t) { var x = t / hopA, i = Math.floor(x); if (i < 0 || i >= TA - 1) return 0; var f = x - i; return beatEnv[i] * (1 - f) + beatEnv[i + 1] * f; }
    function score(per, ph) { var sc = 0, n = 0; for (var t = ph; t < duration; t += per) { sc += Math.max(envAt(t - 0.0116), envAt(t), envAt(t + 0.0116)); n++; } return sc / Math.max(1, n); }
    var best = { sc: -1, per: p0, ph: 0 };
    for (var pi = -150; pi <= 150; pi++) {
      var per = p0 * (1 + pi * 0.0002);
      for (var ph = 0; ph < per; ph += hopA) { var sc = score(per, ph); if (sc > best.sc) best = { sc: sc, per: per, ph: ph }; }
    }
    for (var pj = -10; pj <= 10; pj++) for (var dq = -4; dq <= 4; dq++) {   // refine
      var per2 = best.per * (1 + pj * 0.00002), ph2 = best.ph + dq * hopA / 4; var sc2 = score(per2, ph2);
      if (sc2 > best.sc) best = { sc: sc2, per: per2, ph: ph2 };
    }
    var bpmF = 60 / best.per;
    [Math.round(bpmF), Math.round(bpmF * 2) / 2].forEach(function (cb) {
      if (Math.abs(cb - bpmF) > 0.08 || best.snapped) return; var pc = 60 / cb, bp2 = { sc: -1 };
      for (var ph3 = 0; ph3 < pc; ph3 += hopA / 4) { var s3 = score(pc, ph3); if (s3 > bp2.sc) bp2 = { sc: s3, per: pc, ph: ph3 }; }
      if (bp2.sc >= 0.985 * best.sc) { best = bp2; best.snapped = true; }
    });
    var grid = []; for (var t = best.ph; t < duration - 0.02; t += best.per) grid.push(t);
    // local agreement: best shift of each 8-beat window
    var ok = 0, tot = 0;
    for (var w = 0; w + 8 <= grid.length; w += 8) {
      var bs = 0, bsc = -1;
      for (var dd = -0.09; dd <= 0.0901; dd += 0.0058) { var sw = 0; for (var q = w; q < w + 8; q++) sw += envAt(grid[q] + dd); if (sw > bsc) { bsc = sw; bs = dd; } }
      tot++; if (Math.abs(bs) <= 0.03) ok++;
    }
    if (dbg) dbg.globalGrid = { per: best.per, ph: best.ph, agree: ok / Math.max(1, tot) };
    if (tot && ok / tot >= 0.8) { beats = grid; steadyGrid = true; }
  })();
  // off-beat lock check: dance tracks with off-beat hats/bass can pull the tracker half a beat off.
  // The real beat carries more low-end attack (kick/bass) than the 'and'.
  (function () {
    if (beats.length < 8) return;
    var per = (beats[beats.length - 1] - beats[0]) / (beats.length - 1);
    function lowAt(t) { var i = Math.round(t / hopA), m = 0; for (var d = -2; d <= 3; d++) { var j = i + d; if (j >= 0 && j < TA && P.fluxLow[j] > m) m = P.fluxLow[j]; } return m; }
    var on = 0, off = 0;
    for (var q = 0; q < beats.length; q++) { on += lowAt(beats[q]); off += lowAt(beats[q] + per / 2); }
    if (dbg) dbg.phaseCheck = { on: on, off: off };
    if (off > on * 1.3) beats = beats.map(function (b) { return b + per / 2; }).filter(function (b) { return b < duration - 0.02; });
  })();
  if (dbg) { dbg.bpm0 = bpm0; dbg.bpm = bpm; dbg.dpBeats = dpBeats.slice(); dbg.gridBeats = beats.slice(); }
  progress(0.62, 'drum hits');

  /* ---------------- drums */
  var hits = drumHits(P, cfg);
  // drum presence: are there regular percussive hits near the beat grid, with real percussive level?
  var mixDb = toDbArr(frameRms(x, sr, fps));
  var ceiling = percentile(mixDb, 99);
  var specRms = function (pw) { var o = new Float32Array(pw.length); var sc = 16 / (3 * nfft * nfft); for (var i = 0; i < pw.length; i++) o[i] = Math.sqrt(pw[i] * sc); return o; };
  var percDbA = toDbArr(specRms(percPow)), mixDbA = toDbArr(specRms(mixPow));
  var percLevel = percentile(percDbA, 99) - percentile(mixDbA, 99);
  var nk = hits.kick.t.length, ns = hits.snare.t.length;
  var onBeat = 0;
  if (beats.length) {
    var trAll = hits.kick.t.concat(hits.snare.t).sort(function (a, b) { return a - b; });
    beats.forEach(function (b) { var ni = nearestIdx(trAll, b); if (ni >= 0 && Math.abs(trAll[ni] - b) < 0.05) onBeat++; });
    onBeat /= beats.length;
  }
  var drumsPresent = (cfg.forceDrums !== undefined) ? cfg.forceDrums : (onBeat > (cfg.drumOnBeatMin || 0.3) && percLevel > (cfg.drumLevelMin || -14));
  if (dbg) { dbg.drums = { percLevel: percLevel, onBeat: onBeat, nk: nk, ns: ns, present: drumsPresent }; }

  /* ---------------- snap grid to real transients */
  var trans = drumsPresent ? hits.kick.t.concat(hits.snare.t).sort(function (a, b) { return a - b; }) : [];
  if (trans.length < beats.length * 0.3) {
    var mo = pickPeaks(mixOnsetMed, hopA, 0.08, 1.3);
    trans = mo.t.map(function (t) { return Math.max(0, t - cfg.onsetLatency); }).sort(function (a, b) { return a - b; });
  }
  var snapped = 0;
  for (var bi = 0; bi < beats.length; bi++) {
    var nt = nearestIdx(trans, beats[bi]);
    if (nt >= 0 && Math.abs(trans[nt] - beats[bi]) < cfg.snapTol) { beats[bi] = trans[nt]; snapped++; }
  }
  for (var bj = 1; bj < beats.length; bj++) if (beats[bj] <= beats[bj - 1]) beats[bj] = beats[bj - 1] + 0.001;
  var tempo = bpm;
  if (beats.length > 4) {
    var nbt = beats.length, mxi = (nbt - 1) / 2, myb = meanOf(beats), sxy = 0, sxx = 0;
    for (var qi = 0; qi < nbt; qi++) { sxy += (qi - mxi) * (beats[qi] - myb); sxx += (qi - mxi) * (qi - mxi); }
    tempo = 60 / (sxy / sxx);
  } else if (beats.length > 1) tempo = 60 / ((beats[beats.length - 1] - beats[0]) / (beats.length - 1));
  progress(0.68, 'meter + downbeats');

  /* ---------------- meter + downbeats */
  var MF = {
    kick: hits.kick, snare: hits.snare, bassOnset: bassOnsetMean, mixOnset: mixOnset, hopA: hopA,
    chroma: chroma, bassChroma: bassChroma, TB: TB, hopB: hopB, drumsPresent: drumsPresent, secFeat: secFeat, secDim: secDim,
  };
  if (steadyGrid) cfg.barChangePenalty = Math.max(cfg.barChangePenalty, 30); // steady songs keep regular bars
  var met = detectMeter(beats, MF, cfg, dbg);
  var bpb = met.bpb;
  var downbeats = met.downIdx.map(function (i) { return beats[i]; });
  var bp = barPositions(beats.length, met.downIdx, bpb);
  progress(0.74, 'envelopes');

  /* ---------------- envelopes */
  var nEnv = mixDb.length, env = {};
  env.mix = normEnv(mixDb, ceiling, -40);
  var mixCeilA = percentile(mixDbA, 99);
  function stemEnv(pw, presenceScale) {
    var r = specRms(pw), fpsR = framesToFps(r, hopA, nEnv, fps), db = toDbArr(fpsR);
    var own = percentile(db, 99);
    var presence = clip((own - (mixCeilA - 24)) / 18, 0, 1) * presenceScale;
    var e = normEnv(db, own, -36);
    for (var i = 0; i < e.length; i++) e[i] *= (0.35 + 0.65 * presence);
    return smoothAR(e, fps, 0.008, 0.12);
  }
  env.drums = stemEnv(percPow, drumsPresent ? 1 : 0);
  env.bass = stemEnv(hBass, 1);
  env.vocals = stemEnv(hVoc, 1);
  env.melody = stemEnv(hMel, 1);
  var cent = framesToFps(centroid, hopA, nEnv, fps), cb = new Float32Array(nEnv);
  var brightScale = cfg.brightScale || 1.25;
  for (var ci = 0; ci < nEnv; ci++) cb[ci] = clip(Math.log2(Math.max(cent[ci] * brightScale, 100) / 100) / Math.log2(80), 0, 1);
  env.bright = smoothAR(cb, fps, 0.05, 0.3);
  (function () {
    var k = fps * 2, lo = movingAvgSame(env.mix, k);
    var p3 = percentile(lo, 3), p99 = percentile(lo, 99), e = new Float32Array(nEnv);
    for (var i = 0; i < nEnv; i++) e[i] = clip((lo[i] - p3) / (p99 - p3 + 1e-9), 0, 1);
    env.energy = e;
  })();
  progress(0.80, 'onsets');

  /* ---------------- events */
  var ev = {};
  ['kick', 'snare', 'hats'].forEach(function (k) {
    var h = hits[k];
    ev[k] = drumsPresent ? h.t.map(function (t, i) { return [r3(t), r2(h.s[i])]; }) : [];
  });
  function stemEvents(envOn, gap, envK, keepAll) {
    var pk = pickPeaks(envOn, hopA, gap, 1.5), o = [];
    for (var i = 0; i < pk.t.length; i++) {
      var t = Math.max(0, pk.t[i] - cfg.onsetLatency);
      var e = env[envK];
      if (keepAll || e[Math.min(e.length - 1, Math.floor(t * fps))] > 0.12) o.push([r3(t), r2(pk.s[i])]);
    }
    return o;
  }
  ev.bass = stemEvents(bassOnset, 0.1, 'bass');
  ev.melody = stemEvents(melOnset, 0.09, 'melody');
  ev.vocals = stemEvents(vocOnset, 0.12, 'vocals');
  ev.drums = drumsPresent ? stemEvents(percOnsetMed, 0.08, 'drums') : [];
  progress(0.86, 'pitch + color');

  /* ---------------- key, beat pitch, vocal pitch */
  var cmean = new Array(12).fill(0);
  for (var tf = 0; tf < TB; tf++) for (var pc = 0; pc < 12; pc++) cmean[pc] += chroma[tf * 12 + pc];
  var key = keyEstimate(cmean.map(function (v) { return v / TB; }));
  var beatPitch = beats.map(function (b, i) {
    var t1 = i + 1 < beats.length ? beats[i + 1] : Math.min(duration, b + 60 / tempo);
    var v = chromaSpan(chroma, TB, hopB, b, Math.max(t1, b + hopB));
    var bi2 = 0; for (var q = 1; q < 12; q++) if (v[q] > v[bi2]) bi2 = q;
    return bi2;
  });
  var vocalPitch = new Array(nEnv).fill(0);
  (function () {
    var thr = cfg.vpConf || 1.6, m = new Float32Array(TB);
    for (var t = 0; t < TB; t++) m[t] = vpConf[t] > thr ? vpMidi[t] : 0;
    // 5-frame median to drop isolated jumps
    var w = new Float32Array(5), sm = new Float32Array(TB);
    medfilt1(m, 0, 1, TB, 5, sm, w);
    for (var i = 0; i < nEnv; i++) {
      var tb = Math.min(TB - 1, Math.round((i / fps) / hopB));
      vocalPitch[i] = env.vocals[i] > 0.15 ? Math.round(sm[tb]) : 0;
    }
  })();
  progress(0.92, 'sections');

  /* ---------------- sections */
  var secsOld = sectionsPort({ TB: TB, secDim: secDim, secFeat: secFeat, hopB: hopB }, beats, downbeats, env.energy, fps, duration);
  var secs = sectionsBars({ TB: TB, secDim: secDim, secFeat: secFeat, hopB: hopB }, beats, downbeats, env.energy, fps, duration, secsOld.map(function (x) { return x.start; })) || secsOld;

  /* ---------------- output */
  function q8(a) { var o = new Array(a.length); for (var i = 0; i < a.length; i++) o[i] = clip(Math.round(a[i] * 255), 0, 255); return o; }
  var events = { kick: ev.kick, snare: ev.snare, hats: ev.hats, drums: ev.drums, bass: ev.bass, melody: ev.melody, vocals: ev.vocals };
  var stats = {}; Object.keys(events).forEach(function (k) { stats[k] = events[k].length; });
  var out = {
    format: 'garage-door-viz/1',
    song: song,
    source: base,
    duration: r3(duration),
    fps: fps,
    tempo: r2(tempo),
    beatsPerBar: bpb,
    key: key,
    beats: beats.map(r3),
    beatPos: bp.pos,
    beatBar: bp.bar,
    downbeats: downbeats.map(r3),
    beatPitch: beatPitch,
    sections: secs,
    env: { mix: q8(env.mix), drums: q8(env.drums), bass: q8(env.bass), vocals: q8(env.vocals), melody: q8(env.melody), bright: q8(env.bright), energy: q8(env.energy) },
    vocalPitch: vocalPitch,
    events: events,
    stats: stats,
  };
  if (dbg) { dbg.ms = Date.now() - tStart; dbg.snapped = snapped; Object.defineProperty(out, '_debug', { value: dbg, enumerable: false }); }
  progress(1, 'done');
  return out;
}

/* ------------------------------------------------------------------ classic Web Worker entry */
if (typeof self !== 'undefined' && typeof window === 'undefined' && typeof module === 'undefined') {
  self.onmessage = function (e) {
    var d = e.data || {};
    try {
      var json = analyzeAudio(d.mono, d.sr, {
        name: d.name,
        onProgress: function (f, label) { self.postMessage({ type: 'progress', f: f, label: label }); },
      });
      self.postMessage({ type: 'done', json: json });
    } catch (err) {
      self.postMessage({ type: 'error', message: String((err && err.stack) || err) });
    }
  };
}
if (typeof module !== 'undefined') module.exports = { analyzeAudio };
