// S46-32 바깥 성명 ① DB: migration 글자 검사(데이터베이스 없이). 실제 PostgreSQL 시험은 tests/auth-handoff/outside-statements-db.test.mjs.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {prepareMigration} from '../scripts/ops/db-migration-plan.mjs';

const root = new URL('../', import.meta.url).pathname;
const stem = '20261031230000_outside_statements';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const sql = read(`supabase/migrations/${stem}.sql`);
const TABLES = ['app_outside_sources', 'app_outside_posts', 'app_outside_sentences', 'app_outside_seen'];

test('짝 파일 5개가 있고 승인형 workflow 확장 규칙이 받는다', () => {
  for (const kind of ['precheck.sql', 'snapshot.sql', 'postcheck.sql', 'rollback.sql', 'summary.md'])
    assert.ok(existsSync(new URL(`../docs/${stem}.${kind}`, import.meta.url)), kind);
  const plan = prepareMigration({mode: 'apply', version: '20261031230000', runId: '1', root});
  assert.equal(plan.rules, 'expanded');
  assert.equal(plan.flow, 'full');
  assert.deepEqual(plan.review.definer, [], 'SECURITY DEFINER 함수 없음');
});

test('새 표 넷: RLS 켬, 소유자 정책은 authenticated만, anon·PUBLIC 권한 없음', () => {
  for (const t of TABLES) {
    assert.match(sql, new RegExp(`create table public\\.${t} \\(`), t);
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security;`), t);
    assert.match(sql, new RegExp(`revoke all on table public\\.${t} from public, anon, authenticated, service_role;`), t);
  }
  assert.doesNotMatch(sql, /grant[^;]*\bto\s+(anon|public)\b/i);
  assert.doesNotMatch(sql, /security definer/i);
  assert.doesNotMatch(sql, /using \(true\)|with check \(true\)/i);
  const policies = [...sql.matchAll(/create policy (\w+) on public\.(\w+) for (\w+) to (\w+)\s+using \(private\.app_is_workspace_owner\(workspace_id\)\)/g)];
  assert.deepEqual(policies.map(m => [m[2], m[3], m[4]]), [
    ['app_outside_sources', 'all', 'authenticated'],
    ['app_outside_posts', 'select', 'authenticated'],
    ['app_outside_sentences', 'select', 'authenticated'],
    ['app_outside_seen', 'all', 'authenticated'],
  ]);
});

test('글·문장은 화면이 읽기만, 글 넣기는 서버(service_role)만', () => {
  assert.match(sql, /grant select on table public\.app_outside_posts to authenticated;/);
  assert.match(sql, /grant select on table public\.app_outside_sentences to authenticated;/);
  assert.doesNotMatch(sql, /grant (insert|update|delete)[^;]*app_outside_(posts|sentences) to authenticated/);
  assert.doesNotMatch(sql, /grant [^;]*(last_ok_at|last_error)[^;]*to authenticated/);
  for (const t of TABLES) assert.match(sql, new RegExp(`grant select, insert, update, delete on table public\\.${t} to service_role;`), t);
});

test('외국 글은 문장 행을 만들 수 없고(전문 저장 금지), 핵심 문장은 3개까지', () => {
  assert.match(sql, /constraint app_outside_sentences_lang_check check \(lang = 'ko'\)/);
  assert.match(sql, /foreign key \(post_id, workspace_id, lang\)\s+references public\.app_outside_posts\(id, workspace_id, lang\)/);
  assert.match(sql, /jsonb_array_length\(key_sentences\) <= 3/);
  assert.match(sql, /constraint app_outside_posts_body_check check \(lang = 'ko' or not has_body\)/);
});

test('찾기 함수: INVOKER, search_path 고정, authenticated만 실행, 동적 실행 없음', () => {
  const fn = sql.slice(sql.indexOf('create function public.app_outside_search'), sql.indexOf('$search$;') + 9);
  assert.match(fn, /security invoker/);
  assert.match(fn, /set search_path = ''/);
  assert.doesNotMatch(fn, /\bexecute\b/i);
  assert.match(sql, /revoke all on function public\.app_outside_search\([^)]*\) from public, anon, authenticated, service_role;/);
  assert.match(sql, /grant execute on function public\.app_outside_search\([^)]*\) to authenticated;/);
});

test('기존 표를 바꾸지 않고, 기록 1행이 파일 이름과 같다', () => {
  assert.doesNotMatch(sql, /alter table public\.(?!app_outside_)/);
  assert.doesNotMatch(sql, /rtw_/);
  assert.match(sql, /values \('20261031230000', 'outside_statements',/);
  assert.match(sql.trimEnd(), /commit;$/);
});

test('설계 문서: 명진 결정이 결정됨으로, 공공운수노조·전국결집 줄이 채워짐', () => {
  const doc = read('docs/design/outside-statements.md');
  assert.match(doc, /kptu\.net\/board\/list\.aspx\?mid=F686C1F3/);
  assert.match(doc, /leftall\.com/);
  const table = doc.slice(doc.indexOf('## 8.'), doc.indexOf('## 9.'));
  for (const q of ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'Q9']) assert.match(table, new RegExp(`\\| ${q} \\|[^\\n]*결정됨`), q);
});
