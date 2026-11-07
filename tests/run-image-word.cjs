// Isolated engine/component checks. Optional file arguments are private, local QA inputs only.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
app.setPath('userData', path.resolve(__dirname, '../tmp/image-word-test-profile'));
app.whenReady().then(async () => {
  let server;
  try {
    const { createServer } = await import('vite');
    server = await createServer({ root: path.resolve(__dirname, '..'), server: { port: 5219, strictPort: true, hmr: false }, logLevel: 'error' });
    await server.listen();
    const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
    await win.loadURL('http://localhost:5219/tests/image-word.html');
    const sources = await Promise.all(process.argv.slice(2).map(async file => ({ name: path.basename(file), b64: (await fs.readFile(file)).toString('base64') })));
    await win.webContents.executeJavaScript(`window.__SOURCES = ${JSON.stringify(sources)}`);
    const deadline = Date.now() + 300000;
    let result;
    while (!(result = await win.webContents.executeJavaScript('window.__IMAGE_WORD')) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 250));
    if (!result) throw new Error('Image to Word tests timed out');
    const output = path.resolve(__dirname, '../tmp/image-word-qa');
    await fs.mkdir(output, { recursive: true });
    for (const file of result.files) await fs.writeFile(path.join(output, file.name), Buffer.from(file.b64, 'base64'));
    delete result.files;
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(result, null, 2));
    for (const check of result.checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}${check.error ? ': ' + check.error : ''}`);
    await server.close();
    app.exit(result.checks.every(check => check.pass) ? 0 : 1);
  } catch (error) { console.error(error); if (server) await server.close(); app.exit(2); }
});
