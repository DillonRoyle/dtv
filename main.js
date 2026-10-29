// DTV – main process
const { app, BrowserWindow, ipcMain, session, shell, safeStorage, clipboard, nativeTheme, net } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { spawn } = require('child_process');

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
let userAgent = DEFAULT_UA;
let win;

const dataDir = () => path.join(app.getPath('userData'), 'dtv-data');
const cacheDir = () => path.join(app.getPath('userData'), 'dtv-cache');
const safeName = (k) => String(k).replace(/[^a-z0-9_.-]/gi, '_').slice(0, 120);

async function ensureDirs() {
  await fsp.mkdir(dataDir(), { recursive: true });
  await fsp.mkdir(cacheDir(), { recursive: true });
}

function createWindow() {
  nativeTheme.themeSource = 'dark';
  win = new BrowserWindow({
    width: 1440,
    height: 880,
    minWidth: 980,
    minHeight: 620,
    backgroundColor: '#0d1322',
    show: false,
    title: 'DTV',
    icon: path.join(__dirname, 'build', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: process.platform === 'darwin' ? true : { color: '#0d1322', symbolColor: '#aab3c8', height: 40 },
    trafficLightPosition: { x: 16, y: 13 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // IPTV servers don't send CORS headers and most run on plain http.
      // Turning web security off for this local-only window lets the player
      // read stream segments directly, which is what keeps playback fast.
      webSecurity: false,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
      spellcheck: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  // Never let a stream page or link open inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:')) e.preventDefault();
  });
  win.on('enter-full-screen', () => win.webContents.send('fullscreen', true));
  win.on('leave-full-screen', () => win.webContents.send('fullscreen', false));
}

app.whenReady().then(async () => {
  await ensureDirs();
  // Apply the chosen user agent to every request the player makes.
  session.defaultSession.webRequest.onBeforeSendHeaders((details, cb) => {
    details.requestHeaders['User-Agent'] = userAgent;
    cb({ requestHeaders: details.requestHeaders });
  });
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------- network ----------
async function fetchText(impl, url, timeout) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await impl(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': userAgent, Accept: 'application/json,text/plain,*/*' },
    });
    return { status: res.status, ok: res.ok, text: await res.text() };
  } finally {
    clearTimeout(t);
  }
}
const errCode = (err) => (err.name === 'AbortError' ? 'timeout' : String(err.cause?.code || err.message || err));

ipcMain.handle('net:json', async (_e, url, opts = {}) => {
  const timeout = opts.timeout || 30000;
  const started = Date.now();
  let r;
  try {
    // Chromium's network stack: same DNS, proxy and connection rules as the player and Chrome
    r = await fetchText((u, o) => net.fetch(u, o), url, timeout);
  } catch (err1) {
    try {
      // Node's own stack as a second opinion
      r = await fetchText(fetch, url, timeout);
    } catch (err2) {
      const c1 = errCode(err1);
      return { ok: false, error: c1 === 'timeout' ? c1 : `${c1} / ${errCode(err2)}` };
    }
  }
  if (!r.ok) return { ok: false, status: r.status, error: `Server replied ${r.status}` };
  try {
    return { ok: true, data: JSON.parse(r.text), ms: Date.now() - started };
  } catch {
    return { ok: false, status: r.status, error: 'not-json', sample: r.text.slice(0, 200) };
  }
});

ipcMain.handle('net:setUserAgent', (_e, ua) => {
  userAgent = (ua && String(ua).trim()) || DEFAULT_UA;
  return userAgent;
});
ipcMain.handle('net:defaultUserAgent', () => DEFAULT_UA);

// ---------- key/value store (profiles are encrypted when the OS allows) ----------
ipcMain.handle('kv:get', async (_e, key) => {
  const file = path.join(dataDir(), safeName(key) + '.json');
  try {
    const raw = await fsp.readFile(file);
    if (raw.slice(0, 4).toString() === 'ENC:') {
      const buf = Buffer.from(raw.slice(4).toString(), 'base64');
      return JSON.parse(safeStorage.decryptString(buf));
    }
    return JSON.parse(raw.toString());
  } catch {
    return null;
  }
});
ipcMain.handle('kv:set', async (_e, key, value, encrypt) => {
  const file = path.join(dataDir(), safeName(key) + '.json');
  const json = JSON.stringify(value);
  const tmp = file + '.tmp';
  if (encrypt && safeStorage.isEncryptionAvailable()) {
    await fsp.writeFile(tmp, 'ENC:' + safeStorage.encryptString(json).toString('base64'));
  } else {
    await fsp.writeFile(tmp, json);
  }
  await fsp.rename(tmp, file);
  return true;
});

// ---------- big list cache ----------
ipcMain.handle('cache:get', async (_e, key) => {
  try {
    return JSON.parse(await fsp.readFile(path.join(cacheDir(), safeName(key) + '.json'), 'utf8'));
  } catch {
    return null;
  }
});
ipcMain.handle('cache:set', async (_e, key, value) => {
  const file = path.join(cacheDir(), safeName(key) + '.json');
  await fsp.writeFile(file + '.tmp', JSON.stringify(value));
  await fsp.rename(file + '.tmp', file);
  return true;
});
ipcMain.handle('cache:clear', async (_e, prefix) => {
  const files = await fsp.readdir(cacheDir()).catch(() => []);
  await Promise.all(
    files.filter((f) => !prefix || f.startsWith(safeName(prefix))).map((f) => fsp.rm(path.join(cacheDir(), f), { force: true }))
  );
  return true;
});

// ---------- extras ----------
ipcMain.handle('clipboard:write', (_e, text) => {
  clipboard.writeText(String(text));
  return true;
});

function vlcCandidates(custom) {
  const list = [];
  if (custom) list.push(custom);
  if (process.platform === 'win32') {
    list.push(
      path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'VideoLAN', 'VLC', 'vlc.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'VideoLAN', 'VLC', 'vlc.exe')
    );
  } else if (process.platform === 'darwin') {
    list.push('/Applications/VLC.app/Contents/MacOS/VLC');
  } else {
    list.push('/usr/bin/vlc', '/snap/bin/vlc', '/usr/local/bin/vlc');
  }
  return list;
}
ipcMain.handle('player:external', async (_e, url, title, customPath) => {
  const exe = vlcCandidates(customPath).find((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });
  if (!exe) return { ok: false, error: 'VLC not found' };
  const args = [url, `--meta-title=${title || 'DTV'}`, `--http-user-agent=${userAgent}`];
  const child = spawn(exe, args, { detached: true, stdio: 'ignore' });
  child.unref();
  return { ok: true };
});

ipcMain.handle('win:toggleFullscreen', () => {
  if (!win) return false;
  win.setFullScreen(!win.isFullScreen());
  return win.isFullScreen();
});
ipcMain.handle('win:setFullscreen', (_e, on) => {
  if (win) win.setFullScreen(!!on);
  return !!on;
});
ipcMain.handle('app:info', () => ({ version: app.getVersion(), platform: process.platform }));
