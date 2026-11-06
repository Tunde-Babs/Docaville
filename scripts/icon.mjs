// Docaville app icon — single source of truth for every platform variant.
// The design is drawn in an 824×824 "body" coordinate system and placed into a 1024 canvas:
//   mac:  Apple grid — 824px squircle-ish tile with 100px transparent margin
//   win:  near full-bleed rounded tile (Windows shows icons without a mask)
//   full: edge-to-edge square, no transparency (iOS / Android legacy; the OS applies its own mask)
//   fg / bg: Android adaptive-icon layers (foreground artwork kept inside the 66% safe zone)

const defs = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#38BDF8"/>
      <stop offset="0.45" stop-color="#4F46E5"/>
      <stop offset="1" stop-color="#7C3AED"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.22" cy="0.12" r="0.75">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.38"/>
      <stop offset="0.7" stop-color="#FFFFFF" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="page" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFFFFF"/>
      <stop offset="1" stop-color="#EEF2FF"/>
    </linearGradient>
    <linearGradient id="green" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4ADE80"/><stop offset="1" stop-color="#16A34A"/></linearGradient>
    <linearGradient id="orange" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FDBA74"/><stop offset="1" stop-color="#EA580C"/></linearGradient>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="22" stdDeviation="26" flood-color="#1E1B4B" flood-opacity="0.45"/>
    </filter>
  </defs>`;

const tile = (rx) => `
  <rect width="824" height="824" rx="${rx}" fill="url(#bg)"/>
  <rect width="824" height="824" rx="${rx}" fill="url(#glow)"/>
  <rect x="2" y="2" width="820" height="820" rx="${Math.max(0, rx - 2)}" fill="none" stroke="#FFFFFF" stroke-opacity="0.18" stroke-width="4"/>`;

// Fanned documents: green (sheets) + orange (slides) behind a white doc with a fold,
// a blue title bar, text lines and a 4-colour chart — one hub for every format.
const art = `
  <g filter="url(#shadow)">
    <rect x="188" y="168" width="320" height="420" rx="34" fill="url(#green)" transform="rotate(-15 348 378)"/>
    <rect x="316" y="168" width="320" height="420" rx="34" fill="url(#orange)" transform="rotate(13 476 378)"/>
    <path d="M246 158 H482 L600 276 V626 A38 38 0 0 1 562 664 H246 A38 38 0 0 1 208 626 V196 A38 38 0 0 1 246 158 Z" fill="url(#page)"/>
  </g>
  <path d="M482 158 V238 A38 38 0 0 0 520 276 H600 Z" fill="#C7D2FE"/>
  <rect x="252" y="222" width="170" height="30" rx="15" fill="#2563EB"/>
  <rect x="252" y="282" width="296" height="18" rx="9" fill="#CBD5E1"/>
  <rect x="252" y="320" width="250" height="18" rx="9" fill="#CBD5E1"/>
  <rect x="252" y="358" width="276" height="18" rx="9" fill="#CBD5E1"/>
  <rect x="262" y="500" width="50" height="112" rx="12" fill="#22C55E"/>
  <rect x="332" y="450" width="50" height="162" rx="12" fill="#F97316"/>
  <rect x="402" y="528" width="50" height="84" rx="12" fill="#EF4444"/>
  <rect x="472" y="420" width="50" height="192" rx="12" fill="#2563EB"/>`;

const svg = (inner, size = 1024) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">${defs}${inner}</svg>`;
const place = (x, s, body) => `<g transform="translate(${x} ${x}) scale(${s})">${body}</g>`;
const center = (s) => (1024 - 824 * s) / 2;

export const variants = {
  mac: svg(place(100, 1, tile(185) + art)),
  win: svg(place(center(960 / 824), 960 / 824, tile(170) + art)),
  full: svg(place(0, 1024 / 824, tile(0) + art)),
  bg: svg(place(0, 1024 / 824, tile(0))),
  fg: svg(place(center(0.86), 0.86, art)), // artwork within Android's safe zone
};
