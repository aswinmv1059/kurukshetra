const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { app, BrowserWindow, dialog, Menu, shell, ipcMain } = require("electron");

const CUSTOM_SIGNAL_NAMES_RELATIVE_PATH = path.join("data", "custom-signal-names.json");
const SIGNAL_CODE_PATTERN = /^[A-Z0-9]{2,12}$/;
const SIGNAL_NAME_PATTERN = /^[A-Z0-9][A-Z0-9 /&().-]{1,63}$/;

if (process.platform === "win32") {
  // Runtime tuning for Windows 10 class hardware (including Intel i5 systems).
  app.commandLine.appendSwitch("enable-gpu-rasterization");
  app.commandLine.appendSwitch("num-raster-threads", "4");
  app.commandLine.appendSwitch("disable-background-timer-throttling");
  app.commandLine.appendSwitch("disable-renderer-backgrounding");
}

function sha256File(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
}

function normalizeSignalCode(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .trim();
}

function normalizeSignalName(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeSignalNameMap(rawMap) {
  if (!rawMap || typeof rawMap !== "object" || Array.isArray(rawMap)) {
    return {};
  }

  const sanitized = {};
  for (const [rawCode, rawName] of Object.entries(rawMap)) {
    const code = normalizeSignalCode(rawCode);
    const name = normalizeSignalName(rawName);
    if (!SIGNAL_CODE_PATTERN.test(code)) continue;
    if (!SIGNAL_NAME_PATTERN.test(name)) continue;
    sanitized[code] = name;
  }

  return Object.fromEntries(
    Object.entries(sanitized).sort((a, b) => a[0].localeCompare(b[0]))
  );
}

function getSignalNameMapPaths() {
  return {
    sourcePath: path.join(app.getAppPath(), CUSTOM_SIGNAL_NAMES_RELATIVE_PATH),
    userDataPath: path.join(app.getPath("userData"), "custom-signal-names.json")
  };
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeJsonAtomic(filePath, payload) {
  ensureParentDir(filePath);
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

function readJsonFileSafe(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
}

function loadSignalNameMapFromDisk() {
  const { sourcePath, userDataPath } = getSignalNameMapPaths();
  const sourceMap = sanitizeSignalNameMap(readJsonFileSafe(sourcePath));
  if (Object.keys(sourceMap).length) {
    return sourceMap;
  }
  return sanitizeSignalNameMap(readJsonFileSafe(userDataPath));
}

function persistSignalNameMap(rawMap) {
  const sanitized = sanitizeSignalNameMap(rawMap);
  const { sourcePath, userDataPath } = getSignalNameMapPaths();
  const status = {
    ok: true,
    sourceUpdated: false,
    userDataUpdated: false,
    data: sanitized
  };

  try {
    writeJsonAtomic(sourcePath, sanitized);
    status.sourceUpdated = true;
  } catch (error) {
    status.sourceError = error.message;
  }

  try {
    writeJsonAtomic(userDataPath, sanitized);
    status.userDataUpdated = true;
  } catch (error) {
    status.userDataError = error.message;
  }

  status.ok = status.sourceUpdated || status.userDataUpdated;
  return status;
}

function verifyIntegrity() {
  const appRoot = app.getAppPath();
  const manifestPath = path.join(appRoot, "security", "integrity-manifest.json");

  if (!fs.existsSync(manifestPath)) {
    return { ok: false, reason: "Integrity manifest missing." };
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    return { ok: false, reason: `Integrity manifest invalid: ${error.message}` };
  }

  if (!Array.isArray(manifest.files)) {
    return { ok: false, reason: "Integrity manifest malformed." };
  }

  for (const entry of manifest.files) {
    const relativePath = entry.path;
    const expectedHash = entry.sha256;
    const absolutePath = path.join(appRoot, relativePath);

    if (!fs.existsSync(absolutePath)) {
      return { ok: false, reason: `Protected file missing: ${relativePath}` };
    }

    const actualHash = sha256File(absolutePath);
    if (actualHash !== expectedHash) {
      return { ok: false, reason: `Protected file changed: ${relativePath}` };
    }
  }

  return { ok: true };
}

function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1000,
    minHeight: 680,
    fullscreen: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      devTools: false
    }
  });

  Menu.setApplicationMenu(null);
  mainWindow.removeMenu();
  mainWindow.setFullScreen(true);

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("file://")) {
      event.preventDefault();
    }
  });

  mainWindow.webContents.on("before-input-event", (event, input) => {
    const ctrlOrCmd = input.control || input.meta;
    const blockedShortcut =
      input.key === "F12" ||
      (ctrlOrCmd && input.shift && ["I", "J", "C"].includes(input.key.toUpperCase()));

    if (blockedShortcut) {
      event.preventDefault();
    }
  });

  mainWindow.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  mainWindow.loadFile(path.join(app.getAppPath(), "index.html"));
}

app.on("web-contents-created", (_, contents) => {
  contents.on("will-attach-webview", (event) => event.preventDefault());
});

ipcMain.handle("signal-names:load", () => {
  return {
    ok: true,
    data: loadSignalNameMapFromDisk()
  };
});

ipcMain.handle("signal-names:save", (_event, rawMap) => {
  return persistSignalNameMap(rawMap);
});

app.whenReady().then(() => {
  const integrity = verifyIntegrity();
  if (!integrity.ok) {
    dialog.showErrorBox("Security validation failed", integrity.reason);
    app.quit();
    return;
  }

  createMainWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
