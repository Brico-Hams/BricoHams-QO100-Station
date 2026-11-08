import { app, BrowserWindow, Menu, Tray, nativeImage, session, shell } from 'electron';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateConfig, ConfigError } from '../src/server/config.js';
import { createApp } from '../src/server/app.js';

const here = dirname(fileURLToPath(import.meta.url));
// Files unpacked from the asar archive live next to it; in development they are in the repo root.
const appRoot = resolve(here, '..').replace(/app\.asar$/, 'app.asar.unpacked');
const GOOGLE_ORIGIN = 'https://accounts.google.com';

let station = null;
let localOrigin = null;
let mainWindow = null;
let tray = null;
let quitting = false;

/**
 * Parse a KEY=VALUE file (the optional secrets.env in userData). Values are never logged.
 * @param {string} path File path.
 * @returns {Record<string, string>}
 */
export function readEnvFile(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trimStart().startsWith('#')) out[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
  return out;
}

/**
 * Build the desktop configuration: loopback only, no TLS, data paths under userData.
 * @param {string} userData Electron userData directory.
 * @returns {Readonly<object>}
 */
export function loadDesktopConfig(userData) {
  const configPath = join(userData, 'config.json');
  const raw = JSON.parse(readFileSync(configPath, 'utf8'));
  const port = Number.isInteger(raw.port) && raw.port > 0 ? raw.port : 8443;
  raw.host = '127.0.0.1';
  raw.port = port;
  delete raw.tls;
  raw.publicUrl = `http://localhost:${port}`;
  const abs = (p, fallback) => {
    const v = typeof p === 'string' && p ? p : fallback;
    return isAbsolute(v) ? v : join(userData, v);
  };
  raw.auditLogPath = abs(raw.auditLogPath, 'data/audit.log');
  raw.logbook = { ...(raw.logbook ?? {}), path: abs(raw.logbook?.path, 'data/logbook.db') };
  mkdirSync(dirname(raw.auditLogPath), { recursive: true });
  mkdirSync(dirname(raw.logbook.path), { recursive: true });
  const env = { ...process.env, ...readEnvFile(join(userData, 'secrets.env')) };
  return validateConfig(raw, env);
}

function openHelp() {
  const help = join(appRoot, 'docs', 'help');
  const index = ['index.html', 'README.md'].map((f) => join(help, f)).find(existsSync);
  shell.openPath(index ?? help);
}

function ensureConfig(userData) {
  mkdirSync(userData, { recursive: true });
  const target = join(userData, 'config.json');
  if (existsSync(target)) return true;
  copyFileSync(join(appRoot, 'config.example.json'), target);
  openHelp();
  return false;
}

function isLocal(url) {
  try {
    return new URL(url).origin === localOrigin;
  } catch {
    return false;
  }
}

function hardenSession() {
  const ses = session.defaultSession;
  // Only the microphone, and only for the local page, is ever granted.
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    callback(permission === 'media' && isLocal(details?.requestingUrl ?? wc.getURL()));
  });
  ses.setPermissionCheckHandler((wc, permission, requestingOrigin) => permission === 'media' && requestingOrigin === localOrigin);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const wc = mainWindow.webContents;
  const guard = (event, url) => {
    if (isLocal(url)) return;
    // Google sign-in happens in this same window; everything else is blocked.
    let origin = '';
    try { origin = new URL(url).origin; } catch { /* blocked below */ }
    if (origin !== GOOGLE_ORIGIN) event.preventDefault();
  };
  wc.on('will-navigate', guard);
  wc.on('will-redirect', guard);
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.loadURL(localOrigin);
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  else {
    mainWindow.show();
    mainWindow.focus();
  }
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(join(here, 'tray.png')));
  tray.setToolTip('BricoHams QO-100 Station');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open', click: showWindow },
    { label: 'Help', click: openHelp },
    { label: 'Quit', click: () => app.quit() },
  ]));
  tray.on('click', showWindow);
}

async function stopStation() {
  if (!station) return;
  const s = station;
  station = null;
  // close() releases the PTT holder (carrier off) before anything else; the timeout only guards a hung driver.
  await Promise.race([s.close(), new Promise((r) => setTimeout(r, 5000))]);
}

async function start() {
  const userData = app.getPath('userData');
  if (!ensureConfig(userData)) {
    console.info(`Edit ${join(userData, 'config.json')} and restart; the help page was opened.`);
    app.quit();
    return;
  }
  let config;
  try {
    config = loadDesktopConfig(userData);
  } catch (err) {
    console.error(err instanceof ConfigError ? err.message : `Cannot load config: ${err.message}`);
    openHelp();
    app.quit();
    return;
  }
  station = createApp(config);
  const { port } = await station.listen();
  localOrigin = `http://localhost:${port}`;
  hardenSession();
  createTray();
  createWindow();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.on('window-all-closed', () => { /* stay in the tray */ });
  app.on('before-quit', (e) => {
    if (quitting) return;
    quitting = true;
    e.preventDefault();
    stopStation().finally(() => app.exit(0));
  });
  process.once('SIGTERM', () => app.quit());
  app.whenReady().then(start).catch((err) => {
    console.error(`Startup failed: ${err.message}`);
    stopStation().finally(() => app.exit(1));
  });
}
