// Runs tests/smoke.html in a hidden Electron (Chromium) window against a programmatic Vite server.
// Usage: npm test   (inside VS Code's terminal: env -u ELECTRON_RUN_AS_NODE npm test)
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
app.whenReady().then(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ root: path.join(__dirname, '..'), server: { port: 5199 }, logLevel: 'error' });
  await server.listen();
  const win = new BrowserWindow({ show: false });
  await win.loadURL('http://localhost:5199/tests/smoke.html');
  const deadline = Date.now() + 240000;
  let res;
  while (!(res = await win.webContents.executeJavaScript('window.__SMOKE')) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 500));
  await server.close();
  if (!res) { console.log('TIMEOUT'); app.exit(2); return; }
  for (const r of res) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.info ? '  — ' + r.info : ''}`);
  app.exit(res.every((r) => r.ok) ? 0 : 1);
});
