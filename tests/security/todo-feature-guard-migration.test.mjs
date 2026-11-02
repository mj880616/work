import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';

// EDGE-서버함수정리 C3 안 A(docs/design/todo-feature-guard.md 3절): 텔레그램에 속한 챙길 것 2곳에만 운영자 허용 가드.
// 정적 검사만 한다: 두 표에 restrictive 읽기 정책·가드 트리거가 있고, 나머지 4표(D3)에는 없고, 권한을 넓히는 문장이 없다.
const V='20261102030000',N='todo_feature_guard';
const root=new URL('../../',import.meta.url);
const read=p=>readFileSync(new URL(p,root),'utf8');
const sql=read(`supabase/migrations/${V}_${N}.sql`);
const code=sql.split('\n').filter(l=>!l.trim().startsWith('--')).join('\n').replace(/\s+/g,' ').toLowerCase();
const OTHER=['app_todo_radar_state','app_todo_not_mine','app_todo_feedback','app_todo_rules'];

test('ask rooms: restrictive authenticated read policy with telegram feature check + guard trigger',()=>{
  assert.match(code,/create policy op_feature_read on public\.app_todo_ask_rooms as restrictive for select to authenticated using \(private\.app_workspace_has_feature\(workspace_id, 'telegram'\)\);/);
  assert.match(code,/create trigger trg_op_feature_guard before insert or update on public\.app_todo_ask_rooms for each row execute function private\.app_operator_feature_guard\('telegram'\);/);
});

test('candidates: guard only telegram-source rows (policy and trigger when clause)',()=>{
  assert.match(code,/create policy op_feature_read on public\.app_todo_candidates as restrictive for select to authenticated using \(source_kind <> 'telegram' or private\.app_workspace_has_feature\(workspace_id, 'telegram'\)\);/);
  assert.match(code,/create trigger trg_op_feature_guard before insert or update on public\.app_todo_candidates for each row when \(new\.source_kind = 'telegram'\) execute function private\.app_operator_feature_guard\('telegram'\);/);
});

test('the four other todo tables (D3) get no policy or trigger',()=>{
  for(const t of OTHER)assert.ok(!code.includes(`public.${t}`),`${t}에 가드가 걸리면 안 된다`);
  assert.equal((code.match(/create policy /g)||[]).length,2);
  assert.equal((code.match(/create trigger /g)||[]).length,2);
});

test('narrows only: no grants, no permissive policy, no policy drop/alter, no RLS off, no new functions, no rtw',()=>{
  assert.ok(!/\bgrant\b/.test(code),'권한 부여 금지');
  assert.ok(!/\banon\b/.test(code)&&!/ to public\b/.test(code),'anon·PUBLIC 대상 금지');
  assert.ok(!/drop policy|alter policy|disable row level security|no force row level security|disable trigger/.test(code));
  assert.ok(!/create (or replace )?function/.test(code),'함수 본문은 고치지 않고 기존 가드 재사용');
  assert.ok(!/as permissive/.test(code));
  for(const m of code.matchAll(/create policy [^;]*;/g))assert.match(m[0],/ as restrictive /);
  assert.ok(!code.includes('rtw_'));
});

test('stops before writing when telegram rows exist outside the operator workspace',()=>{
  assert.match(code,/raise exception 'todo_feature_guard_rows_outside_operator; stop'/);
  assert.match(code,/raise exception 'todo_feature_guard_prerequisite_changed; stop'/);
});

test('history row is the last statement before commit with matching version and name',()=>{
  const t=code.trim();
  assert.ok(t.startsWith('begin;'));
  assert.match(t,new RegExp(`insert into supabase_migrations\\.schema_migrations \\(version, name, statements\\) values \\('${V}', '${N}', array\\[[^\\]]*\\]\\); commit;$`));
  assert.equal((t.match(/\bcommit;/g)||[]).length,1);
});

test('five pair files exist; precheck expects zero outside rows; rollback drops exactly the two triggers and two policies',()=>{
  for(const s of ['precheck.sql','snapshot.sql','postcheck.sql','rollback.sql','summary.md'])
    assert.ok(existsSync(new URL(`docs/${V}_${N}.${s}`,root)),`짝 파일 ${s} 없음`);
  const pre=read(`docs/${V}_${N}.precheck.sql`);
  assert.match(pre,/^-- expect: telegram candidates outside operator workspace = 0$/m);
  assert.match(pre,/^-- expect: ask rooms outside operator workspace = 0$/m);
  const rb=read(`docs/${V}_${N}.rollback.sql`).replace(/\s+/g,' ').toLowerCase();
  for(const t of ['app_todo_ask_rooms','app_todo_candidates']){
    assert.ok(rb.includes(`drop trigger trg_op_feature_guard on public.${t};`));
    assert.ok(rb.includes(`drop policy op_feature_read on public.${t};`));
  }
  assert.ok(rb.includes(`delete from supabase_migrations.schema_migrations where version = '${V}' and name = '${N}';`));
  assert.equal((rb.match(/drop (trigger|policy) /g)||[]).length,4);
  const sum=read(`docs/${V}_${N}.summary.md`);
  for(const h of ['무엇이 바뀌나','잘못되면','되돌리는'])assert.ok(sum.includes(h));
});
