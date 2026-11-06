// Verify artifacts actually exported through the packaged desktop application, without driving its UI.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
app.whenReady().then(async () => {
  let server;
  try {
    const { createServer } = await import('vite');
    server = await createServer({root:path.resolve(__dirname,'..'),server:{port:5205,strictPort:true},logLevel:'error'});
    await server.listen();
    const win = new BrowserWindow({show:false});
    await win.loadURL('http://localhost:5205/tests/regressions.html');
    const result = await win.webContents.executeJavaScript(`(async () => {
      const {loadPdfJs,pdfToText} = await import('/src/engines/pdf.ts');
      const r=await fetch('/docs/qa-2026-11-06/fix-verification/fixtures/unicode-packaged.pdf');
      if(!r.ok) throw new Error('Packaged UI export artifact is missing');
      const actual=(await pdfToText(await loadPdfJs(new Uint8Array(await r.arrayBuffer())))).normalize('NFC');
      const expected=['Ẹ káàárọ̀','Привет','你好','مرحبا'];
      return {case:'B09 packaged UI multilingual PDF export',actual,pass:expected.every(s=>actual.includes(s.normalize('NFC')))&&!actual.includes('?')};
    })()`);
    const output=path.resolve(__dirname,'../docs/qa-2026-11-06/fix-verification/packaged-unicode.json');
    await fs.writeFile(output,JSON.stringify(result,null,2));
    console.log(JSON.stringify(result));
    await server.close(); app.exit(result.pass?0:1);
  } catch(e) { console.error(e);if(server)await server.close();app.exit(2); }
});
