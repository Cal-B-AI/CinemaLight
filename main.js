// Cuelight desktop shell: one window running the app, projector output pop-outs, and updates from GitHub Releases.
const { app, BrowserWindow, Menu, shell, dialog } = require("electron");
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
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false }
  });
  win.once("ready-to-show", () => win.show());
  win.loadFile(path.join(__dirname, "app", "index.html"));

  // A file dropped outside a drop zone would otherwise navigate away from the show.
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("file://") || !url.includes("/app/index.html")) e.preventDefault();
  });

  // Projector output windows are opened by the page with window.open("", …). Links go to the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url || url === "about:blank") {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 960, height: 540, backgroundColor: "#000000", autoHideMenuBar: true,
          title: "Cuelight Output", icon: path.join(__dirname, "build", "icon.png"),
          webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false }
        }
      };
    }
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
}

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
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
