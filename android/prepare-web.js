// Copies the DTV interface into the Android app as a single bundled script.
// Run from the project root after `npm install`:  node android/prepare-web.js
// Uses `npx esbuild` unless ESBUILD_BIN points at an esbuild binary.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const out = path.join(__dirname, 'app', 'src', 'main', 'assets', 'www');
const outSrc = path.join(out, 'src');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(outSrc, { recursive: true });

// 1. Bundle + down-level the JavaScript so older Fire TV web engines can run it
const bin = process.env.ESBUILD_BIN ? `"${process.env.ESBUILD_BIN}"` : 'npx --yes esbuild@0.24.0';
execSync(`${bin} src/js/app.js --bundle --format=iife --target=chrome69 --minify --outfile="${path.join(outSrc, 'app.js')}"`, {
  cwd: root,
  stdio: 'inherit',
});

// 2. CSS: expand `inset` (not understood by older engines) into top/right/bottom/left
let css = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');
css = css.replace(/(^|[;{\s])inset:\s*([^;}!]+?)(\s*!important)?\s*;/g, (m, pre, val, imp) => {
  const v = val.trim().split(/\s+/);
  const [t, r = t, b = t, l = r] = v;
  const i = imp || '';
  return `${pre}top: ${t}${i}; right: ${r}${i}; bottom: ${b}${i}; left: ${l}${i};`;
});
css += `
@supports not (aspect-ratio: 1 / 1) {
  .card-art { height: 0; padding-top: 150%; }
  .card-art img { position: absolute; top: 0; left: 0; }
  .ep-thumb { height: 94px; }
}
`;
fs.writeFileSync(path.join(outSrc, 'styles.css'), css);

// 3. HTML: drop the desktop-only video libraries and load the bundle instead
let html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
html = html
  .replace(/\s*<script src="\.\.\/node_modules\/(hls\.js|mpegts\.js)[^"]*"><\/script>/g, '')
  .replace('<script type="module" src="js/app.js"></script>', '<script src="app.js"></script>');

// 4. Fonts: copy the CSS and Latin font files if they've been installed
const fontRe = /<link rel="stylesheet" href="\.\.\/node_modules\/(@fontsource\/[^"]+)">/g;
let m;
const missing = [];
while ((m = fontRe.exec(html))) {
  const rel = m[1];
  const from = path.join(root, 'node_modules', rel);
  if (!fs.existsSync(from)) {
    missing.push(m[0]);
    continue;
  }
  const to = path.join(out, 'node_modules', rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  const filesDir = path.join(path.dirname(from), 'files');
  const filesOut = path.join(path.dirname(to), 'files');
  fs.mkdirSync(filesOut, { recursive: true });
  for (const f of fs.readdirSync(filesDir)) {
    if (/-latin-(\d+)-normal\.woff2$/.test(f)) fs.copyFileSync(path.join(filesDir, f), path.join(filesOut, f));
  }
}
for (const tag of missing) html = html.replace(tag, '');
fs.writeFileSync(path.join(outSrc, 'index.html'), html);

console.log(`DTV web app copied to ${path.relative(root, out)}${missing.length ? ` (fonts skipped: ${missing.length})` : ''}`);
