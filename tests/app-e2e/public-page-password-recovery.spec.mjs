import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
const repoRoot=new URL('../../',import.meta.url);
const read=path=>readFile(new URL(path,repoRoot),'utf8');

test('Web1 편집 인증은 폐기된 비밀번호 복구 대신 Google OAuth를 사용한다',async()=>{
 const auth=await read('app/web1-admin-auth.js');
 const editor=await read('app/public-page-editor.js');
 expect(auth).toContain("provider:'google'");
 expect(auth).toContain('/auth/v1/authorize?provider=google');
 expect(auth).not.toContain('/auth/v1/recover');
 expect(auth).not.toContain('grant_type=password');
 expect(editor).toContain('web1-admin-auth.js?v=1');
 expect(editor).not.toContain('public-page-auth.js');
});

test('과거 Web1 비밀번호 인증 모듈은 현재 편집기에서 참조하지 않는다',async()=>{
 const editor=await read('app/public-page-editor.js');
 expect(editor).not.toContain('KPTUPublicAuth');
 expect(editor).not.toContain('ppeAuthReset');
});