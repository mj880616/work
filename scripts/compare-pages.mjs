import { readFileSync, readdirSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Jekyll 동등성 확인(CI-버전자동화 1단계): compares an actions/jekyll-build-pages output with
// another folder, or with what GitHub Pages serves now. Read-only; nothing is deployed.
//   node scripts/compare-pages.mjs <폴더 A> <폴더 B>
//   node scripts/compare-pages.mjs --live <폴더> [--base https://mj880616.github.io/work/]
const sha = data => createHash('sha256').update(data).digest('hex');

function listFiles(root, prefix = '') {
  const out = [];
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) { if (entry.name !== '.git') out.push(...listFiles(root, path)); }
    else if (entry.isFile()) out.push(path);
  }
  return out.sort();
}

export function hashTree(root) {
  return new Map(listFiles(root).map(file => [file, sha(readFileSync(join(root, file)))]));
}

export function compareTrees(a, b) {
  const onlyA = [...a.keys()].filter(file => !b.has(file));
  const onlyB = [...b.keys()].filter(file => !a.has(file));
  const changed = [...a.keys()].filter(file => b.has(file) && a.get(file) !== b.get(file));
  return { onlyA, onlyB, changed, same: a.size - onlyA.length - changed.length };
}

export async function compareLive(tree, base, { fetchImpl = fetch, concurrency = 8 } = {}) {
  const files = [...tree.keys()], missing = [], changed = [];
  let next = 0;
  async function worker() {
    while (next < files.length) {
      const file = files[next++];
      try {
        const response = await fetchImpl(new URL(file.split('/').map(encodeURIComponent).join('/'), base), { headers: { 'Cache-Control': 'no-cache' }, redirect: 'manual' });
        if (response.status !== 200) { missing.push(`${file} (HTTP ${response.status})`); continue; }
        if (sha(Buffer.from(await response.arrayBuffer())) !== tree.get(file)) changed.push(file);
      } catch (error) {
        missing.push(`${file} (${error.message})`);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { missing: missing.sort(), changed: changed.sort(), same: files.length - missing.length - changed.length };
}

function report(title, sections) {
  const lines = [`### ${title}`, ''];
  for (const [label, items] of sections) {
    if (typeof items === 'number') { lines.push(`- ${label}: ${items}`); continue; }
    lines.push(`- ${label}: ${items.length}`);
    for (const item of items.slice(0, 200)) lines.push(`  - \`${item}\``);
    if (items.length > 200) lines.push(`  - … 외 ${items.length - 200}개`);
  }
  const text = lines.join('\n') + '\n';
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + '\n');
}

async function main() {
  const args = process.argv.slice(2);
  const strict = args.includes('--strict');
  const rest = args.filter(arg => arg !== '--strict');
  let differs;
  if (rest[0] === '--live') {
    const dir = rest[1];
    const base = rest[2] === '--base' ? rest[3] : 'https://mj880616.github.io/work/';
    if (!dir || (rest.length !== 2 && rest.length !== 4) || !/^https:\/\/[^/]+\/.*\/$/.test(base)) throw new Error('사용법: node scripts/compare-pages.mjs --live <폴더> [--base https://…/]');
    const result = await compareLive(hashTree(resolve(dir)), base);
    report(`${dir} ↔ ${base}`, [['같음', result.same], ['운영에 없음·오류', result.missing], ['내용 다름', result.changed]]);
    differs = result.missing.length + result.changed.length > 0;
  } else {
    const [a, b] = rest;
    if (!a || !b || rest.length !== 2) throw new Error('사용법: node scripts/compare-pages.mjs <폴더 A> <폴더 B>');
    const result = compareTrees(hashTree(resolve(a)), hashTree(resolve(b)));
    report(`${a} ↔ ${b}`, [['같음', result.same], [`${a}에만 있음`, result.onlyA], [`${b}에만 있음`, result.onlyB], ['내용 다름', result.changed]]);
    differs = result.onlyA.length + result.onlyB.length + result.changed.length > 0;
  }
  // Without --strict the comparison only reports; 1단계 does not gate on Jekyll differences.
  if (strict && differs) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`Pages 결과를 비교하지 못했습니다: ${error.message}`);
    process.exitCode = 2;
  });
}
