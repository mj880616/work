import { readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { graph, vendored } from './check-loader-cache.mjs';

// CI-버전자동화(docs/design/ci-version-automation.md 4장): the repository references files
// without ?v=. A Pages build output (Jekyll _site or a repository copy) gets every static
// reference to a file in the tree versioned with the first 10 hex chars of the SHA-256 of that
// file's final bytes, children first, so a leaf change reaches index.html. A ?v= already present
// is overwritten. app/asset-manifest.json exists only in the output, made from the same bytes.
const sourceFile = /\.(?:html|js|mjs|css)$/i;
export const hashLength = 10;
export const versionOf = bytes => createHash('sha256').update(bytes).digest('hex').slice(0, hashLength);
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// References into third-party bundles (`vendored`) are left as written: the release in the
// folder name already pins the content, and their internal imports must keep one URL per module.
// JSON named in a script is data read at run time (press/archive.json, rewritten by every press
// publication); versioning it would change the script and so the whole Web2 chain on each
// publication. JSON linked from HTML (the web app manifest) is a static asset like the rest.
export const versionable = (files, edge) => Object.hasOwn(files, edge.target) && !vendored.test(edge.target)
  && !(edge.target.endsWith('.json') && !edge.parent.endsWith('.html'));

export function withVersion(raw, version) {
  if (/[?&]v=/.test(raw)) return raw.replace(/([?&]v=)[^&#]*/, `$1${version}`);
  const [, path, query = '', hash = ''] = raw.match(/^([^?#]*)(\?[^#]*)?(#.*)?$/);
  return `${path}${query ? `${query}&` : '?'}v=${version}${hash}`;
}

// The Cloudflare router (cloudflare/bokdoong-router.mjs) keeps a ?v= asset in the edge cache and
// marks it immutable only when the GitHub Pages bytes match this manifest. A deploy still
// propagating serves old bytes for a new ?v=; those are never pinned.
export const manifestPath = 'app/asset-manifest.json';

export function buildManifest(files, bytes) {
  const assets = {};
  for (const edge of graph(files).edges) {
    if (edge.version === null || !edge.target.startsWith('app/') || !bytes(edge.target)) continue;
    const entry = assets[edge.target] ||= { v: new Set(), sha256: createHash('sha256').update(bytes(edge.target)).digest('hex') };
    entry.v.add(edge.version);
  }
  const lines = Object.keys(assets).sort().map(target =>
    `${JSON.stringify(target)}:${JSON.stringify({ v: [...assets[target].v].sort(), sha256: assets[target].sha256 })}`);
  return `{"assets":{\n${lines.join(',\n')}\n}}\n`;
}

// A reference is a whole string literal, attribute value or url() value, so it must sit
// between delimiters; "./a.js?v=1" never matches inside "./a.js?v=12".
function replaceReference(source, from, to) {
  const pattern = new RegExp(`(?<=["'\`(=\\s])${escape(from)}(?=["'\`)\\s>])`, 'g');
  return source.replace(pattern, () => to);
}

/**
 * files: { path: string (html/js/mjs/css) | Buffer (anything else) }.
 * Returns { files, versions } with the same keys; rewritten sources become strings.
 */
export function rewriteVersions(input) {
  const files = { ...input };
  const text = Object.fromEntries(Object.entries(files).map(([file, value]) => [file, typeof value === 'string' ? value : 'blob']));
  const children = new Map();
  for (const edge of graph(text).edges) {
    if (!versionable(files, edge)) continue;
    if (!children.has(edge.parent)) children.set(edge.parent, []);
    children.get(edge.parent).push(edge);
  }
  const versions = new Map(), active = new Set();
  const bytes = file => typeof files[file] === 'string' ? Buffer.from(files[file], 'utf8') : files[file];
  function finish(file, trail) {
    if (versions.has(file)) return versions.get(file);
    if (active.has(file)) throw new Error(`순환 참조: ${[...trail, file].join(' → ')}`);
    active.add(file);
    let source = files[file];
    for (const edge of children.get(file) || []) {
      const version = finish(edge.target, [...trail, file]);
      const next = withVersion(edge.raw, version);
      if (next === edge.raw) continue;
      let replaced = replaceReference(source, edge.raw, next);
      // HTML attributes may spell & as &amp;; graph() reports the decoded form.
      if (replaced === source && file.endsWith('.html') && edge.raw.includes('&')) {
        replaced = replaceReference(source, edge.raw.replaceAll('&', '&amp;'), next.replaceAll('&', '&amp;'));
      }
      if (replaced === source && !source.includes(next)) throw new Error(`${file}: ${edge.raw} 참조를 고쳐 쓰지 못했습니다.`);
      source = replaced;
    }
    files[file] = source;
    active.delete(file);
    const version = versionOf(bytes(file));
    versions.set(file, version);
    return version;
  }
  for (const file of Object.keys(files).sort()) if (sourceFile.test(file) && typeof files[file] === 'string') finish(file, []);
  return { files, versions };
}

/** Full build on an in-memory tree: rewritten files plus the regenerated manifest. */
export function buildPages(input) {
  const { files } = rewriteVersions(input);
  const text = Object.fromEntries(Object.entries(files).map(([file, value]) => [file, typeof value === 'string' ? value : 'blob']));
  const bytes = file => !Object.hasOwn(files, file) ? null : typeof files[file] === 'string' ? Buffer.from(files[file], 'utf8') : files[file];
  files[manifestPath] = buildManifest(text, bytes);
  return files;
}

function walk(root, prefix = '') {
  const out = [];
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) { if (entry.name !== '.git') out.push(...walk(root, path)); }
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

export function readTree(root) {
  return Object.fromEntries(walk(root).map(file => {
    const data = readFileSync(join(root, file));
    if (!sourceFile.test(file)) return [file, data];
    const source = data.toString('utf8');
    // Hashes are taken from the re-encoded text, so it must be the exact bytes on disk.
    if (!Buffer.from(source, 'utf8').equals(data)) throw new Error(`${file}: UTF-8이 아닌 내용이 있습니다.`);
    return [file, source];
  }));
}

export function buildDirectory(inputDir, outputDir) {
  if (existsSync(outputDir) && readdirSync(outputDir).length) throw new Error(`출력 폴더가 비어 있지 않습니다: ${outputDir}`);
  const input = readTree(inputDir);
  const output = buildPages(input);
  for (const [file, value] of Object.entries(output)) {
    const target = join(outputDir, file);
    mkdirSync(dirname(target), { recursive: true });
    // Untouched files are copied byte for byte; only rewritten sources are re-encoded.
    if (value === input[file] && Object.hasOwn(input, file)) copyFileSync(join(inputDir, file), target);
    else writeFileSync(target, value);
  }
  return output;
}

function main() {
  const [inputDir, outputDir, ...rest] = process.argv.slice(2);
  if (!inputDir || !outputDir || rest.length) throw new Error('사용법: node scripts/build-pages.mjs <입력 폴더> <출력 폴더>');
  const output = buildDirectory(resolve(inputDir), resolve(outputDir));
  const assets = Object.keys(JSON.parse(output[manifestPath]).assets).length;
  console.log(`Pages 빌드 완료: 파일 ${Object.keys(output).length}개, 자산 목록 ${assets}개 → ${outputDir}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) {
    console.error(`Pages 빌드를 하지 못했습니다: ${error.message}`);
    process.exitCode = 2;
  }
}
