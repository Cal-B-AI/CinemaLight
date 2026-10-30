// Cuelight desktop shell: one window running the app, projector output pop-outs, and updates from GitHub Releases.
const electron = require("electron");
const { app, BrowserWindow, Menu, shell, dialog, ipcMain } = electron;
// The screen module can only be touched once the app is ready, so it is read lazily.
const scr = () => electron.screen;
const path = require("path");
const pkg = require("./package.json");

const RELEASES_URL = "https://github.com/Cal-B-AI/CinemaLight/releases/latest";
// macOS only installs updates in place for a code-signed app. Set "macSigned": true in package.json
// once the Mac build is signed with an Apple Developer ID; until then Mac users are told about
// new versions and sent to the download page.
const MAC_CAN_SELF_UPDATE = !!(pkg.cuelight && pkg.cuelight.macSigned);

let win = null;

if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1000, minHeight: 680,
    backgroundColor: "#0e1116", title: "Cuelight", show: false,
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false, preload: path.join(__dirname, "preload.js") }
  });
  win.once("ready-to-show", () => win.show());
  win.loadFile(path.join(__dirname, "app", "index.html"));

  // A file dropped outside a drop zone would otherwise navigate away from the show.
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("file://") || !url.includes("/app/index.html")) e.preventDefault();
  });

  // Projector output windows are opened by the page with window.open("", …). Links go to the browser.
  // Output windows sent to a projector cover it completely (no menu bar, no separate Space on macOS).
  // Output windows belong to this page: close them when it reloads or the main window closes,
  // so an orphaned output never sits on a projector.
  const kids = new Set();
  const closeKids = () => { for (const k of kids) { try { if (!k.isDestroyed()) k.close(); } catch (e) {} } kids.clear(); };
  win.webContents.on("did-start-navigation", (_e, _url, _inPage, isMainFrame) => { if (isMainFrame) closeKids(); });
  win.webContents.on("render-process-gone", closeKids);
  win.on("closed", closeKids);
  win.webContents.on("did-create-window", w => { kids.add(w); w.on("closed", () => kids.delete(w)); });
  win.webContents.on("did-create-window", (w, { frameName }) => {
    const did = pendingPlace.get(frameName); if (did == null) return; pendingPlace.delete(frameName);
    const d = scr().getAllDisplays().find(x => x.id === did); if (!d) return;
    w.setBounds(d.bounds); w.setMenuBarVisibility(false);
    if (process.platform === "darwin") w.setSimpleFullScreen(true); else w.setFullScreen(true);
  });
  // When the projector has a screen assigned, its window opens borderless and fullscreen on that screen.
  win.webContents.setWindowOpenHandler(({ url, frameName }) => {
    if (!url || url === "about:blank") {
      const oid = (frameName || "").startsWith("cuelight_out_") ? frameName.slice(13) : null;
      const d = oid && assigned.has(oid) ? scr().getAllDisplays().find(x => x.id === assigned.get(oid)) : null;
      const base = { backgroundColor: "#000000", autoHideMenuBar: true, title: "Cuelight Output", icon: path.join(__dirname, "build", "icon.png"),
        webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } };
      if (d) {
        pendingPlace.set(frameName, d.id);
        return { action: "allow", overrideBrowserWindowOptions: { ...base, ...d.bounds, frame: false, show: true, hasShadow: false, enableLargerThanScreen: true } };
      }
      return { action: "allow", overrideBrowserWindowOptions: { ...base, width: 960, height: 540 } };
    }
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
}

/* ---------- screens: projectors are just extra displays ---------- */
const assigned = new Map();      // projector (output) id -> display id
const pendingPlace = new Map();  // window frame name -> display id
function displayInfo() {
  const primary = scr().getPrimaryDisplay().id;
  // The screen Cuelight's own window is on is where you run the show, so it's never offered as a projector.
  const control = win && !win.isDestroyed() ? scr().getDisplayMatching(win.getBounds()).id : primary;
  return scr().getAllDisplays().map((d, i) => ({
    id: d.id, label: d.label || (d.internal ? "Built-in display" : `Display ${i + 1}`),
    width: Math.round(d.bounds.width * d.scaleFactor), height: Math.round(d.bounds.height * d.scaleFactor),
    scale: d.scaleFactor, x: d.bounds.x, y: d.bounds.y, primary: d.id === primary, control: d.id === control, internal: !!d.internal
  }));
}
ipcMain.handle("cl:displays", () => displayInfo());
ipcMain.handle("cl:assign", (_e, outputId, displayId) => { if (displayId == null) assigned.delete(outputId); else assigned.set(outputId, displayId); return true; });
// Flash a big label on a screen so you can tell which projector it is.
ipcMain.handle("cl:identify", (_e, displayId) => {
  const d = scr().getAllDisplays().find(x => x.id === displayId); if (!d) return false;
  const info = displayInfo().find(x => x.id === displayId);
  const w = new BrowserWindow({ ...d.bounds, frame: false, transparent: true, alwaysOnTop: true, focusable: false, skipTaskbar: true, hasShadow: false, show: false,
    webPreferences: { contextIsolation: true, sandbox: true } });
  w.setIgnoreMouseEvents(true);
  const html = `<body style="margin:0;display:grid;place-items:center;height:100vh;background:rgba(0,0,0,.55);font:700 9vmin system-ui;color:#f2a93b;text-align:center">${(info.label || "Display").replace(/[<&]/g, "")}<br><span style="font-size:4vmin;color:#fff">${info.width} × ${info.height}</span></body>`;
  w.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html)).then(() => w.showInactive());
  setTimeout(() => { try { w.destroy(); } catch (e) {} }, 2500);
  return true;
});
// Fixing screen arrangement without System Settings: macOS uses the bundled cuelight-displays helper,
// Windows has DisplaySwitch built in.
const { execFile } = require("child_process");
function helperPath() {
  const p = app.isPackaged ? path.join(process.resourcesPath, "cuelight-displays") : path.join(__dirname, "build", "helpers", "cuelight-displays");
  return require("fs").existsSync(p) ? p : null;
}
function run(cmd, args) {
  return new Promise(res => execFile(cmd, args, { timeout: 8000 }, (err, stdout) => res({ ok: !err, out: String(stdout || "") })));
}
ipcMain.handle("cl:screen-state", async () => {
  if (process.platform === "darwin") {
    const h = helperPath(); if (!h) return { canFix: false, mirrored: null };
    const r = await run(h, ["list"]); let list = [];
    try { list = JSON.parse(r.out); } catch (e) {}
    return { canFix: true, mirrored: list.some(d => d.mirrorOf), online: list.length };
  }
  if (process.platform === "win32") return { canFix: true, mirrored: null };
  return { canFix: false, mirrored: null };
});
ipcMain.handle("cl:extend", async () => {
  if (process.platform === "darwin") { const h = helperPath(); if (!h) return { ok: false }; return run(h, ["extend"]); }
  if (process.platform === "win32") return run(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "DisplaySwitch.exe"), ["/extend"]);
  return { ok: false };
});
ipcMain.handle("cl:open-display-settings", () => shell.openExternal(process.platform === "darwin" ? "x-apple.systempreferences:com.apple.Displays-Settings.extension" : "ms-settings:display"));

function displaysChanged() { if (win && !win.isDestroyed()) win.webContents.send("cl:displays-changed"); }

/* ---------- updates ---------- */
let updater = null, manualCheck = false;
function setupUpdates() {
  if (!app.isPackaged) return;
  try { updater = require("electron-updater").autoUpdater; } catch (e) { return; }
  const selfInstall = process.platform !== "darwin" || MAC_CAN_SELF_UPDATE;
  updater.autoDownload = selfInstall;
  updater.autoInstallOnAppQuit = selfInstall;

  updater.on("update-available", info => {
    if (selfInstall) return; // downloads in the background; we ask once it's ready
    dialog.showMessageBox(win, {
      type: "info", buttons: ["Download", "Later"], defaultId: 0, cancelId: 1,
      title: "Update available",
      message: `Cuelight ${info.version} is available`,
      detail: `You have ${app.getVersion()}. Download the new version, then drag it into Applications to replace this one. Your projects stay as they are.`
    }).then(r => { if (r.response === 0) shell.openExternal(RELEASES_URL); });
  });
  updater.on("update-not-available", () => {
    if (manualCheck) dialog.showMessageBox(win, { type: "info", message: "You're up to date", detail: `Cuelight ${app.getVersion()} is the newest version.` });
    manualCheck = false;
  });
  updater.on("update-downloaded", info => {
    manualCheck = false;
    dialog.showMessageBox(win, {
      type: "info", buttons: ["Restart now", "After I quit"], defaultId: 0, cancelId: 1,
      title: "Update ready",
      message: `Cuelight ${info.version} is ready to install`,
      detail: "Restart now to update, or it will install the next time you quit. Don't restart in the middle of a show."
    }).then(r => { if (r.response === 0) updater.quitAndInstall(); });
  });
  updater.on("error", err => {
    if (manualCheck) dialog.showMessageBox(win, { type: "warning", message: "Couldn't check for updates", detail: String(err && err.message || err) });
    manualCheck = false;
  });

  const check = () => updater.checkForUpdates().catch(() => {});
  setTimeout(check, 5000);
  setInterval(check, 4 * 60 * 60 * 1000);
}
function checkNow() {
  if (!updater) { dialog.showMessageBox(win, { type: "info", message: "Updates work in the installed app", detail: "This copy is running from source, so it doesn't check GitHub for updates." }); return; }
  manualCheck = true; updater.checkForUpdates().catch(() => {});
}

/* ---------- menu (Undo/Redo are left to the app so ⌘Z / Ctrl+Z undo show edits) ---------- */
function buildMenu() {
  const mac = process.platform === "darwin";
  const tmpl = [
    ...(mac ? [{ label: "Cuelight", submenu: [
      { role: "about" }, { label: "Check for Updates…", click: checkNow }, { type: "separator" },
      { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" }, { role: "quit" }
    ] }] : [{ label: "File", submenu: [{ role: "quit" }] }]),
    { label: "Edit", submenu: [{ role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    { label: "View", submenu: [{ role: "togglefullscreen" }, { type: "separator" }, { role: "reload" }, { role: "toggleDevTools" }] },
    { role: "windowMenu" },
    { label: "Help", submenu: [
      ...(mac ? [] : [{ label: "Check for Updates…", click: checkNow }]),
      { label: "Release notes", click: () => shell.openExternal("https://github.com/Cal-B-AI/CinemaLight/releases") },
      { label: `Version ${app.getVersion()}`, enabled: false }
    ] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tmpl));
}

app.whenReady().then(() => {
  buildMenu(); createWindow(); setupUpdates();
  scr().on("display-added", displaysChanged); scr().on("display-removed", displaysChanged); scr().on("display-metrics-changed", displaysChanged);
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
