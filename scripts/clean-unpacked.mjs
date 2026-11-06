// Runs after `npm run dist:*`. electron-builder leaves an unpacked copy of the app next to the installers
// (release/mac, release/mac-arm64, win-unpacked…). On macOS, Spotlight and Launchpad index those copies,
// so "DocumentHub" would show up several times. The installers (.dmg / .zip / .exe) are kept; the
// unpacked copies are recreated by the next build.
import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const RELEASE = new URL('../release/', import.meta.url).pathname;
const UNPACKED = /^(mac|mac-(arm64|x64|universal)|(win|linux)(-(arm64|ia32))?-unpacked)$/;

let entries = [];
try { entries = readdirSync(RELEASE); } catch { process.exit(0); } // nothing built yet

for (const name of entries) {
  const dir = join(RELEASE, name);
  if (!UNPACKED.test(name) || !statSync(dir).isDirectory()) continue;
  rmSync(dir, { recursive: true, force: true });
  console.log(`removed unpacked build copy: release/${name}`);
}
