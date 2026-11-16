// Usage: node scripts/bump-version.mjs 1.2.3
// Keeps package.json, tauri.conf.json and Cargo.toml (app + core crate) on one version.
import { readFileSync, writeFileSync } from 'node:fs';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version ?? '')) {
  console.error('Usage: node scripts/bump-version.mjs <major.minor.patch>');
  process.exit(1);
}

const json = (path, edit) => {
  const data = JSON.parse(readFileSync(path, 'utf8'));
  edit(data);
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
};
json('package.json', (d) => (d.version = version));
json('src-tauri/tauri.conf.json', (d) => (d.version = version));
for (const path of ['src-tauri/Cargo.toml', 'src-tauri/core/Cargo.toml']) {
  const text = readFileSync(path, 'utf8').replace(/^version = ".*"$/m, `version = "${version}"`);
  writeFileSync(path, text);
}
console.log(`Version set to ${version}. Commit, then tag: git tag v${version} && git push --tags`);
