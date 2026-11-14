// S46-24 ②: Drive 연결(public-policy-drive)이 사진 출처용 drive 권한을 더 요청하고, 콜백에서 실제로 받은 권한을 확인한다.
// 정적 검사(합성, 비밀값 없음). 함수 코드는 Deno.serve를 바로 열므로 import하지 않고 글자와 작은 함수만 꺼내 시험한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../../supabase/functions/public-policy-drive/index.ts',import.meta.url),'utf8');

test('scope request keeps drive.file and adds full drive; nothing else is requested',()=>{
  assert.match(source,/const DRIVE_FILE_SCOPE = 'https:\/\/www\.googleapis\.com\/auth\/drive\.file';/);
  assert.match(source,/const DRIVE_FULL_SCOPE = 'https:\/\/www\.googleapis\.com\/auth\/drive';/);
  assert.match(source,/const DRIVE_SCOPES = \[DRIVE_FILE_SCOPE, DRIVE_FULL_SCOPE\];/);
  // MULTI ②-2: 전체 drive는 사진 출처·파일 탐색기 허용 작업공간에서만, 다른 사람은 drive.file만.
  assert.match(source,/scope: \(full \? DRIVE_SCOPES : \[DRIVE_FILE_SCOPE\]\)\.join\(' '\),/);
  // S50-8: 판정은 fullDriveAllowed 한 곳(서버 허용 표의 사진 출처·파일 탐색기). 시작·콜백 모두 같은 판정을 쓴다.
  assert.match(source,/return await hasOperatorFeature\(workspaceId, 'gdrive_photos'\) \|\| await hasOperatorFeature\(workspaceId, 'files'\);/);
  assert.match(source,/const full = await fullDriveAllowed\(workspaceId\);/);
  assert.match(source,/const fullDrive = fullAllowed && grantedFullDrive\(tokens\.scope\);/);
  const scopes=[...source.matchAll(/'https:\/\/www\.googleapis\.com\/auth\/([a-z.]+)'/g)].map(m=>m[1]).sort();
  assert.deepEqual(scopes,['drive','drive.file']);
  assert.match(source,/include_granted_scopes: 'true'/);
});

test('granted-scope check: exact full drive scope only',()=>{
  const body=source.match(/function grantedFullDrive\(scope: unknown\) \{\n([\s\S]*?)\n\}/);
  assert.ok(body);
  const fn=new Function('DRIVE_FULL_SCOPE','scope',body[1].replace(/\\s/g,'\\s'));
  const F='https://www.googleapis.com/auth/drive';
  const has=s=>fn(F,s);
  assert.equal(has(`${F}.file ${F}`),true);
  assert.equal(has(`${F}`),true);
  assert.equal(has(`${F}.file`),false);
  assert.equal(has(`${F}.readonly ${F}.file`),false);
  assert.equal(has(`${F}x`),false);
  assert.equal(has(undefined),false);
  assert.equal(has(['x']),false);
});

test('callback keeps saving the connection and only flags the photo source when full drive is missing',()=>{
  // S50-8: 사진 안내는 전체 권한을 요청한 운영자 작업공간에서 그 칸이 빠졌을 때만.
  assert.match(source,/return Response\.redirect\(driveRedirect\('connected', undefined, fullAllowed && !fullDrive \? 'scope_missing' : undefined, state\), 302\);/);
  assert.match(source,/if \(photos\) u\.searchParams\.set\('photos', photos\);/);
  // 기존 확인(about·폴더 접근)과 토큰 저장 순서는 그대로.
  const about=source.indexOf("drive/v3/about?fields=user(emailAddress)"),save=source.indexOf("servicePatch('public_policy_drive_config?id=eq.1'");
  assert.ok(about>0&&save>about);
  // 쓰기 API(파일 바꾸기·지우기)는 이 함수에 없다.
  assert.doesNotMatch(source,/method:\s*'(PATCH|DELETE)'[\s\S]{0,200}googleapis\.com\/drive/);
  assert.doesNotMatch(source,/trashed|files\.delete|emptyTrash/);
});

test('MULTI ②-2: Drive 연결은 부른 사람의 owner 작업공간에 저장, id=1은 운영자일 때만',()=>{
  // 고정 작업공간 이름으로 찾지 않는다.
  assert.doesNotMatch(source,/slug=eq\./);
  assert.doesNotMatch(source,/assertDriveAdmin/);
  // 시작: 로그인 → 본인 owner 작업공간(정확히 1개). 콜백: state에 저장된 user_id로 다시 확인(화면 값 없음).
  assert.match(source,/const workspaceId = await ownWorkspace\(user\.id\);/);
  assert.match(source,/const workspaceId = await callerOwnerWorkspace\(\{ rest: serviceGet \}, row\.user_id\)/);
  // 작업공간별 표에 그 작업공간 행만 쓴다.
  assert.match(source,/servicePatch\(`app_drive_connections\?workspace_id=eq\.\$\{encodeURIComponent\(workspaceId\)\}`/);
  assert.match(source,/servicePost\('app_drive_connections', \{\n\s+workspace_id: workspaceId,/);
  // 옛 자리(id=1)는 calls 허용(운영자) 작업공간일 때만 덮어쓴다.
  const guard=source.indexOf("if (await hasOperatorFeature(workspaceId, 'calls')) {"),patch=source.indexOf("servicePatch('public_policy_drive_config?id=eq.1'");
  assert.ok(guard>0&&patch>guard&&patch-guard<120);
  assert.equal(source.split("servicePatch('public_policy_drive_config?id=eq.1'").length,2);
  // 운영자 판정은 service_role 전용 RPC(서버 허용 표).
  assert.match(source,/rest\/v1\/rpc\/app_operator_feature_workspace/);
});
