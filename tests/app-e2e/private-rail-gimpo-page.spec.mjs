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

test('공개페이지 편집기는 Web1 독립 세션으로 로그인하고 서버 RLS 권한검증을 유지한다', async () => {
  const editor = await read('app/public-page-editor.js');
  const auth = await read('app/public-page-auth.js');
  expect(editor).toContain("document.querySelector('.print-tools,.tools')");
  expect(editor).toContain("PUBLIC_AUTH_SRC='/work/app/public-page-auth.js?v=1'");
  expect(editor).toContain('window.KPTUPublicAuth');
  expect(editor).toContain("'/functions/v1/public-page-edit'");
  expect(editor).not.toContain('window.KPTURuntime');
  expect(editor).not.toContain('Web2에서 로그인');
  expect(auth).toContain("sessionKey:'kptu_public_editor_session_v1'");
  expect(auth).not.toContain('kptu_collab_session_v1');
  expect(auth).toContain("/auth/v1/token?grant_type=password");
  expect(auth).toContain("/auth/v1/token?grant_type=refresh_token");
  expect(editor).not.toContain('마스터 비밀번호');
});

test('비로그인 공개 열람자도 수정 진입 버튼을 볼 수 있고 클릭하면 편집자 로그인을 연다', async ({page}) => {
  await page.goto(`${BASE}/tests/app-e2e/public-page-editor-fixture.html?anon=1`);
  await expect(page.locator('#editPageBtn')).toBeVisible();
  expect(await page.evaluate(()=>window.__ppeCalls)).toEqual([]);
  await page.locator('#editPageBtn').click();
  await expect(page.locator('#ppeAuthDialog')).toBeVisible();
  await expect(page.locator('body')).not.toHaveClass(/ppe-editing/);
});

test('Web1 세션은 있어도 페이지 수정권한이 없으면 로그인 화면에서 권한 부족을 안내한다', async ({page}) => {
  await page.goto(`${BASE}/tests/app-e2e/public-page-editor-fixture.html?forbidden=1`);
  await expect(page.locator('#editPageBtn')).toBeVisible();
  await page.locator('#editPageBtn').click();
  await expect(page.locator('#ppeAuthDialog')).toBeVisible();
  await expect(page.locator('#ppeAuthError')).toContainText('수정 권한');
  await expect(page.locator('body')).not.toHaveClass(/ppe-editing/);
});

test('public-page-edit 함수는 사용자 JWT·DB 편집권한·app_pages RLS로 수정하고 공용 비밀번호·service role을 사용하지 않는다', async () => {
  const fn = await read('supabase/functions/public-page-edit/index.ts');
  expect(fn).toContain("req.headers.get('Authorization')");
  expect(fn).toContain("Deno.env.get('SUPABASE_ANON_KEY')");
  expect(fn).toContain("rpc('app_can_edit_page_rpc'");
  expect(fn).toContain("from('app_pages')");
  expect(fn).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
  expect(fn).not.toContain('0822');
  expect(fn).not.toContain('password');
});

test('공개페이지 수정·저장은 인증된 공통 편집 경로로 완료되고 저장값을 다시 렌더링한다', async ({page}) => {
  await page.goto(`${BASE}/tests/app-e2e/public-page-editor-fixture.html`);
  await expect(page.locator('#editPageBtn')).toBeVisible();
  await page.locator('#editPageBtn').click();
  await expect(page.locator('body')).toHaveClass(/ppe-editing/);
  await page.locator('.pd-title').fill('변경된 제목');
  await page.locator('.pd-summary').fill('변경된 요약');
  await page.locator('.pd-body p').fill('변경된 본문');
  await page.locator('#ppeLiveSave').click();
  await expect(page.locator('body')).not.toHaveClass(/ppe-editing/);
  await expect(page.locator('.pd-title')).toHaveText('변경된 제목');
  await expect(page.locator('.pd-body p')).toContainText('변경된 본문');
  const updateCall=await page.evaluate(()=>window.__ppeCalls.find(x=>x.body?.action==='update'));
  expect(updateCall?.path).toBe('/functions/v1/public-page-edit');
  expect(updateCall?.body?.title).toBe('변경된 제목');
  expect(updateCall?.body?.summary).toBe('변경된 요약');
  expect(updateCall?.body?.body).toContain('변경된 본문');
});

test('공개페이지 저장 실패 시 수정내용을 버리지 않고 편집상태를 유지해 재시도할 수 있다', async ({page}) => {
  await page.goto(`${BASE}/tests/app-e2e/public-page-editor-fixture.html`);
  await page.evaluate(()=>{window.__ppeFailUpdate=true});
  await expect(page.locator('#editPageBtn')).toBeVisible();
  await page.locator('#editPageBtn').click();
  await page.locator('.pd-title').fill('실패해도 남을 제목');
  await page.locator('#ppeLiveSave').click();
  await expect(page.locator('body')).toHaveClass(/ppe-editing/);
  await expect(page.locator('.pd-title')).toHaveText('실패해도 남을 제목');
  await expect(page.locator('#ppeLiveStatus')).toContainText('의도된 저장 실패');
  await expect(page.locator('#ppeLiveSave')).toBeEnabled();
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

test('국감 페이지 도구줄은 제목 위에 배치된다', async () => {
  const html = await read('private-rail/audit-question/index.html');
  const toolsIndex=html.indexOf('id="privateRailQuestionTools"');
  const paperIndex=html.indexOf('id="privateRailQuestionPaper"');
  expect(toolsIndex).toBeGreaterThan(-1);
  expect(paperIndex).toBeGreaterThan(-1);
  expect(toolsIndex).toBeLessThan(paperIndex);
});