import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { graph } from './check-loader-cache.mjs';

// The Cloudflare router (cloudflare/bokdoong-router.mjs) keeps a ?v= asset in the edge
// cache and marks it immutable only when the GitHub Pages bytes match this manifest.
// A deploy still propagating serves old bytes for a new ?v=; those are never pinned.
export const manifestPath = 'app/asset-manifest.json';
const textFile = /\.(?:html|js|mjs|css|json|svg|md|ya?ml)$/i;

export function buildManifest(files, bytes) {
  const assets = {};
  for (const edge of graph(files).edges) {
    if (edge.version === null || !edge.target.startsWith('app/') || !bytes(edge.target)) continue;
    const entry = assets[edge.target] ||= { v: new Set(), sha256: createHash('sha256').update(bytes(edge.target)).digest('hex') };
    entry.v.add(edge.version);
  }
  // One asset per line: parallel PRs conflict only when they change the same file.
  const lines = Object.keys(assets).sort().map(target =>
    `${JSON.stringify(target)}:${JSON.stringify({ v: [...assets[target].v].sort(), sha256: assets[target].sha256 })}`);
  return `{"assets":{\n${lines.join(',\n')}\n}}\n`;
}

function workingTree() {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  process.chdir(root);
  const tracked = execFileSync('git', ['ls-files', '-z', '--', 'app'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0').filter(file => file && existsSync(file));
  const files = Object.fromEntries(tracked.map(file => [file, textFile.test(file) ? readFileSync(file, 'utf8') : 'blob']));
  // Hash committed bytes: a Windows checkout may hold CRLF where Git (and GitHub Pages) hold LF.
  const bytes = file => !Object.hasOwn(files, file) ? null
    : textFile.test(file) ? Buffer.from(files[file].replace(/\r\n/g, '\n'), 'utf8') : readFileSync(file);
  return { files, bytes };
}

function main() {
  const check = process.argv.includes('--check');
  const { files, bytes } = workingTree();
  const next = buildManifest(files, bytes);
  const current = existsSync(manifestPath) ? readFileSync(manifestPath, 'utf8') : '';
  if (check) {
    if (current !== next) {
      console.error(`${manifestPath}가 현재 파일과 다릅니다. node scripts/asset-manifest.mjs 로 다시 만들고 함께 커밋하세요.`);
      process.exitCode = 1;
    } else {
      console.log(`자산 목록 검사 통과: ${Object.keys(JSON.parse(next).assets).length}개.`);
    }
    return;
  }
  if (current !== next) writeFileSync(manifestPath, next);
  console.log(`${manifestPath}: ${Object.keys(JSON.parse(next).assets).length}개.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) {
    console.error(`자산 목록을 만들지 못했습니다: ${error.message}`);
    process.exitCode = 2;
  }
}
