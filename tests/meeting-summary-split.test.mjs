// REC-정리멈춤반복-긴구간(S56-47, 설계 docs/design/meeting-transcript-server.md 9절)
// 긴 녹음의 요약 단계가 Edge 한 번 실행 시간 안에 끝나도록: 한 단계에 AI 요청 한 번, 잘림·시간 초과·끊김이면 반씩 나눠 잇고,
// 실패 이력은 [다시]가 덮어쓰지 않게 DB 트리거가 fail_log에 남긴다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import * as sj from '../supabase/functions/meeting-transcribe/server-job.mjs';
import { MESSAGES, STATUS } from '../supabase/functions/meeting-transcribe/model.mjs';
import { failText, canRetry } from '../app/meeting-server-job.mjs';
import { prepareMigration } from '../scripts/ops/db-migration-plan.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const d = (x) => ({ decisions: x, information: '', actions: [], attendees: [], meetingDate: '' });
const short = Array.from({ length: 400 }, (_, i) => `화자${i % 2 + 1}: ${'가'.repeat(30)} ${i}`).join('\n'); // 한 조각(3만 자 이하)
const long = Array.from({ length: 4000 }, (_, i) => `화자${i % 3 + 1}: ${'가'.repeat(15)} ${i}`).join('\n'); // 여러 조각

// 요약 단계 모의: plan을 따라 한 단계에 AI 한 번. ai(kind, text) → 'ok' | 'cut' | 'timeout'.
function runSummary(transcript, ai, start = []) {
  let parts = start, calls = 0, steps = 0;
  for (let guard = 0; guard < 60; guard++) {
    steps++;
    const plan = sj.summaryPlan(transcript, parts);
    if (plan.kind === 'half') {
      const h = sj.halves(plan.piece); calls++;
      if (ai('half', h[plan.half]) !== 'ok') return { failed: true, calls, steps, parts };
      const got = [...parts[plan.at].halves, d(`h${plan.at}.${plan.half}`)];
      parts = got.length < 2 ? [...parts.slice(0, plan.at), { halves: got }] : plan.single ? got : [...parts.slice(0, plan.at), sj.combineDrafts(got)];
      continue;
    }
    const text = plan.kind === 'merge' ? 'merge' : plan.pieces[plan.next] || '';
    calls++;
    const r = ai(plan.kind, text);
    if (r !== 'ok') {
      const code = r === 'cut' ? 'draft_cut' : 'draft_timeout';
      const split = plan.kind !== 'merge' && sj.SPLIT_CODES.includes(code) ? sj.splitSummary(transcript, parts) : null;
      if (!split) return { failed: true, calls, steps, parts };
      parts = split; continue;
    }
    if (plan.kind === 'merge' || plan.kind === 'one') return { done: true, calls, steps, parts };
    parts = [...parts, d(`p${plan.next}`)];
  }
  return { stuck: true };
}

test('짧은 회의: 한 번에 요약 → 끝. 잘리거나 오래 걸리면 반씩 두 단계 + 합치기, 한 단계에 AI 한 번', () => {
  assert.deepEqual(runSummary(short, () => 'ok'), { done: true, calls: 1, steps: 1, parts: [] });
  for (const bad of ['cut', 'timeout']) {
    const r = runSummary(short, (kind) => (kind === 'one' ? bad : 'ok'));
    assert.equal(r.done, true, bad); assert.equal(r.calls, 4, `${bad}: 한 번(실패) + 반 둘 + 합치기`); assert.equal(r.steps, 4);
  }
});

test('긴 회의: 조각마다 요약 → 합치기. 조각 하나가 잘리거나 오래 걸리면 그 조각만 반씩, 나머지는 그대로 이어 간다', () => {
  const n = sj.summaryPlan(long, []).pieces.length;
  assert.ok(n >= 3);
  const ok = runSummary(long, () => 'ok');
  assert.deepEqual([ok.done, ok.calls], [true, n + 1]);
  let first = true;
  const r = runSummary(long, (kind, text) => {
    if (kind === 'part' && text === sj.summaryPlan(long, []).pieces[1] && first) { first = false; return 'timeout'; }
    return 'ok';
  });
  assert.equal(r.done, true); assert.equal(r.calls, n + 1 + 2, '실패 한 번 + 반 둘');
});

test('반 나눔 표시: 계획·[다시] 나눔·나눌 수 없는 짧은 글', () => {
  let p = sj.summaryPlan(short, [sj.halfMark()]);
  assert.deepEqual([p.kind, p.half, p.single, p.total], ['half', 0, true, 3]);
  p = sj.summaryPlan(short, [{ halves: [d('a')] }]);
  assert.deepEqual([p.kind, p.half], ['half', 1]);
  assert.equal(sj.summaryPlan(short, [d('a'), d('b')]).kind, 'merge');
  const pieces = sj.summaryPlan(long, []).pieces;
  p = sj.summaryPlan(long, [d('1'), sj.halfMark()]);
  assert.deepEqual([p.kind, p.at, p.half, p.single], ['half', 1, 0, false]);
  assert.equal(p.piece, pieces[1]);
  assert.equal(sj.isHalfMark(d('x')), false); assert.equal(sj.isHalfMark({ halves: [d('a'), d('b')] }), false);
  // [다시]: 지금 요약할 조각을 반 나눔으로.
  assert.deepEqual(sj.splitSummary(short, []), [{ halves: [] }]);
  assert.deepEqual(sj.splitJobSummary({ transcript_text: long, summary_parts: [d('1')] }), [d('1'), { halves: [] }]);
  assert.deepEqual(sj.splitSummary(long, [d('1')]), [d('1'), { halves: [] }]);
  assert.equal(sj.splitSummary('짧은 회의', []), null, '나눠도 소용없는 짧은 글');
  assert.equal(sj.splitSummary(long, pieces.map((_, i) => d(String(i)))), null, '합치기 단계는 나누지 않음');
  for (const c of ['draft_cut', 'draft_timeout', 'draft_step_cut', 'step_cut']) assert.ok(sj.SPLIT_CODES.includes(c));
  assert.ok(!sj.SPLIT_CODES.includes('draft_failed'), '열쇠·한도 등 다른 실패는 나눠도 소용없음');
});

test('Edge: 요약 갈래마다 AI 요청 한 번, 끊긴 뒤·[다시] 때 반으로 나눔, 시간 초과는 draft_timeout', () => {
  const src = read('supabase/functions/meeting-transcribe/index.ts');
  const summary = src.slice(src.indexOf("if (job.stage === 'summary') {"), src.indexOf("throw new Fail('failed');\n}", src.indexOf("if (job.stage === 'summary') {")));
  for (const b of summary.split(/\n    if \(plan\.kind === |\n    let raw;|\n    \} else \{/)) assert.ok((b.match(/await serverDraft\(/g) || []).length <= 1, '한 갈래에 AI 요청 한 번');
  assert.doesNotMatch(src, /async function draftPiece\(/);
  assert.match(summary, /if \(cutBefore\) \{\n\s*const split = splitJobSummary\(job\);/);
  assert.match(src, /next = await stepOnce\(job, take\.cut === 1\);/);
  assert.match(src, /throw new Fail\(job\.stage === 'summary' \? 'draft_step_cut' : 'step_cut'\);/);
  assert.match(src, /new Fail\(late \? 'draft_timeout' : 'draft_failed'\)/);
  const retry = src.slice(src.indexOf('async function jobRetry('), src.indexOf('async function jobTick('));
  assert.match(retry, /if \(job\.stage === 'summary' && SPLIT_CODES\.includes\(job\.error_code\)\) \{\n\s*const split = splitJobSummary\(job\);/);
  assert.match(src, /signal: AbortSignal\.timeout\(300000\)/, '요약 한 번 기다림은 늘리지 않음');
  assert.match(read('supabase/functions/meeting-transcribe/server-job.mjs'), /export const MAX_STEP_CUTS = 2;/, '끊김 허용 횟수는 늘리지 않음');
  assert.doesNotMatch(src, /fail_log[:'"]|'fail_log/, 'Edge는 이력 칸을 쓰지 않는다(트리거가 남김)');
});

test('띠 문구: 요약 시간 초과·요약 끊김을 따로, [다시]로 이어짐, 서버 문구표와 짝', () => {
  for (const code of ['draft_timeout', 'draft_step_cut']) {
    assert.ok(MESSAGES[code] && STATUS[code], code);
    assert.match(failText(code), /전사한 글은 남아 있어요/); assert.match(failText(code), /\[다시\]/);
    assert.equal(canRetry(code), true);
  }
  assert.match(failText('draft_timeout'), /요약이 오래 걸려/);
  assert.match(failText('draft_step_cut'), /요약이 서버 시간 안에 끝나지 않아/);
  assert.notEqual(failText('draft_step_cut'), failText('step_cut'));
});

test('DB: 실패 이력 칸·트리거 migration은 짝 파일 5개와 승인형 workflow 확장 규칙을 통과하고, 새 권한을 주지 않는다', () => {
  const v = '20261111010000', name = 'meeting_server_job_fail_log';
  const sql = read(`supabase/migrations/${v}_${name}.sql`);
  for (const suf of ['precheck.sql', 'snapshot.sql', 'postcheck.sql', 'rollback.sql', 'summary.md']) assert.ok(existsSync(new URL(`../docs/${v}_${name}.${suf}`, import.meta.url)), suf);
  for (const mode of ['dry-run', 'apply']) assert.equal(prepareMigration({ mode, version: v, runId: '1', root: process.cwd() }).rules, 'expanded');
  assert.match(sql, /^begin;/); assert.match(sql.trim(), /commit;$/);
  assert.match(sql, /insert into supabase_migrations\.schema_migrations \(version, name, statements\)\nvalues \('20261111010000', 'meeting_server_job_fail_log'/);
  assert.doesNotMatch(sql, /^\s*grant /m, '권한 추가 없음');
  assert.match(sql, /security invoker\nset search_path = ''/);
  assert.match(sql, /revoke all on function private\.app_meeting_server_jobs_fail_log\(\) from public, anon, authenticated, service_role;/);
  assert.match(sql, /new\.fail_log := old\.fail_log;/, '이력은 트리거만 고친다');
  assert.match(sql, /jsonb_array_length\(fail_log\) <= 20/);
  const rb = read(`docs/${v}_${name}.rollback.sql`);
  assert.match(rb, /drop trigger app_meeting_server_jobs_fail_log on public\.app_meeting_server_jobs;\ndrop function private\.app_meeting_server_jobs_fail_log\(\);/);
  assert.match(rb, /delete from supabase_migrations\.schema_migrations\n\s*where version = '20261111010000' and name = 'meeting_server_job_fail_log';/);
});
