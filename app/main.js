// Corne Studio — главный процесс Electron.
const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell, Tray, Menu, nativeImage, clipboard, desktopCapturer } = require('electron');
const { execFile, spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { unzip } = require('./lib/unzip');

let win;
let pendingPortCallback = null;
let tray = null;
let quitting = false;
let trayStatus = 'Corne Studio';

/* ---------------- настройки ---------------- */

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try { return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); } catch { return {}; }
}
function saveSettings(s) {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 2));
}

ipcMain.handle('store:get', () => {
  const s = loadSettings();
  delete s.tokenEnc;
  return s;
});
ipcMain.handle('store:set', (_e, patch) => {
  const s = { ...loadSettings(), ...patch };
  saveSettings(s);
  return true;
});
ipcMain.handle('token:set', (_e, token) => {
  const s = loadSettings();
  if (!token) delete s.tokenEnc;
  else if (safeStorage.isEncryptionAvailable()) s.tokenEnc = safeStorage.encryptString(token).toString('base64');
  else s.tokenEnc = 'plain:' + Buffer.from(token).toString('base64');
  saveSettings(s);
  return true;
});
function getToken() {
  const enc = loadSettings().tokenEnc;
  if (!enc) return '';
  if (enc.startsWith('plain:')) return Buffer.from(enc.slice(6), 'base64').toString();
  try { return safeStorage.decryptString(Buffer.from(enc, 'base64')); } catch { return ''; }
}
ipcMain.handle('token:has', () => !!getToken());

/* ---------------- прошивка: файлы и диски UF2 ---------------- */

function firmwareEntries(name, data) {
  if (/\.zip$/i.test(name)) {
    return unzip(data)
      .filter((e) => /\.uf2$/i.test(e.name))
      .map((e) => ({ name: path.basename(e.name), data: e.data }));
  }
  return [{ name: path.basename(name), data: Buffer.from(data) }];
}

ipcMain.handle('fw:open', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Файл прошивки',
    filters: [{ name: 'Прошивка', extensions: ['uf2', 'zip'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths[0]) return [];
  const f = r.filePaths[0];
  return firmwareEntries(f, fs.readFileSync(f));
});

function candidateRoots() {
  if (process.platform === 'win32') {
    return 'DEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c) => `${c}:\\`);
  }
  const roots = [];
  const user = os.userInfo().username;
  for (const base of ['/Volumes', `/media/${user}`, `/run/media/${user}`]) {
    try { for (const d of fs.readdirSync(base)) roots.push(path.join(base, d)); } catch { /* нет */ }
  }
  return roots;
}

ipcMain.handle('uf2:drives', () => {
  const out = [];
  for (const root of candidateRoots()) {
    const info = path.join(root, 'INFO_UF2.TXT');
    try {
      if (fs.existsSync(info)) {
        const txt = fs.readFileSync(info, 'utf8');
        const model = (txt.match(/Model:\s*(.*)/) || [])[1] || '';
        const board = (txt.match(/Board-ID:\s*(.*)/) || [])[1] || '';
        out.push({ root, model: model.trim(), board: board.trim() });
      }
    } catch { /* диск занят или отключён */ }
  }
  return out;
});

ipcMain.handle('uf2:write', async (_e, root, data) => {
  const target = path.join(root, 'firmware.uf2');
  try {
    await fs.promises.writeFile(target, Buffer.from(data));
    return { ok: true };
  } catch (err) {
    // Загрузчик часто перезагружается сразу после приёма файла и рвёт запись в конце.
    const gone = !fs.existsSync(path.join(root, 'INFO_UF2.TXT'));
    return { ok: gone, note: gone ? 'Диск отключился сразу после записи — так и должно быть' : String(err) };
  }
});

/* ---------------- GitHub Actions ---------------- */

async function gh(url, token, raw = false) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'corne-studio' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let r = await fetch(url, { headers, redirect: raw ? 'manual' : 'follow' });
  if (raw && r.status >= 300 && r.status < 400) {
    // Артефакт отдаётся по подписанной ссылке на другой хост — без токена
    r = await fetch(r.headers.get('location'));
  }
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return raw ? Buffer.from(await r.arrayBuffer()) : r.json();
}

/** Причина падения сборки: строки с ошибками из логов упавших задач. */
ipcMain.handle('gh:failure', async (_e, repo, runId) => {
  const token = getToken();
  const jobs = await gh(`https://api.github.com/repos/${repo}/actions/runs/${runId}/jobs?per_page=50`, token);
  const failed = jobs.jobs.filter((j) => j.conclusion === 'failure');
  const out = [];
  for (const j of failed.slice(0, 3)) {
    let lines = [];
    if (token) {
      try {
        const log = (await gh(`https://api.github.com/repos/${repo}/actions/jobs/${j.id}/logs`, token, true)).toString('utf8');
        lines = log.split('\n')
          .map((l) => l.replace(/^\S+Z\s/, ''))
          .filter((l) => /(error|FATAL|undefined reference|No such file)/i.test(l) && !/^\s*-W|Werror=|-Wno-|errno|ERROR_CHECKS/.test(l))
          .slice(-12);
      } catch { /* нет доступа к логам */ }
    }
    out.push({ name: j.name, url: j.html_url, lines });
  }
  return out;
});

ipcMain.handle('gh:runs', async (_e, repo) => {
  const j = await gh(`https://api.github.com/repos/${repo}/actions/runs?per_page=15`, getToken());
  return j.workflow_runs.map((r) => ({
    id: r.id, title: r.display_title, status: r.status, conclusion: r.conclusion,
    branch: r.head_branch, sha: r.head_sha.slice(0, 7), fullSha: r.head_sha, created: r.created_at, name: r.name,
    url: r.html_url, started: r.run_started_at, updated: r.updated_at,
  }));
});

ipcMain.handle('gh:download', async (_e, repo, runId) => {
  const token = getToken();
  if (!token) throw new Error('Для скачивания артефактов GitHub требует токен (вкладка «Прошивка» → токен)');
  const arts = await gh(`https://api.github.com/repos/${repo}/actions/runs/${runId}/artifacts`, token);
  if (!arts.artifacts.length) throw new Error('В этом запуске нет артефактов');
  const out = [];
  for (const a of arts.artifacts) {
    const zip = await gh(a.archive_download_url, token, true);
    out.push(...firmwareEntries('a.zip', zip));
  }
  return out;
});

/* ---------------- системные данные для экрана ---------------- */

let lastCpu = os.cpus();
ipcMain.handle('sys:stats', () => {
  const now = os.cpus();
  let idle = 0, total = 0;
  now.forEach((c, i) => {
    const p = lastCpu[i] ? lastCpu[i].times : { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 };
    const t = c.times;
    const dt = (t.user - p.user) + (t.nice - p.nice) + (t.sys - p.sys) + (t.idle - p.idle) + (t.irq - p.irq);
    idle += t.idle - p.idle;
    total += dt;
  });
  lastCpu = now;
  const cpu = total > 0 ? Math.round(100 * (1 - idle / total)) : 0;
  const ram = Math.round(100 * (1 - os.freemem() / os.totalmem()));
  return { cpu, ram, uptime: Math.round(os.uptime()) };
});

/* ---------------- файл раскладки ---------------- */

ipcMain.handle('keymap:open', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Открыть corne.keymap',
    filters: [{ name: 'ZMK keymap', extensions: ['keymap'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return { path: r.filePaths[0], text: fs.readFileSync(r.filePaths[0], 'utf8') };
});
ipcMain.handle('keymap:read', (_e, p) => ({ path: p, text: fs.readFileSync(p, 'utf8') }));
ipcMain.handle('keymap:save', async (_e, filePath, text) => {
  let target = filePath;
  if (!target) {
    const r = await dialog.showSaveDialog(win, { defaultPath: 'corne.keymap' });
    if (r.canceled) return null;
    target = r.filePath;
  }
  fs.writeFileSync(target, text);
  return target;
});

ipcMain.handle('open:url', (_e, url) => {
  if (/^https:\/\//.test(url)) shell.openExternal(url);
});

/* ---------------- git: публикация изменений ---------------- */

function git(cwd, args) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: `${stdout}${stderr}`.trim(), missing: err && err.code === 'ENOENT' });
    });
  });
}

ipcMain.handle('repo:pick', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Папка репозитория corne-studio', properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  const dir = r.filePaths[0];
  if (!fs.existsSync(path.join(dir, '.git'))) throw new Error('В этой папке нет git-репозитория');
  return dir;
});

ipcMain.handle('repo:keymapPath', (_e, dir) => {
  const p = path.join(dir, 'config', 'corne.keymap');
  return fs.existsSync(p) ? p : null;
});

ipcMain.handle('git:status', async (_e, dir) => {
  const st = await git(dir, ['status', '--porcelain']);
  if (st.missing) throw new Error('Git не найден. Установите Git for Windows: https://git-scm.com');
  const head = await git(dir, ['rev-parse', 'HEAD']);
  return { changes: st.out ? st.out.split('\n').length : 0, files: st.out, head: head.out };
});

ipcMain.handle('git:publish', async (_e, dir, message) => {
  const log = [];
  const run = async (args) => {
    const r = await git(dir, args);
    log.push(`$ git ${args.join(' ')}\n${r.out}`);
    if (r.missing) throw new Error('Git не найден. Установите Git for Windows: https://git-scm.com');
    return r;
  };
  await run(['add', '-A']);
  const diff = await run(['diff', '--cached', '--quiet']);
  let committed = false;
  if (diff.code !== 0) {
    const c = await run(['commit', '-m', message || 'Update keymap']);
    if (c.code !== 0) throw new Error('Не удалось сделать коммит:\n' + c.out);
    committed = true;
  }
  let p = await run(['push']);
  if (p.code !== 0 && /rejected|fetch first|non-fast-forward/i.test(p.out)) {
    const pull = await run(['pull', '--no-rebase', '-X', 'ours', '-m', 'Merge']);
    if (pull.code !== 0) throw new Error('Не удалось подтянуть изменения с GitHub:\n' + pull.out);
    p = await run(['push']);
  }
  if (p.code !== 0) throw new Error('git push не удался:\n' + p.out);
  const head = await run(['rev-parse', 'HEAD']);
  return { committed, sha: head.out, log: log.join('\n\n') };
});

/* ---------------- трей и автозапуск ---------------- */

function trayMenu() {
  return Menu.buildFromTemplate([
    { label: trayStatus, enabled: false },
    { type: 'separator' },
    { label: 'Открыть Corne Studio', click: () => { win.show(); win.focus(); } },
    { label: 'Подсветка: вкл/выкл', click: () => win.webContents.send('tray:action', 'rgb-toggle') },
    { label: 'Свой режим подсветки: старт/стоп', click: () => win.webContents.send('tray:action', 'stream-toggle') },
    { type: 'separator' },
    { label: 'Выход', click: () => { quitting = true; app.quit(); } },
  ]);
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', process.platform === 'darwin' ? 'icon16.png' : 'icon32.png'));
  tray = new Tray(icon);
  tray.setToolTip(trayStatus);
  tray.setContextMenu(trayMenu());
  tray.on('click', () => { win.isVisible() ? win.hide() : (win.show(), win.focus()); });
}

ipcMain.on('tray:status', (_e, text) => {
  trayStatus = text || 'Corne Studio';
  if (tray) { tray.setToolTip(trayStatus); tray.setContextMenu(trayMenu()); }
});

ipcMain.handle('app:autostart', (_e, on) => {
  if (typeof on === 'boolean') app.setLoginItemSettings({ openAtLogin: on, args: ['--hidden'] });
  return app.getLoginItemSettings().openAtLogin;
});

/* ---------------- активное окно Windows ---------------- */

let winWatcher = null;
function startWindowWatcher() {
  if (process.platform !== 'win32' || winWatcher) return;
  const script = `
Add-Type @"
using System; using System.Runtime.InteropServices;
public class CsWin {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
}
"@
$last = ''
while ($true) {
  $h = [CsWin]::GetForegroundWindow(); $p = 0
  [void][CsWin]::GetWindowThreadProcessId($h, [ref]$p)
  try { $n = (Get-Process -Id $p -ErrorAction Stop).ProcessName } catch { $n = '' }
  if ($n -ne $last) { [Console]::Out.WriteLine($n); [Console]::Out.Flush(); $last = $n }
  Start-Sleep -Milliseconds 700
}`;
  winWatcher = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true });
  let buf = '';
  winWatcher.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const name = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (name && win && name.toLowerCase() !== 'electron' && name !== 'Corne Studio') win.webContents.send('window:active', name);
    }
  });
  winWatcher.on('exit', () => { winWatcher = null; });
}

/* ---------------- локальный HTTP: статус Claude и уведомления ---------------- */

const LOCAL_PORT = 47800;
function startLocalServer() {
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, `http://127.0.0.1:${LOCAL_PORT}`);
    const send = (route, data) => { if (win) win.webContents.send(route, data); };
    const finish = () => { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('ok\n'); };
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 10000) req.destroy(); });
    req.on('end', () => {
      let extra = {};
      try { if (body) extra = JSON.parse(body); } catch { /* не JSON — не важно */ }
      if (u.pathname === '/claude') {
        send('claude:status', { state: u.searchParams.get('state') || extra.state || 'idle', text: u.searchParams.get('text') || '' });
        return finish();
      }
      if (u.pathname === '/notify') {
        send('notify', { color: u.searchParams.get('color') || 'ffffff', ms: +u.searchParams.get('ms') || 1500, text: u.searchParams.get('text') || '' });
        return finish();
      }
      res.writeHead(404); res.end('Corne Studio: /claude?state=working|waiting|done|idle, /notify?color=rrggbb&ms=1500\n');
    });
  });
  srv.on('error', () => { /* порт занят — работаем без него */ });
  srv.listen(LOCAL_PORT, '127.0.0.1');
}

/* ---------------- PDF-шпаргалка ---------------- */

ipcMain.handle('pdf:save', async (_e, html) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: 'corne-шпаргалка.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (r.canceled) return null;
  const pw = new BrowserWindow({ show: false, webPreferences: { javascript: false } });
  await pw.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  const pdf = await pw.webContents.printToPDF({ landscape: true, printBackground: true, pageSize: 'A4', margins: { marginType: 'custom', top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 } });
  pw.destroy();
  fs.writeFileSync(r.filePath, pdf);
  shell.openPath(r.filePath);
  return r.filePath;
});

/* ---------------- сниппеты: вставка текста в активное окно ---------------- */

ipcMain.handle('snippet:paste', async (_e, text) => {
  const prev = clipboard.readText();
  clipboard.writeText(text);
  if (process.platform === 'win32') {
    await new Promise((res) => {
      const ps = spawn('powershell.exe', ['-NoProfile', '-Command',
        'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("^v")'], { windowsHide: true });
      ps.on('exit', res);
      ps.on('error', res);
    });
  }
  setTimeout(() => clipboard.writeText(prev), 800);
  return true;
});

/* ---------------- погода (open-meteo, без ключа) ---------------- */

const weatherCache = {};
ipcMain.handle('weather:get', async (_e, city) => {
  const key = (city || '').trim().toLowerCase();
  if (!key) throw new Error('Город не указан');
  const c = weatherCache[key];
  if (c && Date.now() - c.at < 10 * 60 * 1000) return c.data;
  const g = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=ru&name=${encodeURIComponent(city)}`)).json();
  if (!g.results || !g.results[0]) throw new Error('Город не найден');
  const { latitude, longitude, name } = g.results[0];
  const w = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1`)).json();
  const data = {
    city: name,
    temp: Math.round(w.current.temperature_2m),
    code: w.current.weather_code,
    wind: Math.round(w.current.wind_speed_10m / 3.6),
    min: Math.round(w.daily.temperature_2m_min[0]),
    max: Math.round(w.daily.temperature_2m_max[0]),
  };
  weatherCache[key] = { at: Date.now(), data };
  return data;
});

/* ---------------- произвольные текстовые файлы (дизайн экрана) ---------------- */

ipcMain.handle('file:saveText', async (_e, name, text) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: name, filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (r.canceled) return null;
  fs.writeFileSync(r.filePath, text);
  return r.filePath;
});
ipcMain.handle('file:openText', async () => {
  const r = await dialog.showOpenDialog(win, { filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return null;
  return fs.readFileSync(r.filePaths[0], 'utf8');
});

/* ---------------- резервная копия настроек ---------------- */

ipcMain.handle('backup:export', async () => {
  const r = await dialog.showSaveDialog(win, { defaultPath: 'corne-studio-backup.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (r.canceled) return null;
  const s = loadSettings();
  delete s.tokenEnc;
  fs.writeFileSync(r.filePath, JSON.stringify(s, null, 2));
  return r.filePath;
});
ipcMain.handle('backup:import', async () => {
  const r = await dialog.showOpenDialog(win, { filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return false;
  const data = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
  const cur = loadSettings();
  saveSettings({ ...data, tokenEnc: cur.tokenEnc });
  return true;
});

/* ---------------- окно и Web Serial ---------------- */

ipcMain.on('serial:choose', (_e, portId) => {
  if (pendingPortCallback) {
    pendingPortCallback(portId || '');
    pendingPortCallback = null;
  }
});

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#14161b',
    title: 'Corne Studio',
    icon: path.join(__dirname, 'assets', 'icon256.png'),
    show: !process.argv.includes('--hidden'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const ses = win.webContents.session;
  ses.on('select-serial-port', (event, portList, webContents, callback) => {
    event.preventDefault();
    pendingPortCallback = callback;
    webContents.send('serial:ports', portList.map((p) => ({
      portId: p.portId, portName: p.portName, displayName: p.displayName,
      vendorId: p.vendorId, productId: p.productId,
    })));
  });
  ses.setPermissionCheckHandler((_wc, permission) => ['serial', 'clipboard-sanitized-write', 'media', 'display-capture'].includes(permission));
  ses.setDevicePermissionHandler((details) => details.deviceType === 'serial');
  // Эквалайзер: звук компьютера (loopback) без выбора экрана
  ses.setDisplayMediaRequestHandler((_req, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => callback({ video: sources[0], audio: 'loopback' }));
  });

  win.on('close', (e) => {
    // Крестик сворачивает в трей, если так включено в настройках
    if (!quitting && loadSettings().minimizeToTray !== false && tray) {
      e.preventDefault();
      win.hide();
    }
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });
  app.whenReady().then(() => { createWindow(); createTray(); startWindowWatcher(); startLocalServer(); });
}
app.on('before-quit', () => { quitting = true; if (winWatcher) winWatcher.kill(); });
app.on('window-all-closed', () => app.quit());
