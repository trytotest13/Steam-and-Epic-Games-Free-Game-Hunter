// Free Game Hunter — zero-dependency quality gate.
// Checks the manifest, verifies every referenced file exists, validates PNG
// icons by signature, and syntax-checks every JS file (node --check).
// Exit code 1 on any problem; CI and local `npm run validate` both use this.
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const problems = [];
const checked = { manifest: 0, files: 0, png: 0, js: 0, htmlRefs: 0 };

const err = (msg) => problems.push(msg);
const rel = (p) => join(root, p);

// ---- manifest ----
let manifest;
try {
  manifest = JSON.parse(readFileSync(rel('manifest.json'), 'utf8'));
  checked.manifest = 1;
} catch (e) {
  err(`manifest.json is not valid JSON: ${e.message}`);
  console.error(problems.join('\n'));
  process.exit(1);
}

if (manifest.manifest_version !== 3) err('manifest_version must be 3');
if (!/^\d+\.\d+\.\d+$/.test(manifest.version || '')) err(`version "${manifest.version}" is not semver`);
if (!Array.isArray(manifest.permissions) || !manifest.permissions.length) err('permissions must be a non-empty array');
for (const perm of ['storage', 'tabs', 'scripting', 'notifications']) {
  if (!manifest.permissions.includes(perm)) err(`missing required permission: ${perm}`);
}

// ---- referenced files exist ----
const mustExist = [];
const pushIcons = (icons) => {
  if (!icons) return;
  for (const p of Object.values(icons)) mustExist.push(p);
};
pushIcons(manifest.icons);
pushIcons(manifest.action && manifest.action.default_icon);
mustExist.push(manifest.background && manifest.background.service_worker);
mustExist.push(manifest.action && manifest.action.default_popup);
if (manifest.options_ui) mustExist.push(manifest.options_ui.page);
for (const cs of manifest.content_scripts || []) {
  for (const f of cs.js || []) mustExist.push(f);
}
for (const f of mustExist) {
  if (!f) {
    err('manifest references an empty path');
    continue;
  }
  if (!existsSync(rel(f))) err(`manifest references missing file: ${f}`);
  else checked.files++;
}

// ---- PNG icons: magic bytes + IHDR dimensions ----
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
for (const p of Object.values(manifest.icons || {})) {
  try {
    const buf = readFileSync(rel(p));
    if (!buf.subarray(0, 8).equals(PNG_SIG)) {
      err(`${p} is not a valid PNG (bad signature)`);
      continue;
    }
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    if (w <= 0 || h <= 0) err(`${p} has zero dimensions`);
    else checked.png++;
  } catch {
    err(`could not read icon: ${p}`);
  }
}

// ---- JS syntax (node --check) ----
const jsFiles = [];
for (const cs of manifest.content_scripts || []) jsFiles.push(...(cs.js || []));
if (manifest.background && manifest.background.service_worker) jsFiles.push(manifest.background.service_worker);
for (const f of [manifest.action && manifest.action.default_popup, manifest.options_ui && manifest.options_ui.page]) {
  if (f) jsFiles.push(f.replace(/\.html$/, '.js'));
}
for (const f of [...new Set(jsFiles)]) {
  const r = spawnSync(process.execPath, ['--check', rel(f)], { encoding: 'utf8' });
  if (r.status !== 0) err(`${f} failed node --check:\n${r.stderr}`);
  else checked.js++;
}

// ---- HTML local refs exist ----
for (const f of [manifest.action && manifest.action.default_popup, manifest.options_ui && manifest.options_ui.page]) {
  if (!f) continue;
  const html = readFileSync(rel(f), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  for (const ref of refs) {
    if (/^(https?:|data:|#|mailto:)/i.test(ref)) continue;
    const target = join(root, dirname(f), ref.split('#')[0]);
    if (!existsSync(target)) err(`${f} references missing local file: ${ref}`);
    else checked.htmlRefs++;
  }
}

const total = checked.files + checked.png + checked.js + checked.htmlRefs;
if (problems.length) {
  console.error(`validate: FAILED\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(
  `validate: OK — manifest v${manifest.version}, ${total} references checked ` +
    `(${checked.files} files, ${checked.png} PNG icons, ${checked.js} JS syntax-checked, ${checked.htmlRefs} html refs)`
);
