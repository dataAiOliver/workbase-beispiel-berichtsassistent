// Build: Syntaxprüfung aller .mjs-Dateien und Kopie von public/ nach dist/ mit Content-Hash.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const skip = new Set(['node_modules', 'dist', '.git', '.workbase', 'test-results', 'playwright-report']);
const started = performance.now();

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(root);
const modules = files.filter((f) => f.endsWith('.mjs') || (f.endsWith('.js') && f.includes(`${join(root, 'public')}`)));
for (const f of modules) execFileSync(process.execPath, ['--check', f], { stdio: 'inherit' });
console.log(`✓ Syntaxprüfung: ${modules.length} Module`);

const dist = join(root, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(join(root, 'public'), dist, { recursive: true });

// JS/CSS mit Content-Hash versehen und Verweise in index.html umschreiben.
const manifest = {};
for (const f of walk(dist)) {
  const ext = extname(f);
  if (ext !== '.js' && ext !== '.css') continue;
  const hash = createHash('sha256').update(readFileSync(f)).digest('hex').slice(0, 10);
  const rel = relative(dist, f);
  const hashed = rel.slice(0, -ext.length) + `.${hash}` + ext;
  writeFileSync(join(dist, hashed), readFileSync(f));
  rmSync(f);
  manifest[rel] = hashed;
}
const indexPath = join(dist, 'index.html');
let html = readFileSync(indexPath, 'utf8');
for (const [from, to] of Object.entries(manifest)) html = html.replaceAll(`/${from}`, `/${to}`);
writeFileSync(indexPath, html);
writeFileSync(join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`✓ dist/ erstellt (${Object.keys(manifest).length} Assets gehasht) in ${Math.round(performance.now() - started)} ms`);
