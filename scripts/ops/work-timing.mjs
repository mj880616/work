#!/usr/bin/env node
// 일마다 걸린 시간 재기 + 멈춘 작업 세션 찾기 (OPS-작업속도, 2026-11-10 명진 요청 "작업 하나에 1~2시간 — 10분 안쪽으로").
//
// 쓰는 법(CC 방, gh가 로그인된 곳):
//   node scripts/ops/work-timing.mjs                  # 오늘(KST) merge된 PR의 단계별 시간 가운데 값 + 멈춘 세션
//   node scripts/ops/work-timing.mjs --since 2026-11-10T00:00+09:00 [--now ...] [--stall-min 30] [--json]
// 단계: PR 열림 → 화면 시험(browser-e2e) 끝 → merge → Pages 배포 끝(merge 커밋의 'Deploy GitHub Pages' 실행).
//   '접수'·'띄움' 시각은 공개 저장소에 없으므로 CC가 2시간 보고에서 요청함 접수 시각과 함께 적는다(docs/command-center-ops.md 4-1절).
// 멈춘 세션: 최근 6시간 안에 commit이 있고 PR이 없는 브랜치 중, 마지막 commit 뒤 --stall-min(기본 30)분이 지난 것.
//   지시서의 '30분 안에 첫 PR' 규칙을 넘긴 세션이다. CC가 끄고 이어받거나 다시 띄운다.
// 읽기만 한다(GitHub API GET). 결과에는 PR 번호·브랜치 이름·시각만 나온다(업무 내용 없음).
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const MIN = 60000;

export function median(values) {
  const list = values.filter(v => Number.isFinite(v)).sort((a, b) => a - b);
  if (!list.length) return null;
  const mid = Math.floor(list.length / 2);
  return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
}

const minutes = (from, to) => (from && to ? (Date.parse(to) - Date.parse(from)) / MIN : null);

// pr: {number, created_at, merged_at, e2e_done_at, deploy_done_at}
export function stageMinutes(pr) {
  const e2eToMerge = minutes(pr.e2e_done_at, pr.merged_at);
  return {
    number: pr.number,
    open_to_e2e: minutes(pr.created_at, pr.e2e_done_at),
    e2e_to_merge: e2eToMerge != null && e2eToMerge >= 0 ? e2eToMerge : null,
    open_to_merge: minutes(pr.created_at, pr.merged_at),
    merge_to_deploy: minutes(pr.merged_at, pr.deploy_done_at),
    open_to_deploy: minutes(pr.created_at, pr.deploy_done_at),
  };
}

export function summarize(prs) {
  const rows = prs.map(stageMinutes);
  const keys = ['open_to_e2e', 'e2e_to_merge', 'open_to_merge', 'merge_to_deploy', 'open_to_deploy'];
  const out = {count: rows.length};
  for (const key of keys) {
    const values = rows.map(r => r[key]).filter(v => v != null);
    out[key] = {median: median(values), max: values.length ? Math.max(...values) : null, n: values.length};
  }
  return {summary: out, rows};
}

// branches: [{name, last_commit_at}], prHeads: Set of branch names that have a PR (open or closed)
export function stalledBranches(branches, prHeads, {now, stallMin = 30, windowHours = 6} = {}) {
  const at = Date.parse(now);
  return branches
    .filter(b => b.name !== 'main' && !prHeads.has(b.name))
    .map(b => ({...b, idle_min: (at - Date.parse(b.last_commit_at)) / MIN}))
    .filter(b => b.idle_min >= stallMin && b.idle_min <= windowHours * 60)
    .sort((a, b) => b.idle_min - a.idle_min);
}

const fmt = v => (v == null ? '-' : `${Math.round(v)}분`);

export function renderReport({summary}, stalled) {
  const label = {
    open_to_e2e: 'PR 열림 → 화면 시험 끝',
    e2e_to_merge: '화면 시험 끝 → merge(기다림)',
    open_to_merge: 'PR 열림 → merge',
    merge_to_deploy: 'merge → 배포 끝',
    open_to_deploy: 'PR 열림 → 배포 끝',
  };
  const lines = [`merge된 PR ${summary.count}개`, '', '| 단계 | 가운데 | 최대 | 표본 |', '|---|---|---|---|'];
  for (const [key, name] of Object.entries(label)) {
    const s = summary[key];
    lines.push(`| ${name} | ${fmt(s.median)} | ${fmt(s.max)} | ${s.n} |`);
  }
  lines.push('', stalled.length ? `멈춘 세션 의심 ${stalled.length}개(PR 없이 마지막 commit 뒤 30분 넘음):` : '멈춘 세션 의심 없음');
  for (const b of stalled) lines.push(`- ${b.name}: 마지막 commit 뒤 ${fmt(b.idle_min)}`);
  return lines.join('\n');
}

function gh(path) {
  return JSON.parse(execFileSync('gh', ['api', path], {encoding: 'utf8', maxBuffer: 64 << 20}));
}

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') out.json = true;
    else if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[++i];
  }
  return out;
}

function main() {
  const opt = args(process.argv.slice(2));
  const repo = opt.repo || 'mj880616/work';
  const now = opt.now ? new Date(opt.now).toISOString() : new Date().toISOString();
  const kstDay = new Date(Date.parse(now) + 9 * 3600000).toISOString().slice(0, 10);
  const since = opt.since ? Date.parse(opt.since) : Date.parse(`${kstDay}T00:00:00+09:00`);

  const closed = gh(`repos/${repo}/pulls?state=closed&per_page=100&sort=updated&direction=desc`);
  const merged = closed.filter(p => p.merged_at && Date.parse(p.merged_at) >= since);
  const deploys = gh(`repos/${repo}/actions/workflows/pages-deploy.yml/runs?branch=main&per_page=100`).workflow_runs || [];
  const prs = merged.map(p => {
    const checks = gh(`repos/${repo}/commits/${p.head.sha}/check-runs?check_name=browser-e2e`).check_runs || [];
    const done = checks.filter(c => c.conclusion && c.conclusion !== 'skipped').map(c => c.completed_at).sort().pop() || null;
    const deploy = deploys.filter(r => r.head_sha === p.merge_commit_sha && r.conclusion === 'success').map(r => r.updated_at).sort()[0] || null;
    return {number: p.number, created_at: p.created_at, merged_at: p.merged_at, e2e_done_at: done, deploy_done_at: deploy};
  });

  const open = gh(`repos/${repo}/pulls?state=open&per_page=100`);
  const heads = new Set([...open, ...closed].map(p => p.head.ref));
  // 브랜치 마지막 commit 시각은 이 저장소 사본의 원격 브랜치에서 읽는다(먼저 git fetch).
  execFileSync('git', ['fetch', '--quiet', 'origin'], {stdio: 'ignore'});
  const branches = execFileSync('git', ['for-each-ref', '--sort=-committerdate', '--format=%(refname:lstrip=3)\t%(committerdate:iso-strict)', 'refs/remotes/origin'], {encoding: 'utf8'})
    .split('\n').filter(Boolean).slice(0, 200)
    .map(line => { const [name, last_commit_at] = line.split('\t'); return {name, last_commit_at}; })
    .filter(b => b.name && b.name !== 'HEAD');
  const stalled = stalledBranches(branches, heads, {now, stallMin: Number(opt['stall-min'] || 30)});
  const result = summarize(prs);
  if (opt.json) console.log(JSON.stringify({...result, stalled}, null, 2));
  else console.log(renderReport(result, stalled));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
