import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { graph } from './check-loader-cache.mjs';
import { readTree, versionOf, hashLength, buildManifest, manifestPath, versionable } from './build-pages.mjs';
import router, { resetManifestMemo } from '../cloudflare/bokdoong-router.mjs';

// Checks a build-pages.mjs output: (a) every reference the build versions carries the content
// hash of its target, (b) app/asset-manifest.json is exactly what the output files give, (c) the
// Cloudflare router marks every listed Web2 asset immutable when GitHub Pages serves these bytes.
const bytesOf = (files, file) => typeof files[file] === 'string' ? Buffer.from(files[file], 'utf8') : files[file];
const hashed = new RegExp(`^[0-9a-f]{${hashLength}}$`);

export async function checkBuild(files) {
  const errors = [];
  const text = Object.fromEntries(Object.entries(files).map(([file, value]) => [file, typeof value === 'string' ? value : 'blob']));
  const { edges } = graph(text);
  let references = 0;
  for (const edge of edges) {
    if (!Object.hasOwn(files, edge.target)) continue;
    if (edge.version === null) {
      if (versionable(files, edge)) errors.push(`(a) ${edge.parent}: ${edge.raw} → ?v= 없음`);
      continue;
    }
    references++;
    const expected = versionOf(bytesOf(files, edge.target));
    if (!hashed.test(edge.version) || edge.version !== expected) {
      errors.push(`(a) ${edge.parent}: ${edge.raw} → 기대 ?v=${expected}`);
    }
  }
  const manifest = buildManifest(text, file => Object.hasOwn(files, file) ? bytesOf(files, file) : null);
  if (String(files[manifestPath] ?? '') !== manifest) errors.push(`(b) ${manifestPath}가 결과 파일과 다릅니다.`);
  const assets = JSON.parse(manifest).assets;
  const urls = [];
  for (const [file, entry] of Object.entries(assets)) {
    if (!/\.(?:js|css|svg|png|ico|webp)$/i.test(file) || file.endsWith('/sw.js')) continue;
    for (const v of entry.v) urls.push([file, v]);
  }
  const originalFetch = globalThis.fetch, originalCaches = globalThis.caches;
  globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
  globalThis.fetch = async input => {
    const url = new URL(input.url);
    const path = decodeURIComponent(url.pathname.replace(/^\/work\//, ''));
    const body = path === manifestPath ? files[manifestPath] : bytesOf(files, path);
    return body == null ? new Response('missing', { status: 404 }) : new Response(body);
  };
  try {
    resetManifestMemo();
    for (const [file, v] of urls) {
      const response = await router.fetch(new Request(`https://desk.bokdoong.com/work/${file}?v=${v}`), {}, { waitUntil() {} });
      if (response.headers.get('Cache-Control') !== 'public, max-age=31536000, immutable') errors.push(`(c) ${file}?v=${v}: ${response.status} ${response.headers.get('Cache-Control')}`);
    }
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.caches = originalCaches;
    resetManifestMemo();
  }
  return { errors, references, assets: Object.keys(assets).length, workerChecked: urls.length };
}

async function main() {
  const [dir, ...rest] = process.argv.slice(2);
  if (!dir || rest.length) throw new Error('사용법: node scripts/check-pages-build.mjs <빌드 결과 폴더>');
  const result = await checkBuild(readTree(resolve(dir)));
  if (result.errors.length) {
    for (const error of result.errors) console.error(error);
    process.exitCode = 1;
  } else {
    console.log(`빌드 결과 검사 통과: 해시 참조 ${result.references}개, 자산 목록 ${result.assets}개, Worker 지문 ${result.workerChecked}개.`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`빌드 결과를 검사하지 못했습니다: ${error.message}`);
    process.exitCode = 2;
  });
}
