import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const directory = process.argv[2] ?? 'release';
const files = (await fs.readdir(directory, { withFileTypes: true }))
  .filter(file => file.isFile() && ['.zip', '.dmg', '.exe', '.AppImage', '.apk', '.aab'].includes(path.extname(file.name)))
  .map(file => file.name).sort();
if (!files.length) throw new Error('No release packages found for checksums.');
const rows = [];
for (const name of files) rows.push(`${createHash('sha256').update(await fs.readFile(path.join(directory, name))).digest('hex')}  ${name}`);
await fs.writeFile(path.join(directory, 'SHA256SUMS.txt'), rows.join('\n') + '\n');
console.log(`Generated SHA-256 checksums for ${files.length} packages.`);
