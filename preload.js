const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dtv', {
  getJSON: (url, opts) => ipcRenderer.invoke('net:json', url, opts),
  setUserAgent: (ua) => ipcRenderer.invoke('net:setUserAgent', ua),
  defaultUserAgent: () => ipcRenderer.invoke('net:defaultUserAgent'),
  kvGet: (k) => ipcRenderer.invoke('kv:get', k),
  kvSet: (k, v, enc) => ipcRenderer.invoke('kv:set', k, v, enc),
  cacheGet: (k) => ipcRenderer.invoke('cache:get', k),
  cacheSet: (k, v) => ipcRenderer.invoke('cache:set', k, v),
  cacheClear: (prefix) => ipcRenderer.invoke('cache:clear', prefix),
  copy: (t) => ipcRenderer.invoke('clipboard:write', t),
  openExternal: (url, title, exe) => ipcRenderer.invoke('player:external', url, title, exe),
  toggleFullscreen: () => ipcRenderer.invoke('win:toggleFullscreen'),
  setFullscreen: (on) => ipcRenderer.invoke('win:setFullscreen', on),
  info: () => ipcRenderer.invoke('app:info'),
  onFullscreen: (cb) => ipcRenderer.on('fullscreen', (_e, v) => cb(v)),
  platform: process.platform,
});
