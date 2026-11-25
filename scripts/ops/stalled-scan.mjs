#!/usr/bin/env node
// 멈춘 일 매일 자동 대조 (QA-멈춘일자동점검, S70-50, 근거 docs/qa/stalled-audit-20261125.md 3절).
// 기록 문서만 보고는 무엇이 정말 멈췄는지 알 수 없어서, 승인형 workflow 실행 로그와 main 파일을 직접 대조한다.
//   (a) main에 있는데 apply 성공 기록이 없는 migration  — db-migration-apply.yml 로그의 DB_MODE·DB_VERSION
//   (b) 마지막 성공 배포 ref 뒤에 소스(_shared 포함)가 바뀐 Edge 함수 — edge-function-deploy.yml 로그의 FUNCTION_NAME·배포 SHA
//   (c) 마지막 커밋 뒤 7일이 넘은 열린 PR
// 읽기만 한다(GitHub API GET, git). 결과에는 파일 이름·함수 이름·PR 번호·날짜 수만 나온다(업무 내용 없음).
//
// 쓰는 법(gh가 로그인된 곳, main을 모두 받은 저장소 안):
//   node scripts/ops/stalled-scan.mjs [--repo owner/name] [--cache file.json] [--max-logs 350] [--min-age-days 1]
//        [--pr-days 7] [--out summary.md] [--json result.json]
// 로그 읽기는 실행 하나에 API 한 번이 들어 --cache에 결과를 모아 두고 새 실행만 읽는다(--max-logs 만큼씩).
// 아직 다 못 읽은 실행이 남아 있으면 (a)(b)는 '판정 보류'로 두고 알림 대상에서 뺀다(틀린 경보 막기).
import {execFile, execFileSync} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, posix} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const DAY = 86400000;
export const DB_WORKFLOW = 'db-migration-apply.yml';
export const EDGE_WORKFLOW = 'edge-function-deploy.yml';
// 승인형 DB workflow가 생긴 뒤의 파일만 본다. 그 전 파일은 SQL Editor로 적용했고 실행 로그가 없다(docs/migration-history.md).
export const MIGRATION_SINCE = '20261020000000';

const stripTime = line => line.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z\s?/, '');

// 로그 글에서 첫 DB_MODE·DB_VERSION 값. version은 14자리 번호로 줄인다.
export function parseDbLog(text) {
  let mode = null, version = null;
  for (const raw of String(text).split('\n')) {
    const line = stripTime(raw);
    if (mode === null) { const m = line.match(/^\s*DB_MODE:\s*([a-z-]+)\s*$/); if (m) mode = m[1]; }
    if (version === null) { const m = line.match(/^\s*DB_VERSION:\s*(\d{14})\S*\s*$/); if (m) version = m[1]; }
    if (mode && version) break;
  }
  return {mode, version};
}

// 로그 글에서 첫 FUNCTION_NAME, 그리고 checkout이 실제로 꺼낸 커밋(git log -1 --format=%H 다음 줄).
export function parseEdgeLog(text) {
  let fn = null, sha = null, afterLog = false;
  for (const raw of String(text).split('\n')) {
    const line = stripTime(raw);
    if (fn === null) { const m = line.match(/^\s*FUNCTION_NAME:\s*([A-Za-z0-9][A-Za-z0-9_-]*)\s*$/); if (m) fn = m[1]; }
    if (sha === null) {
      if (afterLog) { const m = line.match(/^([0-9a-f]{40})\s*$/); if (m) sha = m[1]; afterLog = false; }
      else if (/git log -1 --format=%H\s*$/.test(line)) afterLog = true;
    }
    if (fn && sha) break;
  }
  return {fn, sha};
}

// runs: [{id, conclusion, created_at, mode, version}] → apply 성공 version 집합
export function appliedVersions(runs) {
  const set = new Set();
  for (const r of runs) if (r.conclusion === 'success' && r.mode === 'apply' && r.version) set.add(r.version);
  return set;
}

// files: [{version, name, added_at}] → apply 기록 없는 것(since 이후, ignore 제외)
export function pendingMigrations(files, applied, {since = MIGRATION_SINCE, ignore = {}, now, minAgeDays = 1} = {}) {
  const out = [];
  for (const f of files) {
    if (f.version < since || applied.has(f.version) || ignore[f.version]) continue;
    const age = f.added_at && now ? Math.floor((Date.parse(now) - Date.parse(f.added_at)) / DAY) : null;
    out.push({name: f.name, version: f.version, days: age, fresh: age !== null && age < minAgeDays});
  }
  return out.sort((a, b) => a.version.localeCompare(b.version));
}

// runs: [{id, conclusion, created_at, fn, sha}] → 함수마다 마지막 성공 배포(시각 기준. 되돌리기 배포도 그대로 마지막으로 친다)
export function lastDeploys(runs) {
  const map = new Map();
  for (const r of runs) {
    if (r.conclusion !== 'success' || !r.fn || !r.sha) continue;
    const prev = map.get(r.fn);
    if (!prev || Date.parse(r.created_at) > Date.parse(prev.at)) map.set(r.fn, {sha: r.sha, at: r.created_at});
  }
  return map;
}

// 함수 폴더 안 파일에서 상대 경로 import를 따라 _shared 등 함께 배포되는 파일까지 모은다.
// files: Map(path → source), 경로는 저장소 기준 posix('supabase/functions/x/index.ts')
export function functionSources(fn, files, root = 'supabase/functions') {
  const start = [...files.keys()].filter(p => p.startsWith(`${root}/${fn}/`));
  const seen = new Set();
  const queue = [...start];
  while (queue.length) {
    const p = queue.shift();
    if (seen.has(p) || !files.has(p)) continue;
    seen.add(p);
    const src = files.get(p);
    for (const m of src.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const target = posix.normalize(posix.join(posix.dirname(p), m[1]));
      if (target.startsWith(`${root}/`) && !seen.has(target)) queue.push(target);
    }
  }
  return [...seen].sort();
}

// fns: [name], deploys: Map, changedSince(sha, paths) → {changed: [paths], first_at} | null(ref 모름)
export function changedFunctions(fns, deploys, sourcesOf, changedSince, {ignore = {}, now, minAgeDays = 1} = {}) {
  const changed = [], never = [], unknown = [];
  for (const fn of [...fns].sort()) {
    if (ignore[fn]) continue;
    const d = deploys.get(fn);
    if (!d) { never.push({fn}); continue; }
    const diff = changedSince(d.sha, sourcesOf(fn));
    if (diff === null) { unknown.push({fn, sha: d.sha}); continue; }
    if (!diff.changed.length) continue;
    const days = diff.first_at && now ? Math.floor((Date.parse(now) - Date.parse(diff.first_at)) / DAY) : null;
    changed.push({fn, sha: d.sha, files: diff.changed.length, shared: diff.changed.some(p => p.includes('/_shared/')), days, fresh: days !== null && days < minAgeDays});
  }
  return {changed, never, unknown};
}

// prs: [{number, draft, last_commit_at}] → 마지막 커밋 뒤 days일 넘은 것
export function stalePrs(prs, now, days = 7) {
  return prs
    .map(p => ({number: p.number, draft: !!p.draft, days: Math.floor((Date.parse(now) - Date.parse(p.last_commit_at)) / DAY)}))
    .filter(p => p.days >= days)
    .sort((a, b) => b.days - a.days || a.number - b.number);
}

// 알림(이슈)을 낼 항목: 하루 안 된 것과 판정 보류는 뺀다.
export function alertItems(result) {
  const items = [];
  if (!result.backlog) {
    for (const m of result.migrations) if (!m.fresh) items.push(`migration ${m.name}`);
    for (const f of result.edge.changed) if (!f.fresh) items.push(`edge ${f.fn}`);
  }
  for (const p of result.prs) items.push(`PR #${p.number}`);
  return items;
}

export function shouldNotify(alerts, last, now, days = 7) {
  if (!alerts.length) return false;
  if (!last || !Array.isArray(last.alerts)) return true;
  if (JSON.stringify([...alerts].sort()) !== JSON.stringify([...last.alerts].sort())) return true;
  return Date.parse(now) - Date.parse(last.at) >= days * DAY;
}

export function renderReport(result) {
  const lines = ['## 멈춘 일 자동 점검', ''];
  lines.push(`기준 main \`${(result.main || '').slice(0, 8)}\` · 점검 시각 ${result.now} · 읽은 실행: DB ${result.counts.db}개, Edge ${result.counts.edge}개`, '');
  if (result.backlog) lines.push(`> 아직 읽지 못한 실행 로그 ${result.backlog}개 — (a)(b)는 판정 보류(알림 안 함). 다음 실행에서 이어 읽는다.`, '');
  const age = d => (d === null || d === undefined ? '?' : `${d}일`);
  lines.push(`### (a) apply 성공 기록이 없는 migration: ${result.migrations.length}개`);
  if (result.migrations.length) {
    lines.push('', '| 파일 | main에 들어온 뒤 | 비고 |', '| --- | --- | --- |');
    for (const m of result.migrations) lines.push(`| \`${m.name}\` | ${age(m.days)} | ${m.fresh ? '하루 안 됨(알림 안 함)' : ''} |`);
  }
  lines.push('', `### (b) 마지막 성공 배포 뒤 소스가 바뀐 Edge 함수: ${result.edge.changed.length}개`);
  if (result.edge.changed.length) {
    lines.push('', '| 함수 | 마지막 배포 ref | 바뀐 파일 수 | 공용 부품 | 처음 바뀐 뒤 | 비고 |', '| --- | --- | --- | --- | --- | --- |');
    for (const f of result.edge.changed) lines.push(`| \`${f.fn}\` | \`${f.sha.slice(0, 8)}\` | ${f.files} | ${f.shared ? '포함' : ''} | ${age(f.days)} | ${f.fresh ? '하루 안 됨(알림 안 함)' : ''} |`);
  }
  if (result.edge.never.length) lines.push('', `workflow 배포 기록이 없는 함수: ${result.edge.never.map(f => `\`${f.fn}\``).join(', ')}`);
  if (result.edge.unknown.length) lines.push('', `배포 ref를 main 기록에서 찾지 못한 함수: ${result.edge.unknown.map(f => `\`${f.fn}\`(\`${f.sha.slice(0, 8)}\`)`).join(', ')}`);
  lines.push('', `### (c) 마지막 커밋 뒤 ${result.prDays}일 넘은 열린 PR: ${result.prs.length}개`);
  if (result.prs.length) lines.push('', result.prs.map(p => `#${p.number}(${p.days}일${p.draft ? ', 초안' : ''})`).join(', '));
  lines.push('');
  return lines.join('\n');
}

// ---- 아래는 실제 GitHub·git 읽기 ----

const pexec = promisify(execFile);
const git = (...args) => execFileSync('git', args, {encoding: 'utf8', maxBuffer: 256 << 20}).trim();
const ghJson = path => JSON.parse(execFileSync('gh', ['api', path], {encoding: 'utf8', maxBuffer: 64 << 20}));

function listRuns(repo, workflow) {
  const runs = [];
  for (let page = 1; page <= 50; page++) {
    const data = ghJson(`repos/${repo}/actions/workflows/${workflow}/runs?per_page=100&page=${page}`);
    for (const r of data.workflow_runs) runs.push({id: r.id, status: r.status, conclusion: r.conclusion, created_at: r.created_at});
    if (data.workflow_runs.length < 100) break;
  }
  return runs;
}

async function readRunLog(repo, id, dir) {
  const zip = join(dir, `${id}.zip`);
  const {stdout} = await pexec('gh', ['api', `repos/${repo}/actions/runs/${id}/logs`], {encoding: 'buffer', maxBuffer: 512 << 20});
  writeFileSync(zip, stdout);
  try {
    const {stdout: text} = await pexec('unzip', ['-p', zip], {encoding: 'utf8', maxBuffer: 512 << 20});
    return text;
  } finally { rmSync(zip, {force: true}); }
}

// 성공한 실행만 로그를 읽는다(실패·취소는 적용·배포가 아니므로 셈에서 빠진다). 읽은 결과는 cache에 남긴다.
async function fillRuns(repo, workflow, cacheBucket, parse, budget, dir, parallel = 6) {
  const runs = listRuns(repo, workflow);
  const todo = runs.filter(r => r.status === 'completed' && r.conclusion === 'success' && !cacheBucket[r.id]);
  const now = todo.slice(0, budget.left);
  budget.left -= now.length;
  for (let i = 0; i < now.length; i += parallel) {
    await Promise.all(now.slice(i, i + parallel).map(async r => {
      try { cacheBucket[r.id] = {created_at: r.created_at, ...parse(await readRunLog(repo, r.id, dir))}; }
      catch { /* 로그가 지워졌거나 일시 오류: 다음 실행에서 다시 */ }
    }));
  }
  const backlog = todo.filter(r => !cacheBucket[r.id]).length;
  const merged = runs.filter(r => r.status === 'completed').map(r => ({...r, ...(cacheBucket[r.id] || {})}));
  return {runs: merged, backlog};
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|mts|js|mjs|json)$/.test(name)) out.push(p);
  }
  return out;
}

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
}

async function main() {
  const repo = arg('--repo', process.env.GITHUB_REPOSITORY || 'mj880616/work');
  const cachePath = arg('--cache', null);
  const maxLogs = Number(arg('--max-logs', '350'));
  const minAgeDays = Number(arg('--min-age-days', '1'));
  const prDays = Number(arg('--pr-days', '7'));
  const now = arg('--now', new Date().toISOString());
  const here = dirname(fileURLToPath(import.meta.url));
  const ignorePath = join(here, 'stalled-scan-ignore.json');
  const ignore = existsSync(ignorePath) ? JSON.parse(readFileSync(ignorePath, 'utf8')) : {};
  const cache = cachePath && existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {};
  cache.db ||= {}; cache.edge ||= {};

  const dir = mkdtempSync(join(tmpdir(), 'stalled-scan-'));
  const budget = {left: maxLogs};
  const db = await fillRuns(repo, DB_WORKFLOW, cache.db, parseDbLog, budget, dir);
  const edge = await fillRuns(repo, EDGE_WORKFLOW, cache.edge, parseEdgeLog, budget, dir);
  rmSync(dir, {recursive: true, force: true});

  const mainSha = git('rev-parse', 'HEAD');
  const files = git('ls-files', 'supabase/migrations').split('\n').filter(p => /\/\d{14}_[^/]+\.sql$/.test(p)).map(p => {
    const name = p.split('/').pop();
    return {name, version: name.slice(0, 14), added_at: git('log', '--diff-filter=A', '--format=%cI', '-1', '--', p) || null};
  });
  const migrations = pendingMigrations(files, appliedVersions(db.runs), {ignore: ignore.migrations || {}, now, minAgeDays});

  const fnRoot = 'supabase/functions';
  const sourceFiles = new Map(walk(fnRoot).map(p => [p.split('\\').join('/'), readFileSync(p, 'utf8')]));
  const fns = readdirSync(fnRoot).filter(n => !n.startsWith('_') && !n.startsWith('.') && existsSync(join(fnRoot, n, 'index.ts')));
  const changedSince = (sha, paths) => {
    try { git('cat-file', '-e', `${sha}^{commit}`); } catch { return null; }
    const changed = git('diff', '--name-only', sha, mainSha, '--', ...paths).split('\n').filter(Boolean);
    if (!changed.length) return {changed};
    const dates = git('log', '--format=%cI', `${sha}..${mainSha}`, '--', ...changed).split('\n').filter(Boolean);
    return {changed, first_at: dates.at(-1) || null};
  };
  const edgeResult = changedFunctions(fns, lastDeploys(edge.runs), fn => functionSources(fn, sourceFiles, fnRoot), changedSince, {ignore: ignore.functions || {}, now, minAgeDays});

  const prs = [];
  for (let page = 1; page <= 10; page++) {
    const list = ghJson(`repos/${repo}/pulls?state=open&per_page=100&page=${page}`);
    for (const p of list) {
      const c = ghJson(`repos/${repo}/commits/${p.head.sha}`);
      prs.push({number: p.number, draft: p.draft, last_commit_at: c.commit.committer.date});
    }
    if (list.length < 100) break;
  }

  const result = {
    now, main: mainSha, prDays,
    counts: {db: db.runs.length, edge: edge.runs.length},
    backlog: db.backlog + edge.backlog,
    migrations, edge: edgeResult, prs: stalePrs(prs, now, prDays),
  };
  result.alerts = alertItems(result);
  // 같은 항목을 날마다 다시 알리지 않는다: 항목이 바뀌었거나 마지막 알림 뒤 7일이 지났을 때만 notify=true.
  result.notify = shouldNotify(result.alerts, cache.last, now);
  if (result.notify) cache.last = {alerts: result.alerts, at: now};
  const report = renderReport(result);
  if (cachePath) writeFileSync(cachePath, JSON.stringify(cache));
  const out = arg('--out', null);
  if (out) writeFileSync(out, report); else process.stdout.write(report);
  const json = arg('--json', null);
  if (json) writeFileSync(json, JSON.stringify(result, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(err => { console.error(err.message); process.exit(1); });
}
