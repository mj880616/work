import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// S70-20b FORGET-기본이미함(명진 11/25 12:36 "할일에 추가하지도 않고 이미 해버린 일이 많다는거야", 12:39 "모두 추천대로").
// 화면 쪽 판정(todo-radar-data.js)과 서버 옮기기(migration 20261125160000)의 같은 기준을 본다. 실제 PostgreSQL 실행은
// tests/auth-handoff/forget-auto-expire-db.test.mjs가 본다. 글·이름은 지어낸 것이다.
const {autoDone, autoReplied, starredCandidate, bundleDay, AUTO_DONE_LABEL} = await import('../app/todo-radar-data.js');

const seoulKey = d => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
const row = (o = {}) => ({id: 'c1', kind: 'request', summary: '가상 요청', due: null, source_kind: 'basket', status: 'open', created_at: '2026-10-05T03:00:00Z', decided_at: null, ...o});
const AT = '2026-10-07T15:13:00Z';

test('지남: 서버가 저절로 옮긴 그대로인 줄만 이미 함 · 지남 (모든 출처)', () => {
  const c = row({status: 'done', auto_done: 'expired', auto_done_at: AT, decided_at: AT});
  assert.equal(autoDone(c), 'expired');
  assert.equal(AUTO_DONE_LABEL.expired, '지남');
  assert.equal(autoDone({...c, source_kind: 'telegram'}), 'expired');
  // 되돌렸다가(처리 전) 사람이 다시 [이미 함]을 누르면 처리한 때가 달라져 꼬리표 없음.
  assert.equal(autoDone({...c, decided_at: '2026-10-08T01:00:00Z'}), '');
  assert.equal(autoDone({...c, status: 'open', decided_at: null}), '', '되돌린 줄은 처리 전');
});
test('답장함은 그대로 텔레그램만(앞 단계 #3052 규칙 유지)', () => {
  const c = row({source_kind: 'telegram', status: 'done', auto_done: 'replied', auto_done_at: AT, decided_at: AT});
  assert.equal(autoReplied(c), true);
  assert.equal(autoDone({...c, source_kind: 'basket'}), '');
  assert.equal(autoDone({...c, auto_done: 'other'}), '');
});
test('★: 마감 있는 줄·직접 부른 텔레그램 요청은 ★(처리 전일 때만)', () => {
  assert.equal(starredCandidate(row({due: '2026-10-09'})), true);
  assert.equal(starredCandidate(row({source_kind: 'telegram', ask_direct: true})), true);
  assert.equal(starredCandidate(row({source_kind: 'telegram', ask_direct: false})), false);
  assert.equal(starredCandidate(row()), false);
  assert.equal(starredCandidate(row({due: '2026-10-09', status: 'done'})), false);
});
test('하루 묶음: 서울 기준 어제 들어온 ★ 아닌 처리 전 줄만 어제 묶음', () => {
  const today = '2026-10-06';
  assert.equal(bundleDay(row({created_at: '2026-10-05T03:00:00Z'}), today, seoulKey), '2026-10-05', '어제 낮');
  assert.equal(bundleDay(row({created_at: '2026-10-04T15:30:00Z'}), today, seoulKey), '2026-10-05', '어제 0시 30분(서울)');
  assert.equal(bundleDay(row({created_at: '2026-10-04T14:30:00Z'}), today, seoulKey), '', '그제 밤(서울) — 서버가 옮길 줄');
  assert.equal(bundleDay(row({created_at: '2026-10-05T15:30:00Z'}), today, seoulKey), '', '오늘 0시 30분(서울) — 오늘 줄');
  assert.equal(bundleDay(row({due: '2026-10-09'}), today, seoulKey), '', '★는 묶지 않음');
  assert.equal(bundleDay(row({status: 'tasked'}), today, seoulKey), '', '처리한 줄');
  assert.equal(bundleDay(row({created_at: 'x'}), today, seoulKey), '');
});

const sql = readFileSync(new URL('../supabase/migrations/20261125160000_forget_auto_expire.sql', import.meta.url), 'utf8');
const fn = sql.slice(sql.indexOf('create function public.app_forget_auto_expire()'), sql.indexOf('revoke all on function'));
test('서버 옮기기: 처리 전·까닭 없음·마감 없음·직접 부름 아님·서울 어제 0시 전만, 가족·소식 표는 건드리지 않음', () => {
  const where = fn.slice(fn.indexOf('update public.app_todo_candidates'));
  for (const part of ["c.status = 'open'", 'c.auto_done is null', 'c.due is null', 'c.ask_direct is not true', 'c.created_at < v_cut'])
    assert.ok(where.includes(part), part);
  assert.match(where, /set status = 'done', decided_at = v_now, auto_done = 'expired', auto_done_at = v_now/);
  assert.match(fn, /timezone\('Asia\/Seoul', v_now\)\)::date - 1\)::timestamp at time zone 'Asia\/Seoul'/, '서울 어제 0시');
  // 가족 잊지 말기·소식 표는 건드리지 않는다: 바꾸는 표는 후보 표 하나뿐.
  const code = sql.replace(/--.*$/gm, '');
  const touched = [...code.matchAll(/\b(?:update|alter table|insert into|delete from)\s+([a-z_]+\.[a-z_]+)/gi)].map(m => m[1]);
  assert.deepEqual([...new Set(touched)].sort(), ['public.app_todo_candidates', 'supabase_migrations.schema_migrations'], '후보 표와 migration 기록만');
  assert.doesNotMatch(fn, /summary|evidence/, '글 칸을 읽지 않음');
  assert.match(sql, /revoke all on function public\.app_forget_auto_expire\(\) from public, anon, authenticated, service_role;/);
  assert.doesNotMatch(sql, /grant execute on function public\.app_forget_auto_expire/, '실행권은 아무에게도 주지 않음(예약만)');
  assert.match(sql, /select cron\.schedule\('web2_forget_auto_expire', '13 15 \* \* \*', \$cmd\$select public\.app_forget_auto_expire\(\)\$cmd\$\);/);
});
