#!/usr/bin/env node
// PR마다 도는 화면 시험(App browser E2E)을 고친 파일과 관련된 시험으로 줄인다 (OPS-시험줄, S70-39).
//
// 규칙(AGENTS.md 9절 '시험 양 줄이기', 2026-11-25 명진 결정):
// - 고친 파일 → 관련 시험 대응은 이 파일 한 곳에서 계산한다. 손으로 쓴 표는 아래 FULL·IGNORE·SCREEN_SPECS 목록뿐이고,
//   나머지는 앱 파일끼리 부르는 관계(import·import()·'./x.js' 문자열·HTML src/href·CSS @import)와
//   시험 파일이 부르는 앱 파일 이름, 파일 이름 규칙(시험 이름이 앱 파일 이름으로 시작)으로 자동으로 찾는다.
// - 대응을 못 찾으면, 공용 부품(첫 화면이 바로 부르는 파일·많은 화면이 함께 쓰는 파일)·시험 도구·workflow를 고쳤으면 전체.
// - 문서 등 앱·시험과 상관없는 파일만 고쳤으면 시험 없음.
// - merge queue(merge_group)·main push·매일 정기 실행은 이 계산 없이 늘 전체다(workflow가 정함).
//
//   node scripts/ci/e2e-select.mjs <changed-list-file> <out.json>
//       changed-list-file = `git diff --name-only -z base...head` 결과(NUL 또는 줄바꿈 구분).
//       out.json = {mode:'none'|'some'|'full', specs:[…], reasons:[…], shards:n}
//   node scripts/ci/e2e-select.mjs --has <out.json> <spec>...
//       고른 결과에 주어진 시험 파일 중 하나라도 들어가면(또는 전체면) 'true', 아니면 'false'를 찍는다.
import {existsSync, readdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {basename, join, posix} from 'node:path';
import {fileURLToPath} from 'node:url';

export const SPEC_DIR = 'tests/app-e2e';
export const MAX_SHARDS = 24;
// 시험 파일 몇 개를 갈래 하나에 맡길지(전체가 아니면 갈래 수 = 올림(파일 수 / 이 값), 1~24).
export const SPECS_PER_SHARD = 6;
// 이보다 많은 앱 파일이 (첫 화면 사슬·공용 부품을 빼고) 바로 부르는 파일은 공용 부품으로 보고 전체를 돌린다.
export const SHARED_FAN_IN = 12;

// 고치면 늘 전체를 돌리는 파일(시험 도구·workflow·첫 화면 사슬·공용 부품). 첫 화면이 바로 부르는 파일(app/index.html의
// src·href)과 많이 쓰이는 파일은 아래 계산이 따로 전체로 보낸다.
export const FULL_PATTERNS = [
  /^\.github\/workflows\/app-e2e-check\.yml$/,
  /^\.github\/actions\/setup-playwright\//,
  /^scripts\/ci\/e2e-(select|shard)\.mjs$/,
  /^tests\/app-e2e\/helpers\//,
  /^playwright\.config\.[cm]?[jt]s$/,
  /^(package|package-lock)\.json$/,
  /^p\//,
  /^app\/(index\.html|app\.js|loader-v2\.js|view-loader\.js|runtime-client\.js|app-router\.js|part-styles\.js)$/,
  /^app\/(auth-[^/]+|accessibility-dialog\.js|topbar-actions\.[^/]+|select-mode[^/]*|folder-tree-ui[^/]*)$/,
  /^app\/(shared|brand|login)\//,
  /^app\/(theme-tokens|base-ui|ui-standard|critical|styles|desktop-ui|workspace-ui)\.css$/,
];
// 화면 시험과 상관없는 앱 안 파일(배포 빌드·단위 시험이 따로 본다).
export const IGNORE_PATTERNS = [
  /^app\/release-notes\//,
  /^app\/.*\.md$/i,
];
// 화면 파일 → 이름으로는 찾지 못하는 그 화면의 공용 동작 시험(STAB-파일끌기회귀 S70-80, 명진 11/26 "잘 되던게 자꾸 안됨").
// standard-interactions.spec.mjs(목록·나무·고르기·끌기 기준표)와 자료실 사각형 고르기 시험은 화면 파일 이름을 부르지 않아(가짜 서버 helper로 화면을 연다)
// 자동 계산으로는 [파일]·자료실·노트·사진 화면 파일을 고친 PR에서 빠졌다. 그 화면을 고치면 이 시험들을 꼭 함께 돌린다. 새 화면을 기준표에 더하면 여기에도 한 줄.
export const SCREEN_SPECS = [
  [/^app\/files[^/]*\.(m?js|css)$/, ['standard-interactions.spec.mjs']],
  [/^app\/(library-[^/]+\.(m?js|css)|marquee-select\.(js|css))$/, ['standard-interactions.spec.mjs', 'library-marquee-anywhere.spec.mjs', 'library-marquee-select.spec.mjs']],
  [/^app\/(note|notes)[^/]*\.(m?js|css)$/, ['standard-interactions.spec.mjs']],
  [/^app\/photos?[^/]*\.(m?js|css)$/, ['standard-interactions.spec.mjs']],
];
export function screenSpecsFor(file, testFiles) {
  const out = new Set();
  for (const [re, names] of SCREEN_SPECS) if (re.test(file)) for (const n of names) if (testFiles.has(`${SPEC_DIR}/${n}`)) out.add(`${SPEC_DIR}/${n}`);
  return out;
}
// 이 파일이 부르는 쪽을 따라 올라갈 때 멈추는 첫 화면 사슬(모든 화면을 부르므로 따라가면 늘 전체가 된다).
export const ROOTS = new Set(['app/index.html', 'app/app.js', 'app/loader-v2.js', 'app/view-loader.js']);

const CODE_EXT = /\.(m?js|css|html)$/i;
const REF = /(?:['"`(]|@import\s+)(\.{0,2}\/?[\w@.+\-/]+?\.(?:m?js|css|html|json|svg))(?:[?#][^'"`)]*)?['"`)]/g;

export function parseChanged(text) {
  return [...new Set(text.split(/[\0\n]/).map(s => s.trim()).filter(Boolean))];
}

// 앱 파일끼리 부르는 관계. files: Map<경로, 내용>. 돌려주는 것: Map<경로, Set<그 파일을 부르는 경로>>
export function buildImporters(files) {
  const importers = new Map();
  for (const [file, text] of files) {
    if (!CODE_EXT.test(file)) continue;
    for (const m of text.matchAll(REF)) {
      let ref = m[1];
      if (/^[\w@]/.test(ref) && !ref.includes('/')) ref = './' + ref;
      if (!/^\.{0,2}\//.test(ref)) continue;
      const target = ref.startsWith('/') ? ref.slice(1) : posix.normalize(posix.join(posix.dirname(file), ref));
      if (target === file || !files.has(target)) continue;
      if (!importers.has(target)) importers.set(target, new Set());
      importers.get(target).add(file);
    }
  }
  return importers;
}

// file을 (첫 화면 사슬 밖에서) 부르는 파일 전부. 첫 화면 사슬에 닿으면 거기서 멈춘다.
export function ancestors(file, importers, stops = ROOTS) {
  const seen = new Set();
  const stack = [file];
  while (stack.length) {
    const cur = stack.pop();
    for (const parent of importers.get(cur) || []) {
      if (seen.has(parent) || parent === file) continue;
      seen.add(parent);
      if (!stops.has(parent)) stack.push(parent);
    }
  }
  return seen;
}

const stemOf = file => basename(file).replace(/\.[^.]+$/, '');
const escape = text => text.replace(/[\\^$.*+?()[\]{}|\/]/g, '\\$&');

// 시험 파일(spec)마다 그 파일과 그 파일이 부르는 시험 안 파일(fixture·helper)의 내용을 한 덩어리로 본다.
export function specTexts(testFiles) {
  const out = new Map();
  for (const [file, text] of testFiles) {
    if (!file.endsWith('.spec.mjs')) continue;
    let all = text;
    const seen = new Set([file]);
    const stack = [file];
    while (stack.length) {
      const cur = stack.pop();
      for (const m of (testFiles.get(cur) || '').matchAll(/['"`](\.{1,2}\/[\w.\-/]+\.(?:m?js|html))['"`]/g)) {
        const target = posix.normalize(posix.join(posix.dirname(cur), m[1]));
        if (!testFiles.has(target) || seen.has(target)) continue;
        seen.add(target);
        stack.push(target);
        all += '\n' + testFiles.get(target);
      }
    }
    out.set(file, all);
  }
  return out;
}

// 앱 파일 하나와 관련된 시험: 그 파일(또는 그 파일을 부르는 화면 파일)의 이름을 시험이 부르거나,
// 시험 파일 이름이 그 앱 파일 이름으로 시작한다.
export function specsFor(names, specs) {
  const hits = new Set();
  const patterns = [...names].map(name => {
    const stem = stemOf(name);
    return {stem, mention: new RegExp(`(^|[^\\w-])${escape(basename(name))}([^\\w-]|$)`)};
  });
  for (const [spec, text] of specs) {
    const specStem = basename(spec).replace(/\.spec\.mjs$/, '');
    for (const {stem, mention} of patterns) {
      if (mention.test(text) || (stem.length >= 4 && (specStem === stem || specStem.startsWith(stem + '-')))) {
        hits.add(spec);
        break;
      }
    }
  }
  return hits;
}

export function shardsFor(selection) {
  if (selection.mode === 'full') return MAX_SHARDS;
  if (selection.mode === 'none') return 0;
  return Math.min(MAX_SHARDS, Math.max(1, Math.ceil(selection.specs.length / SPECS_PER_SHARD)));
}

// changed: 고친 파일 목록. appFiles·testFiles: Map<경로, 내용>(지금 PR head 기준).
export function select(changed, appFiles, testFiles) {
  const reasons = [];
  const full = reason => {
    const out = {mode: 'full', specs: [], reasons: [...reasons, reason]};
    out.shards = shardsFor(out);
    return out;
  };
  const importers = buildImporters(appFiles);
  const specs = specTexts(testFiles);
  const indexRefs = new Set([...importers].filter(([, by]) => by.has('app/index.html')).map(([f]) => f));
  // 첫 화면 사슬·첫 화면이 바로 부르는 파일·공용 부품(FULL 목록)에서는 위로 따라가지 않는다
  // (그 파일들은 모든 화면을 부르므로, 따라가면 무엇을 고쳐도 전체가 된다. 그 파일 자체를 고치면 전체).
  const stops = new Set([...ROOTS, ...indexRefs, ...appFiles.keys()].filter(f => ROOTS.has(f) || indexRefs.has(f) || FULL_PATTERNS.some(re => re.test(f))));
  const picked = new Set();
  for (const file of changed) {
    if (FULL_PATTERNS.some(re => re.test(file))) return full(`${file}: 공용 부품·시험 도구·workflow`);
    if (IGNORE_PATTERNS.some(re => re.test(file))) { reasons.push(`${file}: 화면 시험 무관`); continue; }
    if (file.startsWith(SPEC_DIR + '/')) {
      if (file.endsWith('.spec.mjs')) {
        if (testFiles.has(file)) { picked.add(file); reasons.push(`${file}: 고친 시험`); }
        else reasons.push(`${file}: 지운 시험`);
        continue;
      }
      // fixture 등 시험 안 다른 파일: 그것을 부르는 시험.
      const hits = [...specs].filter(([, text]) => text.includes(basename(file))).map(([s]) => s);
      if (!hits.length) return full(`${file}: 부르는 시험을 못 찾음`);
      hits.forEach(s => picked.add(s));
      reasons.push(`${file}: 시험 ${hits.length}개`);
      continue;
    }
    if (!file.startsWith('app/')) continue; // 문서·서버·다른 도구: 화면 시험 무관(전과 같음)
    if (indexRefs.has(file)) return full(`${file}: 첫 화면이 바로 부르는 파일`);
    // 앱 파일들은 서로 돌아가며 부르는 곳이 많아(바구니 ↔ 자료실 ↔ 노트 등) 끝까지 따라가면 모두가 걸린다.
    // 그래서 바로 부르는 파일 한 층만 본다(그 파일을 부르는 화면의 시험).
    const plain = [...(importers.get(file) || [])].filter(f => !stops.has(f));
    if (plain.length > SHARED_FAN_IN) return full(`${file}: 앱 파일 ${plain.length}개가 함께 쓰는 공용 부품`);
    const names = new Set([file, ...plain]);
    // 하위 폴더 파일(arsenal/ 등)은 폴더 이름을 부르는 시험도 관련으로 본다.
    const hits = specsFor(names, specs);
    const dir = file.split('/').length > 2 ? file.split('/')[1] + '/' : '';
    if (dir) for (const [s, text] of specs) if (text.includes(dir)) hits.add(s);
    for (const s of screenSpecsFor(file, testFiles)) hits.add(s);
    if (!hits.size) return full(`${file}: 관련 시험을 못 찾음`);
    hits.forEach(s => picked.add(s));
    reasons.push(`${file}: 시험 ${hits.size}개`);
  }
  const out = picked.size ? {mode: 'some', specs: [...picked].sort(), reasons} : {mode: 'none', specs: [], reasons};
  out.shards = shardsFor(out);
  return out;
}

function walk(root, out = new Map()) {
  if (!existsSync(root)) return out;
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    const st = statSync(path);
    if (st.isDirectory()) {
      // 판 번호가 든 외부 라이브러리 폴더 안은 서로 부르는 관계만 많고 시험 대응에 쓰지 않는다.
      if (/-\d+\.\d+/.test(name) || name === 'node_modules') continue;
      walk(path, out);
    } else if (/\.(m?js|css|html|json|svg)$/i.test(name) && st.size < 2_000_000) {
      out.set(path.split('\\').join('/'), readFileSync(path, 'utf8'));
    }
  }
  return out;
}

export function loadRepo(root = '.') {
  const rel = map => new Map([...map].map(([k, v]) => [posix.relative(root.split('\\').join('/'), k) || k, v]));
  return {appFiles: rel(walk(join(root, 'app'))), testFiles: rel(walk(join(root, SPEC_DIR)))};
}

function main(argv) {
  if (argv[0] === '--has') {
    const sel = JSON.parse(readFileSync(argv[1], 'utf8'));
    const wanted = argv.slice(2);
    process.stdout.write(sel.mode === 'full' || wanted.some(s => sel.specs.includes(s)) ? 'true' : 'false');
    return;
  }
  const [listFile, outFile] = argv;
  if (!listFile || !outFile) throw new Error('usage: e2e-select.mjs <changed-list-file> <out.json> | --has <out.json> <spec>...');
  const changed = parseChanged(readFileSync(listFile, 'utf8'));
  const {appFiles, testFiles} = loadRepo('.');
  const sel = select(changed, appFiles, testFiles);
  writeFileSync(outFile, JSON.stringify(sel, null, 2));
  console.log(`mode=${sel.mode} specs=${sel.specs.length} shards=${sel.shards}`);
  for (const r of sel.reasons) console.log(`- ${r}`);
  for (const s of sel.specs) console.log(`  ${s}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
