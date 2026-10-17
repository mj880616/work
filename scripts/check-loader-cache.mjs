import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokenizer } from 'acorn';

const sourceFile = /\.(?:html|js|mjs|css)$/i;
const textFile = /\.(?:html|js|mjs|css|json|svg|md|ya?ml)$/i;
// These directories contain tooling/fixtures, not deployed page entry points.
const nonEntry = /^(?:tests|docs|scripts|node_modules|android-app|windows-app|supabase|cloudflare|\.github)\/|^app\/legacy\//;

function localReference(raw, parent) {
  raw = raw.replaceAll('&amp;', '&');
  if (/^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(raw) || raw.includes('${')) return null;
  const [pathname, query = ''] = raw.split(/[?#]/);
  if (!/\.(?:js|mjs|css|json|svg|png|jpe?g|webp|ico|woff2?)$/i.test(pathname)) return null;
  const target = posix.normalize(pathname.startsWith('/')
    ? pathname.replace(/^\/(?:work\/)?/, '')
    : posix.join(posix.dirname(parent), pathname));
  if (target.startsWith('../')) return null;
  return { target, version: new URLSearchParams(query).get('v'), raw };
}

export function references(parent, source) {
  if (!sourceFile.test(parent)) return [];
  const values = [];
  if (parent.endsWith('.html')) {
    const clean = source.replace(/<!--[\s\S]*?-->/g, '');
    // Resource tags only: normal page links are not cache dependencies.
    for (const tag of clean.matchAll(/<(?:script|link|img|source)\b[^>]*>/gi)) {
      for (const attr of tag[0].matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) values.push(attr[1]);
    }
    for (const script of clean.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
      values.push(...literalValues(script[1]));
    }
  } else if (parent.endsWith('.css')) {
    const clean = source.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const url of clean.matchAll(/url\(\s*["']?([^\s'"()]+)["']?\s*\)|@import\s+["']([^"']+)["']/gi)) values.push(url[1] || url[2]);
  } else {
    values.push(...literalValues(source));
  }
  return values.map(raw => localReference(raw, parent)).filter(Boolean);
}

function literalValues(source) {
  const values = [];
  for (const token of tokenizer(source, { ecmaVersion: 'latest', sourceType: 'module' })) {
    if (!['string', 'template'].includes(token.type.label)) continue;
    values.push(token.value);
    // Resource tags assembled inside HTML template strings.
    for (const attr of token.value.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) values.push(attr[1]);
  }
  return values;
}

export function graph(files) {
  const queue = Object.keys(files).filter(file => file.endsWith('.html') && !nonEntry.test(file));
  const visited = new Set(), edges = [];
  while (queue.length) {
    const parent = queue.pop();
    if (visited.has(parent)) continue;
    visited.add(parent);
    for (const ref of references(parent, files[parent])) {
      edges.push({ parent, ...ref });
      if (sourceFile.test(ref.target) && Object.hasOwn(files, ref.target)) queue.push(ref.target);
    }
  }
  return { edges, visited };
}

// Third-party bundles live in folders named after their release (rhwp-0.8.7/, mermaid-11.17.2/).
// The build leaves references into them as written (scripts/build-pages.mjs).
export const vendored = /(?:^|\/)[\w.-]+-\d+\.\d+\.\d+\//;

// CI-버전자동화 3단계(docs/design/ci-version-automation.md 4장): the repository references files
// without ?v=; scripts/build-pages.mjs adds content hashes when Pages is built. A hand-written
// ?v= to a file in the repository would be overwritten by the build, so it is refused here.
// References to files outside the repository (another host, a root path Pages does not hold)
// are not built and may keep their own ?v=.
export function checkSourceVersions(base, head) {
  const errors = new Set();
  const sources = Object.keys(head).filter(file => sourceFile.test(file) && !nonEntry.test(file)).sort();
  for (const parent of sources) {
    for (const ref of references(parent, head[parent])) {
      if (ref.version === null || !Object.hasOwn(head, ref.target) || vendored.test(ref.target)) continue;
      errors.add(`${parent}: ${ref.raw} — ?v=를 손으로 쓰지 마세요. 번호 없는 경로로 쓰면 Pages 빌드(scripts/build-pages.mjs)가 내용 해시를 붙입니다.`);
    }
  }
  const after = graph(head);
  for (const edge of after.edges) {
    if (Object.hasOwn(base, edge.target) && !Object.hasOwn(head, edge.target)) {
      errors.add(`${edge.target} 파일을 삭제했지만 ${edge.parent}에서 아직 불러옵니다. 이 참조를 제거하거나 새 파일 경로로 바꾸세요.`);
    }
  }
  return { errors: [...errors], references: after.edges.length, sources: sources.length };
}

function git(args, options = {}) {
  return execFileSync('git', args, { maxBuffer: 64 * 1024 * 1024, ...options });
}

function revisionFiles(ref) {
  const sha = git(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], { encoding: 'utf8' }).trim();
  const rows = git(['ls-tree', '-rz', sha], { encoding: 'utf8' }).split('\0').filter(Boolean)
    .map(row => { const [meta, file] = row.split('\t'); return { file, oid: meta.split(' ')[2], type: meta.split(' ')[1] }; })
    .filter(row => row.type === 'blob');
  const files = Object.fromEntries(rows.map(row => [row.file, `blob:${row.oid}`]));
  const sources = rows.filter(row => textFile.test(row.file));
  if (sources.length) {
    const data = git(['cat-file', '--batch'], { input: sources.map(row => row.oid).join('\n') + '\n' });
    let offset = 0;
    for (const row of sources) {
      const end = data.indexOf(10, offset);
      const size = Number(data.subarray(offset, end).toString().split(' ')[2]);
      if (!Number.isSafeInteger(size)) throw new Error('Git 파일 내용을 읽지 못했습니다.');
      files[row.file] = data.subarray(end + 1, end + 1 + size).toString('utf8');
      offset = end + 1 + size + 1;
    }
  }
  return files;
}

function workingFiles(base, ref) {
  const files = { ...base };
  // Let Git apply checkout filters when finding modifications (CRLF, attributes).
  const paths = [
    ...git(['diff', '--no-renames', '--name-only', '-z', ref, '--'], { encoding: 'utf8' }).split('\0'),
    ...git(['ls-files', '-z', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\0'),
  ].filter(Boolean);
  for (const file of new Set(paths)) {
    if (!existsSync(file)) { delete files[file]; continue; }
    const data = readFileSync(file);
    files[file] = textFile.test(file) ? data.toString('utf8')
      : `blob:${createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex')}`;
  }
  return files;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length % 2 || args.some((arg, index) => index % 2 === 0 && !['--base', '--head'].includes(arg))) {
    throw new Error('사용법: node scripts/check-loader-cache.mjs --base <기준 SHA> [--head <검사 SHA>]');
  }
  const options = Object.fromEntries(Array.from({ length: args.length / 2 }, (_, i) => [args[i * 2], args[i * 2 + 1]]));
  if (!options['--base']) throw new Error('--base에 PR 기준 SHA를 지정하세요.');
  process.chdir(git(['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim());
  const base = revisionFiles(options['--base']);
  const result = checkSourceVersions(base, options['--head'] ? revisionFiles(options['--head']) : workingFiles(base, options['--base']));
  if (result.errors.length) {
    for (const error of result.errors) console.error(error);
    process.exitCode = 1;
  } else {
    console.log(`?v= 검사 통과: 소스 ${result.sources}개에 손으로 쓴 ?v= 없음, 운영 참조 ${result.references}개 확인.`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) {
    console.error(`?v= 검사를 실행하지 못했습니다: ${error.message}`);
    process.exitCode = 2;
  }
}
