import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = process.argv[2];
if (!destination) throw new Error('Usage: node scripts/build-chat-pages.mjs <new-output-directory>');
const output = resolve(destination);
// Refuse existing output directories, avoiding accidental deletion or stale files.
await mkdir(output);
await mkdir(join(output, 'assets'));
let html = await readFile(join(root, 'page/index.html'), 'utf8');
for (const [from, to] of [
  ['href="/" aria-label="Tiff home"', 'href="https://tiff.co.ke/" aria-label="Tiff home"'],
  ['href="/get-the-app.html"', 'href="https://tiff.co.ke/get-the-app.html"'],
  ['href="/privacy.html"', 'href="https://tiff.co.ke/privacy.html"']
]) {
  if (!html.includes(from)) throw new Error(`Expected chat page markup missing: ${from}`);
  html = html.replace(from, to);
}
await writeFile(join(output, 'index.html'), html);
for (const file of ['chat-page.css', 'chat-config.js', 'chat.js', 'tiff-mark.png']) {
  await copyFile(join(root, 'assets', file), join(output, 'assets', file));
}
console.log(`Chat-only static Pages output created: ${output}`);
