'use strict';
/* Garage Door Visualizer — engine
   Song analysis (.viz.json) -> per-frame control signals -> WebGL scenes per door -> projection-mapped composite.
   Everything is a pure function of song time t, so renders are frame-exact and scrubbing is safe. */

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const fract = (x) => x - Math.floor(x);
const hash1 = (n) => fract(Math.sin(n * 127.1 + 311.7) * 43758.5453);
const fmtTime = (t) => { t = Math.max(0, t); const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2); };
function lastLE(arr, t, isPair) { let lo = 0, hi = arr.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; const v = isPair ? arr[m][0] : arr[m]; if (v <= t) { r = m; lo = m + 1; } else hi = m - 1; } return r; }
function hexToLin(h) { const n = parseInt(h.slice(1), 16); const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => v / 255); return c.map(v => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))); }
function hsv2rgb(h, s, v) { h = fract(h) * 6; const i = Math.floor(h), f = h - i; const p = v * (1 - s), q = v * (1 - s * f), u = v * (1 - s * (1 - f)); return [[v, u, p], [q, v, p], [p, v, u], [p, q, v], [u, p, v], [v, p, q]][i % 6]; }
function lsGet(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }

/* ------------------------------------------------------------------ palettes */
const PALETTES = {
  classic:   { name: 'Classic Christmas', c: ['#ff2a2a', '#16d36b', '#ffd36b', '#fff4e0'] },
  icy:       { name: 'Ice & Snow',        c: ['#bfe9ff', '#3d8bff', '#ffffff', '#8a6bff'] },
  warm:      { name: 'Warm White',        c: ['#ffb347', '#ffe2a8', '#fff7ea', '#ff8a2a'] },
  bethlehem: { name: 'Bethlehem Night',   c: ['#ffe7a8', '#ffffff', '#5b7cff', '#ffb04a'] },
  royal:     { name: 'Advent Royal',      c: ['#8e4dff', '#ffcf5a', '#ffffff', '#4b2bd6'] },
  aurora:    { name: 'Northern Lights',   c: ['#2bff9a', '#21d4ff', '#a65bff', '#ff4fa3'] },
  candy:     { name: 'Candy Cane',        c: ['#ff2244', '#ffffff', '#ff7aa2', '#ffffff'] },
  fire:      { name: 'Fire & Gold',       c: ['#ff3b0f', '#ff9a1f', '#ffe066', '#ff5a2a'] },
  jewel:     { name: 'Stained Glass',     c: ['#e0182d', '#1f5bff', '#ffc21a', '#12b85a'] },
  rainbow:   { name: 'Rainbow',           c: ['#ff3355', '#ffd23f', '#33e08a', '#3d7bff'], spin: 1 },
  music:     { name: 'Follow the music',  c: ['#ff3355', '#ffd23f', '#33e08a', '#3d7bff'], music: 1 },
};

/* ------------------------------------------------------------------ patterns */
const PATTERNS = {
  off:      'Off (whole door)',
  chase:    'Chase 4 (left to right)',
  bounce:   'Bounce (back and forth)',
  climb:    'Climb (row per beat)',
  fill:     'Build up (fills each bar)',
  onoff:    'On / Off',
  alternate:'Alternate checker',
  center:   'Center out',
  doors:    'Door to door',
  wave:     'Smooth wave',
  sparkle:  'Sparkle on hits',
  random:   'Random panels',
  flash:    'Flash on bar',
  hits:     'Pulse on hits',
};

/* ------------------------------------------------------------------ song model */
class Song {
  constructor(j) {
    this.j = j;
    this.name = j.song || 'song';
    this.duration = j.duration;
    this.fps = j.fps || 60;
    this.beats = j.beats.length ? j.beats : [0];
    this.beatPos = j.beatPos.length ? j.beatPos : [1];
    this.beatBar = j.beatBar.length ? j.beatBar : [0];
    this.bpb = j.beatsPerBar || 4;
    this.tempo = j.tempo || 120;
    this.key = j.key || '';
    this.sections = (j.sections && j.sections.length) ? j.sections : [{ start: 0, end: j.duration, level: 1, label: 'A', energy: 0.5 }];
    this.env = {};
    for (const k in j.env) this.env[k] = Float32Array.from(j.env[k], v => v / 255);
    this.frames = this.env.mix ? this.env.mix.length : Math.ceil(this.duration * this.fps);
    this.events = {};
    for (const k in j.events) this.events[k] = j.events[k];
    const B = this.beats;
    this.events.beat = B.map((t, i) => [t, this.beatPos[i] === 1 ? 1 : 0.7]);
    this.events.downbeat = B.filter((t, i) => this.beatPos[i] === 1).map(t => [t, 1]);
    this.events.offbeat = B.slice(0, -1).map((t, i) => [(t + B[i + 1]) / 2, 0.7]);
    this.events.section = this.sections.map(s => [s.start, 1]);
    this.beatDur = 60 / this.tempo;
    this.bpbOverride = 0;
    this.buildHue(j.beatPitch || []);
    this.vocalPitch = j.vocalPitch || [];
  }
  get groupLen() { const b = this.bpbOverride || this.bpb; return b === 3 || b === 6 ? 3 : (b === 8 ? 8 : 4); }
  buildHue(bp) {
    // circle-of-fifths hue per beat, smoothed (circular) so color drifts with the harmony instead of flickering
    const n = this.frames; const hue = new Float32Array(n);
    let x = 1, y = 0;
    for (let f = 0; f < n; f++) {
      const t = f / this.fps; const bi = clamp(lastLE(this.beats, t), 0, bp.length - 1);
      const pc = bp.length ? bp[bi] : 0; const a = ((pc * 7) % 12) / 12 * Math.PI * 2;
      const k = 1 - Math.exp(-1 / (this.fps * this.beatDur * 2));
      x = lerp(x, Math.cos(a), k); y = lerp(y, Math.sin(a), k);
      hue[f] = fract(Math.atan2(y, x) / (Math.PI * 2));
    }
    this.hue = hue;
  }
  envAt(name, t) {
    const a = this.env[name]; if (!a) return 0;
    const x = t * this.fps; const i = Math.floor(x);
    if (i <= 0) return a[0]; if (i >= a.length - 1) return a[a.length - 1];
    const f = x - i; return a[i] * (1 - f) + a[i + 1] * f;
  }
  hueAt(t) { const i = clamp(Math.round(t * this.fps), 0, this.hue.length - 1); return this.hue[i]; }
  pitchAt(t) { const p = this.vocalPitch; if (!p.length) return 0; const i = clamp(Math.round(t * this.fps), 0, p.length - 1); return p[i] ? clamp((p[i] - 45) / 40, 0, 1) : 0; }
  beatTime(i) {
    const B = this.beats, n = B.length;
    if (i >= 0 && i < n) return B[i];
    if (i < 0) return B[0] + i * (n > 1 ? B[1] - B[0] : this.beatDur);
    return B[n - 1] + (i - n + 1) * this.beatDur;
  }
  posOf(i) { // 1-based beat in bar, bar index (works outside the analysed range)
    const n = this.beats.length, bpb = this.bpbOverride || this.bpb;
    if (!this.bpbOverride && i >= 0 && i < n && this.beatBar[i] >= 0) return [this.beatPos[i], this.beatBar[i]];
    let ref = this.beatPos.indexOf(1); if (ref < 0) ref = 0;
    const k = i - ref; const bar = Math.floor(k / bpb); return [k - bar * bpb + 1, bar];
  }
  beatInfo(t) {
    const B = this.beats, n = B.length; let i = lastLE(B, t), cont;
    if (i < 0) { const d = n > 1 ? B[1] - B[0] : this.beatDur; cont = (t - B[0]) / d; }
    else if (i >= n - 1) cont = (n - 1) + (t - B[n - 1]) / this.beatDur;
    else cont = i + (t - B[i]) / (B[i + 1] - B[i]);
    const idx = Math.floor(cont), phase = cont - idx;
    const [pos, bar] = this.posOf(idx); const bpb = this.bpbOverride || this.bpb;
    const g = this.groupLen; const abs = bar * bpb + pos - 1;
    return { cont, idx, phase, pos, bar, bpb, barCont: bar + (pos - 1 + phase) / bpb, group: ((abs % g) + g) % g, groupIdx: Math.floor(abs / g), dur: this.beatTime(idx + 1) - this.beatTime(idx) };
  }
  sectionAt(t) { let i = 0; for (let k = 0; k < this.sections.length; k++) if (this.sections[k].start <= t + 1e-6) i = k; const s = this.sections[i]; return { i, s, phase: clamp((t - s.start) / Math.max(0.01, s.end - s.start), 0, 1) }; }
  eventsPerBeat(name) { const e = this.events[name]; return e ? e.length / Math.max(1, this.beats.length) : 0; }
  meanEnv(name) { const a = this.env[name]; if (!a) return 0; let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s / a.length; }

  static demo() {
    // a synthetic 4/4 groove so the tool shows something before a song is loaded
    const bpm = 112, T = 60 / bpm, dur = +(8 * 16 * T).toFixed(3), fps = 60, n = Math.ceil(dur * fps);
    const beats = [], pos = [], bar = [];
    for (let i = 0; i * T < dur - 0.01; i++) { beats.push(+(i * T).toFixed(3)); pos.push(i % 4 + 1); bar.push(Math.floor(i / 4)); }
    const ev = { kick: [], snare: [], hats: [], drums: [], bass: [], melody: [], vocals: [] };
    const secs = []; const lv = [0, 1, 2, 3, 1, 3, 2, 0];
    for (let s = 0; s < 8; s++) secs.push({ start: +(s * 16 * T).toFixed(3), end: 0, level: lv[s], label: 'ABCBDBCA'[s], energy: lv[s] / 3, drop: s === 3 });
    for (let i = 0; i < secs.length; i++) secs[i].end = i + 1 < secs.length ? secs[i + 1].start : dur;
    beats.forEach((t, i) => {
      const lvl = secs[Math.max(0, secs.findIndex((s) => t >= s.start && t < s.end))].level;
      if (lvl >= 1 && (i % 4 === 0 || i % 4 === 2)) ev.kick.push([t, 1]);
      if (lvl >= 2 && i % 4 === 2 && Math.floor(i / 4) % 2) ev.kick.push([t + T / 2, 0.8]);
      if (lvl >= 1 && (i % 4 === 1 || i % 4 === 3)) ev.snare.push([t, 0.9]);
      if (lvl >= 2) { ev.hats.push([t, 0.6]); ev.hats.push([t + T / 2, 0.5]); }
      if (i % 2 === 0) ev.melody.push([t + T * 0.25, 0.7]);
      ev.bass.push([t, 0.8]);
    });
    ['kick', 'snare', 'hats'].forEach(k => ev.drums.push(...ev[k])); ev.drums.sort((a, b) => a[0] - b[0]);
    const env = {}; const keys = ['mix', 'drums', 'bass', 'vocals', 'melody', 'bright', 'energy'];
    keys.forEach(k => env[k] = new Array(n));
    for (let f = 0; f < n; f++) {
      const t = f / fps; const s = secs.find(x => t >= x.start && t < x.end) || secs[0]; const L = s.level / 3;
      const ph = fract(t / T);
      env.mix[f] = Math.round(255 * (0.45 + 0.4 * L + 0.1 * Math.exp(-ph * 5)));
      env.drums[f] = Math.round(255 * (L > 0 ? 0.3 + 0.6 * Math.exp(-ph * 6) : 0.05));
      env.bass[f] = Math.round(255 * (0.4 + 0.3 * L));
      env.vocals[f] = Math.round(255 * clamp(0.5 + 0.5 * Math.sin(t * 0.7), 0, 1) * (0.4 + 0.6 * L));
      env.melody[f] = Math.round(255 * (0.4 + 0.4 * Math.sin(t * 1.3) ** 2));
      env.bright[f] = Math.round(255 * (0.5 + 0.2 * L));
      env.energy[f] = Math.round(255 * (0.15 + 0.8 * L));
    }
    return new Song({ format: 'garage-door-viz/1', song: 'Demo groove', duration: dur, fps, tempo: bpm, beatsPerBar: 4, key: 'C major', beats, beatPos: pos, beatBar: bar, downbeats: beats.filter((_, i) => i % 4 === 0), beatPitch: beats.map((_, i) => [0, 7, 9, 5][Math.floor(i / 8) % 4]), sections: secs, env, vocalPitch: [], events: ev, demo: true });
  }
}

/* ------------------------------------------------------------------ signal sources */
const EVENT_SOURCES = { kick: 'Kick drum', snare: 'Snare / clap', hats: 'Hi-hats / cymbals', drums: 'Any drum hit', bass: 'Bass notes', melody: 'Melody notes', vocals: 'Vocal notes', beat: 'Every beat', downbeat: 'Bar start (beat 1)', offbeat: 'Off-beats (and)', section: 'Section changes' };
const CONT_SOURCES = { 'vocals~': 'Vocal loudness', 'melody~': 'Melody loudness', 'bass~': 'Bass loudness', 'drums~': 'Drum loudness', 'mix~': 'Whole song loudness', 'energy~': 'Song energy (slow)', 'bright~': 'Brightness of sound' };

function eventEnv(list, t, rel, attack = 0.006) {
  if (!list || !list.length) return 0;
  const i = lastLE(list, t, true); let v = 0;
  for (let k = i; k >= 0 && k > i - 10; k--) {
    const dt = t - list[k][0]; if (dt > rel * 7) break;
    const a = dt < attack ? dt / attack : 1; v = Math.max(v, list[k][1] * a * Math.exp(-dt / rel));
  }
  return v;
}
function guardEvents(list, minGap) { // keep events at least minGap apart (photosensitivity guard for full-door flashes)
  const out = []; let last = -1e9;
  for (const e of list || []) if (e[0] - last >= minGap) { out.push(e); last = e[0]; }
  return out;
}


/* ------------------------------------------------------------------ WebGL renderer */
const VS = `#version 300 es
in vec2 aPos; out vec2 vUv; void main(){ vUv = aPos*0.5+0.5; gl_Position = vec4(aPos,0.,1.); }`;

class Renderer {
  constructor(canvas) {
    this.c = canvas;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: true, premultipliedAlpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is not available in this browser. Use a current Chrome, Edge or Safari.');
    this.gl = gl;
    this.half = !!gl.getExtension('EXT_color_buffer_float') || !!gl.getExtension('EXT_color_buffer_half_float');
    gl.getExtension('OES_texture_float_linear');
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.progs = {}; this.fbos = {};
  }
  compile(type, src) {
    const gl = this.gl; const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(s); console.error(log, src.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n')); throw new Error('Shader compile failed: ' + log); }
    return s;
  }
  program(key, fsrc) {
    if (this.progs[key]) return this.progs[key];
    const gl = this.gl; const p = gl.createProgram();
    gl.attachShader(p, this.compile(gl.VERTEX_SHADER, VS)); gl.attachShader(p, this.compile(gl.FRAGMENT_SHADER, fsrc));
    gl.bindAttribLocation(p, 0, 'aPos'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link failed: ' + gl.getProgramInfoLog(p));
    const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); const nm = info.name.replace(/\[0\]$/, ''); u[nm] = gl.getUniformLocation(p, info.name); }
    return (this.progs[key] = { p, u });
  }
  fbo(key, w, h) {
    w = Math.max(2, Math.round(w)); h = Math.max(2, Math.round(h));
    const f = this.fbos[key]; if (f && f.w === w && f.h === h) return f;
    const gl = this.gl; if (f) { gl.deleteTexture(f.tex); gl.deleteFramebuffer(f.fb); }
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    if (this.half) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return (this.fbos[key] = { tex, fb, w, h });
  }
  draw(prog, target, uniforms, textures) {
    const gl = this.gl; gl.useProgram(prog.p);
    if (target) { gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb); gl.viewport(0, 0, target.w, target.h); }
    else { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.c.width, this.c.height); }
    let unit = 0;
    for (const k in textures || {}) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, textures[k]); if (prog.u[k]) gl.uniform1i(prog.u[k], unit); unit++; }
    for (const k in uniforms) {
      const loc = prog.u[k]; if (!loc) continue; const v = uniforms[k];
      if (typeof v === 'number') gl.uniform1f(loc, v);
      else if (v.m3) gl.uniformMatrix3fv(loc, false, v.m3);
      else if (v.v4) gl.uniform4fv(loc, v.v4);
      else if (v.v3) gl.uniform3fv(loc, v.v3);
      else if (v.length === 2) gl.uniform2fv(loc, v); else if (v.length === 3) gl.uniform3fv(loc, v); else gl.uniform4fv(loc, v);
    }
    gl.bindVertexArray(this.vao); gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

/* homography: unit square (0,0)(1,0)(1,1)(0,1) -> quad p0..p3 ; returns inverse (quad -> square) as column-major mat3 */
function homographyInv(p) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = p;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let g = 0, h = 0; const den = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) { g = (dx3 * dy2 - dx2 * dy3) / den; h = (dx1 * dy3 - dx3 * dy1) / den; }
  const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, c = x0, d = y1 - y0 + g * y1, e = y3 - y0 + h * y3, f = y0;
  // forward H (row-major): [a b c; d e f; g h 1]; invert
  const A = [a, b, c, d, e, f, g, h, 1];
  const inv = [A[4] * A[8] - A[5] * A[7], A[2] * A[7] - A[1] * A[8], A[1] * A[5] - A[2] * A[4], A[5] * A[6] - A[3] * A[8], A[0] * A[8] - A[2] * A[6], A[2] * A[3] - A[0] * A[5], A[3] * A[7] - A[4] * A[6], A[1] * A[6] - A[0] * A[7], A[0] * A[4] - A[1] * A[3]];
  const det = A[0] * inv[0] + A[1] * inv[3] + A[2] * inv[6];
  for (let i = 0; i < 9; i++) inv[i] /= det;
  return new Float32Array([inv[0], inv[3], inv[6], inv[1], inv[4], inv[7], inv[2], inv[5], inv[8]]); // column-major
}


const BLUR_FS = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o; uniform sampler2D uT; uniform vec2 uDir; uniform float uThresh;
void main(){ vec3 s = vec3(0.); float w[5] = float[](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
  for(int i=-4;i<=4;i++){ vec3 c = texture(uT, vUv + uDir*float(i)).rgb; if(uThresh>0.) c = max(c - uThresh, 0.); s += c*w[abs(i)]; } o = vec4(s,1.); }`;
const FINAL_FS = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o; uniform sampler2D uC, uB1, uB2, uB3; uniform float uBloom, uSpill, uMaster;
vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0., 1.); }
void main(){ vec4 c = texture(uC, vUv); vec3 b = texture(uB1,vUv).rgb*0.5 + texture(uB2,vUv).rgb*0.35 + texture(uB3,vUv).rgb*0.3;
  float m = c.a; vec3 col = c.rgb + b*uBloom*mix(m, 1., uSpill);
  col = aces(col*uMaster*1.15);
  col = pow(col, vec3(1./2.2));
  col = max(col - 0.004, 0.)*mix(m, 1., uSpill*clamp(length(b)*4.,0.,1.));
  o = vec4(col,1.); }`;

/* ------------------------------------------------------------------ scene shader assembly */
const SCENE_HEADER = `#version 300 es
precision highp float; in vec2 vUv; out vec4 fragColor;
uniform vec2 uRes; uniform float uAspect, uTime, uBeat, uBeatPhase, uBar, uBarPhase, uBpb, uBeatDur, uGroup;
uniform float uHit, uAcc, uFlow, uGlow, uFlash, uEnergy, uLevel, uSecPhase, uTravel, uHue, uPitch, uSpeed, uIntensity, uSeed, uSpinPal;
uniform vec4 uHitEv[8]; uniform vec4 uAccEv[8]; uniform vec4 uHitNext; uniform vec3 uPal[4]; uniform vec4 uCells[16]; uniform vec2 uGrid; uniform vec4 uParam;
uniform vec4 uBand0; // x kick hit env, y bass level, z drums level, w snare hit env (0..1)
uniform vec4 uBand1; // x melody level, y vocals level, z hats hit env, w whole-song loudness (0..1)
#define PI 3.14159265359
#define TAU 6.28318530718
float hash11(float p){ p = fract(p*.1031); p *= p+33.33; p *= p+p; return fract(p); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*vec3(.1031,.1030,.0973)); p3 += dot(p3, p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y); }
float fbm(vec2 p){ float s = 0., a = .5; mat2 m = mat2(1.6,1.2,-1.2,1.6); for(int i=0;i<5;i++){ s += a*noise(p); p = m*p; a *= .5; } return s; }
float fbm3(vec2 p){ float s = 0., a = .5; mat2 m = mat2(1.6,1.2,-1.2,1.6); for(int i=0;i<3;i++){ s += a*noise(p); p = m*p; a *= .5; } return s; }
vec3 hsv(float h, float s, float v){ vec3 k = clamp(abs(mod(h*6.+vec3(0,4,2),6.)-3.)-1., 0., 1.); return v*mix(vec3(1.), k, s); }
vec3 pal(float x){ x = fract(x)*4.; int i = int(x); float f = smoothstep(0.,1.,fract(x)); return mix(uPal[i&3], uPal[(i+1)&3], f); }
vec3 palc(int i){ return uPal[i&3]; }
float cellv(int i){ i = clamp(i, 0, 63); return uCells[i>>2][i&3]; }
float cellAt(vec2 uv){ ivec2 c = ivec2(clamp(floor(uv*uGrid), vec2(0.), uGrid-1.)); return cellv(c.y*int(uGrid.x)+c.x); }
float glowPt(vec2 d, float r){ return r*r/(dot(d,d)+r*r*0.02); }
float sdSeg(vec2 p, vec2 a, vec2 b){ vec2 pa = p-a, ba = b-a; float h = clamp(dot(pa,ba)/dot(ba,ba),0.,1.); return length(pa-ba*h); }
float sdBox(vec2 p, vec2 b){ vec2 d = abs(p)-b; return length(max(d,0.))+min(max(d.x,d.y),0.); }
float sdRBox(vec2 p, vec2 b, float r){ return sdBox(p, b-r)-r; }
float sdStar5(vec2 p, float r, float rf){ const vec2 k1 = vec2(0.809016994375, -0.587785252292); const vec2 k2 = vec2(-k1.x,k1.y);
  p.x = abs(p.x); p -= 2.0*max(dot(k1,p),0.0)*k1; p -= 2.0*max(dot(k2,p),0.0)*k2; p.x = abs(p.x); p.y -= r;
  vec2 ba = rf*vec2(-k1.y,k1.x) - vec2(0,1); float h = clamp( dot(p,ba)/dot(ba,ba), 0.0, r );
  return length(p-ba*h) * sign(p.y*ba.x-p.x*ba.y); }
mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c,-s,s,c); }
float evEnv(vec4 e, float rel){ return e.x < 0. || e.x > 50. ? 0. : e.y*exp(-e.x/rel)*clamp(e.x/0.006,0.,1.); }
`;
function sceneSource(sc) {
  return SCENE_HEADER + sc.glsl + `
void main(){ vec2 uv = vUv; vec2 p = vec2((uv.x-0.5)*uAspect, uv.y-0.5);
  vec3 c = scene(uv, p); fragColor = vec4(max(c, 0.)*uIntensity, 1.); }`;
}


function defaultDoors() {
  return { aw: 15.5, ah: 7, bw: 8, bh: 7, gap: 2.5, ac: 8, ar: 4, bc: 4, br: 4, feather: 0.006, spill: false, corners: null };
}
function flatCorners(d) {
  // both doors side by side at true proportions, centered, filling ~92% of a 16:9 frame
  const total = d.aw + d.gap + d.bw, h = Math.max(d.ah, d.bh);
  const W = 16 / 9; let s = (W * 0.92) / total; if (h * s > 0.9) s = 0.9 / h;
  const x0 = (W - total * s) / 2, yb = 0.5 + (h * s) / 2;
  const rect = (x, w, hh) => { const xa = x / W, xb = (x + w) / W, ya = yb - hh, yt = yb - hh; return [[xa, yb], [xb, yb], [xb, yb - hh * s], [xa, yb - hh * s]]; };
  return { a: rect(x0, d.aw * s, d.ah), b: rect(x0 + (d.aw + d.gap) * s, d.bw * s, d.bh) }; // corners: BL, BR, TR, TL in output uv (y down)
}
