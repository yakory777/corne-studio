const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cs', {
  store: {
    get: () => ipcRenderer.invoke('store:get'),
    set: (patch) => ipcRenderer.invoke('store:set', patch),
  },
  token: {
    set: (t) => ipcRenderer.invoke('token:set', t),
    has: () => ipcRenderer.invoke('token:has'),
  },
  fw: {
    open: () => ipcRenderer.invoke('fw:open'),
    drives: () => ipcRenderer.invoke('uf2:drives'),
    write: (root, data) => ipcRenderer.invoke('uf2:write', root, data),
  },
  gh: {
    runs: (repo) => ipcRenderer.invoke('gh:runs', repo),
    failure: (repo, runId) => ipcRenderer.invoke('gh:failure', repo, runId),
    download: (repo, runId) => ipcRenderer.invoke('gh:download', repo, runId),
  },
  keymap: {
    open: () => ipcRenderer.invoke('keymap:open'),
    read: (path) => ipcRenderer.invoke('keymap:read', path),
    save: (path, text) => ipcRenderer.invoke('keymap:save', path, text),
  },
  repo: {
    pick: () => ipcRenderer.invoke('repo:pick'),
    keymapPath: (dir) => ipcRenderer.invoke('repo:keymapPath', dir),
    status: (dir) => ipcRenderer.invoke('git:status', dir),
    publish: (dir, msg) => ipcRenderer.invoke('git:publish', dir, msg),
  },
  tray: {
    status: (text) => ipcRenderer.send('tray:status', text),
    onAction: (cb) => ipcRenderer.on('tray:action', (_e, a) => cb(a)),
  },
  onActiveWindow: (cb) => ipcRenderer.on('window:active', (_e, name) => cb(name)),
  onClaude: (cb) => ipcRenderer.on('claude:status', (_e, st) => cb(st)),
  onNotify: (cb) => ipcRenderer.on('notify', (_e, n) => cb(n)),
  pasteSnippet: (text) => ipcRenderer.invoke('snippet:paste', text),
  weather: (city) => ipcRenderer.invoke('weather:get', city),
  backup: {
    export: () => ipcRenderer.invoke('backup:export'),
    import: () => ipcRenderer.invoke('backup:import'),
  },
  saveText: (name, text) => ipcRenderer.invoke('file:saveText', name, text),
  openText: () => ipcRenderer.invoke('file:openText'),
  savePdf: (html) => ipcRenderer.invoke('pdf:save', html),
  autostart: (on) => ipcRenderer.invoke('app:autostart', on),
  sysStats: () => ipcRenderer.invoke('sys:stats'),
  openUrl: (u) => ipcRenderer.invoke('open:url', u),
  serial: {
    onPorts: (cb) => ipcRenderer.on('serial:ports', (_e, list) => cb(list)),
    choose: (portId) => ipcRenderer.send('serial:choose', portId),
  },
});
