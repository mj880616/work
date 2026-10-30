// SEC-Web1첫페이지: Web1 루트 업무 페이지(index.html)는 로그인 없는 공개 키로 카드 보관 상태 표에 쓰지 않는다.
// 화면 비밀번호는 브라우저에서만 맞춰 보는 것이라 접근 통제가 아니다. 쓰기는 DB 권한에서 막는다(짝 migration).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>readFileSync(join(root,p),'utf8');
const V='20261021200000_web1_archive_state_readonly';
const T='public.main_project_archive_state';

test('Web1 첫 페이지는 보관 상태를 읽기만 하고 쓰지 않는다',()=>{
  const html=read('index.html');
  assert.match(html,/\/rest\/v1\/main_project_archive_state\?select=card_key,archived/);
  assert.doesNotMatch(html,/method:\s*['"](?:POST|PATCH|PUT|DELETE)['"]/i);
  assert.doesNotMatch(html,/on_conflict=|resolution=merge-duplicates|return=representation/);
  assert.doesNotMatch(html,/moveProject|archive-move/);
});

test('Web1·Web2 브라우저 코드 어디에서도 보관 상태 표에 쓰지 않는다',()=>{
  // DOMAIN-④ E2: Web2 사업 게시판(app/web1-board.js)은 지워졌다. Web2 app/ 파일 전체를 함께 본다.
  const appFiles=readdirSync(join(root,'app')).filter(n=>/\.(?:js|mjs|html)$/.test(n)).map(n=>'app/'+n);
  for(const p of ['index.html',...appFiles]){
    const text=read(p);
    for(const m of text.matchAll(/main_project_archive_state[^'"`]*/g))assert.match(m[0],/^main_project_archive_state\?select=/,p);
  }
});

test('migration은 쓰기 권한만 회수하고 권한을 넓히지 않는다',()=>{
  const sql=read(`supabase/migrations/${V}.sql`);
  assert.match(sql,/^begin;/);
  assert.match(sql,/commit;\s*$/);
  assert.match(sql,new RegExp(`revoke insert, update, delete, truncate, references, trigger on table ${T.replace('.','\\.')} from public, anon, authenticated;`));
  assert.doesNotMatch(sql,/\bgrant\s/i);
  assert.doesNotMatch(sql,/create policy|drop policy|alter policy|disable row level security|no force row level security/i);
  assert.doesNotMatch(sql,/\b(?:insert into|update|delete from)\s+public\./i);
  assert.match(sql,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261021200000', 'web1_archive_state_readonly'/);
  assert.match(sql,/WEB1_ARCHIVE_STATE_PREREQUISITE_CHANGED/);
  assert.match(sql,/WEB1_ARCHIVE_STATE_REVOKE_INCOMPLETE/);
});

test('짝 파일이 있고 확인 SQL은 읽기 전용이다',()=>{
  for(const kind of ['precheck','snapshot','postcheck','rollback','summary']){
    assert.ok(existsSync(join(root,`docs/${V}.${kind}.${kind==='summary'?'md':'sql'}`)),kind);
  }
  for(const kind of ['precheck','snapshot','postcheck']){
    const body=read(`docs/${V}.${kind}.sql`).split('\n').filter(l=>!l.trim().startsWith('--')).join('\n').replace(/'[^']*'/g,"''");
    assert.match(body,/^\s*select\b/i,kind);
    assert.doesNotMatch(body,/\b(?:insert|update|delete|grant|revoke|alter|drop|create|truncate|begin|commit)\b/i,kind);
  }
  const rb=read(`docs/${V}.rollback.sql`);
  assert.match(rb,/^begin;/);
  assert.match(rb,/commit;\s*$/);
  assert.match(rb,/delete from supabase_migrations\.schema_migrations where version = '20261021200000' and name = 'web1_archive_state_readonly';/);
  assert.doesNotMatch(rb,/\bto\s+public\b|create policy|drop policy|disable row level security/i);
});
