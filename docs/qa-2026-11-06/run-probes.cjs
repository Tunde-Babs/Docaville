// Engine-only exploratory probes. Does not drive or modify the user's application UI.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
app.whenReady().then(async () => {
  let server;
  try {
    const { createServer } = await import('vite');
    server = await createServer({ root: path.resolve(__dirname, '../..'), server: { port: 5203, strictPort: true }, logLevel: 'error' });
    await server.listen();
    const win = new BrowserWindow({ show: false });
    await win.loadURL('http://localhost:5203/docs/qa-2026-11-06/probes.html');
    const deadline = Date.now() + 120000;
    let result;
    while (!(result = await win.webContents.executeJavaScript('window.__QA')) && Date.now() < deadline) await new Promise(r => setTimeout(r, 250));
    if (!result) throw new Error('Probe timeout');
    for (const f of result.files) await fs.writeFile(path.join(__dirname, 'fixtures', f.name), Buffer.from(f.base64, 'base64'));
    delete result.files;
    await fs.writeFile(path.join(__dirname, 'evidence', 'engine-results.json'), JSON.stringify(result, null, 2));
    for (const r of result.results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name}: ${JSON.stringify(r.actual)}`);
    console.log(`Engine probes: ${result.results.filter(r=>r.pass).length}/${result.results.length} passed`);
    await server.close(); app.exit(0);
  } catch (e) { console.error(e); if (server) await server.close(); app.exit(2); }
});
