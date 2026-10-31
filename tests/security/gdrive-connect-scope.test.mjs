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
  assert.match(source,/scope: DRIVE_SCOPES\.join\(' '\),/);
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
  assert.match(source,/return Response\.redirect\(driveRedirect\('connected', undefined, grantedFullDrive\(tokens\.scope\) \? undefined : 'scope_missing'\), 302\);/);
  assert.match(source,/if \(photos\) u\.searchParams\.set\('photos', photos\);/);
  // 기존 확인(about·폴더 접근)과 토큰 저장 순서는 그대로.
  const about=source.indexOf("drive/v3/about?fields=user(emailAddress)"),save=source.indexOf("servicePatch('public_policy_drive_config?id=eq.1'");
  assert.ok(about>0&&save>about);
  // 쓰기 API(파일 바꾸기·지우기)는 이 함수에 없다.
  assert.doesNotMatch(source,/method:\s*'(PATCH|DELETE)'[\s\S]{0,200}googleapis\.com\/drive/);
  assert.doesNotMatch(source,/trashed|files\.delete|emptyTrash/);
});
