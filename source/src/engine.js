/* Engine v2: timeline of effect clips on tracks, each with its own reactivity and pattern.
   Everything is a pure function of song time, so preview and render match frame for frame. */

const TRACKS = ['Background', 'Main', 'Accents'];
const TRIGGERS = {
  beat: 'Every beat', downbeat: 'Downbeats (beat 1)', half: 'Beats 1 & 3', backbeat: 'Beats 2 & 4', offbeat: 'Off-beats (the "and")', bar2: 'Every 2 bars',
  kick: 'Kick drum', snare: 'Snare / clap', hats: 'Hi-hats', drums: 'Any drum hit', bass: 'Bass notes', melody: 'Melody notes', vocals: 'Vocal notes', section: 'Section changes', none: 'Nothing',
};
const LEVELS = { 'vocals~': 'Vocal loudness', 'melody~': 'Melody loudness', 'bass~': 'Bass loudness', 'drums~': 'Drum loudness', 'mix~': 'Overall loudness', 'energy~': 'Song energy (slow)', 'bright~': 'Brightness of sound', none: 'Nothing' };
const PATTERN_NAMES = {
  off: 'None (whole door)', chase: 'Chase across', bounce: 'Bounce back and forth', climb: 'Climb rows', fill: 'Build up', onoff: 'On / off',
  alternate: 'Alternate checker', center: 'Center out', doors: 'Door to door', random: 'Random panels', flash: 'Flash on step 1', sparkle: 'Sparkle on hits', hits: 'Pulse on hits', wave: 'Smooth wave',
};
const CATEGORIES = ['DJ Lights', 'Christmas Lights', 'Candy', 'Stars', 'Angels & Faith', 'Christian', 'Christmas', 'Winter', 'Music', 'Patterns', 'Lights', 'Simulation', 'Big motion'];
const CAT_GROUP = { 'DJ Lights': 'DJ', 'Lights': 'DJ', 'Christmas Lights': 'Christmas', 'Christmas': 'Christmas', 'Winter': 'Christmas', 'Stars': 'Stars', 'Angels & Faith': 'Faith', 'Christian': 'Faith', 'Simulation': 'Motion', 'Big motion': 'Motion', 'Candy': 'Candy', 'Music': 'Music', 'Patterns': 'Patterns' };
const GROUPS = ['All', 'DJ', 'Christmas', 'Candy', 'Stars', 'Faith', 'Music', 'Patterns', 'Motion'];
const ALL_FX = () => SCENE_ORDER3.concat(SCENE_ORDER, SCENE_ORDER2);

/* ---------- song extensions */
function extendSong(song) {
  const B = song.beats;
  song.events.half = B.filter((t, i) => { const p = song.beatPos[i]; return p === 1 || (song.bpb >= 4 && p === 3); }).map(t => [t, 1]);
  song.events.backbeat = B.filter((t, i) => { const p = song.beatPos[i]; return song.bpb >= 4 ? (p === 2 || p === 4) : p === 2; }).map(t => [t, 1]);
  let k = 0; song.events.bar2 = B.filter((t, i) => song.beatPos[i] === 1).filter(() => (k++ % 2) === 0).map(t => [t, 1]);
  song.events.none = [];
  return song;
}
function eventsPerBeat(song, k) { const e = song.events[k]; return e ? e.length / Math.max(1, song.beats.length) : 0; }

/* ---------- clips */
let CLIP_ID = 1;
function defaultClip(fx, start, end, track) {
  const sc = SCENES[fx] || SCENES.starfield;
  return {
    id: CLIP_ID++, track: track ?? 1, start, end, fx,
    doors: sc.perDoor ? 'both' : (sc.mode === 'span' ? 'span' : 'both'),
    palette: sc.palette || 'classic', intensity: 1, speed: 1, params: (sc.params || []).map((p, i) => (track === 2 && sc.accentParams && sc.accentParams[i] != null) ? sc.accentParams[i] : p.def),
    hit: { src: 'kick', amt: 1 }, acc: { src: 'snare', amt: 1 }, flow: { src: 'melody~', amt: 1 }, glow: { src: 'vocals~', amt: 1 }, decay: 0.28,
    pattern: sc.cells ? 'chase' : 'off', patOn: 'beat', steps: 4, patMask: !sc.cells, tail: 1, floor: 0.12,
    fadeIn: 1, fadeOut: 1, opacity: 1,
  };
}
function smartReact(song, clip) {
  // pick triggers that actually exist in this song
  const kpb = eventsPerBeat(song, 'kick'), spb = eventsPerBeat(song, 'snare'), hpb = eventsPerBeat(song, 'hats'), dpb = eventsPerBeat(song, 'drums');
  clip.hit.src = (kpb >= 0.25 && kpb <= 2.2) ? 'kick' : (dpb >= 0.3 && dpb <= 3) ? 'drums' : 'beat';
  clip.acc.src = (spb >= 0.15 && spb <= 2.2) ? 'snare' : (hpb >= 0.2 && hpb <= 3) ? 'hats' : (eventsPerBeat(song, 'melody') > 0.2 ? 'melody' : 'offbeat');
  clip.flow.src = song.meanEnv('melody') > 0.15 ? 'melody~' : 'mix~';
  clip.glow.src = song.meanEnv('vocals') > 0.22 ? 'vocals~' : 'energy~';
  const pref = (SCENES[clip.fx] || {}).react; // effects that want a specific part of the song (piano keys -> melody notes)
  if (pref) for (const k of ['hit', 'acc']) { const want = pref[k]; if (want && eventsPerBeat(song, want) >= 0.12 && eventsPerBeat(song, want) <= 4) clip[k].src = want; }
  return clip;
}

/* ---------- auto fill */
const STYLES = {
  party: { name: 'Party / DJ', base: ['lasers', 'movingheads', 'scanners', 'tunnel', 'eqbars', 'strobe', 'discoball', 'beams'], acc: ['starburst', 'fireworks', 'strobe'], bg: [] },
  lights: { name: 'Christmas lights', base: ['c9swag', 'spiraltree', 'arches', 'twinkle', 'netlights', 'dottree', 'wreath', 'jinglebells', 'bulbs', 'icicles'], acc: ['lightframe', 'starburst'], bg: [], calm: ['bokeh', 'goldsnow', 'twinkle'], special: ['presentbow', 'poinsettia', 'yulefire'] },
  candy: { name: 'Candy shop', base: ['peppermint', 'stripes', 'candyrain', 'lollipop', 'candycarousel', 'candytunnel'], acc: ['starburst', 'lightframe'], bg: [], calm: ['candyrain', 'bokeh'], special: ['candytunnel', 'giftwrap'] },
  faith: { name: 'Faith', base: ['sparkleangels', 'bethlehem', 'angel', 'rosewindow', 'nativity', 'glory', 'candles', 'angelchoir', 'moravian'], acc: ['halos'], bg: ['starfield'], calm: ['sparkleangels', 'starfield', 'goldsnow'], special: ['nativity', 'rosewindow'] },
  stars: { name: 'Stars', base: ['starfield', 'moravian', 'constellation', 'galaxy', 'starwall', 'bethlehem'], acc: ['starshower', 'starburst'], bg: [] },
  mix: { name: 'Mix of everything', base: [], acc: [], bg: [] },
};
function autoFill(song, styleKey) {
  // Each part gets a steady main look; choruses get the biggest look plus a hit layer on bar lines;
  // repeated parts (every chorus, every verse) reuse their look. Part names come from the analysis.
  const slow = song.tempo < 90 && eventsPerBeat(song, 'kick') < 0.3;
  let st = STYLES[styleKey] || STYLES.mix;
  if (styleKey === 'mix') st = slow ? { base: ['sparkleangels', 'bethlehem', 'goldsnow', 'candles', 'moravian', 'poinsettia', 'aurora', 'constellation'], acc: ['halos', 'starshower'], bg: [], calm: ['starfield', 'goldsnow', 'bokeh'], special: ['nativity', 'angelchoir', 'rosewindow'] }
    : { base: ['lasers', 'peppermint', 'spiraltree', 'movingheads', 'stripes', 'pianokeys', 'arches', 'tunnel', 'jinglebells', 'snowman', 'candyrain'], acc: ['starburst', 'fireworks', 'strobe', 'lightframe'], bg: [], calm: ['twinkle', 'neonflakes', 'bokeh'], special: ['sparkleangels', 'kaleido', 'discoball'] };
  const calm = st.calm || ['starfield', 'twinkle', 'snowstorm'], special = st.special || ['moravian', 'angel', 'constellation'];
  const clips = []; const byLabel = {}; let n = 0;
  const pats = [['wave', 'off'], ['fill', 'center', 'wave'], ['chase', 'climb', 'bounce', 'doors'], ['alternate', 'onoff', 'hits', 'chase']];
  const kindOf = (sec) => sec.kind || '';
  song.sections.forEach((sec, i) => {
    const L = sec.level || 0; const lab = sec.label || 'A'; const kind = kindOf(sec);
    let fx = byLabel[lab];
    if (!fx) {
      if (kind === 'Intro' || kind === 'Outro' || kind === 'Break') fx = calm[(n++) % calm.length];
      else if (kind === 'Bridge') fx = special[(n++) % special.length];
      else if (kind === 'Chorus') fx = st.base[0];
      else { fx = st.base[(1 + n) % st.base.length]; n++; }
      byLabel[lab] = fx;
    }
    const c = smartReact(song, defaultClip(fx, sec.start, sec.end, 1));
    const big = kind === 'Chorus' || L >= 3;
    c.intensity = kind === 'Intro' || kind === 'Outro' ? 0.7 : [0.72, 0.85, 0.95, 1][L];
    c.speed = [0.75, 0.9, 1.1, 1.3][L] * (slow ? 0.8 : 1);
    const sc = SCENES[fx];
    if (sc && sc.cells) {
      const pl = pats[big ? 3 : L]; c.pattern = slow ? (big ? 'fill' : 'wave') : (kind === 'Pre-Chorus' ? 'fill' : pl[(lab.charCodeAt(0) + L) % pl.length]);
      c.patOn = kind === 'Pre-Chorus' ? 'beat' : (big && !slow ? 'beat' : 'downbeat'); c.patMask = false;
    }
    c.tail = slow ? 1.8 : [1.4, 1.1, 0.9, 0.75][L];
    c.fadeIn = i === 0 ? 0 : (sec.drop && !slow ? 0 : (slow ? 4 : 1)); c.fadeOut = slow ? 4 : 1; c.flashIn = !!sec.drop && !slow;
    clips.push(c);
    if (st.bg && st.bg.length) clips.push(Object.assign(smartReact(song, defaultClip(st.bg[0], sec.start, sec.end, 0)), { intensity: 0.6, fadeIn: 2, fadeOut: 2 }));
    if (big && st.acc.length && sec.end - sec.start > 4 && kind !== 'Outro') {
      const ac = smartReact(song, defaultClip(st.acc[(i + n) % st.acc.length], sec.start, sec.end, 2));
      ac.intensity = 0.9; ac.fadeIn = 0; ac.fadeOut = 1;
      ac.hit.src = slow ? 'downbeat' : (ac.fx === 'starburst' || ac.fx === 'fireworks' || ac.fx === 'strobe' ? 'downbeat' : ac.hit.src); // big hits mark the bar
      clips.push(ac);
    }
  });
  return clips;
}

/* ---------- per-clip frame state */
function clipState(t, clip, song, base) {
  const rel = clip.decay || 0.28;
  const val = (r, relr) => {
    if (!r || !r.src || r.src === 'none') return 0;
    if (r.src.endsWith('~')) return clamp(song.envAt(r.src.slice(0, -1), t) * r.amt, 0, 2);
    return clamp(eventEnv(song.events[r.src], t, relr) * r.amt, 0, 2);
  };
  const st = Object.assign({}, base);
  st.hit = val(clip.hit, rel); st.acc = val(clip.acc, rel * 0.8); st.flow = val(clip.flow, 0.4); st.glow = val(clip.glow, 0.5);
  const fl = clip._flash || []; st.flash = clamp(eventEnv(fl, t, rel * 0.9) * (clip.hit.amt || 1), 0, 1.5);
  st.hitEv = new Float32Array(32); st.accEv = new Float32Array(32); st.hitNext = new Float32Array(4).fill(99); st.hitNextSeed = new Float32Array(4);
  const fillEv = (name, arr, next, seedOut) => {
    const L = song.events[name]; for (let k = 0; k < 8; k++) { arr[k * 4] = 999; arr[k * 4 + 1] = 0; arr[k * 4 + 2] = k; arr[k * 4 + 3] = -1; }
    if (!L || !L.length) return; const i = lastLE(L, t, true);
    for (let k = 0; k < 8; k++) { const j = i - k; if (j < 0) break; arr[k * 4] = t - L[j][0]; arr[k * 4 + 1] = L[j][1]; arr[k * 4 + 2] = hash1(j * 1.731 + 0.17); arr[k * 4 + 3] = j; }
    if (next) for (let k = 0; k < 4; k++) { const j = i + 1 + k; if (j < L.length) { next[k] = L[j][0] - t; seedOut[k] = hash1(j * 1.731 + 0.17); } }
  };
  fillEv(clip.hit.src, st.hitEv, st.hitNext, st.hitNextSeed); fillEv(clip.acc.src, st.accEv, null, null);
  return st;
}
function baseState(t, song) {
  const bi = song.beatInfo(t); const sec = song.sectionAt(t);
  return {
    t, beat: bi.cont, beatPhase: bi.phase, beatIdx: bi.idx, pos: bi.pos, bar: bi.barCont, barIdx: bi.bar, barPhase: fract(bi.barCont), bpb: bi.bpb, group: bi.group, beatDur: bi.dur,
    energy: song.envAt('energy', t), level: sec.s.level || 0, secPhase: sec.phase, hue: song.hueAt(t), pitch: song.pitchAt(t), travel: travelAt(t),
    band0: [eventEnv(song.events.kick, t, 0.16), song.envAt('bass', t), song.envAt('drums', t), eventEnv(song.events.snare, t, 0.14)],
    band1: [song.envAt('melody', t), song.envAt('vocals', t), eventEnv(song.events.hats, t, 0.07), song.envAt('mix', t)],
  };
}
function travelAt(t) { const tr = App._travel, fps = App.song.fps; if (!tr) return t; const x = t * fps; const i = clamp(Math.floor(x), 0, tr.length - 2); return tr[i] + (tr[i + 1] - tr[i]) * (x - i) + (x > tr.length - 1 ? (x - tr.length + 1) / fps : 0); }
function buildTravel() {
  const song = App.song, n = song.frames, fps = song.fps; const tr = new Float32Array(n + 1); let acc = 0;
  for (let f = 0; f < n; f++) { const t = f / fps; acc += (0.35 + 0.9 * song.envAt('energy', t) + 0.35 * song.envAt('mix', t)) / fps; tr[f + 1] = acc; }
  App._travel = tr;
}
function prepClips() { // flash-guard lists per clip trigger
  const g = App.settings.guard;
  for (const c of App.clips) c._flash = g ? guardEvents(App.song.events[c.hit.src], 0.34) : (App.song.events[c.hit.src] || []);
}

/* ---------- patterns: advance on any trigger, any step count */
function patternCells(clip, st, door, d, cells, cols, rows) {
  const song = App.song; const pat = clip.pattern || 'off'; const tail = clip.tail || 1; const steps = Math.max(1, clip.steps || 4);
  const offX = door === 'b' ? d.ac : 0; const totC = d.ac + d.bc; const n = cols * rows; cells.fill(0, 0, 64);
  if (pat === 'off') { cells.fill(1, 0, n); return; }
  if (pat === 'wave') { for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) { const gx = (x + offX + 0.5) / totC; cells[y * cols + x] = Math.pow(0.5 + 0.5 * Math.cos(2 * Math.PI * (gx - st.barPhase)), 2.2 / tail); } return; }
  const E = song.events[clip.patOn] || song.events.beat; if (!E || !E.length) { cells.fill(1, 0, n); return; }
  const i0 = lastLE(E, st.t, true);
  const isBeat = clip.patOn === 'beat';
  for (let k = 0; k < 4; k++) {
    const idx = i0 - k; if (idx < 0) break;
    const te = E[idx][0]; const age = st.t - te; if (age < 0) continue;
    const per = clamp((idx + 1 < E.length ? E[idx + 1][0] : te + song.beatDur) - te, 0.08, 2.5);
    const rel = Math.max(0.04, per * 0.45 * tail);
    const env = (age < 0.008 ? age / 0.008 : 1) * Math.exp(-age / rel) * (pat === 'sparkle' || pat === 'hits' ? clamp(E[idx][1] * 1.3, 0.3, 1) : 1);
    if (env < 0.003) continue;
    let abs = idx;
    if (isBeat) { const [pos, bar] = song.posOf(idx); abs = bar * (song.bpbOverride || song.bpb) + pos - 1; }
    const g = ((abs % steps) + steps) % steps;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const gx = x + offX; let on = 0;
      switch (pat) {
        case 'chase': on = Math.floor(gx * steps / totC) === g; break;
        case 'bounce': { const L = 2 * totC - 2; const p = ((abs % L) + L) % L; const col = p < totC ? p : L - p; on = gx === col || (totC > 8 && gx === col + (col % 2 ? -1 : 1)); break; }
        case 'climb': on = (rows - 1 - y) === (g % rows); break;
        case 'fill': on = Math.floor(gx * steps / totC) <= g; break;
        case 'onoff': on = g % 2 === 0; break;
        case 'alternate': on = ((gx + y + abs) % 2) === 0; break;
        case 'center': { const c = (totC - 1) / 2; const dd = Math.abs(gx - c) / (c + 0.5); on = Math.floor(dd * steps * 0.999) === g; break; }
        case 'doors': on = (door === 'a') === (g % 2 === 0); break;
        case 'random': on = hash1(abs * 7.13 + gx * 1.7 + y * 5.3) < 0.35; break;
        case 'flash': on = g === 0; break;
        case 'hits': on = 1; break;
        case 'sparkle': on = hash1(idx * 13.7 + (y * cols + x + offX * 7) * 3.1) < 0.28; break;
        default: on = 1;
      }
      if (on) { const c = y * cols + x; cells[c] = Math.max(cells[c], env); }
    }
  }
}

/* ---------- rendering */
const LAYER_FS = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uT; uniform vec4 uR; uniform float uOp; uniform vec4 uC[16]; uniform vec2 uG; uniform float uMask, uFloor;
float cell(vec2 duv){ vec2 q = duv*uG; ivec2 c = ivec2(clamp(floor(q), vec2(0.), uG-1.)); int i = c.y*int(uG.x)+c.x; float v = uC[i>>2][i&3];
  vec2 f = fract(q); vec2 e = smoothstep(0.0, 0.06, f)*smoothstep(0.0, 0.06, 1.-f); return v * mix(0.55, 1., e.x*e.y); }
void main(){ vec3 c = texture(uT, uR.xy + vUv*uR.zw).rgb; if(uMask > 0.5) c *= mix(uFloor, 1., cell(vUv)); o = vec4(c*uOp, 1.); }`;
const COMPOSITE2_FS = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uA, uB; uniform mat3 uHA, uHB; uniform float uFeather, uTest, uOutAspect, uAspA, uAspB; uniform vec2 uGA, uGB; uniform float uFlashCut;
vec3 door(sampler2D T, mat3 H, vec2 G, float asp, vec2 uv, out float m){
  vec3 q = H*vec3(uv,1.); vec2 d = q.xy/q.z; m = 0.;
  if(q.z<=0. || d.x<-0.02 || d.x>1.02 || d.y<-0.02 || d.y>1.02) return vec3(0.);
  float fe = max(uFeather, 1e-4);
  m = smoothstep(0., fe, d.x)*smoothstep(0., fe, 1.-d.x)*smoothstep(0., fe*uOutAspect*0.5, d.y)*smoothstep(0., fe*uOutAspect*0.5, 1.-d.y);
  vec3 c = texture(T, d).rgb;
  if(uTest > 0.5){ vec2 gq = d*G; vec2 fw = fwidth(gq)*1.5; vec2 gl = smoothstep(fw, vec2(0.), abs(fract(gq+0.5)-0.5));
    c = mix(vec3(0.05,0.08,0.12)+0.1*vec3(d,0.), vec3(1.), max(gl.x, gl.y));
    c += vec3(1.,0.8,0.3)*smoothstep(0.012,0.,abs(length((d-0.5)*vec2(asp,1.))-0.25)); }
  return c;
}
void main(){ vec2 uv = vec2(vUv.x, 1.-vUv.y); float ma, mb;
  vec3 a = door(uA, uHA, uGA, uAspA, uv, ma); vec3 b = door(uB, uHB, uGB, uAspB, uv, mb);
  o = vec4(a*ma + b*mb + uFlashCut*max(ma, mb), max(ma, mb)); }`;

const R = { gl: null };
const tmpCells = { a: new Float32Array(64), b: new Float32Array(64), s: new Float32Array(64) };
function clipUniforms(clip, st, aspect, w, h, cells, grid) {
  const P = PALETTES[clip.palette] || PALETTES.classic;
  let cols = P.c.map(hexToLin);
  if (P.music) cols = [0, 0.12, 0.33, 0.5].map(o => hsv2rgb(st.hue + o, 0.85, 1).map(v => v * v));
  if (P.spin) { const sh = st.beat * 0.0625; const A = P.c.map(hexToLin); cols = [0, 1, 2, 3].map(i => { const f = fract(sh + i * 0.25) * 4; const k = Math.floor(f), fr = f - k; return A[k % 4].map((v, j) => lerp(v, A[(k + 1) % 4][j], fr)); }); }
  const pm = clip.params || [];
  return {
    uRes: [w, h], uAspect: aspect, uTime: st.t, uBeat: st.beat, uBeatPhase: st.beatPhase, uBar: st.bar, uBarPhase: st.barPhase, uBpb: st.bpb, uBeatDur: st.beatDur, uGroup: st.group,
    uHit: st.hit, uAcc: st.acc, uFlow: st.flow, uGlow: st.glow, uFlash: st.flash, uEnergy: st.energy, uLevel: st.level, uSecPhase: st.secPhase,
    uTravel: st.travel * (clip.speed ?? 1), uHue: st.hue, uPitch: st.pitch, uSpeed: clip.speed ?? 1, uIntensity: clip.intensity ?? 1, uSeed: 0,
    uHitEv: { v4: st.hitEv }, uAccEv: { v4: st.accEv }, uHitNext: st.hitNext, uHitNextSeed: st.hitNextSeed, uPal: { v3: new Float32Array(cols.flat()) },
    uCells: { v4: cells }, uGrid: grid, uParam: [pm[0] ?? 0.5, pm[1] ?? 0.5, pm[2] ?? 0.5, pm[3] ?? 0.5], uBand0: st.band0, uBand1: st.band1,
  };
}
function clipOpacity(clip, t, beatDur) {
  const fi = (clip.fadeIn || 0) * beatDur, fo = (clip.fadeOut || 0) * beatDur;
  let o = clip.opacity ?? 1;
  if (fi > 0) o *= clamp((t - clip.start) / fi, 0, 1);
  if (fo > 0) o *= clamp((clip.end - t) / fo, 0, 1);
  return o * o * (3 - 2 * o) || 0;
}
function activeClips(t) { return App.clips.filter(c => t >= c.start && t < c.end).sort((a, b) => a.track - b.track); }

function renderFrame(t, opts = {}) {
  const r = R.gl; const gl = r.gl; const song = App.song; if (!song) return null;
  const W = r.c.width, H = r.c.height; const d = App.doors;
  const tt = t + (App.settings.offsetMs || 0) / 1000;
  const base = baseState(tt, song);
  let corners = (opts.flat || !d.corners) ? flatCorners(d) : d.corners;
  const only = opts.only || null; // 'a' = main door fills the frame, 'b' = single door fills the frame
  if (only) { const full = [[0, 1], [1, 1], [1, 0], [0, 0]], off = [[2, 2], [2.01, 2], [2.01, 1.99], [2, 1.99]]; corners = only === 'a' ? { a: full, b: off } : { a: off, b: full }; }
  const pxSize = (pts) => [Math.hypot((pts[1][0] - pts[0][0]) * W, (pts[1][1] - pts[0][1]) * H), Math.hypot((pts[3][0] - pts[0][0]) * W, (pts[3][1] - pts[0][1]) * H)];
  const q = opts.quality || 1;
  const [awp, ahp] = pxSize(corners.a), [bwp, bhp] = pxSize(corners.b);
  const aspA = d.aw / d.ah, aspB = d.bw / d.bh;
  const accA = r.fbo('accA', awp * q, ahp * q), accB = r.fbo('accB', bwp * q, bhp * q);
  for (const f of [accA, accB]) { gl.bindFramebuffer(gl.FRAMEBUFFER, f.fb); gl.viewport(0, 0, f.w, f.h); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
  const layerProg = r.program('layer', LAYER_FS);
  const clips = App.testPattern ? [] : activeClips(tt);
  let li = 0; const info = [];
  for (const clip of clips) {
    const sc = SCENES[clip.fx]; if (!sc) continue;
    const op = clipOpacity(clip, tt, song.beatDur); if (op <= 0.002) continue;
    const st = clipState(tt, clip, song, base); info.push({ clip, st });
    patternCells(clip, st, 'a', d, tmpCells.a, d.ac, d.ar);
    patternCells(clip, st, 'b', d, tmpCells.b, d.bc, d.br);
    const mask = clip.pattern !== 'off' && clip.patMask && !sc.cells ? 1 : 0;
    let mode = clip.doors || 'both'; if (sc.perDoor && mode === 'span') mode = 'both';
    const prog = r.program('scene:' + clip.fx, sceneSource(sc));
    const scale = (sc.res || 1) * q;
    const renderTo = (key, aspect, pw, ph, cells, grid) => { const fb = r.fbo(key, pw * scale, ph * scale); r.draw(prog, fb, clipUniforms(clip, st, aspect, fb.w, fb.h, cells, grid)); return fb; };
    const add = (src, rect, target, cells, grid) => {
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      r.draw(layerProg, target, { uR: rect, uOp: op, uC: { v4: cells }, uG: grid, uMask: mask, uFloor: clip.floor ?? 0.12 }, { uT: src.tex });
      gl.disable(gl.BLEND);
    };
    const wantA = only !== 'b', wantB = only !== 'a';
    if (mode === 'span') {
      const total = d.aw + d.gap + d.bw, hh = Math.max(d.ah, d.bh);
      const spanH = only ? (only === 'a' ? ahp : bhp) * hh / (only === 'a' ? d.ah : d.bh) : Math.max(ahp, bhp) * 0.9;
      const fb = renderTo('L' + li + 's', total / hh, spanH * total / hh, spanH, tmpCells.a, [d.ac, d.ar]);
      if (wantA) add(fb, [0, (hh - d.ah) / hh, d.aw / total, d.ah / hh], accA, tmpCells.a, [d.ac, d.ar]);
      if (wantB) add(fb, [(d.aw + d.gap) / total, (hh - d.bh) / hh, d.bw / total, d.bh / hh], accB, tmpCells.b, [d.bc, d.br]);
    } else {
      if (wantA && (mode === 'both' || mode === 'main')) add(renderTo('L' + li + 'a', aspA, awp, ahp, tmpCells.a, [d.ac, d.ar]), [0, 0, 1, 1], accA, tmpCells.a, [d.ac, d.ar]);
      if (wantB && (mode === 'both' || mode === 'single')) add(renderTo('L' + li + 'b', aspB, bwp, bhp, tmpCells.b, [d.bc, d.br]), [0, 0, 1, 1], accB, tmpCells.b, [d.bc, d.br]);
    }
    li++;
  }
  // flash cut at the start of clips that ask for it
  let flashCut = 0;
  for (const c of clips) if (c.flashIn && tt - c.start < 0.35) flashCut = Math.max(flashCut, (1 - (tt - c.start) / 0.35) * 0.8);
  const comp = r.fbo('comp', W, H);
  r.draw(r.program('composite2', COMPOSITE2_FS), comp, {
    uHA: { m3: homographyInv(corners.a) }, uHB: { m3: homographyInv(corners.b) }, uFeather: only ? 0.0004 : (d.feather ?? 0.006), uTest: App.testPattern ? 1 : 0, uOutAspect: W / H,
    uAspA: aspA, uAspB: aspB, uGA: [d.ac, d.ar], uGB: [d.bc, d.br], uFlashCut: flashCut,
  }, { uA: accA.tex, uB: accB.tex });
  const blur = r.program('blur', BLUR_FS); const bl = {}; let src = comp;
  for (const [div, k] of [[2, 'b1'], [4, 'b2'], [8, 'b3']]) {
    const t1 = r.fbo(k + 'h', W / div, H / div), t2 = r.fbo(k + 'v', W / div, H / div);
    r.draw(blur, t1, { uDir: [1.5 / t1.w, 0], uThresh: div === 2 ? 0.7 : 0 }, { uT: src.tex });
    r.draw(blur, t2, { uDir: [0, 1.5 / t2.h], uThresh: 0 }, { uT: t1.tex });
    bl[k] = t2; src = t2;
  }
  r.draw(r.program('final', FINAL_FS), null, { uBloom: App.testPattern ? 0 : 0.7, uSpill: d.spill ? 1 : 0, uMaster: App.settings.master ?? 1 }, { uC: comp.tex, uB1: bl.b1.tex, uB2: bl.b2.tex, uB3: bl.b3.tex });
  return { base, info };
}
