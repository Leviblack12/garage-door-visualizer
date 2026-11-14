// Dev check: electron scripts/rendertest.js <song> -> analyzes the song and renders 4 s of each door with audio, reports timing.
const { app, BrowserWindow } = require('electron'); const path = require('path'); const fs = require('fs');
const song = process.argv[process.argv.length - 1];
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, width: 1400, height: 900, webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, backgroundThrottling: false } });
  await w.loadFile(path.join(__dirname, '..', 'app', 'index.html'));
  const t0 = Date.now();
  w.webContents.send('menu', 'open-file', { name: path.basename(song), data: fs.readFileSync(song) });
  for (let i = 0; i < 200; i++) { await new Promise(r => setTimeout(r, 500)); if (await w.webContents.executeJavaScript('!!(GDV.App.song)')) break; }
  const ana = (Date.now() - t0) / 1000;
  const res = await w.webContents.executeJavaScript(`(async () => {
    const out = { tempo: GDV.App.song.tempo, clips: GDV.App.clips.length, renders: [] };
    for (const only of ['a', 'b']) { const d = GDV.App.doors; const asp = only === 'a' ? d.aw / d.ah : d.bw / d.bh; const H = 1080, W = Math.round(H * asp / 2) * 2;
      const r = await GDV.exportVideo({ size: [W, H], fps: 24, bitrate: 16, t0: 30, t1: 34, audio: true, only, quality: 1.15 });
      out.renders.push({ only, W, H, frames: r.frames, secs: +r.seconds.toFixed(2), audio: r.audio, mb: +(r.buffer.byteLength / 1048576).toFixed(1) }); }
    return JSON.stringify(out); })()`);
  console.log('RENDERTEST analysis ' + ana.toFixed(1) + 's ' + res); app.quit();
});
