// S46-24 ②·S71-01: Drive 연결(public-policy-drive)의 권한 요청·콜백 확인. S71-01부터 drive 전체는 운영자 + 명진 전용 창구만.
// 정적 검사(합성, 비밀값 없음). 함수 코드는 Deno.serve를 바로 열므로 import하지 않고 글자와 작은 함수만 꺼내 시험한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../../supabase/functions/public-policy-drive/index.ts',import.meta.url),'utf8');
const code=source.replace(/^\s*\/\/.*$/gm,'');

// S71-01 AUTH-구글권한나누기: 권한 글자·창구 고르기는 공용 도우미(_shared/google-oauth-clients.mjs) 한 곳. 이 함수에는 권한 주소 글자가 없다.
test('S71-01 scope request goes through the shared helper; no scope literal, no include_granted_scopes',()=>{
  assert.match(source,/from "\.\.\/_shared\/google-oauth-clients\.mjs";/);
  assert.equal([...source.matchAll(/googleapis\.com\/auth\//g)].length,0,'no scope literal in this function');
  assert.doesNotMatch(code,/include_granted_scopes/);
  assert.doesNotMatch(source,/DRIVE_SCOPES|accounts\.google\.com\/o\/oauth2/);
  // 시작: 서버 허용 표('calls')로 운영자 판정 → 계획(창구·권한) → 그 창구의 동의 화면 주소.
  assert.match(source,/const plan = driveStartPlan\(\{ isOperator: await hasOperatorFeature\(workspaceId, OPERATOR_FEATURE\)/);
  assert.match(source,/const OPERATOR_FEATURE = 'calls';/);
  assert.match(source,/fullDriveAuthUrl\(\{ client: plan\.client, redirectUri: CALLBACK_URL, state: raw \}\)/);
  assert.match(source,/reviewAuthUrl\(\{ cfg, redirectUri: CALLBACK_URL, scopes: plan\.scopes, state: raw \}\)/);
  // full_drive는 명진 전용 창구에서 구글이 실제로 준 경우만.
  assert.match(source,/const fullDrive = clientKind === 'full' && grantsFullDrive\(tokens\.scope\);/);
});

test('callback keeps saving the connection and only flags the photo source when the operator misses full drive',()=>{
  assert.match(source,/return Response\.redirect\(driveRedirect\('connected', undefined, isOperator && !fullDrive \? 'scope_missing' : undefined, state\), 302\);/);
  assert.match(source,/if \(photos\) u\.searchParams\.set\('photos', photos\);/);
  // 기존 확인(about·폴더 접근)과 토큰 저장 순서는 그대로. 창구 기록은 연결 저장 뒤, id=1 갱신 앞.
  const about=source.indexOf("drive/v3/about?fields=user(emailAddress)"),client=source.indexOf("await saveConnectionClient(workspaceId, clientKind, now);"),save=source.indexOf("servicePatch('public_policy_drive_config?id=eq.1'");
  assert.ok(about>0&&client>about&&save>client);
  // 쓰기 API(파일 바꾸기·지우기)는 이 함수에 없다.
  assert.doesNotMatch(source,/method:\s*'(PATCH|DELETE)'[\s\S]{0,200}googleapis\.com\/drive/);
  assert.doesNotMatch(source,/trashed|files\.delete|emptyTrash/);
});

test('MULTI ②-2: Drive 연결은 부른 사람의 owner 작업공간에 저장, id=1은 운영자일 때만',()=>{
  // 고정 작업공간 이름으로 찾지 않는다.
  assert.doesNotMatch(source,/slug=eq\./);
  assert.doesNotMatch(source,/assertDriveAdmin/);
  // 시작: 로그인 → 본인 owner 작업공간(정확히 1개). 콜백: state에 저장된 user_id로 다시 확인(화면 값 없음).
  assert.match(source,/await ownWorkspace\(user\.id\);/);
  assert.match(source,/const workspaceId = await callerOwnerWorkspace\(\{ rest: serviceGet \}, row\.user_id\)/);
  // 작업공간별 표에 그 작업공간 행만 쓴다.
  assert.match(source,/servicePatch\(`app_drive_connections\?workspace_id=eq\.\$\{encodeURIComponent\(workspaceId\)\}`/);
  assert.match(source,/servicePost\('app_drive_connections', \{\n\s+workspace_id: workspaceId,/);
  // 옛 자리(id=1)는 calls 허용(운영자) 작업공간일 때만 덮어쓴다.
  const guard=source.indexOf("if (isOperator) {"),patch=source.indexOf("servicePatch('public_policy_drive_config?id=eq.1'");
  assert.match(source,/const isOperator = await hasOperatorFeature\(workspaceId, OPERATOR_FEATURE\);/);
  assert.ok(guard>0&&patch>guard&&patch-guard<120);
  assert.equal(source.split("servicePatch('public_policy_drive_config?id=eq.1'").length,2);
  // 운영자 판정은 service_role 전용 RPC(서버 허용 표).
  assert.match(source,/rest\/v1\/rpc\/app_operator_feature_workspace/);
});
