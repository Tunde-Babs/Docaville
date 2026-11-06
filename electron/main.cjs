// Desktop shell (Windows + macOS). The UI is the same web bundle used on mobile.
const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const speech = require('./speech.cjs');
if (process.env.DH_TEST && process.env.DH_TEST_PROFILE) app.setPath('userData', path.resolve(process.env.DH_TEST_PROFILE));

const ICON = path.join(__dirname, '..', 'build', 'icon.png');
const DOC_EXT = ['pdf', 'docx', 'doc', 'odt', 'rtf', 'txt', 'md', 'html', 'htm', 'xlsx', 'xlsm', 'csv', 'tsv', 'pptx',
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'heic', 'heif', 'tif', 'tiff', 'svg'];

let win = null;
let dirtyCount = 0, forceClose = false, quitting = false;
const pendingPaths = []; // files the OS asked us to open before the window was ready
const writable = new Set(); // paths the renderer may overwrite: opened by the user or chosen in a Save dialog

// ---------- single instance + "Open with…" / double-click in Finder / Explorer ----------
// (automated tests set DH_TEST so they can run beside a developer's copy of the app)
if (!process.env.DH_TEST && !app.requestSingleInstanceLock()) { app.quit(); }
const docArgs = (argv) => argv.slice(1).filter((a) => !a.startsWith('-') && DOC_EXT.includes(path.extname(a).slice(1).toLowerCase()));
app.on('second-instance', (_e, argv) => {
  openPaths(docArgs(argv));
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});
app.on('open-file', (e, p) => { e.preventDefault(); openPaths([p]); }); // macOS
pendingPaths.push(...docArgs(process.argv)); // Windows: file passed on the command line

async function readForRenderer(paths) {
  const out = [];
  for (const p of paths) {
    try {
      const abs = path.resolve(p);
      const bytes = await fs.readFile(abs);
      writable.add(abs);
      out.push({ name: path.basename(abs), path: abs, bytes: new Uint8Array(bytes) });
      app.addRecentDocument(abs);
    } catch (err) { dialog.showErrorBox('Could not open file', `${p}\n${err.message}`); }
  }
  return out;
}
async function openPaths(paths) {
  if (!paths.length) return;
  if (!win || win.webContents.isLoading()) { pendingPaths.push(...paths); return; }
  win.webContents.send('open-files', await readForRenderer(paths));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 380,
    title: 'DocumentHub',
    icon: ICON, // Windows/Linux taskbar & window icon (macOS uses the bundle's .icns)
    backgroundColor: '#EEF0FB',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (process.env.DH_TEST && process.env.DH_TEST_OFFLINE) win.webContents.session.webRequest.onBeforeRequest({ urls: ['https://*/*', 'http://*/*'] }, (_request, callback) => callback({ cancel: true }));
  if (process.env.ELECTRON_DEV_URL) win.loadURL(process.env.ELECTRON_DEV_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  // Never navigate the app window away; open web links in the user's browser.
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:') && !url.startsWith(process.env.ELECTRON_DEV_URL ?? '\0')) { e.preventDefault(); shell.openExternal(url); } });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });

  // Unsaved work: ask before closing the window / quitting.
  win.on('close', async (e) => {
    if (forceClose || dirtyCount === 0) return;
    e.preventDefault();
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning', buttons: ['Save All…', "Don't Save", 'Cancel'], defaultId: 0, cancelId: 2,
      message: dirtyCount === 1 ? 'You have a document with unsaved changes.' : `You have ${dirtyCount} documents with unsaved changes.`,
      detail: "If you don't save, your changes will be lost.",
    });
    if (response === 2) { quitting = false; return; }
    if (response === 0) {
      const ok = await new Promise((resolve) => { ipcMain.once('save-all-result', (_ev, r) => resolve(r)); win.webContents.send('save-all'); });
      if (!ok) { quitting = false; return; }
    }
    forceClose = true;
    win.close();
  });
  win.on('closed', () => { speech.stop(); win = null; forceClose = false; if (quitting) app.quit(); });
}

// ---------- IPC ----------
ipcMain.handle('speech-voices', () => speech.voices());
ipcMain.handle('speech-speak', (_event, { text, voice, rate }) => speech.speak(text, voice, rate));
ipcMain.handle('speech-control', (_event, action) => speech.control(action));
ipcMain.on('allow-path', (_e, p) => { if (typeof p === 'string' && path.isAbsolute(p)) writable.add(path.resolve(p)); });
ipcMain.handle('take-pending-files', async () => readForRenderer(pendingPaths.splice(0)));
ipcMain.handle('open-dialog', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Documents & images', extensions: DOC_EXT }, { name: 'All files', extensions: ['*'] }],
  });
  return canceled ? [] : readForRenderer(filePaths);
});
ipcMain.handle('confirm-close', async (_e, { name }) => {
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning', buttons: ['Save', "Don't Save", 'Cancel'], defaultId: 0, cancelId: 2,
    message: `Do you want to save the changes you made to “${name}”?`, detail: "Your changes will be lost if you don't save them.",
  });
  return ['save', 'discard', 'cancel'][response];
});
ipcMain.on('set-dirty', (_e, { count, title }) => {
  dirtyCount = count;
  if (!win) return;
  win.setDocumentEdited?.(count > 0); // macOS: dot in the close button
  if (title) win.setTitle(title);
});

// Atomic write: temp file + rename, so a crash or full disk can never leave a half-written document.
async function atomicWrite(target, bytes) {
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.tmp`);
  await fs.writeFile(tmp, Buffer.from(bytes));
  await fs.rename(tmp, target);
}
ipcMain.handle('write-file', async (_e, { path: p, bytes }) => {
  const target = path.resolve(p);
  if (!writable.has(target)) throw new Error('This file was not opened in DocumentHub; use Save As.');
  await atomicWrite(target, bytes);
  return target;
});
ipcMain.handle('save-file', async (event, { name, bytes }) => {
  const w = BrowserWindow.fromWebContents(event.sender);
  const ext = path.extname(name).slice(1);
  const { canceled, filePath } = await dialog.showSaveDialog(w, {
    defaultPath: name,
    filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : [],
  });
  if (canceled || !filePath) return null;
  await atomicWrite(filePath, bytes);
  writable.add(path.resolve(filePath));
  app.addRecentDocument(filePath);
  return filePath;
});
ipcMain.handle('print-to-pdf', async (event, { landscape }) => event.sender.printToPDF({
  printBackground: true, landscape: !!landscape, pageSize: 'A4', margins: { marginType: 'default' },
}));

// ---------- application menu ----------
const send = (cmd) => () => win?.webContents.send('menu', cmd);
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [
      { label: 'New', submenu: [
        { label: 'Word Document', accelerator: 'CmdOrCtrl+N', click: send('new-doc') },
        { label: 'Excel Workbook', click: send('new-sheet') },
        { label: 'PowerPoint Presentation', click: send('new-slides') },
      ] },
      { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: send('open') },
      { role: 'recentDocuments', submenu: [{ role: 'clearRecentDocuments' }] },
      { type: 'separator' },
      { label: 'Save', accelerator: 'CmdOrCtrl+S', click: send('save') },
      { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: send('save-as') },
      { type: 'separator' },
      { label: 'Print…', accelerator: 'CmdOrCtrl+P', click: send('print') },
      { type: 'separator' },
      { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: send('close-tab') },
      ...(isMac ? [] : [{ role: 'quit' }]),
    ] },
    { label: 'Edit', submenu: [
      // Undo/redo go to the editors' own history (documents, sheets, slides, PDF overlays).
      { label: 'Undo', accelerator: 'CmdOrCtrl+Z', registerAccelerator: false, click: send('undo') },
      { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', registerAccelerator: false, click: send('redo') },
      { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
    ] },
    { label: 'View', submenu: [
      { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { type: 'separator' }, { role: 'togglefullscreen' },
      ...(app.isPackaged ? [] : [{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }]),
    ] },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.on('before-quit', () => { quitting = true; });
app.whenReady().then(() => {
  // In development the app runs inside the stock Electron bundle; show our icon in the Dock anyway.
  if (process.platform === 'darwin' && !app.isPackaged) { try { app.dock.setIcon(ICON); } catch { /* ignore */ } }
  buildMenu();
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin' || quitting) app.quit(); });
