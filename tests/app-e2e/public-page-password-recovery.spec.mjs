import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

const BASE='http://127.0.0.1:8123';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const repoRoot=new URL('../../',import.meta.url);
const read=path=>readFile(new URL(path,repoRoot),'utf8');

test('Web1 로그인 창에서 비밀번호 재설정 메일을 요청할 수 있다',async({page})=>{
  let recover=null;
  await page.route(`${SB}/auth/v1/recover**`,async route=>{
    recover={url:route.request().url(),body:route.request().postDataJSON()};
    await route.fulfill({status:200,contentType:'application/json',body:'{}'});
  });
  await page.goto(`${BASE}/tests/app-e2e/public-page-password-recovery-fixture.html`);
  await expect(page.locator('#ppeAuthReset')).toBeVisible();
  await page.locator('#ppeAuthEmail').fill('editor@example.com');
  await page.locator('#ppeAuthReset').click();
  await expect.poll(()=>recover).not.toBeNull();
  expect(recover.body.email).toBe('editor@example.com');
  expect(new URL(recover.url).searchParams.get('redirect_to')).toBe(`${BASE}/tests/app-e2e/public-page-password-recovery-fixture.html`);
  await expect(page.locator('#ppeAuthError')).toContainText('재설정 메일을 보냈습니다');
});

test('recovery 링크 세션으로 새 비밀번호를 저장할 수 있다',async({page})=>{
  let updateBody=null;
  await page.route(`${SB}/auth/v1/user`,async route=>{
    updateBody=route.request().postDataJSON();
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({id:'u1'})});
  });
  const hash='#access_token=recovery-access&refresh_token=recovery-refresh&expires_in=3600&token_type=bearer&type=recovery';
  await page.goto(`${BASE}/tests/app-e2e/public-page-password-recovery-fixture.html${hash}`);
  await expect(page.locator('#ppeRecoveryForm')).toBeVisible();
  await expect(page.locator('#ppeAuthTitle')).toHaveText('새 비밀번호 설정');
  await page.locator('#ppeRecoveryPassword').fill('new-password-123');
  await page.locator('#ppeRecoveryPasswordConfirm').fill('new-password-123');
  await page.locator('#ppeRecoveryForm button[type="submit"]').click();
  await expect.poll(()=>updateBody).not.toBeNull();
  expect(updateBody.password).toBe('new-password-123');
  expect(await page.evaluate(()=>localStorage.getItem('kptu_public_editor_session_v1'))).toContain('recovery-access');
});

test('Web1 인증 모듈은 복구 기능을 Web2 세션과 분리한다',async()=>{
  const auth=await read('app/public-page-auth.js');
  expect(auth).toContain('/auth/v1/recover');
  expect(auth).toContain('resetPasswordForEmail');
  expect(auth).toContain('consumeRecoverySession');
  expect(auth).toContain('updatePassword');
  expect(auth).toContain('ppeAuthReset');
  expect(auth).toContain('ppeRecoveryForm');
  expect(auth).toContain('새 비밀번호');
  expect(auth).toContain("sessionKey:'kptu_public_editor_session_v1'");
  expect(auth).not.toContain('kptu_collab_session_v1');
});
