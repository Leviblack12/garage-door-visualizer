// Garage Door Visualizer - Mac app shell. The whole app is app/index.html; this file adds a window, a menu and native save dialogs.
const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const path = require('path'); const fs = require('fs');
let win = null; let lastDir = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1500, height: 960, minWidth: 1000, minHeight: 680, backgroundColor: '#0b0f18', title: 'Garage Door Visualizer',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  win.loadFile(path.join(__dirname, 'app', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.on('closed', () => { win = null; });
}
const send = (cmd, payload) => { if (win) win.webContents.send('menu', cmd, payload); };
async function openSong() {
  const r = await dialog.showOpenDialog(win, { title: 'Open a song or project', properties: ['openFile'], filters: [{ name: 'Songs and projects', extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'json'] }] });
  if (r.canceled || !r.filePaths[0]) return;
  const f = r.filePaths[0]; send('open-file', { name: path.basename(f), data: fs.readFileSync(f) });
}
function uniquePath(dir, name) {
  let p = path.join(dir, name); const ext = path.extname(name), base = name.slice(0, name.length - ext.length); let i = 2;
  while (fs.existsSync(p)) p = path.join(dir, `${base} (${i++})${ext}`); return p;
}
ipcMain.handle('save-file', async (e, name, data) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(lastDir || app.getPath('movies'), name) });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, Buffer.from(data)); lastDir = path.dirname(r.filePath); return r.filePath;
});
ipcMain.handle('save-files', async (e, files) => {
  const r = await dialog.showOpenDialog(win, { title: 'Choose a folder for the videos', buttonLabel: 'Save here', defaultPath: lastDir || app.getPath('movies'), properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  const dir = r.filePaths[0]; let first = null;
  for (const f of files) { const p = uniquePath(dir, f.name); fs.writeFileSync(p, Buffer.from(f.data)); first = first || p; }
  lastDir = dir; if (first) shell.showItemInFolder(first); return dir;
});

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [
      { label: 'Open Song or Project...', accelerator: 'CmdOrCtrl+O', click: openSong },
      { label: 'Save Project', accelerator: 'CmdOrCtrl+S', click: () => send('save-project') },
      { type: 'separator' },
      { label: 'Render Video...', accelerator: 'CmdOrCtrl+Shift+R', click: () => send('render') },
      { type: 'separator' }, isMac ? { role: 'close' } : { role: 'quit' },
    ] },
    { label: 'Edit', submenu: [
      { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => send('undo') },
      { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', click: () => send('redo') },
      { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
    ] },
    { label: 'View', submenu: [{ role: 'togglefullscreen' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }] },
    { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: 'Project page', click: () => shell.openExternal('https://github.com/Leviblack12/garage-door-visualizer') }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Self-test used when building: node checks that video + audio encoding work in this build, then quits.
if (process.argv.includes('--selftest')) {
  app.whenReady().then(async () => {
    const w = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true } });
    await w.loadFile(path.join(__dirname, 'app', 'index.html'));
    const res = await w.webContents.executeJavaScript(`(async () => {
      const v = await VideoEncoder.isConfigSupported({ codec: 'avc1.640033', width: 2392, height: 1080, bitrate: 16e6, framerate: 24 });
      const v4 = await VideoEncoder.isConfigSupported({ codec: 'avc1.640033', width: 4096, height: 1850, bitrate: 40e6, framerate: 24 });
      let a = { supported: false }; try { a = await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 256000 }); } catch (e) {}
      return JSON.stringify({ video1080: v.supported, video4k: v4.supported, aac: a.supported, effects: Object.keys(GDV.SCENES).length, native: !!window.gdvNative });
    })()`);
    console.log('SELFTEST ' + res); app.quit();
  });
} else {
  app.whenReady().then(() => { buildMenu(); createWindow(); });
  app.on('activate', () => { if (!win) createWindow(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
