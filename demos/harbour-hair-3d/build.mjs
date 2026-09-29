import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Script } from 'node:vm';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const require = createRequire(import.meta.url);
const tailwind = require('@tailwindcss/postcss');
const postcss = createRequire(require.resolve('@tailwindcss/postcss'))('postcss');
const css = await postcss([tailwind({ base: here, optimize: true })]).process(
  '@import "tailwindcss" source(none);\n@source "./index.html";\n@source "./interface.js";\n@source "./scene.js";',
  { from: path.join(here, 'styles.css') },
);
const result = await build({
  stdin: { contents: 'import "./interface.js"; import "./scene.js";', resolveDir: here },
  bundle: true, write: false, minify: true, format: 'iife', target: ['es2020'], legalComments: 'inline',
});
let html = await readFile(path.join(here, 'index.html'), 'utf8');
const threeLicense = await readFile(path.join(here, 'node_modules/three/LICENSE'), 'utf8');
html = html.replace('<!-- APP_CSS -->', () => `<style>${css.css}</style>`);
// A callback preserves literal dollar sequences inside minified JavaScript.
html = html.replace('<!-- APP_SCRIPT -->', () => `<script>/* Three.js license:\n${threeLicense} */\n${result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script>`);
for (let n = 1; n <= 7; n++) {
  const photo = await readFile(path.join(root, `public/images/gallery/salon-${n}.webp`));
  html = html.replaceAll(`__PHOTO_${n}__`, `data:image/webp;base64,${photo.toString('base64')}`);
}
const destination = path.join(root, 'public/harbour-hair-3d.html');
// Three.js embeds multiline GLSL; trim its insignificant trailing whitespace.
html = html.replace(/[\t ]+$/gm, '');
new Script(html.split('<script>')[1].split('</script>')[0]);
await writeFile(destination, html);
console.log(`Built ${destination} (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB). All scripts, styles and photographs are embedded.`);
