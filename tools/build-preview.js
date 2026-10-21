// Builds a single-file clickable preview of the app (preview.html) that runs entirely in the browser.
// Usage: node tools/build-preview.js [output-file]
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const modules = {};
for (const f of fs.readdirSync(path.join(root, 'src')).filter((f) => f.endsWith('.js'))) modules[f.replace(/\.js$/, '')] = read(`src/${f}`);
const pub = {};
const images = {};
for (const f of fs.readdirSync(path.join(root, 'public'), { withFileTypes: true })) if (f.isFile()) pub[f.name] = read(`public/${f.name}`);
for (const f of fs.readdirSync(path.join(root, 'public', 'img')).filter((f) => f.endsWith('.jpg'))) images[`/static/img/${f}`] = `data:image/jpeg;base64,${fs.readFileSync(path.join(root, 'public', 'img', f)).toString('base64')}`;
for (const f of fs.readdirSync(path.join(root, 'public', 'img', 'addons'))) images[`/static/img/addons/${f}`] = `data:image/svg+xml;base64,${fs.readFileSync(path.join(root, 'public', 'img', 'addons', f)).toString('base64')}`;

// Safe to drop inside an HTML <script>: no "</script>", no raw line separators.
const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);
const embed = (obj) => JSON.stringify(obj).replace(/<\//g, '<\\/').split(LS).join('\\u2028').split(PS).join('\\u2029');

const runtime = read('tools/preview-runtime.js')
  .replace('__MODULES__', () => embed(modules))
  .replace('__PUBLIC__', () => embed(pub))
  .replace('__IMAGES__', () => embed(images));
const html = read('tools/preview-shell.html').replace('__RUNTIME__', () => runtime);

const out = process.argv[2] || path.join(root, 'preview.html');
fs.writeFileSync(out, html);
console.log(`Wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);
