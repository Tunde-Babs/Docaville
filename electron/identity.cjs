// Keep the previous profile in place: copying a live Chromium database is unsafe.
const path = require('node:path');
const { existsSync } = require('node:fs');
function profilePath(appData, exists = existsSync) {
  for (const name of ['DocumentHub', 'documenthub']) {
    const legacy = path.join(appData, name);
    if (exists(legacy)) return legacy;
  }
  return path.join(appData, 'Docaville');
}
module.exports = { profilePath };
