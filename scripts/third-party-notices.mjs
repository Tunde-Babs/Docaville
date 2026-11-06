import fs from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd();
const lock = JSON.parse(await fs.readFile('package-lock.json', 'utf8'));
const sections = ['Docaville — third-party dependency notices\n\nGenerated from the locked installed dependency tree. Includes build tools as well as runtime libraries. Font notices are distributed in dist/fonts; downloaded model terms are listed in docs/release/model-licenses.md. This inventory is not a legal clearance opinion.'];
const inventory = [];
for (const [location, entry] of Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b))) {
  if (!location || !location.includes('node_modules/')) continue;
  const directory = path.join(root, location);
  let meta;
  try { meta = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8')); } catch { continue; }
  const names = (await fs.readdir(directory)).filter(name => /^(licen[sc]e|copying|notice)(\.|$|-)/i.test(name)).sort();
  const row = { name: meta.name, version: meta.version, license: meta.license ?? entry.license ?? 'See package notices', notices: names };
  inventory.push(row);
  const texts = [];
  for (const name of names) {
    const file = path.join(directory, name);
    if ((await fs.stat(file)).isFile()) texts.push(`${name}\n${await fs.readFile(file, 'utf8')}`);
  }
  sections.push(`${row.name}@${row.version}\nLicense: ${typeof row.license === 'string' ? row.license : JSON.stringify(row.license)}\n${texts.join('\n\n') || 'No separate root notice file; consult the upstream package and declared license.'}`);
}
await fs.mkdir('licenses', { recursive: true });
await fs.writeFile('licenses/THIRD-PARTY-NOTICES.txt', sections.join('\n\n' + '='.repeat(72) + '\n\n') + '\n');
await fs.copyFile('docs/release/model-licenses.md', 'licenses/MODEL-NOTICES.md');
await fs.mkdir('docs/release', { recursive: true });
await fs.writeFile('docs/release/dependency-inventory.json', JSON.stringify(inventory, null, 2) + '\n');
console.log(`Generated notices for ${inventory.length} installed packages.`);
