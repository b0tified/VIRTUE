/* VIRTUE — Electron desktop wrapper.
 * Loads the deployed production app in a borderless 1280×800 window.
 * Build the installer with:
 *   yarn electron:install      # one-time: installs electron + electron-builder
 *   yarn electron:dev          # runs the wrapper against the live PWA
 *   yarn electron:build:linux  # AppImage / deb
 *   yarn electron:build:win    # NSIS .exe installer
 *   yarn electron:build:mac    # dmg
 *
 * The output binary connects to the same servers as the browser version, so
 * all gameplay/data/match-making is identical. Settings (graphics/FPS/etc) are
 * stored per-device.
 */
const { app, BrowserWindow, Menu } = require("electron");
const path = require("path");

// Replace with your deployed PWA URL or a custom domain.
const PROD_URL = process.env.VIRTUE_URL || "https://blast-arena-servers.emergent.host";

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: "#0A0A0A",
    title: "VIRTUE",
    autoHideMenuBar: true,
    fullscreenable: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    icon: path.join(__dirname, "..", "public", "icon-512.png"),
  });

  // Strip default menu (File/Edit/View) — game UX, not document app.
  Menu.setApplicationMenu(null);

  win.loadURL(PROD_URL);

  // Open external links in the default browser (e.g. social shares).
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http") && !url.startsWith(PROD_URL)) {
      require("electron").shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  // F11 toggles fullscreen (no menu, so we wire it manually).
  win.webContents.on("before-input-event", (event, input) => {
    if (input.key === "F11" && input.type === "keyDown") {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    }
  });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
