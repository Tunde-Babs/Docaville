// Renders scripts/icon.mjs into every platform asset using Chromium (via Electron) for exact SVG
// rendering with transparency.   npm run icons
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '..');
const out = (p) => { const f = path.join(root, p); fs.mkdirSync(path.dirname(f), { recursive: true }); return f; };

app.whenReady().then(async () => {
  const { variants } = await import(path.join(root, 'scripts/icon.mjs'));
  const win = new BrowserWindow({ show: false });
  await win.loadURL('data:text/html,<html></html>');
  // draw(svgs: [{svg, x, y, w}], size) → PNG base64. Layers are composited in order.
  const draw = (layers, size, fill) => win.webContents.executeJavaScript(`(async () => {
    const c = document.createElement('canvas'); c.width = c.height = ${size}; const x = c.getContext('2d');
    ${fill ? `x.fillStyle = '${fill}'; x.fillRect(0, 0, ${size}, ${size});` : ''}
    x.imageSmoothingQuality = 'high';
    for (const l of ${JSON.stringify(layers)}) {
      const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(l.svg); await img.decode();
      x.drawImage(img, l.x, l.y, l.w, l.w);
    }
    return c.toDataURL('image/png').split(',')[1];
  })()`).then((b64) => Buffer.from(b64, 'base64'));
  const png = (v, size) => draw([{ svg: variants[v], x: 0, y: 0, w: size }], size);

  // ---- macOS .icns (Apple grid variant) ----
  const iconset = out('build/icon.iconset/x');
  for (const s of [16, 32, 128, 256, 512]) {
    fs.writeFileSync(path.join(path.dirname(iconset), `icon_${s}x${s}.png`), await png('mac', s));
    fs.writeFileSync(path.join(path.dirname(iconset), `icon_${s}x${s}@2x.png`), await png('mac', s * 2));
  }
  if (process.platform === 'darwin') execFileSync('iconutil', ['-c', 'icns', path.dirname(iconset), '-o', out('build/icon.icns')]);
  fs.rmSync(path.dirname(iconset), { recursive: true });
  fs.writeFileSync(out('build/icon.png'), await png('mac', 1024));

  // ---- Windows .ico (PNG-compressed entries; supported since Vista) ----
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const imgs = await Promise.all(sizes.map((s) => png('win', s)));
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((s, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(s >= 256 ? 0 : s, e); header.writeUInt8(s >= 256 ? 0 : s, e + 1);
    header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(imgs[i].length, e + 8); header.writeUInt32LE(offset, e + 12);
    offset += imgs[i].length;
  });
  fs.writeFileSync(out('build/icon.ico'), Buffer.concat([header, ...imgs]));

  // ---- Web / in-app ----
  fs.writeFileSync(out('public/favicon.svg'), variants.win);
  fs.writeFileSync(out('public/logo.svg'), variants.win);
  fs.writeFileSync(out('public/apple-touch-icon.png'), await png('full', 180));
  fs.writeFileSync(out('public/icon-512.png'), await png('win', 512));

  // ---- iOS / Android sources for `npx @capacitor/assets generate` ----
  fs.writeFileSync(out('assets/icon-only.png'), await png('full', 1024));
  fs.writeFileSync(out('assets/icon-foreground.png'), await png('fg', 1024));
  fs.writeFileSync(out('assets/icon-background.png'), await png('bg', 1024));
  const S = 2732, I = 720;
  fs.writeFileSync(out('assets/splash.png'), await draw([{ svg: variants.bg, x: 0, y: 0, w: S }, { svg: variants.mac, x: (S - I) / 2, y: (S - I) / 2, w: I }], S));
  fs.writeFileSync(out('assets/splash-dark.png'), await draw([{ svg: variants.mac, x: (S - I) / 2, y: (S - I) / 2, w: I }], S, '#0B1020'));

  console.log('icons written: build/icon.{icns,ico,png}, public/{favicon.svg,logo.svg,apple-touch-icon.png,icon-512.png}, assets/*');
  app.exit(0);
});
