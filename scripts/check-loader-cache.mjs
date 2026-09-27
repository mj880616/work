import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceFile = /\.(?:html|js|mjs|css)$/i;
const textFile = /\.(?:html|js|mjs|css|json|svg|md|ya?ml)$/i;
// These directories contain tooling/fixtures, not deployed page entry points.
const nonEntry = /^(?:tests|docs|scripts|node_modules|android|windows|supabase|cloudflare|\.github)\/|^app\/legacy\//;
const normalized = value => typeof value === 'string' ? value.replace(/\r\n/g, '\n') : value;

// Keep strings intact while discarding comments (including commented-out imports).
// This is a static literal reader, not a JavaScript evaluator. See docs for limits.
function withoutComments(source, html = false) {
  if (html) source = source.replace(/<!--[\s\S]*?-->/g, '');
  return source.replace(/"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g,
    token => token.startsWith('/') ? '' : token);
}

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

function references(parent, source) {
  if (!sourceFile.test(parent)) return [];
  const clean = withoutComments(source, parent.endsWith('.html'));
  const values = [];
  if (parent.endsWith('.html')) {
    // Resource tags only: normal page links are not cache dependencies.
    for (const tag of clean.matchAll(/<(?:script|link|img|source)\b[^>]*>/gi)) {
      for (const attr of tag[0].matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) values.push(attr[1]);
    }
    for (const script of clean.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
      values.push(...literalValues(script[1]));
    }
  } else {
    values.push(...literalValues(clean));
    if (parent.endsWith('.css')) {
      for (const url of clean.matchAll(/url\(\s*([^\s'"()]+)\s*\)/gi)) values.push(url[1]);
    }
  }
  return values.map(raw => localReference(raw, parent)).filter(Boolean);
}

function literalValues(source) {
  const values = [];
  for (const match of source.matchAll(/(["'`])((?:\\[\s\S]|(?!\1)[^\\])*)\1/g)) {
    values.push(match[2]);
    // Resource tags assembled inside HTML template strings.
    for (const attr of match[2].matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) values.push(attr[1]);
  }
  return values;
}

function graph(files) {
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

export function checkCacheVersions(base, head) {
  const before = graph(base), after = graph(head);
  const changed = new Set([...Object.keys(base), ...Object.keys(head)]
    .filter(file => normalized(base[file]) !== normalized(head[file])));
  const oldVersions = new Map();
  for (const edge of before.edges) {
    const key = `${edge.parent}\0${edge.target}`;
    if (!oldVersions.has(key)) oldVersions.set(key, new Set());
    oldVersions.get(key).add(edge.version);
  }
  const errors = new Set();
  for (const edge of after.edges) {
    if (!changed.has(edge.target) || !Object.hasOwn(base, edge.target)) continue;
    if (!Object.hasOwn(head, edge.target)) {
      errors.add(`${edge.target} 파일을 삭제했지만 ${edge.parent}에서 아직 불러옵니다. 이 참조를 제거하거나 새 파일 경로로 바꾸세요.`);
      continue;
    }
    const previous = oldVersions.get(`${edge.parent}\0${edge.target}`);
    // A new URL has no old cached bytes. Existing unversioned URLs have no v policy.
    if (!previous || (edge.version === null && [...previous].every(v => v === null))) continue;
    if (!edge.version || previous.has(edge.version)) {
      errors.add(`${edge.target} 파일을 고쳤지만 ${edge.parent}의 ${edge.raw} 캐시 버전이 갱신되지 않았습니다. 이 파일을 불러오는 모든 곳의 ?v= 값을 새 값으로 바꾸고 상위 로더 버전도 올려 주세요.`);
    }
  }
  return { errors: [...errors], changed: [...changed], references: after.edges.length, sources: after.visited.size };
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
    ...git(['diff', '--name-only', '-z', ref, '--'], { encoding: 'utf8' }).split('\0'),
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
  const result = checkCacheVersions(base, options['--head'] ? revisionFiles(options['--head']) : workingFiles(base, options['--base']));
  if (result.errors.length) {
    for (const error of result.errors) console.error(error);
    process.exitCode = 1;
  } else {
    console.log(`캐시 버전 검사 통과: 변경 ${result.changed.length}개, 운영 참조 ${result.references}개 확인.`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) {
    console.error(`캐시 버전 검사를 실행하지 못했습니다: ${error.message}`);
    process.exitCode = 2;
  }
}
