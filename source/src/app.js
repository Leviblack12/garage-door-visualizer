/* App v2: drag in a song -> in-browser analysis -> timeline of effect clips -> live preview with audio -> MP4 */
const $ = (id) => document.getElementById(id);
const canvas = $('out');
const App = {
  song: null, audio: null, clips: [], settings: { offsetMs: 0, guard: true, master: 1 }, doors: migrateDoors(lsGet('gdv2.doors', defaultDoors())),
  sel: null, armed: null, testPattern: false, editCorners: false, exporting: false, songKey: '',
  play: { playing: false, pos: 0, ctx: null, src: null, startAt: 0, wallStart: 0, pos0: 0 },
};
function migrateDoors(d) { if (d && d.aw === 16 && d.ah === 7 && d.bw === 9 && d.bh === 7 && !d.cornersEdited) { d.aw = 15.5; d.bw = 8; d.corners = null; } return d; }
const TL = { gut: 78, pps: 20, scroll: 0, h: 196, ruler: 22, lane: 44, track: 42, drag: null, dirty: true, snap: 'bar' };
const CAT_COLORS = { DJ: '#ff7ac8', Christmas: '#ff6b6b', Candy: '#ff9fb2', Stars: '#8fd3ff', Faith: '#f4c76e', Music: '#7cf0c8', Patterns: '#ffd36b', Motion: '#b58cff' };
function fxGroup(fx) { return CAT_GROUP[(SCENES[fx] || {}).cat] || 'Motion'; }
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
let toastT = 0; function toast(msg, ms = 3500) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms); }
function fmtBar(t) { if (!App.song) return ''; const bi = App.song.beatInfo(t + 1e-4); return (bi.bar + 1) + '.' + bi.pos; }

/* ---------------- saving / downloads (works as a claude.ai artifact and as a local file) */
let dlCap; async function getDownloads() { if (dlCap !== undefined) return dlCap; dlCap = null; try { if (window.claude && typeof claude.use === 'function') dlCap = await claude.use('downloads'); } catch (e) { dlCap = null; } return dlCap; }
async function saveFile(name, blob) {
  if (window.gdvNative) { try { const r = await window.gdvNative.saveFile(name, await blob.arrayBuffer()); if (r) toast('Saved ' + r, 5000); return !!r; } catch (e) { toast('Could not save: ' + e.message); return false; } }
  const dl = await getDownloads();
  if (dl) { try { await dl.save({ filename: name, data: blob }); toast('Saved ' + name); return true; } catch (e) { if (e && e.code !== 'declined') toast('Could not save: ' + (e.message || e.code)); return false; } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000); return true;
}

/* ---------------- audio */
function ensureCtx() { if (!App.play.ctx) App.play.ctx = new (window.AudioContext || window.webkitAudioContext)(); return App.play.ctx; }
function curTime() { const P = App.play; if (!P.playing) return P.pos; if (P.src) return P.ctx.currentTime - P.startAt - (P.ctx.outputLatency || P.ctx.baseLatency || 0); return P.pos0 + (performance.now() - P.wallStart) / 1000; }
function startAudio(from) {
  const P = App.play; from = clamp(from, 0, App.song.duration - 0.05);
  if (App.audio) {
    const ctx = ensureCtx(); if (ctx.state === 'suspended') ctx.resume();
    const src = ctx.createBufferSource(); src.buffer = App.audio; src.connect(ctx.destination);
    P.startAt = ctx.currentTime - from + 0.04; src.start(ctx.currentTime + 0.04, from); P.src = src;
    src.onended = () => { if (P.src === src) { P.playing = false; P.pos = App.song.duration; P.src = null; updatePlay(); } };
  } else { P.src = null; P.pos0 = from; P.wallStart = performance.now(); }
  P.playing = true; updatePlay();
}
function stopAudio() { const P = App.play; if (P.src) { try { P.src.onended = null; P.src.stop(); } catch (e) { /* already stopped */ } } P.src = null; P.playing = false; updatePlay(); }
function togglePlay() { if (!App.song) return; if (App.play.playing) { App.play.pos = curTime(); stopAudio(); } else startAudio(App.play.pos >= App.song.duration - 0.1 ? 0 : App.play.pos); }
function seek(t) { if (!App.song) return; t = clamp(t, 0, App.song.duration); const was = App.play.playing; stopAudio(); App.play.pos = t; if (was) startAudio(t); TL.dirty = true; }
function updatePlay() { $('btnPlay').textContent = App.play.playing ? 'Pause' : 'Play'; }

/* ---------------- analysis */
function showAnalyzing(label, f, title) { $('dropzone').hidden = true; $('analyzing').hidden = false; if (title) $('anaTitle').textContent = title; $('anaLabel').textContent = label; $('anaBar').firstElementChild.style.width = Math.round(f * 100) + '%'; }
function runAnalyzer(mono, name) {
  return new Promise((resolve, reject) => {
    let worker = null;
    try { const src = $('gdv-analyzer').textContent; worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))); } catch (e) { worker = null; }
    const fallback = () => { setTimeout(() => { try { resolve(window.__analyzeAudio(mono, 22050, { name, onProgress: () => { } })); } catch (e) { reject(e); } }, 60); };
    if (!worker) { showAnalyzing('Analyzing (this tab may pause for a few seconds)', 0.3); fallback(); return; }
    const copy = mono.slice();
    worker.onmessage = (e) => { const m = e.data; if (m.type === 'progress') showAnalyzing(m.label, 0.1 + 0.88 * m.f); else if (m.type === 'done') { worker.terminate(); resolve(m.json); } else if (m.type === 'error') { worker.terminate(); reject(new Error(m.message)); } };
    worker.onerror = (e) => { worker.terminate(); showAnalyzing('Analyzing on the main thread', 0.3); fallback(); e.preventDefault && e.preventDefault(); };
    worker.postMessage({ mono: copy, sr: 22050, name }, [copy.buffer]);
  });
}
async function openAudio(file) {
  try {
    stopAudio(); showAnalyzing('Decoding audio', 0.03, 'Listening to "' + file.name.replace(/\.[^.]+$/, '') + '"');
    const buf = await ensureCtx().decodeAudioData(await file.arrayBuffer());
    const name = file.name.replace(/\.[^.]+$/, '');
    const key = name + '|' + buf.duration.toFixed(2);
    let json = lsGet('gdv2.ana.' + key, null);
    if (!json) {
      showAnalyzing('Preparing audio', 0.06);
      const off = new OfflineAudioContext(1, Math.ceil(buf.duration * 22050), 22050);
      const s = off.createBufferSource(); s.buffer = buf; s.connect(off.destination); s.start();
      const mono = (await off.startRendering()).getChannelData(0);
      const t0 = performance.now();
      json = await runAnalyzer(mono, name);
      json.song = name; json.source = file.name;
      lsSet('gdv2.ana.' + key, json);
      console.log('analysis', ((performance.now() - t0) / 1000).toFixed(1) + 's');
    }
    loadSong(json, buf, key);
  } catch (e) { console.error(e); $('analyzing').hidden = true; $('dropzone').hidden = !!App.song; toast('Could not read that file: ' + e.message, 6000); }
}
function loadSong(json, buf, key, project) {
  const song = extendSong(new Song(json));
  App.song = song; App.audio = buf || null; App.songKey = key || song.name;
  App.origPos = { pos: song.beatPos.slice(), bar: song.beatBar.slice() };
  const saved = project || lsGet('gdv2.proj.' + App.songKey, null);
  if (saved && saved.clips) { App.clips = saved.clips; App.settings = Object.assign({ offsetMs: 0, guard: true, master: 1 }, saved.settings || {}); CLIP_ID = Math.max(CLIP_ID, ...App.clips.map(c => c.id + 1)); if (saved.barShift) shiftBars(saved.barShift, true); if (saved.bpb) setBpb(saved.bpb, true); }
  else { App.clips = autoFill(song, $('selStyle').value); App.settings = { offsetMs: 0, guard: true, master: 1 }; }
  App.sel = null; App.play.pos = 0; stopAudio();
  buildTravel(); prepClips(); histReset();
  $('analyzing').hidden = true; $('dropzone').hidden = true;
  $('songname').textContent = song.name; $('pillTempo').hidden = false; $('pillTempo').textContent = song.tempo.toFixed(1) + ' BPM ' + song.bpb + '/4'; $('pillKey').hidden = !song.key; $('pillKey').textContent = song.key;
  for (const id of ['btnPlay', 'btnStop', 'btnSaveProj', 'btnGo', 'btnAdd', 'btnAuto', 'btnClear']) $(id).disabled = false; histButtons();
  fitTimeline(); refreshSongPane(); refreshClipPane(); TL.dirty = true;
  toast(App.audio ? 'Ready. Press Play or Space.' : 'Loaded without audio');
}
function saveLocal() { if (!App.song || (App.song.j && App.song.j.demo)) return; lsSet('gdv2.proj.' + App.songKey, projectData(false)); }
let saveT = 0; function changed(rebuild) { if (rebuild) prepClips(); clearTimeout(saveT); saveT = setTimeout(saveLocal, 400); TL.dirty = true; histSchedule(); }

/* ---------------- undo / redo (Cmd+Z, Shift+Cmd+Z): snapshots of clips + song settings */
const H = { undo: [], redo: [], cur: null, t: 0 };
function histSnap() { return JSON.stringify({ clips: App.clips.map(c => { const o = Object.assign({}, c); delete o._flash; return o; }), settings: App.settings, barShift: App.barShift || 0, bpbSet: App.bpbSet || 0 }); }
function histReset() { clearTimeout(H.t); H.undo = []; H.redo = []; H.cur = App.song ? histSnap() : null; histButtons(); }
function histSchedule() { clearTimeout(H.t); H.t = setTimeout(histCommit, 350); }
function histCommit() { clearTimeout(H.t); if (!App.song || H.cur == null) return; const s = histSnap(); if (s === H.cur) return; H.undo.push(H.cur); if (H.undo.length > 300) H.undo.shift(); H.cur = s; H.redo = []; histButtons(); }
function histApply(snap) {
  const o = JSON.parse(snap); App.clips = o.clips; App.settings = o.settings;
  if ((o.barShift || 0) !== (App.barShift || 0) || (o.bpbSet || 0) !== (App.bpbSet || 0)) { App.barShift = 0; setBpb(o.bpbSet || 0, true); if (o.barShift) shiftBars(o.barShift, true); }
  if (!App.clips.some(c => c.id === App.sel)) App.sel = null;
  prepClips(); refreshClipPane(); refreshSongPane(); refreshCards(); TL.dirty = true; clearTimeout(saveT); saveT = setTimeout(saveLocal, 400); histButtons();
}
function undo() { histCommit(); if (!H.undo.length) { toast('Nothing to undo', 1500); return; } H.redo.push(H.cur); H.cur = H.undo.pop(); histApply(H.cur); toast('Undo', 900); }
function redo() { histCommit(); if (!H.redo.length) { toast('Nothing to redo', 1500); return; } H.undo.push(H.cur); H.cur = H.redo.pop(); histApply(H.cur); toast('Redo', 900); }
function histButtons() { const u = $('btnUndo'), r = $('btnRedo'); if (u) u.disabled = !App.song || !H.undo.length && !(H.cur != null && App.song && histSnap() !== H.cur); if (r) r.disabled = !H.redo.length; }
function isTextField(el) { if (!el) return false; if (el.tagName === 'TEXTAREA' || el.isContentEditable) return true; return el.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button', 'file', 'color'].includes(el.type); }
function menuUndo(isRedo) { if (isTextField(document.activeElement)) { document.execCommand(isRedo ? 'redo' : 'undo'); return; } isRedo ? redo() : undo(); }
function projectData(withAnalysis) {
  const p = { format: 'gdv-project/2', song: App.song.name, key: App.songKey, clips: App.clips.map(c => { const o = Object.assign({}, c); delete o._flash; return o; }), settings: App.settings, doors: App.doors, barShift: App.barShift || 0, bpb: App.bpbSet || 0 };
  if (withAnalysis) p.analysis = App.song.j;
  return p;
}

/* ---------------- bars: shift / beats per bar */
function rebuildBarEvents(song) {
  song.events.downbeat = song.beats.filter((t, i) => song.beatPos[i] === 1).map(t => [t, 1]);
  song.j.downbeats = song.events.downbeat.map(e => e[0]); extendSong(song);
}
function shiftBars(delta, silent) {
  const s = App.song; const bpb = s.bpb; App.barShift = ((App.barShift || 0) + delta) % bpb;
  let bar = -1; s.beatPos = s.beatPos.map(p => (((p - 1 - delta) % bpb) + bpb) % bpb + 1);
  s.beatBar = s.beatPos.map(p => (p === 1 ? ++bar : Math.max(bar, -1)));
  rebuildBarEvents(s); prepClips(); TL.dirty = true; if (!silent) { changed(); toast('Bars shifted ' + (delta > 0 ? '+1' : '-1') + ' beat'); refreshSongPane(); }
}
function setBpb(n, silent) {
  const s = App.song; App.bpbSet = n;
  if (!n) { s.beatPos = App.origPos.pos.slice(); s.beatBar = App.origPos.bar.slice(); s.bpb = s.j.beatsPerBar || 4; }
  else { const a = Math.max(0, s.beatPos.indexOf(1)); s.bpb = n; s.beatPos = s.beats.map((_, i) => ((((i - a) % n) + n) % n) + 1); s.beatBar = s.beats.map((_, i) => Math.floor((i - a) / n)); }
  rebuildBarEvents(s); prepClips(); TL.dirty = true; if (!silent) { changed(); refreshSongPane(); }
}

/* ---------------- timeline */
const tl = $('timeline');
function tlX(t) { return TL.gut + (t - TL.scroll) * TL.pps; }
function tlT(x) { return (x - TL.gut) / TL.pps + TL.scroll; }
function tlW() { return Math.max(50, tl.clientWidth - TL.gut); }
function trackY(k) { return TL.ruler + TL.lane + k * TL.track; }
function fitTimeline() { const w = tlW(); TL.pps = Math.max(2, (w - 12) / App.song.duration); TL.minPps = TL.pps; TL.scroll = 0; $('zoom').value = 0; }
function snapT(t) {
  const s = App.song; if (!s || TL.snap === 'off') return t;
  const list = TL.snap === 'bar' ? s.events.downbeat.map(e => e[0]) : s.beats;
  if (!list.length) return t; let best = list[0];
  for (const b of list) if (Math.abs(b - t) < Math.abs(best - t)) best = b;
  if (t < list[0] * 0.5) best = 0; if (Math.abs(s.duration - t) < Math.abs(best - t)) best = s.duration;
  return best;
}
function drawTimeline() {
  const dpr = window.devicePixelRatio || 1; const w = tl.clientWidth, h = TL.h; tl.style.height = h + 'px';
  if (tl.width !== Math.round(w * dpr) || tl.height !== Math.round(h * dpr)) { tl.width = Math.round(w * dpr); tl.height = Math.round(h * dpr); }
  const g = tl.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  g.fillStyle = '#0d121d'; g.fillRect(0, 0, w, h);
  const s = App.song; if (!s) { g.fillStyle = '#5d6782'; g.font = '12px Inter, system-ui, sans-serif'; g.fillText('The timeline appears here once a song is loaded.', 14, 40); return; }
  // tracks background
  for (let k = 0; k < 3; k++) { g.fillStyle = k % 2 ? '#0f1522' : '#111829'; g.fillRect(0, trackY(k), w, TL.track); }
  // sections lane
  const y0 = TL.ruler, LV = ['#1d2840', '#26375a', '#5e4a1e', '#6b2a2a'];
  for (const sec of s.sections) {
    const x0 = tlX(sec.start), x1 = tlX(sec.end); if (x1 < 0 || x0 > w) continue;
    g.fillStyle = LV[sec.level || 0]; g.fillRect(x0 + 1, y0 + 2, Math.max(1, x1 - x0 - 2), TL.lane - 4);
    g.save(); g.beginPath(); g.rect(x0 + 2, y0, x1 - x0 - 4, TL.lane); g.clip();
    g.fillStyle = '#e8eaf1'; g.font = '600 11px Inter, system-ui, sans-serif'; g.fillText((sec.name || sec.label || '') + (sec.drop ? '  · drop' : ''), x0 + 6, y0 + 15); g.restore();
  }
  // loudness curve
  g.strokeStyle = 'rgba(143,211,255,.55)'; g.lineWidth = 1; g.beginPath();
  for (let x = 0; x < w; x += 2) { const t = tlT(x); if (t < 0 || t > s.duration) continue; const v = s.envAt('mix', t); g.lineTo(x, y0 + TL.lane - 4 - v * (TL.lane - 18)); }
  g.stroke();
  // ruler: bars / beats
  g.fillStyle = '#0a0e17'; g.fillRect(0, 0, w, TL.ruler);
  const barW = s.beatDur * s.bpb * TL.pps; const every = barW > 60 ? 1 : barW > 28 ? 2 : barW > 12 ? 4 : barW > 5 ? 8 : 16;
  g.font = '10px JetBrains Mono, monospace';
  for (let i = 0; i < s.beats.length; i++) {
    const x = tlX(s.beats[i]); if (x < -20 || x > w + 20) continue; const db = s.beatPos[i] === 1;
    if (db) { const bar = s.beatBar[i] + 1; if (bar % every === 0 || every === 1) { g.fillStyle = '#8b94aa'; g.fillText(String(bar), x + 3, 14); g.fillStyle = '#2f3b57'; g.fillRect(x, 0, 1, h); } else { g.fillStyle = '#1b2336'; g.fillRect(x, TL.ruler, 1, h - TL.ruler); } }
    else if (barW / s.bpb > 7) { g.fillStyle = '#161e2f'; g.fillRect(x, TL.ruler + TL.lane, 1, h); }
  }
  // clips
  for (const c of App.clips) {
    const x0 = tlX(c.start), x1 = tlX(c.end), y = trackY(c.track) + 3, hh = TL.track - 6; if (x1 < 0 || x0 > w) continue;
    const col = CAT_COLORS[fxGroup(c.fx)] || '#8b94aa'; const sel = App.sel === c.id;
    g.fillStyle = sel ? 'rgba(244,199,110,.22)' : 'rgba(255,255,255,.06)'; g.strokeStyle = sel ? '#f4c76e' : col;
    g.beginPath(); g.roundRect ? g.roundRect(x0 + 1, y, Math.max(2, x1 - x0 - 2), hh, 6) : g.rect(x0 + 1, y, Math.max(2, x1 - x0 - 2), hh); g.fill(); g.lineWidth = sel ? 2 : 1; g.stroke();
    g.fillStyle = col; g.fillRect(x0 + 1, y, 4, hh);
    const fi = (c.fadeIn || 0) * s.beatDur * TL.pps, fo = (c.fadeOut || 0) * s.beatDur * TL.pps;
    g.strokeStyle = 'rgba(232,234,241,.35)'; g.beginPath(); g.moveTo(x0 + 1, y + hh); g.lineTo(x0 + 1 + fi, y + 2); g.lineTo(x1 - 1 - fo, y + 2); g.lineTo(x1 - 1, y + hh); g.stroke();
    g.save(); g.beginPath(); g.rect(x0 + 8, y, x1 - x0 - 12, hh); g.clip();
    g.fillStyle = '#e8eaf1'; g.font = '600 11px Inter, system-ui, sans-serif'; g.fillText((SCENES[c.fx] || {}).name || c.fx, x0 + 10, y + 15);
    g.fillStyle = '#8b94aa'; g.font = '10px Inter, system-ui, sans-serif'; g.fillText('Hit: ' + (TRIGGERS[c.hit.src] || c.hit.src) + (c.pattern !== 'off' ? '  ·  ' + PATTERN_NAMES[c.pattern] + ' / ' + (TRIGGERS[c.patOn] || c.patOn) : ''), x0 + 10, y + 29);
    g.restore();
  }
  if (TL.ghost) { const gx = tlX(TL.ghost.t); g.fillStyle = 'rgba(244,199,110,.25)'; g.fillRect(gx, trackY(TL.ghost.track) + 3, Math.max(30, 4 * s.beatDur * s.bpb * TL.pps), TL.track - 6); }
  g.fillStyle = '#0a0e17'; g.fillRect(0, 0, TL.gut, h); g.fillStyle = '#222c42'; g.fillRect(TL.gut - 1, 0, 1, h);
  g.font = '600 9.5px Inter, system-ui, sans-serif'; g.fillStyle = '#8b94aa'; g.fillText('BAR', 10, 15); g.fillText('SONG', 10, TL.ruler + 17);
  for (let k = 0; k < 3; k++) { g.fillStyle = '#8b94aa'; g.fillText(TRACKS[k].toUpperCase(), 10, trackY(k) + 24); }
  const px = tlX(curTime()); if (px < TL.gut) { TL.dirty = false; return; } g.fillStyle = '#ffffff'; g.fillRect(px - 1, 0, 2, h); g.beginPath(); g.moveTo(px - 6, 0); g.lineTo(px + 6, 0); g.lineTo(px, 8); g.fill();
  TL.dirty = false;
}
function hitClip(x, y) {
  const k = Math.floor((y - trackY(0)) / TL.track); if (k < 0 || k > 2) return null;
  const t = tlT(x); const c = App.clips.filter(c => c.track === k && t >= c.start && t <= c.end).pop();
  if (!c) return { track: k, t };
  const ex = 7 / TL.pps; const edge = Math.abs(t - c.start) < ex ? 'start' : Math.abs(t - c.end) < ex ? 'end' : null;
  return { track: k, t, clip: c, edge };
}
function sectionSpan(t) {
  const s = App.song; const sec = s.sections.find(x => t >= x.start && t < x.end) || s.sections[s.sections.length - 1];
  const barLen = s.beatDur * s.bpb; let a = sec.start, b = sec.end;
  if (b - a > barLen * 16.5) { a = snapT(t); if (TL.snap === 'off') a = t; b = Math.min(sec.end, a + barLen * 8); }
  return [a, b];
}
function addClip(fx, t, track) {
  const s = App.song; const [a, b] = sectionSpan(t);
  const c = smartReact(s, defaultClip(fx, a, b, track)); App.clips.push(c); select(c.id); changed(true);
  toast('Added ' + SCENES[fx].name + ' (' + fmtBar(a) + ' to ' + fmtBar(b) + ')');
}
tl.addEventListener('pointerdown', (e) => {
  if (!App.song) return; tl.setPointerCapture(e.pointerId);
  const r = tl.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top;
  if (x < TL.gut) return;
  if (y < TL.ruler + TL.lane) { TL.drag = { mode: 'scrub' }; seek(tlT(x)); return; }
  const hc = hitClip(x, y); if (!hc) return;
  if (hc.clip) { select(hc.clip.id); TL.drag = { mode: hc.edge || 'move', clip: hc.clip, t0: hc.t, s0: hc.clip.start, e0: hc.clip.end, tr0: hc.clip.track, moved: false }; }
  else { if (App.sel != null) select(null); TL.drag = { mode: 'scrub' }; seek(hc.t); } // empty space: deselect + move the playhead (effects are added by dragging a card)
});
tl.addEventListener('pointermove', (e) => {
  const r = tl.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top;
  const D = TL.drag;
  if (!D) { const hc = (y > trackY(0)) ? hitClip(x, y) : null; tl.style.cursor = hc && hc.clip ? (hc.edge ? 'ew-resize' : 'grab') : 'pointer'; return; }
  const t = tlT(x); const minLen = App.song.beatDur;
  if (D.mode === 'scrub') { seek(t); return; }
  D.moved = true; const c = D.clip;
  if (D.mode === 'move') { const len = D.e0 - D.s0; let ns = snapT(D.s0 + (t - D.t0)); ns = clamp(ns, 0, App.song.duration - len); c.start = ns; c.end = ns + len; const k = clamp(Math.floor((y - trackY(0)) / TL.track), 0, 2); c.track = k; }
  else if (D.mode === 'start') c.start = clamp(snapT(t), 0, c.end - minLen);
  else if (D.mode === 'end') c.end = clamp(snapT(t), c.start + minLen, App.song.duration);
  TL.dirty = true;
});
tl.addEventListener('pointerup', () => { if (TL.drag && TL.drag.moved) { changed(); refreshClipPane(); } TL.drag = null; });
tl.addEventListener('wheel', (e) => {
  if (!App.song) return; e.preventDefault();
  if (e.ctrlKey || e.metaKey) { const r = tl.getBoundingClientRect(); const x = e.clientX - r.left; const t = tlT(x); TL.pps = clamp(TL.pps * Math.exp(-e.deltaY * 0.002), TL.minPps, 400); TL.scroll = clamp(t - (x - TL.gut) / TL.pps, 0, Math.max(0, App.song.duration - tlW() / TL.pps)); $('zoom').value = Math.log(TL.pps / TL.minPps) / Math.log(400 / TL.minPps); }
  else { TL.scroll = clamp(TL.scroll + (e.deltaX || e.deltaY) / TL.pps, 0, Math.max(0, App.song.duration - tlW() / TL.pps)); }
  TL.dirty = true;
}, { passive: false });
tl.addEventListener('dragover', (e) => { if (!App.song) return; e.preventDefault(); const r = tl.getBoundingClientRect(); const y = e.clientY - r.top; const k = clamp(Math.floor((y - trackY(0)) / TL.track), 0, 2); TL.ghost = { t: snapT(tlT(e.clientX - r.left)), track: k }; TL.dirty = true; });
tl.addEventListener('dragleave', () => { TL.ghost = null; TL.dirty = true; });
tl.addEventListener('drop', (e) => {
  e.preventDefault(); const fx = e.dataTransfer.getData('text/fx'); const gh = TL.ghost; TL.ghost = null; if (!fx || !gh || !App.song) return;
  const r = tl.getBoundingClientRect(); const hc = hitClip(e.clientX - r.left, e.clientY - r.top);
  if (hc && hc.clip) { swapEffect(hc.clip, fx); select(hc.clip.id); return; } // dropped on a clip: swap its effect, keep its timing
  addClip(fx, gh.t + 0.001, gh.track);
});

/* ---------------- effects library */
let thumbR = null, thumbSong = null; const thumbQueue = [];
function fxCardHTML(id) { const sc = SCENES[id]; const sp = { slow: 'Slow', fast: 'Fast', any: 'Any tempo' }[sc.speed] || ''; return '<canvas width="240" height="105"></canvas><div class="meta"><div class="nm">' + esc(sc.name) + '</div><div class="tg"><span class="tempo ' + sc.speed + '">' + sp + '</span><span>' + esc(fxGroup(id)) + '</span></div></div>'; }
function buildFxPanel() {
  const chips = $('fxGroups'); chips.innerHTML = GROUPS.map((g, i) => '<button data-g="' + g + '" class="' + (i ? '' : 'on') + '">' + g + '</button>').join('');
  chips.querySelectorAll('button').forEach(b => b.onclick = () => { chips.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); filterFx(b.dataset.g); });
  const grid = $('fxgrid'); grid.innerHTML = '';
  for (const id of ALL_FX()) {
    if (!SCENES[id]) continue;
    const b = document.createElement('button'); b.className = 'card'; b.dataset.id = id; b.type = 'button'; b.draggable = true; b.innerHTML = fxCardHTML(id);
    b.onclick = () => onFxClick(id); b.ondblclick = () => { if (App.song) addClip(id, curTime() + 0.001, 1); };
    b.ondragstart = (e) => { e.dataTransfer.setData('text/fx', id); e.dataTransfer.effectAllowed = 'copy'; };
    grid.appendChild(b); thumbQueue.push(b);
  }
  requestAnimationFrame(thumbStep);
}
function filterFx(g) { document.querySelectorAll('#fxgrid .card').forEach(c => { c.hidden = !(g === 'All' || fxGroup(c.dataset.id) === g); }); }
function swapEffect(c, id) {
  const keep = { hit: c.hit, acc: c.acc, flow: c.flow, glow: c.glow, decay: c.decay, start: c.start, end: c.end, track: c.track, id: c.id, fadeIn: c.fadeIn, fadeOut: c.fadeOut, intensity: c.intensity, speed: c.speed, doors: c.doors };
  Object.assign(c, defaultClip(id, c.start, c.end, c.track), keep); changed(true); refreshClipPane(); refreshCards(); toast('Clip changed to ' + SCENES[id].name);
}
function onFxClick(id) {
  App.armed = id; refreshCards();
  $('fxHint').innerHTML = '<b>' + esc(SCENES[id].name) + '</b> picked. Drag the card onto a track, double-click it, or press "Add effect at playhead". Drop it on an existing clip to swap that clip\'s effect.';
}
function refreshCards() { const c = App.clips.find(x => x.id === App.sel); document.querySelectorAll('#fxgrid .card').forEach(b => { b.classList.toggle('armed', b.dataset.id === App.armed); b.classList.toggle('current', !!c && b.dataset.id === c.fx); }); }
function thumbStep() {
  const card = thumbQueue.shift(); if (!card) return;
  try { drawThumb(card.dataset.id, card.querySelector('canvas')); } catch (e) { console.warn('thumb', card.dataset.id, e); }
  requestAnimationFrame(thumbStep);
}
function drawThumb(id, cv) {
  if (!thumbR) { const c = document.createElement('canvas'); c.width = 240; c.height = 105; thumbR = new Renderer(c); thumbSong = extendSong(Song.demo()); }
  const s = thumbSong; const t = 26.3; const sc = SCENES[id];
  const bi = s.beatInfo(t);
  const st = { t, beat: bi.cont, beatPhase: bi.phase, bar: bi.barCont, barPhase: fract(bi.barCont), bpb: 4, beatDur: s.beatDur, group: bi.group, energy: 0.8, level: 3, secPhase: 0.3, hue: 0.1, pitch: 0, travel: t * 1.2,
    hit: 0.45, acc: 0.3, flow: 0.6, glow: 0.75, flash: 0, band0: [0.6, 0.7, 0.6, 0.3], band1: [0.6, 0.7, 0.4, 0.8] };
  const clip = defaultClip(id, 0, 60, 1);
  Object.assign(st, (() => { const o = { hitEv: new Float32Array(32), accEv: new Float32Array(32), hitNext: new Float32Array([0.3, 0.8, 99, 99]), hitNextSeed: new Float32Array([0.3, 0.7, 0, 0]) };
    const ages = [0.12, 0.55, 0.95, 1.4, 2.1, 2.8, 999, 999]; ages.forEach((a, k) => { o.hitEv[k * 4] = a; o.hitEv[k * 4 + 1] = a < 99 ? 1 : 0; o.hitEv[k * 4 + 2] = hash1(k * 3.7 + 1.3); o.hitEv[k * 4 + 3] = 40 - k; o.accEv[k * 4] = a * 0.7 + 0.05; o.accEv[k * 4 + 1] = a < 99 ? 0.8 : 0; o.accEv[k * 4 + 2] = hash1(k * 5.1 + 2.2); o.accEv[k * 4 + 3] = 30 - k; }); return o; })());
  const cells = new Float32Array(64); for (let i = 0; i < 32; i++) cells[i] = (i % 8 < 3 || (i >> 3) === 1) ? 1 : 0.15;
  const prog = thumbR.program('scene:' + id, sceneSource(sc));
  const aspect = 240 / 105;
  thumbR.draw(prog, null, clipUniforms(clip, st, aspect, 240, 105, cells, [8, 4]));
  cv.getContext('2d').drawImage(thumbR.c, 0, 0);
}

/* ---------------- clip editor */
function select(id) { App.sel = id; refreshClipPane(); refreshCards(); TL.dirty = true; if (id != null) showTab('clip'); }
function showTab(name) { document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('active', x.dataset.tab === name)); document.querySelectorAll('.pane').forEach(p => p.classList.toggle('active', p.id === 'pane-' + name)); }
function optList(map, cur) { return Object.entries(map).map(([k, v]) => '<option value="' + k + '"' + (k === cur ? ' selected' : '') + '>' + esc(v) + '</option>').join(''); }
function trigLabel(k) { const s = App.song; if (!s || k === 'none') return TRIGGERS[k]; const e = s.events[k]; return TRIGGERS[k] + (e ? ' · ' + (e.length / Math.max(1, s.beats.length)).toFixed(2) + '/beat' : ''); }
function trigOptions(cur) { return Object.keys(TRIGGERS).map(k => '<option value="' + k + '"' + (k === cur ? ' selected' : '') + '>' + esc(trigLabel(k)) + '</option>').join(''); }
function levelOptions(cur) { return '<optgroup label="Smooth levels">' + optList(LEVELS, cur) + '</optgroup><optgroup label="Hits (pulses)">' + Object.keys(TRIGGERS).filter(k => k !== 'none').map(k => '<option value="' + k + '"' + (k === cur ? ' selected' : '') + '>' + esc(TRIGGERS[k]) + '</option>').join('') + '</optgroup>'; }
function refreshClipPane() {
  const c = App.clips.find(x => x.id === App.sel); const ed = $('clipEditor');
  $('clipEmpty').hidden = !!c; ed.hidden = !c; if (!c) { ed.innerHTML = ''; return; }
  const sc = SCENES[c.fx]; const s = App.song;
  const pal = Object.entries(PALETTES).map(([k, v]) => '<option value="' + k + '"' + (k === c.palette ? ' selected' : '') + '>' + esc(v.name) + '</option>').join('');
  const params = (sc.params || []).map((p, i) => '<div class="row3"><label for="cp' + i + '">' + esc(p.name) + '</label><input id="cp' + i + '" data-p="' + i + '" type="range" min="0" max="1" step="0.01" value="' + (c.params[i] ?? p.def) + '"><span class="val">' + Math.round((c.params[i] ?? p.def) * 100) + '</span></div>').join('');
  const reactRow = (key, label, color, isLevel) => '<div class="react"><span class="tag" style="color:' + color + '">' + label + '</span><select data-r="' + key + '">' + (isLevel ? levelOptions(c[key].src) : trigOptions(c[key].src)) + '</select><input data-ra="' + key + '" type="range" min="0" max="2" step="0.05" value="' + c[key].amt + '" title="Amount"></div>';
  ed.innerHTML = '<div class="group"><div class="clipHead"><canvas id="clipThumb" width="240" height="105"></canvas><div><div class="t">' + esc(sc.name) + '</div><div class="s">bar ' + fmtBar(c.start) + ' to ' + fmtBar(c.end) + ' · ' + TRACKS[c.track] + '</div></div></div>'
    + '<div class="row"><label for="cFx">Effect</label><select id="cFx">' + GROUPS.filter(g => g !== 'All').map(g => '<optgroup label="' + g + '">' + ALL_FX().filter(id => SCENES[id] && fxGroup(id) === g).map(id => '<option value="' + id + '"' + (id === c.fx ? ' selected' : '') + '>' + esc(SCENES[id].name) + '</option>').join('') + '</optgroup>').join('') + '</select></div>'
    + '<div class="note">Swapping keeps this clip\'s timing and reactions. You can also drop an effect card on the clip.</div></div>'
    + '<div class="group"><h3>Doors</h3><div class="seg" id="cDoors">' + [['both', 'Both doors'], ['span', 'Span across'], ['main', 'Main only'], ['single', 'Single only']].map(([k, v]) => '<button data-v="' + k + '" class="' + (c.doors === k ? 'on' : '') + '">' + v + '</button>').join('') + '</div></div>'
    + '<div class="group"><h3>Look</h3><div class="row"><label for="cPal">Colors</label><select id="cPal">' + pal + '</select></div>'
    + '<div class="row3"><label for="cInt">Brightness</label><input id="cInt" type="range" min="0.1" max="1.6" step="0.01" value="' + c.intensity + '"><span class="val">' + Math.round(c.intensity * 100) + '%</span></div>'
    + '<div class="row3"><label for="cSpd">Speed</label><input id="cSpd" type="range" min="0" max="3" step="0.05" value="' + c.speed + '"><span class="val">' + c.speed.toFixed(2) + 'x</span></div>' + params + '</div>'
    + '<div class="group"><h3>Reacts to</h3><div class="note"><b>Hit</b> bursts &middot; <b>Accent</b> sparks &middot; <b>Flow</b> motion &middot; <b>Glow</b> brightness. Pick any part of the song for each.</div>'
    + reactRow('hit', 'Hit', '#f4c76e', false) + reactRow('acc', 'Accent', '#ff6b6b', false) + reactRow('flow', 'Flow', '#8fd3ff', true) + reactRow('glow', 'Glow', '#5ee6a3', true)
    + '<div class="row3"><label for="cDecay">Hit decay</label><input id="cDecay" type="range" min="0.05" max="1.2" step="0.01" value="' + c.decay + '"><span class="val">' + Math.round(c.decay * 1000) + 'ms</span></div></div>'
    + '<div class="group"><h3>Pattern on the door panels</h3><div class="row"><label for="cPat">Pattern</label><select id="cPat">' + optList(PATTERN_NAMES, c.pattern) + '</select></div>'
    + '<div class="row"><label for="cPatOn">Steps on</label><select id="cPatOn">' + trigOptions(c.patOn) + '</select></div>'
    + '<div class="row"><span class="lbl">Count</span><div class="seg" id="cSteps">' + [1, 2, 3, 4, 6, 8, 16].map(n => '<button data-v="' + n + '" class="' + (c.steps === n ? 'on' : '') + '">' + n + '</button>').join('') + '</div></div>'
    + '<div class="row3"><label for="cTail">Tail</label><input id="cTail" type="range" min="0.15" max="3" step="0.05" value="' + c.tail + '"><span class="val">' + c.tail.toFixed(2) + '</span></div>'
    + (sc.cells ? '<div class="note">This effect lights its own parts with the pattern.</div>' : '<div class="row"><label for="cMask">Apply</label><select id="cMask"><option value="1"' + (c.patMask ? ' selected' : '') + '>Mask the effect by panel</option><option value="0"' + (!c.patMask ? ' selected' : '') + '>Off for this effect</option></select></div><div class="row3"><label for="cFloor">Off level</label><input id="cFloor" type="range" min="0" max="0.6" step="0.01" value="' + c.floor + '"><span class="val">' + Math.round(c.floor * 100) + '%</span></div>') + '</div>'
    + '<div class="group"><h3>Timing</h3><div class="row3"><label for="cFi">Fade in</label><input id="cFi" type="range" min="0" max="16" step="0.5" value="' + c.fadeIn + '"><span class="val">' + c.fadeIn + ' b</span></div>'
    + '<div class="row3"><label for="cFo">Fade out</label><input id="cFo" type="range" min="0" max="16" step="0.5" value="' + c.fadeOut + '"><span class="val">' + c.fadeOut + ' b</span></div>'
    + '<div class="row"><label for="cFlash">Start with</label><select id="cFlash"><option value="0">Fade</option><option value="1"' + (c.flashIn ? ' selected' : '') + '>Flash cut</option></select></div>'
    + '<div class="btns"><button id="cDup">Duplicate</button><button id="cAll">Copy reactions to all clips</button><button id="cDel">Delete</button></div></div>';
  try { drawThumb(c.fx, $('clipThumb')); } catch (e) { /* thumb optional */ }
  const upd = (rebuild) => { changed(rebuild); };
  ed.querySelectorAll('#cDoors button').forEach(b => b.onclick = () => { c.doors = b.dataset.v; ed.querySelectorAll('#cDoors button').forEach(x => x.classList.toggle('on', x === b)); upd(); });
  $('cPal').onchange = (e) => { c.palette = e.target.value; upd(); };
  $('cFx').onchange = (e) => swapEffect(c, e.target.value);
  const rng = (id, key, fmt, rebuild) => { const el = $(id); if (!el) return; el.oninput = () => { c[key] = +el.value; el.nextElementSibling.textContent = fmt(+el.value); upd(rebuild); }; };
  rng('cInt', 'intensity', v => Math.round(v * 100) + '%'); rng('cSpd', 'speed', v => v.toFixed(2) + 'x'); rng('cDecay', 'decay', v => Math.round(v * 1000) + 'ms');
  rng('cTail', 'tail', v => v.toFixed(2)); rng('cFloor', 'floor', v => Math.round(v * 100) + '%'); rng('cFi', 'fadeIn', v => v + ' b'); rng('cFo', 'fadeOut', v => v + ' b');
  ed.querySelectorAll('[data-p]').forEach(el => el.oninput = () => { c.params[+el.dataset.p] = +el.value; el.nextElementSibling.textContent = Math.round(el.value * 100); upd(); });
  ed.querySelectorAll('select[data-r]').forEach(el => el.onchange = () => { c[el.dataset.r].src = el.value; upd(true); });
  ed.querySelectorAll('input[data-ra]').forEach(el => el.oninput = () => { c[el.dataset.ra].amt = +el.value; upd(); });
  $('cPat').onchange = (e) => { c.pattern = e.target.value; if (c.pattern !== 'off' && !sc.cells) c.patMask = true; refreshClipPane(); upd(); };
  $('cPatOn').onchange = (e) => { c.patOn = e.target.value; upd(); };
  ed.querySelectorAll('#cSteps button').forEach(b => b.onclick = () => { c.steps = +b.dataset.v; ed.querySelectorAll('#cSteps button').forEach(x => x.classList.toggle('on', x === b)); upd(); });
  if ($('cMask')) $('cMask').onchange = (e) => { c.patMask = e.target.value === '1'; upd(); };
  $('cFlash').onchange = (e) => { c.flashIn = e.target.value === '1'; upd(); };
  $('cDup').onclick = duplicateSel; $('cDel').onclick = deleteSel;
  $('cAll').onclick = () => { for (const o of App.clips) if (o !== c) { o.hit = Object.assign({}, c.hit); o.acc = Object.assign({}, c.acc); o.flow = Object.assign({}, c.flow); o.glow = Object.assign({}, c.glow); o.decay = c.decay; } changed(true); toast('Reactions copied to every clip'); };
}
function deleteSel() { const i = App.clips.findIndex(x => x.id === App.sel); if (i < 0) return; App.clips.splice(i, 1); App.sel = null; refreshClipPane(); refreshCards(); changed(true); }
function duplicateSel() { const c = App.clips.find(x => x.id === App.sel); if (!c) return; const len = c.end - c.start; const n = JSON.parse(JSON.stringify(Object.assign({}, c, { _flash: null }))); n.id = CLIP_ID++; n.start = Math.min(App.song.duration - len, c.end); n.end = n.start + len; App.clips.push(n); select(n.id); changed(true); }

/* ---------------- song pane */
function refreshSongPane() {
  const s = App.song; if (!s) return; const pb = (k) => eventsPerBeat(s, k).toFixed(2);
  $('songStats').innerHTML = '<b>' + s.tempo.toFixed(1) + ' BPM</b>, ' + s.bpb + ' beats per bar, key ' + esc(s.key || '?') + ', ' + s.sections.length + ' sections, ' + s.beats.length + ' beats.<br>Hits per beat: kick ' + pb('kick') + ', snare ' + pb('snare') + ', hats ' + pb('hats') + ', bass notes ' + pb('bass') + ', melody notes ' + pb('melody') + ', vocal notes ' + pb('vocals') + '.' + (s.j.format && s.j.source && /json/i.test(s.j.source) ? '' : '');
  $('selBpb').value = String(App.bpbSet || 0);
  setR('rgOffset', App.settings.offsetMs, 'vOffset', v => (v > 0 ? '+' : '') + v + 'ms'); setR('rgMaster', App.settings.master ?? 1, 'vMaster', v => Math.round(v * 100) + '%');
  $('chkGuard').checked = App.settings.guard !== false;
}
function setR(id, v, vid, fmt) { $(id).value = v; $(vid).textContent = fmt(+v); }

/* ---------------- doors pane */
function refreshDoors() {
  const d = App.doors; for (const k of ['aw', 'ah', 'bw', 'bh', 'gap', 'ac', 'ar', 'bc', 'br']) $('d' + k[0].toUpperCase() + k.slice(1)).value = d[k];
  setR('rgFeather', d.feather, 'vFeather', v => v.toFixed(3)); $('chkSpill').checked = !!d.spill;
  $('btnTest').classList.toggle('on', App.testPattern); $('btnEdit').classList.toggle('on', App.editCorners); drawHandles();
}
function drawHandles() {
  const box = $('handles'); box.innerHTML = ''; if (!App.editCorners) return;
  const d = App.doors; if (!d.corners) d.corners = flatCorners(d);
  const rc = canvas.getBoundingClientRect(), vb = $('viewport').getBoundingClientRect();
  ['a', 'b'].forEach(door => d.corners[door].forEach((pt, i) => {
    const h = document.createElement('div'); h.className = 'handle' + (door === 'b' ? ' b' : ''); h.title = (door === 'a' ? 'Main door ' : 'Single door ') + ['bottom-left', 'bottom-right', 'top-right', 'top-left'][i];
    const place = (r2) => { h.style.left = (r2.left - vb.left + pt[0] * r2.width) + 'px'; h.style.top = (r2.top - vb.top + pt[1] * r2.height) + 'px'; };
    place(rc);
    h.onpointerdown = (e) => { h.setPointerCapture(e.pointerId); h.onpointermove = (ev) => { const r2 = canvas.getBoundingClientRect(); pt[0] = clamp((ev.clientX - r2.left) / r2.width, 0, 1); pt[1] = clamp((ev.clientY - r2.top) / r2.height, 0, 1); place(r2); }; h.onpointerup = () => { h.onpointermove = null; lsSet('gdv2.doors', App.doors); }; };
    box.appendChild(h);
  }));
}

/* ---------------- export */
async function exportVideo(opt) {
  if (!('VideoEncoder' in window)) throw new Error('This browser cannot encode video. Use Chrome or Edge.');
  const song = App.song; const [w, h] = opt.size; const fps = opt.fps;
  let t0 = 0, t1 = song.duration;
  if (opt.range === 'clip') { const c = App.clips.find(x => x.id === App.sel); if (!c) throw new Error('Select a clip first, or render the whole song.'); t0 = c.start; t1 = c.end; }
  else if (opt.range === '15') t1 = Math.min(15, song.duration);
  if (opt.t0 != null) { t0 = opt.t0; t1 = Math.min(song.duration, opt.t1); }
  const nFrames = Math.round((t1 - t0) * fps);
  const level = (w * h > 1920 * 1080 * 1.01) ? '640033' : (fps > 30 ? '64002A' : '640028');
  const vcfg = { codec: 'avc1.' + level, width: w, height: h, bitrate: opt.bitrate * 1e6, framerate: fps, latencyMode: 'quality', avc: { format: 'avc' } };
  if (!(await VideoEncoder.isConfigSupported(vcfg)).supported) throw new Error('H.264 at ' + w + 'x' + h + ' is not supported by this browser.');
  let useAudio = !!(opt.audio && App.audio && 'AudioEncoder' in window);
  const acfg = useAudio ? { codec: 'mp4a.40.2', sampleRate: App.audio.sampleRate, numberOfChannels: Math.min(2, App.audio.numberOfChannels), bitrate: 256000 } : null;
  if (useAudio) { try { useAudio = (await AudioEncoder.isConfigSupported(acfg)).supported; } catch (e) { useAudio = false; } }
  const target = new Mp4Muxer.ArrayBufferTarget();
  const muxer = new Mp4Muxer.Muxer({ target, fastStart: 'in-memory', firstTimestampBehavior: 'offset', video: { codec: 'avc', width: w, height: h, frameRate: fps }, audio: useAudio ? { codec: 'aac', sampleRate: acfg.sampleRate, numberOfChannels: acfg.numberOfChannels } : undefined });
  let encErr = null; const venc = new VideoEncoder({ output: (ch, meta) => muxer.addVideoChunk(ch, meta), error: (e) => { encErr = e; } }); venc.configure(vcfg);
  App.exporting = true; const pw = canvas.width, ph = canvas.height; canvas.width = w; canvas.height = h; const started = performance.now();
  try {
    for (let f = 0; f < nFrames; f++) {
      if (App.cancelExport) throw new Error('Render cancelled');
      if (encErr) throw encErr;
      renderFrame(t0 + f / fps, { quality: opt.quality || 1.15, flat: opt.flat, only: opt.only });
      const vf = new VideoFrame(canvas, { timestamp: Math.round(f * 1e6 / fps), duration: Math.round(1e6 / fps) });
      venc.encode(vf, { keyFrame: f % (fps * 2) === 0 }); vf.close();
      while (venc.encodeQueueSize > 4) await new Promise(r => setTimeout(r, 1));
      if (f % 10 === 0) { opt.onProgress && opt.onProgress(f / nFrames, (performance.now() - started) / 1000); await new Promise(r => setTimeout(r, 0)); }
    }
    await venc.flush();
    if (useAudio) {
      let aerr = null; const aenc = new AudioEncoder({ output: (ch, meta) => muxer.addAudioChunk(ch, meta), error: (e) => { aerr = e; } }); aenc.configure(acfg);
      const sr = App.audio.sampleRate, nc = acfg.numberOfChannels; const s0 = Math.round(t0 * sr), s1 = Math.min(App.audio.length, Math.round(t1 * sr));
      const ch = []; for (let c = 0; c < nc; c++) ch.push(App.audio.getChannelData(c));
      for (let s = s0; s < s1; s += 4096) { const n = Math.min(4096, s1 - s); const data = new Float32Array(n * nc); for (let c = 0; c < nc; c++) data.set(ch[c].subarray(s, s + n), c * n);
        const ad = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: nc, timestamp: Math.round((s - s0) / sr * 1e6), data }); aenc.encode(ad); ad.close(); if (aerr) throw aerr; }
      await aenc.flush();
    }
    muxer.finalize();
    return { frames: nFrames, seconds: (performance.now() - started) / 1000, audio: useAudio, buffer: target.buffer };
  } finally { App.exporting = false; App.cancelExport = false; canvas.width = pw; canvas.height = ph; }
}
let renders = [];
function doorFrameSize(door, h) { const d = App.doors; const asp = door === 'a' ? d.aw / d.ah : d.bw / d.bh; let H = h, W = Math.round(H * asp / 2) * 2; if (W > 4096) { W = 4096; H = Math.round(W / asp / 2) * 2; } return [W, H]; }
function outSizes() {
  const out = $('rOut').value, h = +$('rRes').value;
  if (out === 'mapped' || out === 'flat') return [{ only: null, size: [Math.round(h * 16 / 9 / 2) * 2, h], flat: out === 'flat', label: 'Both doors' }];
  const L = []; if (out !== 'b') L.push({ only: 'a', size: doorFrameSize('a', h), label: 'Main door' }); if (out !== 'a') L.push({ only: 'b', size: doorFrameSize('b', h), label: 'Single door' }); return L;
}
function refreshRenderSizes() { if ($('rSizes')) $('rSizes').textContent = outSizes().map(o => o.label + ': ' + o.size[0] + ' \u00d7 ' + o.size[1]).join('  \u00b7  '); }
async function saveAll(list) {
  if (!list.length) return;
  if (window.gdvNative && window.gdvNative.saveFiles && list.length > 1) { const files = []; for (const r of list) files.push({ name: r.name, data: await r.blob.arrayBuffer() }); const dir = await window.gdvNative.saveFiles(files); if (dir) toast('Saved ' + list.length + ' videos to ' + dir, 6000); return; }
  for (const r of list) await saveFile(r.name, r.blob);
}

/* ---------------- main loop */
function resizeCanvas() {
  if (App.exporting) return; const rc = canvas.getBoundingClientRect(); const dpr = Math.min(2, window.devicePixelRatio || 1);
  let w = Math.round(rc.width * dpr); if (document.body.classList.contains('fs')) w = Math.round(screen.width * dpr);
  w = clamp(w, 320, 3840); const h = Math.round(w * 9 / 16); if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
}
const METERS = [['Hit', '#f4c76e', 'hit'], ['Accent', '#ff6b6b', 'acc'], ['Flow', '#8fd3ff', 'flow'], ['Glow', '#5ee6a3', 'glow']];
function frame() {
  if (App.song && !App.exporting) {
    let t = curTime(); if (App.play.playing && t >= App.song.duration) { stopAudio(); App.play.pos = App.song.duration; t = App.song.duration; }
    resizeCanvas();
    const res = renderFrame(t, { quality: App.play.playing ? 0.75 : 1 });
    if (res) {
      $('time').textContent = fmtTime(t) + ' / ' + fmtTime(App.song.duration);
      const b = res.base; const dots = $('beatdots'); if (dots.childElementCount !== b.bpb) dots.innerHTML = '<i></i>'.repeat(b.bpb);
      [...dots.children].forEach((d, i) => d.classList.toggle('on', i === b.pos - 1)); $('barnum').textContent = 'bar ' + (b.barIdx + 1);
      const sec = App.song.sectionAt(t).s; $('secname').textContent = (sec.name || 'part ' + (sec.label || '')) + (sec.drop ? ' · drop' : '');
      const top = res.info[res.info.length - 1];
      document.querySelectorAll('#meters .m i').forEach((el, i) => { el.style.width = top ? Math.min(100, top.st[METERS[i][2]] * 100) + '%' : '0%'; });
    }
    if (App.play.playing || TL.dirty || TL.drag) {
      if (App.play.playing) { const px = tlX(t), w = tl.clientWidth; if (px > w - 40 || px < TL.gut) { TL.scroll = clamp(t - 40 / TL.pps, 0, Math.max(0, App.song.duration - tlW() / TL.pps)); } }
      drawTimeline();
    }
  } else if (!App.song && TL.dirty) drawTimeline();
  requestAnimationFrame(frame);
}

/* ---------------- wiring */
function goFullscreen() { document.body.classList.add('fs'); const el = document.documentElement; if (el.requestFullscreen) el.requestFullscreen().catch(() => { }); setTimeout(drawHandles, 80); }
function loadDemo() { const d = Song.demo(); loadSong(d.j, null, 'demo'); toast('Demo groove (no audio). Drop a real song any time.'); }
async function handleFiles(files) {
  const f = files[0]; if (!f) return;
  if (/\.json$/i.test(f.name)) {
    const j = JSON.parse(await f.text());
    if (j.format && String(j.format).startsWith('garage-door-viz')) { if (!App.song) { toast('Open the song audio first, then load its .viz.json'); return; } loadSong(j, App.audio, App.songKey); toast('Studio analysis loaded'); return; }
    if (j.format === 'gdv-project/2') return openProject(j);
    if (j.aw && j.ah) { App.doors = Object.assign(defaultDoors(), j); lsSet('gdv2.doors', App.doors); refreshDoors(); toast('Mapping loaded'); return; }
    toast('That JSON is not a project, analysis or mapping file.'); return;
  }
  openAudio(f);
}
function openProject(p) {
  if (p.doors) { App.doors = Object.assign(defaultDoors(), p.doors); lsSet('gdv2.doors', App.doors); refreshDoors(); }
  if (App.song && (App.songKey === p.key || App.song.name === p.song)) { loadSong(App.song.j, App.audio, App.songKey, p); toast('Project loaded'); return; }
  if (p.analysis) { lsSet('gdv2.proj.' + p.key, p); lsSet('gdv2.ana.' + p.key, p.analysis); loadSong(p.analysis, null, p.key, p); toast('Project loaded. Open the song "' + p.song + '" to hear it.', 6000); }
}
function wire() {
  buildFxPanel();
  $('meters').innerHTML = METERS.map(([n, c]) => '<div class="m"><span>' + n + '</span><div><i style="background:' + c + '"></i></div></div>').join('');
  document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => showTab(b.dataset.tab));
  $('btnOpen').onclick = $('btnPick').onclick = () => $('fileIn').click(); $('fileIn').onchange = (e) => { handleFiles([...e.target.files]); e.target.value = ''; };
  $('btnDemo').onclick = loadDemo;
  $('btnLoadProj').onclick = () => $('projIn').click(); $('projIn').onchange = async (e) => { const f = e.target.files[0]; if (f) openProject(JSON.parse(await f.text())); e.target.value = ''; };
  $('btnSaveProj').onclick = () => saveFile((App.song.name || 'song') + '.gdv.json', new Blob([JSON.stringify(projectData(true))], { type: 'application/json' }));
  $('btnGo').onclick = () => showTab('render');
  ['dragenter', 'dragover'].forEach(ev => $('viewport').addEventListener(ev, (e) => { e.preventDefault(); $('dropzone').classList.add('drag'); if (App.song) $('dropzone').hidden = false; }));
  ['dragleave', 'drop'].forEach(ev => $('viewport').addEventListener(ev, (e) => { e.preventDefault(); $('dropzone').classList.remove('drag'); if (App.song && ev === 'dragleave') $('dropzone').hidden = true; }));
  $('viewport').addEventListener('drop', (e) => { if (e.dataTransfer.files.length) handleFiles([...e.dataTransfer.files]); else if (App.song) $('dropzone').hidden = true; });
  $('btnPlay').onclick = togglePlay; $('btnStop').onclick = () => { stopAudio(); App.play.pos = 0; TL.dirty = true; };
  $('btnFS').onclick = goFullscreen; $('btnTest').onclick = () => { App.testPattern = !App.testPattern; refreshDoors(); };
  $('btnAdd').onclick = () => addClip(App.armed || 'starfield', curTime() + 0.001, 1);
  $('btnAuto').onclick = () => { App.clips = autoFill(App.song, $('selStyle').value); App.sel = null; refreshClipPane(); changed(true); toast('Timeline filled with ' + STYLES[$('selStyle').value].name); };
  $('btnClear').onclick = () => { App.clips = []; App.sel = null; refreshClipPane(); changed(true); toast('Timeline cleared. Cmd+Z brings it back.'); };
  $('btnUndo').onclick = undo; $('btnRedo').onclick = redo;
  document.querySelectorAll('#snapSeg button').forEach(b => b.onclick = () => { TL.snap = b.dataset.v; document.querySelectorAll('#snapSeg button').forEach(x => x.classList.toggle('on', x === b)); });
  $('zoom').oninput = (e) => { if (!App.song) return; const center = tlT(TL.gut + tlW() / 2); TL.pps = TL.minPps * Math.pow(400 / TL.minPps, +e.target.value); TL.scroll = clamp(center - tlW() / 2 / TL.pps, 0, Math.max(0, App.song.duration - tlW() / TL.pps)); TL.dirty = true; };
  // song pane
  $('btnShiftL').onclick = () => shiftBars(-1); $('btnShiftR').onclick = () => shiftBars(1);
  $('selBpb').onchange = (e) => setBpb(+e.target.value);
  $('rgOffset').oninput = (e) => { App.settings.offsetMs = +e.target.value; refreshSongPane(); changed(); };
  $('rgMaster').oninput = (e) => { App.settings.master = +e.target.value; refreshSongPane(); changed(); };
  $('chkGuard').onchange = (e) => { App.settings.guard = e.target.checked; changed(true); };
  $('btnPro').onclick = () => $('proIn').click(); $('proIn').onchange = (e) => { handleFiles([...e.target.files]); e.target.value = ''; };
  // doors pane
  for (const k of ['aw', 'ah', 'bw', 'bh', 'gap', 'ac', 'ar', 'bc', 'br']) $('d' + k[0].toUpperCase() + k.slice(1)).onchange = (e) => {
    let v = +e.target.value; if (['ac', 'bc'].includes(k)) v = clamp(Math.round(v), 1, 16); if (['ar', 'br'].includes(k)) v = clamp(Math.round(v), 1, 8);
    const d = Object.assign({}, App.doors, { [k]: v }); if (d.ac * d.ar > 64 || d.bc * d.br > 64) { toast('Max 64 panels per door'); refreshDoors(); return; }
    App.doors[k] = v; if (!App.doors.cornersEdited) App.doors.corners = null; lsSet('gdv2.doors', App.doors); refreshDoors(); refreshRenderSizes(); };
  $('rgFeather').oninput = (e) => { App.doors.feather = +e.target.value; refreshDoors(); lsSet('gdv2.doors', App.doors); };
  $('chkSpill').onchange = (e) => { App.doors.spill = e.target.checked; lsSet('gdv2.doors', App.doors); };
  $('btnEdit').onclick = () => { App.editCorners = !App.editCorners; if (App.editCorners) { App.doors.corners = App.doors.corners || flatCorners(App.doors); App.doors.cornersEdited = true; App.testPattern = true; } refreshDoors(); };
  $('btnFlat').onclick = () => { App.doors.corners = null; App.doors.cornersEdited = false; lsSet('gdv2.doors', App.doors); refreshDoors(); };
  $('btnSaveCal').onclick = () => saveFile('garage-door-mapping.json', new Blob([JSON.stringify(App.doors, null, 1)], { type: 'application/json' }));
  $('btnLoadCal').onclick = () => $('calIn').click(); $('calIn').onchange = (e) => { handleFiles([...e.target.files]); e.target.value = ''; };
  window.addEventListener('resize', () => { drawHandles(); TL.dirty = true; });
  // render pane
  $('btnRender').onclick = async () => {
    if (App.exporting) { App.cancelExport = true; return; }
    if (!App.song) return; stopAudio();
    const jobs = outSizes(); const fps = +$('rFps').value; const base = (App.song.name || 'song').replace(/[^\w\- ]+/g, '').trim() || 'song';
    $('btnRender').textContent = 'Cancel'; $('renderNote').textContent = 'Rendering...'; $('result').hidden = true; renders = [];
    try {
      for (let j = 0; j < jobs.length; j++) {
        const job = jobs[j]; const tag = jobs.length > 1 ? job.label + ' (' + (j + 1) + ' of ' + jobs.length + '): ' : '';
        const res = await exportVideo({ size: job.size, fps, bitrate: +$('rBit').value * Math.max(1, job.size[0] * job.size[1] / (1920 * 1080)) ** 0.7, range: $('rRange').value, flat: job.flat, only: job.only, audio: $('rAudio').value === '1',
          onProgress: (p, el) => { $('progress').firstElementChild.style.width = ((j + p) / jobs.length * 100).toFixed(1) + '%'; const eta = p > 0.01 ? el / p - el : 0; $('renderNote').textContent = tag + Math.round(p * 100) + '% \u00b7 about ' + Math.round(eta) + ' s left'; } });
        renders.push({ blob: new Blob([res.buffer], { type: 'video/mp4' }), name: base + ' - ' + job.label + '.mp4', label: job.label, size: job.size, audio: res.audio, frames: res.frames, secs: res.seconds });
      }
      $('progress').firstElementChild.style.width = '100%';
      const r0 = renders[0];
      $('renderNote').textContent = 'Done: ' + renders.map(r => r.label + ' ' + r.size[0] + '\u00d7' + r.size[1]).join(', ') + ' \u00b7 ' + r0.frames + ' frames each' + (r0.audio ? ', with the song audio.' : '. Video only: this browser could not encode the audio.');
      $('resList').innerHTML = renders.map((r, i) => '<div class="resrow"><span><b>' + esc(r.name) + '</b> \u00b7 ' + (r.blob.size / 1048576).toFixed(0) + ' MB</span><button data-i="' + i + '">Preview</button><button data-s="' + i + '">Save</button></div>').join('');
      $('resList').querySelectorAll('[data-s]').forEach(b => b.onclick = () => saveFile(renders[+b.dataset.s].name, renders[+b.dataset.s].blob));
      const v = $('resVideo'); const show = (i) => { try { v.hidden = false; v.src = URL.createObjectURL(renders[i].blob); } catch (e) { v.hidden = true; } };
      $('resList').querySelectorAll('[data-i]').forEach(b => b.onclick = () => show(+b.dataset.i));
      v.onerror = () => { v.hidden = true; }; show(0); $('result').hidden = false;
      $('btnSaveVid').textContent = renders.length > 1 ? 'Save all ' + renders.length + ' videos' : 'Save MP4';
    } catch (e) { $('renderNote').textContent = e.message; }
    $('btnRender').textContent = 'Go';
  };
  $('btnSaveVid').onclick = () => saveAll(renders);
  $('rOut').onchange = $('rRes').onchange = refreshRenderSizes; refreshRenderSizes();
  // keys
  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey; const k = e.key.toLowerCase();
    if (mod && (k === 'z' || k === 'y') && !window.gdvNative) { if (isTextField(e.target)) return; e.preventDefault(); (k === 'y' || e.shiftKey) ? redo() : undo(); return; }
    if (mod) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') { if (e.target.type !== 'range' || e.code !== 'Space') return; }
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'f' || e.key === 'F') goFullscreen();
    else if (e.key === 'Escape') { document.body.classList.remove('fs'); setTimeout(drawHandles, 80); }
    else if (e.key === 't' || e.key === 'T') { App.testPattern = !App.testPattern; refreshDoors(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && App.sel != null) { e.preventDefault(); deleteSel(); }
    else if ((e.key === 'd' || e.key === 'D') && App.sel != null) { e.preventDefault(); duplicateSel(); }
    else if (App.song && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) seek(curTime() + (e.key === 'ArrowRight' ? 1 : -1) * App.song.beatDur * App.song.bpb);
  });
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) document.body.classList.remove('fs'); setTimeout(drawHandles, 80); });
}
function wireNative() { // Mac app (Electron): menu commands and native file dialogs
  if (!window.gdvNative) return;
  document.body.classList.add('native');
  window.gdvNative.onMenu((cmd, payload) => {
    if (cmd === 'undo') menuUndo(false); else if (cmd === 'redo') menuUndo(true);
    else if (cmd === 'open-file' && payload) handleFiles([new File([payload.data], payload.name)]);
    else if (cmd === 'save-project') { if (App.song) $('btnSaveProj').click(); }
    else if (cmd === 'render') { if (App.song) showTab('render'); }
    else if (cmd === 'play') togglePlay();
  });
}
function boot() {
  try { R.gl = new Renderer(canvas); } catch (e) { $('dropzone').querySelector('p').textContent = e.message; return; }
  wire(); wireNative(); refreshDoors(); drawTimeline(); requestAnimationFrame(frame);
}
window.GDV = { App, SCENES, loadSong, renderFrame, exportVideo, autoFill, extendSong, defaultClip, openAudio, Song, TL, undo, redo, menuUndo, H };
boot();
