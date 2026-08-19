/**
 * preload.ts — contextIsolation 有効時にレンダラーへ最小限の橋渡しをする。
 * Vyline のフロントは純粋な Web アプリとして作られているため、
 * ここで公開するのは「Electron シェル内で動いていることの検出用フラグ」程度に留める。
 */
import { contextBridge, shell, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("vyline", {
  isElectron: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    app: ipcRenderer.sendSync("vyline:app-version") as string,
  },
  openExternal: (url: string) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  },
});
