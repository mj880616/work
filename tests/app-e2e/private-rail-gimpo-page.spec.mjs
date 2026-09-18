import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

const BASE='http://127.0.0.1:8123';
const repoRoot=new URL('../../',import.meta.url);
const read=path=>readFile(new URL(path,repoRoot),'utf8');

test('민자철도 사업현황에 김포·9호선 안전인력 투쟁 바로가기가 노출된다', async () => {
  const html = await read('private-rail/index.html');
  expect(html).toContain('/work/p/gimpo-publicization/');
  expect(html).toContain('김포 공영화 및 안전인력 확충 투쟁');
  expect(html).toContain('/work/p/line9-publicization/');
  expect(html).toContain('9호선 공영화 및 안전인력 확충 투쟁');
});

test('김포 허브와 하위페이지 명칭을 공영화 및 안전인력 확충 투쟁으로 통일한다', async () => {
  const hub = await read('p/gimpo-publicization/index.html');
  const audit = await read('p/gimpo-publicization-audit/index.html');
  const press = await read('p/gimpo-publicization-press-1008/index.html');
  expect(hub).toContain('<title>김포 공영화 및 안전인력 확충 투쟁</title>');
  expect(hub).toContain('aria-label="김포 공영화 및 안전인력 확충 투쟁 영역"');
  expect(audit).toContain('← 김포 공영화 및 안전인력 확충 투쟁');
  expect(press).toContain('← 김포 공영화 및 안전인력 확충 투쟁');
});

test('김포 허브는 3개 대응영역과 행감·기자회견 하위페이지를 제공한다', async () => {
  const hub = await read('p/gimpo-publicization/index.html');
  expect(hub).toContain('하반기 임단투');
  expect(hub).toContain('시의회 대응');
  expect(hub).toContain('언론 대응');
  expect(hub).toContain('/work/p/gimpo-publicization-audit/');
  expect(hub).toContain('/work/p/gimpo-publicization-press-1008/');
  expect(hub).toContain('10/8 기자회견 준비페이지');
});

test('9호선 투쟁 허브는 임단투·행감·언론현장 대응을 연결한다', async () => {
  const hub = await read('p/line9-publicization/index.html');
  expect(hub).toContain('<title>9호선 공영화 및 안전인력 확충 투쟁</title>');
  expect(hub).toContain('하반기 임단투');
  expect(hub).toContain('서울시의회·행정사무감사 대응');
  expect(hub).toContain('언론·현장 대응');
  expect(hub).toContain('/work/p/line9-publicization-audit/');
});

test('9호선 1단계 행감 하위페이지는 독립 문서·상위 복귀·편집 인쇄 구조를 제공한다', async () => {
  const html = await read('p/line9-publicization-audit/index.html');
  expect(html).toContain('name="kptu-page-slug" content="line9-publicization-audit"');
  expect(html).toContain('<title>9호선 1단계 서울시 행정사무감사 대응</title>');
  expect(html).toContain('← 9호선 공영화 및 안전인력 확충 투쟁');
  expect(html).toContain('id="editPageBtn"');
  expect(html).toContain('id="printPageBtn"');
});

test('공개페이지 편집기는 Google 관리자 인증과 서버 RLS 권한검증을 사용한다', async () => {
  const editor=await read('app/public-page-editor.js');
  const auth=await read('app/web1-admin-auth.js');
  expect(editor).toContain("ADMIN_AUTH_SRC='/work/app/web1-admin-auth.js?v=1'");
  expect(editor).toContain('window.KPTUWeb1AdminAuth');
  expect(editor).toContain("'/functions/v1/public-page-edit'");
  expect(editor).not.toContain('window.KPTURuntime');
  expect(auth).toContain("provider:'google'");
  expect(auth).not.toContain('grant_type=password');
});

test('비로그인 공개 열람자의 수정은 Google 관리자 로그인을 시작한다',async({page})=>{
  await page.goto(`${BASE}/tests/app-e2e/public-page-editor-fixture.html?anon=1`);
  await expect(page.locator('#editPageBtn')).toBeVisible();
  await page.locator('#editPageBtn').click();
  await expect.poll(()=>page.evaluate(()=>window.__ppeGoogleLogin||0)).toBe(1);
  await expect(page.locator('body')).not.toHaveClass(/ppe-editing/);
});

test('관리자가 아닌 Google 계정은 편집모드로 진입하지 않는다',async({page})=>{
  await page.goto(`${BASE}/tests/app-e2e/public-page-editor-fixture.html?forbidden=1`);
  await page.locator('#editPageBtn').click();
  await expect.poll(()=>page.evaluate(()=>window.__ppeGoogleLogin||0)).toBe(1);
  await expect(page.locator('body')).not.toHaveClass(/ppe-editing/);
});

test('public-page-edit 함수는 지정 관리자 JWT·DB 편집권한·app_pages RLS를 모두 확인한다',async()=>{
  const fn=await read('supabase/functions/public-page-edit/index.ts');
  expect(fn).toContain("req.headers.get('Authorization')");
  expect(fn).toContain('WEB1_ADMIN_USER_ID');
  expect(fn).toContain('await db.auth.getUser()');
  expect(fn).toContain("rpc('app_can_edit_page_rpc'");
  expect(fn).toContain("from('app_pages')");
  expect(fn).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
  expect(fn).not.toContain('0822');
});

test('국회토론회와 국감 페이지의 사업현황 돌아가기 버튼은 좌측 고정 규칙을 쓴다', async () => {
  const forumTools = await read('app/forum-flow-polish.js');
  const questionTools = await read('assets/private-rail-question-tools.js');
  expect(forumTools).toContain("a.className='print-btn back-link'");
  expect(forumTools).toContain("a.style.marginRight='auto'");
  expect(questionTools).toContain('private-rail-question-back back-link');
  expect(questionTools).toContain('margin-right:auto!important');
  expect(questionTools).toContain('bar.append(back,stat,edit,cancel,print)');
});

test('국감 페이지 도구줄은 현재 question-0912 페이지의 제목 위에 동적으로 배치된다', async () => {
  const html = await read('private-rail/question-0912/index.html');
  const questionTools = await read('assets/private-rail-question-tools.js');
  expect(html).toContain('/work/app/web1-toolbar.js?v=1');
  expect(html).toContain('class="hero"');
  const toolbar=await read('app/web1-toolbar.js');
  expect(toolbar).toContain("document.querySelector('h1,.hero,.pd-hero')");
  expect(toolbar).toContain('target.parentNode.insertBefore(bar,target)');
});