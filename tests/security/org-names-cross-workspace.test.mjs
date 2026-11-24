import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
// COLLAB-조직목록없음직접입력 덧붙임(11/15 21:07): 한 작업공간의 조직(담당조직) 이름이 다른 작업공간 사람의 화면·API 응답에 나오면 안 된다.
// 이 시험은 DB 쪽 길을 지킨다(실제 DB 시험은 tests/auth-handoff/call-context-people·trash-org-report-db, supabase/tests/authz_sole_owner.sql).
// ① app_suborganizations 표의 읽기 정책은 작업공간 주인(owner)만이고, 그 밖의 정책은 좁히기(restrictive)만 한다.
// ② RLS를 건너뛰는 SECURITY DEFINER 함수 중 조직 표를 읽는 것은 검토한 목록뿐이고, 각각 작업공간 주인 확인 또는 서버가 정한 작업공간 조건으로 묶인다.
//    새 DEFINER 함수가 조직 표를 읽으면 이 시험이 실패한다 — 작업공간 조건을 확인한 뒤 목록에 이유와 함께 더한다.
const DIR = 'supabase/migrations';
const migrations = readdirSync(DIR).filter(f => f.endsWith('.sql')).sort().map(f => [f, readFileSync(`${DIR}/${f}`, 'utf8')]);

// 마지막 정의 기준(같은 이름을 다시 만들면 뒤의 것, drop하면 빠짐).
function latestFunctions() {
  const latest = new Map();
  for (const [file, sql] of migrations) {
    const re = /create\s+(?:or\s+replace\s+)?function\s+([\w."]+)\s*\(([\s\S]*?)\$(\w*)\$([\s\S]*?)\$\3\$([^;]*);/gi;
    for (const m of sql.matchAll(re)) latest.set(m[1].replace(/"/g, '').toLowerCase(), {file, head: m[2] + m[5], body: m[4]});
    for (const d of sql.matchAll(/drop\s+function\s+(?:if\s+exists\s+)?([\w."]+)/gi)) latest.delete(d[1].replace(/"/g, '').toLowerCase());
  }
  return latest;
}

// 검토한 DEFINER 함수(조직 표를 읽음): 이름 → 작업공간 조건 모양.
const OWNER = /private\.app_is_workspace_owner\s*\(|private\.app_is_owner_organization\s*\(/i;
const REVIEWED = {
  'private.app_is_owner_organization': /private\.app_is_workspace_owner\s*\(/i, // 참/거짓만 돌려줌
  'public.app_trash_list': OWNER,
  'public.app_trash_restore': OWNER,
  'public.app_trash_purge': OWNER,
  'public.app_call_work_info': OWNER,
  'public.app_call_edit': OWNER,
  'public.app_call_context_people': /workspace_id\s*=\s*p_workspace/i, // service_role만 실행, 작업공간은 서버(운영자 기능 확인)가 정함
  'private.app_trash_org_before_delete': /returns\s+trigger/i, // 트리거: 부른 사람에게 행을 돌려주지 않음
  // S69 STORE-계정삭제 트리거: 조직 이름을 읽어 돌려주지 않고, 부른 사람 owner 작업공간(v_ws, auth.uid()로 서버가 정함)의 조직 줄만 지운다.
  'private.app_account_delete_run': /delete from public\.app_suborganizations t where t\.workspace_id = v_ws;/i,
};

test('조직 표를 읽는 SECURITY DEFINER 함수는 검토한 목록뿐이고, 모두 작업공간 조건으로 묶인다', () => {
  const found = [];
  for (const [name, {head, body}] of latestFunctions()) {
    if (!/security\s+definer/i.test(head) || !/app_suborganizations/i.test(body)) continue;
    found.push(name);
    assert.ok(REVIEWED[name], `${name}: 검토하지 않은 DEFINER 함수가 조직 표를 읽음`);
    assert.match(name === 'private.app_trash_org_before_delete' ? head : body, REVIEWED[name], `${name}: 작업공간 조건 없음`);
  }
  assert.deepEqual(found.sort(), Object.keys(REVIEWED).sort());
});

test('조직 이름을 돌려주는 DEFINER 함수는 anon·PUBLIC에 실행 권한이 없다', () => {
  for (const name of ['public.app_trash_list', 'public.app_call_context_people', 'public.app_call_work_info']) {
    const short = name.split('.')[1];
    let grantedToAnon = false;
    for (const [, sql] of migrations) {
      for (const g of sql.matchAll(new RegExp(`(grant|revoke)\\s+(?:all|execute)[^;]*?function\\s+public\\.${short}\\b[^;]*?\\b(to|from)\\s+([^;]+);`, 'gi'))) {
        if (/\b(anon|public)\b/i.test(g[4])) grantedToAnon = g[1].toLowerCase() === 'grant';
      }
    }
    assert.equal(grantedToAnon, false, `${name}: anon/PUBLIC 실행 권한`);
  }
});

test('app_suborganizations 정책: 허용(permissive) 정책은 작업공간 주인 확인 하나뿐', () => {
  const policies = new Map();
  for (const [, sql] of migrations) {
    for (const m of sql.matchAll(/create\s+policy\s+"?([\w-]+)"?\s+on\s+public\.app_suborganizations\b([^;]*);/gi)) policies.set(m[1], m[2]);
    for (const m of sql.matchAll(/drop\s+policy\s+(?:if\s+exists\s+)?"?([\w-]+)"?\s+on\s+public\.app_suborganizations\b/gi)) policies.delete(m[1]);
  }
  const permissive = [...policies].filter(([, def]) => !/as\s+restrictive/i.test(def));
  assert.deepEqual(permissive.map(([name]) => name), ['task12a_owner_all']);
  assert.match(permissive[0][1], /to\s+authenticated/i);
  assert.match(permissive[0][1], /private\.app_is_workspace_owner\s*\(\s*workspace_id\s*\)/i);
});
