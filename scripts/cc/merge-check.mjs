#!/usr/bin/env node
// 넣기 자동 점검(merge gate) — OPS-넣기점검 (2026-11-26 명진 결정, 효율화 2).
// PR 번호를 받아 GitHub REST로 읽기만 하고, PR마다 한 줄 판정과 이유를 낸다. merge 등 쓰기 동작은 없다.
//
//   node scripts/cc/merge-check.mjs 3158 3149 3141        # 사람이 읽는 표
//   node scripts/cc/merge-check.mjs --json 3158            # 기계용
//   (선택) --repo owner/name  --root <저장소 폴더>
//
// 통신: `gh`가 있으면 `gh api`(로그인 정보는 gh가 다룸), 없으면 GITHUB_TOKEN·GH_TOKEN 환경 값으로 fetch.
// 토큰 값은 어디에도 출력하지 않는다.
// 영역 표: scripts/cc/lanes.json (docs/command-center-ops.md 1-1절의 경로 패턴은 이 파일 한 곳).
// _shared 계산·13절 '만들 차례' ID는 --root(기본: 이 저장소 작업 폴더, 보통 최신 main)의 파일을 읽는다.
import {execFileSync} from 'node:child_process';
import {readFileSync, readdirSync, statSync, existsSync} from 'node:fs';
import {join, dirname, resolve, relative, posix} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT = resolve(here, '..', '..');
export const DEFAULT_REPO = 'mj880616/work';

// ---------------------------------------------------------------- 경로 패턴
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { re += '.*'; i++; if (glob[i + 1] === '/') i++; }
      else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

export function loadLanes(root = DEFAULT_ROOT) {
  return JSON.parse(readFileSync(join(root, 'scripts/cc/lanes.json'), 'utf8'));
}

// 영역을 셀 파일: 앱 코드와 Edge 함수만(문서·시험·workflow는 영역을 정하지 않는다).
export function isLaneFile(path) {
  return (path.startsWith('app/') && !path.startsWith('app/release-notes/')) || path.startsWith('supabase/functions/');
}

export function laneOfFile(path, lanesDoc) {
  for (const lane of lanesDoc.lanes) {
    if (lane.patterns.some((p) => globToRegExp(p).test(path))) return lane.id;
  }
  return lanesDoc.default;
}

export function laneName(id, lanesDoc) {
  if (!id) return '';
  const lane = lanesDoc.lanes.find((l) => l.id === id);
  return lane ? lane.name : '사. 그 밖';
}

// PR 영역 = 영역 파일이 가장 많이 걸린 영역(같으면 표 위쪽). 영역 파일이 없으면 null(문서·시험·운영만).
export function prLane(files, lanesDoc) {
  const counts = new Map();
  for (const f of files) {
    if (!isLaneFile(f)) continue;
    const id = laneOfFile(f, lanesDoc);
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  if (!counts.size) return null;
  const order = [...lanesDoc.lanes.map((l) => l.id), lanesDoc.default];
  let best = null;
  for (const id of order) {
    if (!counts.has(id)) continue;
    if (best === null || counts.get(id) > counts.get(best)) best = id;
  }
  return best;
}

// ---------------------------------------------------------------- Edge 함수 계산
const SRC = /\.(ts|mts|js|mjs|tsx|jsx)$/;

function walkSources(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkSources(full, out);
    else if (SRC.test(name)) out.push(full);
  }
  return out;
}

// 저장소 함수 폴더의 파일 → 그 파일이 부르는 상대 경로 파일 목록(저장소 기준 경로).
export function readFunctionImports(root = DEFAULT_ROOT) {
  const base = join(root, 'supabase/functions');
  const graph = {};
  for (const full of walkSources(base)) {
    const rel = relative(root, full).split('\\').join('/');
    graph[rel] = importsOf(readFileSync(full, 'utf8'), rel);
  }
  return graph;
}

export function importsOf(text, fromPath) {
  const out = new Set();
  const re = /(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;
  for (const m of text.matchAll(re)) {
    const spec = m[1] || m[2] || m[3];
    if (!spec || !spec.startsWith('.')) continue;
    out.add(posix.normalize(posix.join(posix.dirname(fromPath), spec)));
  }
  return [...out];
}

function functionOf(path) {
  const m = /^supabase\/functions\/([^/]+)\//.exec(path);
  return m ? m[1] : null;
}

// 바뀐 파일 → 배포할 함수 이름. _shared 파일은 그것을(간접 포함) 부르는 함수 전부.
export function edgeFunctionsFor(files, importGraph) {
  const reverse = new Map();
  for (const [from, tos] of Object.entries(importGraph)) {
    for (const to of tos) {
      if (!reverse.has(to)) reverse.set(to, new Set());
      reverse.get(to).add(from);
    }
  }
  const fns = new Set();
  const sharedChanged = [];
  for (const f of files) {
    const fn = functionOf(f);
    if (!fn) continue;
    if (fn === '_shared') sharedChanged.push(f);
    else if (!fn.startsWith('_')) fns.add(fn);
  }
  const seen = new Set(sharedChanged);
  const queue = [...sharedChanged];
  while (queue.length) {
    const cur = queue.shift();
    for (const from of reverse.get(cur) || []) {
      if (seen.has(from)) continue;
      seen.add(from);
      const fn = functionOf(from);
      if (fn && !fn.startsWith('_')) fns.add(fn);
      else queue.push(from);
    }
  }
  return {functions: [...fns].sort(), sharedChanged};
}

// ---------------------------------------------------------------- 확정 동작 ID(13절)
export function pendingInteractionIds(markdown) {
  const start = markdown.search(/^## 13\./m);
  if (start < 0) return [];
  const rest = markdown.slice(start);
  const next = rest.slice(4).search(/^## /m);
  const section = next < 0 ? rest : rest.slice(0, next + 4);
  const ids = [];
  for (const line of section.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 2 || !/^[A-Z]\d+[a-z]?$/.test(cells[0])) continue;
    if (cells[cells.length - 1].includes('만들 차례')) ids.push(cells[0]);
  }
  return ids;
}

function idRe(id) {
  return new RegExp(`(?<![A-Za-z0-9])${id}(?![A-Za-z0-9])`);
}

export function idsMentioned(body, ids) {
  return ids.filter((id) => idRe(id).test(body || ''));
}

// 시험 파일 patch의 더한 줄에 그 ID가 든 test(…)/describe(…) 이름이 있는지.
export function idHasTest(id, testPatches) {
  const re = idRe(id);
  for (const patch of testPatches) {
    for (const line of (patch || '').split('\n')) {
      if (!line.startsWith('+')) continue;
      if (/\b(test|it|describe)(\.\w+)?\s*\(/.test(line) && re.test(line)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------- 판정
export function isScreenFile(path) {
  return path.startsWith('app/') && !path.startsWith('app/release-notes/') && /\.(js|mjs|css|html)$/.test(path);
}

const OK_CONCLUSIONS = new Set(['success', 'skipped', 'neutral']);

// pr: {number,title,draft,body,mergeable,mergeable_state}
// files: [{filename,status,patch}]
// checks: [{name,status,conclusion}]  required: ['browser-e2e', …]
// ctx: {lanesDoc, importGraph, pendingIds, openPrs:[{number,draft,lane,files}]}
export function judgePr({pr, files, checks, required}, ctx) {
  const names = files.map((f) => f.filename);
  const reasons = [];
  const warnings = [];
  const scope = [];

  // 초록
  const reqState = required.map((name) => {
    const runs = checks.filter((c) => c.name === name);
    if (!runs.length) return {name, state: '없음'};
    if (runs.some((c) => c.status !== 'completed')) return {name, state: '도는 중'};
    if (runs.every((c) => OK_CONCLUSIONS.has(c.conclusion))) return {name, state: '성공'};
    return {name, state: '실패'};
  });
  const failed = checks.filter((c) => c.status === 'completed' && !OK_CONCLUSIONS.has(c.conclusion)).map((c) => c.name);
  const running = checks.filter((c) => c.status !== 'completed').map((c) => c.name);
  if (pr.draft) reasons.push('초안');
  for (const r of reqState) if (r.state !== '성공') reasons.push(`필수 검사 ${r.name} ${r.state}`);
  if (failed.length) reasons.push(`실패 검사: ${[...new Set(failed)].join(', ')}`);
  if (running.length) reasons.push(`도는 검사 ${new Set(running).size}개`);
  if (pr.mergeable === false || pr.mergeable_state === 'dirty') reasons.push('main과 충돌');
  else if (pr.mergeable_state !== 'clean' && !reasons.length) reasons.push(`넣기 상태 ${pr.mergeable_state || '모름'}`);
  const green = reasons.length === 0;

  // 범위
  const migrations = names.filter((f) => f.startsWith('supabase/migrations/'));
  if (migrations.length) scope.push(`DB 적용 필요(${migrations.length}개 파일)`);
  const edge = edgeFunctionsFor(names, ctx.importGraph);
  if (edge.functions.length) {
    scope.push(`Edge 배포: ${edge.functions.join(', ')}${edge.sharedChanged.length ? ` (_shared ${edge.sharedChanged.length}개 계산)` : ''}`);
  } else if (edge.sharedChanged.length) {
    scope.push('_shared만 바뀜(부르는 함수 없음)');
  }
  const workflows = names.filter((f) => f.startsWith('.github/workflows/'));
  if (workflows.length) scope.push(`workflow 변경(${workflows.map((f) => f.slice('.github/workflows/'.length)).join(', ')})`);

  // 영역
  const lane = prLane(names, ctx.lanesDoc);
  if (lane) {
    const others = (ctx.openPrs || []).filter((o) => o.number !== pr.number && !o.draft && o.lane === lane);
    if (lane !== ctx.lanesDoc.default) {
      if (others.length) warnings.push(`같은 영역(${laneName(lane, ctx.lanesDoc)}) 열린 PR: ${others.map((o) => `#${o.number}`).join(', ')}`);
    }
    const mine = new Set(names.filter(isLaneFile));
    const sameFile = (ctx.openPrs || [])
      .filter((o) => o.number !== pr.number && !o.draft && (o.files || []).some((f) => mine.has(f)))
      .map((o) => `#${o.number}`);
    if (sameFile.length) warnings.push(`같은 파일을 고치는 열린 PR: ${sameFile.join(', ')}`);
  }

  // 확정 동작 시험
  const screen = names.filter(isScreenFile);
  const e2e = files.filter((f) => f.filename.startsWith('tests/app-e2e/') && f.status !== 'removed');
  if (screen.length && !e2e.length) warnings.push('화면 파일을 바꿨는데 tests/app-e2e 시험 변경·추가 없음');
  const mentioned = idsMentioned(pr.body, ctx.pendingIds || []);
  const testPatches = files.filter((f) => f.filename.startsWith('tests/')).map((f) => f.patch);
  const missingIds = mentioned.filter((id) => !idHasTest(id, testPatches));
  if (missingIds.length) warnings.push(`확정 동작 ID 시험 없음: ${missingIds.join(', ')}`);

  // release-notes
  if (screen.length && !names.some((f) => /^app\/release-notes\/.+\.json$/.test(f))) {
    warnings.push('화면이 바뀌는데 app/release-notes 파일 없음');
  }

  return {
    number: pr.number,
    title: pr.title,
    green,
    verdict: green ? (warnings.length ? '초록·경고' : '초록') : '멈춤',
    reasons,
    scope,
    lane: lane ? laneName(lane, ctx.lanesDoc) : '영역 없음(문서·시험·운영)',
    warnings,
    ids: mentioned,
  };
}

export function formatTable(results) {
  const lines = ['| PR | 판정 | 영역 | 범위 | 이유·경고 |', '| --- | --- | --- | --- | --- |'];
  const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  for (const r of results) {
    const icon = r.green ? (r.warnings.length ? '🟡' : '🟢') : '🔴';
    const why = [...r.reasons, ...r.warnings.map((w) => `⚠ ${w}`)].join(' · ') || '—';
    lines.push(`| #${r.number} | ${icon} ${r.verdict} | ${cell(r.lane)} | ${cell(r.scope.join(' · ') || '—')} | ${cell(why)} |`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- GitHub 읽기
function hasGh() {
  try { execFileSync('gh', ['--version'], {stdio: 'ignore'}); return true; } catch { return false; }
}

export function makeClient() {
  const useGh = hasGh();
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
  if (!useGh && !token) throw new Error('gh도 없고 GITHUB_TOKEN·GH_TOKEN도 없어 GitHub를 읽을 수 없습니다.');
  return async function get(path) {
    if (useGh) {
      const out = execFileSync('gh', ['api', '-H', 'Accept: application/vnd.github+json', path], {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']});
      return JSON.parse(out);
    }
    const res = await fetch(`https://api.github.com/${path}`, {headers: {Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`}});
    if (!res.ok) throw new Error(`GitHub ${res.status} ${path}`);
    return res.json();
  };
}

async function pages(get, path) {
  const all = [];
  for (let page = 1; page < 50; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const data = await get(`${path}${sep}per_page=100&page=${page}`);
    const items = Array.isArray(data) ? data : data.check_runs || [];
    all.push(...items);
    if (items.length < 100) break;
  }
  return all;
}

async function requiredChecks(get, repo) {
  try {
    const rules = await get(`repos/${repo}/rules/branches/main`);
    return rules.filter((r) => r.type === 'required_status_checks')
      .flatMap((r) => r.parameters.required_status_checks.map((c) => c.context));
  } catch { return []; }
}

async function main(argv) {
  const args = argv.slice(2);
  const json = args.includes('--json');
  const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
  const repo = opt('--repo', DEFAULT_REPO);
  const root = resolve(opt('--root', DEFAULT_ROOT));
  const skip = new Set([opt('--repo'), opt('--root')].filter(Boolean));
  const numbers = args.filter((a) => /^\d+$/.test(a) && !skip.has(a)).map(Number);
  if (!numbers.length) {
    console.error('쓰는 법: node scripts/cc/merge-check.mjs [--json] [--repo owner/name] [--root 폴더] <PR 번호> …');
    process.exit(2);
  }
  const get = makeClient();
  const lanesDoc = loadLanes(root);
  const importGraph = readFunctionImports(root);
  const siPath = join(root, 'docs/design/standard-interactions.md');
  const pendingIds = existsSync(siPath) ? pendingInteractionIds(readFileSync(siPath, 'utf8')) : [];
  const required = await requiredChecks(get, repo);

  const open = await pages(get, `repos/${repo}/pulls?state=open`);
  const filesCache = new Map();
  const filesOf = async (n) => {
    if (!filesCache.has(n)) filesCache.set(n, await pages(get, `repos/${repo}/pulls/${n}/files`));
    return filesCache.get(n);
  };
  const openPrs = [];
  for (const o of open) {
    if (o.draft) continue;
    const names = (await filesOf(o.number)).map((f) => f.filename);
    openPrs.push({number: o.number, draft: false, lane: prLane(names, lanesDoc), files: names.filter(isLaneFile)});
  }
  const ctx = {lanesDoc, importGraph, pendingIds, openPrs};

  const results = [];
  for (const n of numbers) {
    const pr = await get(`repos/${repo}/pulls/${n}`);
    const files = await filesOf(n);
    const checks = await pages(get, `repos/${repo}/commits/${pr.head.sha}/check-runs`);
    results.push(judgePr({pr, files, checks, required}, ctx));
  }
  if (json) console.log(JSON.stringify({required, results}, null, 2));
  else {
    console.log(`필수 검사: ${required.join(', ') || '(규칙에 없음)'}`);
    console.log(formatTable(results));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv).catch((err) => { console.error(`넣기 점검 실패: ${err.message}`); process.exit(1); });
}
