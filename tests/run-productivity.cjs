// Exercises product engines and the recovery hook in an isolated Electron profile, not the user's UI.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
app.setPath('userData', path.resolve(__dirname, '../tmp/productivity-test-profile'));
app.whenReady().then(async () => {
  let server;
  try {
    const { createServer } = await import('vite');
    server = await createServer({ root: path.resolve(__dirname, '..'), server: { port: 5208, strictPort: true, hmr: false }, logLevel: 'error' }); await server.listen();
    const window = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
    window.webContents.on('console-message', (_event, _level, message) => { if (/^(PASS|FAIL|Downloading|Loading|Preparing|Processing)/.test(message)) console.log(message); });
    await window.loadURL(`http://localhost:5208/tests/productivity.html${process.argv.includes('--ml') ? '?ml' : ''}`);
    const deadline = Date.now() + (process.argv.includes('--ml') ? 1200000 : 180000); let result;
    while (!(result = await window.webContents.executeJavaScript('window.__PRODUCTIVITY')) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 500));
    if (!result) throw new Error('Productivity tests timed out');
    await fs.mkdir(path.resolve(__dirname, '../docs/productivity-build'), { recursive: true });
    await fs.writeFile(path.resolve(__dirname, `../docs/productivity-build/results${process.argv.includes('--ml') ? '-ml' : ''}.json`), JSON.stringify(result, null, 2));
    result.filter(r => !r.pass).forEach(r => console.error(r.detail)); console.log(`${result.filter(r => r.pass).length}/${result.length} passed`);
    await server.close(); app.exit(result.every(r => r.pass) ? 0 : 1);
  } catch (error) { console.error(error); if (server) await server.close(); app.exit(2); }
});
