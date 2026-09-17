import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

const BASE='http://127.0.0.1:8123';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const repoRoot=new URL('../../',import.meta.url);
const read=path=>readFile(new URL(path,repoRoot),'utf8');

test('Web1 로그인 창에서 비밀번호 재설정 메일을 요청할 수 있다',async({page})=>{
  let recoverBody=null;
  await page.route(`${SB}/auth/v1/recover`,async route=>{
    recoverBody=route.request().postDataJSON();
    await route.fulfill({status:200,contentType:'application/json',body:'{}'});
  });
  await page.goto(`${BASE}/tests/app-e2e/public-page-editor-fixture.html?anon=1&realAuth=1`);
  await page.locator('#editPageBtn').click();
  await expect(page.locator('#ppeAuthReset')).toBeVisible();
  await page.locator('#ppeAuthEmail').fill('editor@example.com');
  await page.locator('#ppeAuthReset').click();
  await expect.poll(()=>recoverBody).not.toBeNull();
  expect(recoverBody.email).toBe('editor@example.com');
  expect(recoverBody.redirect_to).toContain('/work/p/');
  await expect(page.locator('#ppeAuthError')).toContainText('재설정 메일');
});

test('Web1 인증 모듈은 recovery 세션을 받아 새 비밀번호를 저장할 수 있다',async()=>{
  const auth=await read('app/public-page-auth.js');
  const editor=await read('app/public-page-editor.js');
  expect(auth).toContain('/auth/v1/recover');
  expect(auth).toContain('resetPasswordForEmail');
  expect(auth).toContain('consumeRecoverySession');
  expect(auth).toContain('updatePassword');
  expect(auth).toContain("sessionKey:'kptu_public_editor_session_v1'");
  expect(auth).not.toContain('kptu_collab_session_v1');
  expect(editor).toContain('ppeAuthReset');
  expect(editor).toContain('ppeRecoveryForm');
  expect(editor).toContain('새 비밀번호');
});
