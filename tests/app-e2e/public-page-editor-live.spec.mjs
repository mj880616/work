import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

const BASE='http://127.0.0.1:8123';
const repoRoot=new URL('../../',import.meta.url);
const read=path=>readFile(new URL(path,repoRoot),'utf8');

async function openEditor(page){
  await page.goto(`${BASE}/tests/app-e2e/public-page-editor-fixture.html`);
  await expect(page.locator('#editPageBtn')).toBeVisible();
  await page.locator('#editPageBtn').click();
  await expect(page.locator('body')).toHaveClass(/ppe-editing/);
}

function updateCalls(page){
  return page.evaluate(()=>window.__ppeCalls.filter(x=>x.body?.action==='update'));
}

test('비로그인 Web1 수정은 Google 관리자 로그인을 시작한다',async({page})=>{
  await page.goto(`${BASE}/tests/app-e2e/public-page-editor-fixture.html?anon=1`);
  await page.locator('#editPageBtn').click();
  await expect.poll(()=>page.evaluate(()=>window.__ppeGoogleLogin||0)).toBe(1);
  await expect(page.locator('body')).not.toHaveClass(/ppe-editing/);
});

test('지정 관리자 세션은 서버 권한 확인 후 편집모드로 진입한다',async({page})=>{
  await page.goto(`${BASE}/tests/app-e2e/public-page-editor-fixture.html`);
  await page.locator('#editPageBtn').click();
  await expect.poll(()=>page.evaluate(()=>window.__ppeDebug?.())).toMatchObject({session:true,canEdit:true,alert:undefined,google:0,editor:true});
  const checks=await page.evaluate(()=>window.__ppeCalls.filter(x=>x.body?.action==='check'));
  expect(checks.length).toBeGreaterThanOrEqual(1);
  await expect.poll(()=>page.evaluate(()=>window.__ppeDebug?.())).toMatchObject({alert:undefined,paper:true,title:true});
  await page.evaluate(()=>window.KPTUPublicPageEditor.open());
  await expect.poll(()=>page.evaluate(()=>window.__ppeDebug?.())).toMatchObject({error:undefined,rejection:undefined});
  await expect(page.locator('body')).toHaveClass(/ppe-editing/);
  const checksAfter=await page.evaluate(()=>window.__ppeCalls.filter(x=>x.body?.action==='check'));
  expect(checksAfter.length).toBeGreaterThanOrEqual(1);
});

test('관리자가 아닌 계정은 편집모드로 진입하지 않는다',async({page})=>{
  await page.goto(`${BASE}/tests/app-e2e/public-page-editor-fixture.html?forbidden=1`);
  await page.locator('#editPageBtn').click();
  await expect.poll(()=>page.evaluate(()=>window.__ppeGoogleLogin||0)).toBe(1);
  await expect(page.locator('body')).not.toHaveClass(/ppe-editing/);
});

test('본문 섹션과 details 카드는 삭제할 수 있고 삭제 내용이 자동 저장된다',async({page})=>{
  await openEditor(page);
  await expect(page.locator('.pd-section > .ppe-block-delete')).toHaveCount(2);
  await expect(page.locator('.pd-details > .ppe-block-delete')).toHaveCount(1);
  page.once('dialog',d=>d.accept());
  await page.locator('.pd-section').first().locator(':scope > .ppe-block-delete').click();
  await expect(page.locator('.pd-body')).not.toContainText('첫 번째 칸');
  await expect.poll(async()=>updateCalls(page).then(x=>x.length),{timeout:5000}).toBeGreaterThanOrEqual(1);
  const calls=await updateCalls(page);
  expect(calls.at(-1).body.body).not.toContain('첫 번째 칸');
  expect(calls.at(-1).body.body).toContain('두 번째 칸');
});

test('문구 수정은 저장 버튼 없이 유휴시간 뒤 자동 저장되고 저장됨 상태를 표시한다',async({page})=>{
  await openEditor(page);
  await page.locator('.pd-title').fill('자동 저장 제목');
  await expect.poll(async()=>updateCalls(page).then(x=>x.length),{timeout:5000}).toBeGreaterThanOrEqual(1);
  const calls=await updateCalls(page);
  expect(calls.at(-1).body.title).toBe('자동 저장 제목');
  await expect(page.locator('#ppeLiveStatus')).toContainText('저장됨');
  await expect(page.locator('body')).toHaveClass(/ppe-editing/);
});

test('저장 중 새 수정이 생기면 요청을 겹치지 않고 마지막 상태를 후속 저장한다',async({page})=>{
  await openEditor(page);
  await page.evaluate(()=>{window.__ppeUpdateDelay=900});
  await page.locator('.pd-title').fill('첫 저장');
  await expect.poll(async()=>updateCalls(page).then(x=>x.length),{timeout:5000}).toBe(1);
  await page.locator('.pd-title').fill('최종 저장');
  await expect.poll(async()=>updateCalls(page).then(x=>x.length),{timeout:7000}).toBe(2);
  const calls=await updateCalls(page);
  expect(calls[0].body.title).toBe('첫 저장');
  expect(calls[1].body.title).toBe('최종 저장');
  await expect(page.locator('#ppeLiveStatus')).toContainText('저장됨');
});

test('일시적 저장 실패는 화면 내용을 유지하고 자동 재시도해 복구한다',async({page})=>{
  await openEditor(page);
  await page.evaluate(()=>{window.__ppeFailCount=1});
  await page.locator('.pd-title').fill('실패 후 복구');
  await expect.poll(async()=>updateCalls(page).then(x=>x.length),{timeout:8000}).toBeGreaterThanOrEqual(2);
  await expect(page.locator('.pd-title')).toHaveText('실패 후 복구');
  await expect(page.locator('#ppeLiveStatus')).toContainText('저장됨');
});

test('지속적 저장 실패 시 편집내용을 유지하고 다시 저장 버튼으로 복구할 수 있다',async({page})=>{
  await openEditor(page);
  await page.evaluate(()=>{window.__ppeFailUpdate=true});
  await page.locator('.pd-title').fill('수동 재시도 내용');
  await expect(page.locator('#ppeLiveRetry')).toBeVisible({timeout:9000});
  await expect(page.locator('.pd-title')).toHaveText('수동 재시도 내용');
  await page.evaluate(()=>{window.__ppeFailUpdate=false});
  await page.locator('#ppeLiveRetry').click();
  await expect(page.locator('#ppeLiveStatus')).toContainText('저장됨',{timeout:5000});
});

test('편집 종료는 미저장 변경을 먼저 저장한 뒤 렌더링 상태로 돌아간다',async({page})=>{
  await openEditor(page);
  await page.locator('.pd-title').fill('종료 직전 변경');
  await page.locator('#ppeLiveDone').click();
  await expect(page.locator('body')).not.toHaveClass(/ppe-editing/,{timeout:6000});
  await expect(page.locator('.pd-title')).toHaveText('종료 직전 변경');
  const calls=await updateCalls(page);
  expect(calls.at(-1).body.title).toBe('종료 직전 변경');
});

test('공개페이지 템플릿 최신 편집기 버전은 커스텀 김포·9호선 셸에도 자동 전파된다',async()=>{
  const template=await read('p/index.html');
  const meta=await read('scripts/public-page-meta.mjs');
  const editor=await read('app/public-page-editor.js');
  const auth=await read('app/web1-admin-auth.js');
  const targets=[
    'p/gimpo-publicization/index.html',
    'p/gimpo-publicization-audit/index.html',
    'p/gimpo-publicization-press-1008/index.html',
    'p/line9-publicization/index.html',
    'p/line9-publicization-audit/index.html'
  ];
  expect(template).toContain('public-page-editor.js?v=11');
  expect(editor).toContain("ADMIN_AUTH_SRC='/work/app/web1-admin-auth.js?v=1'");
  expect(editor).not.toContain('Web2에서 로그인');
  expect(auth).toContain("sessionKey:'kptu_web1_admin_session_v1'");
  expect(auth).not.toContain('kptu_collab_session_v1');
  expect(meta).toContain('templateEditorVersion(template)');
  expect(meta).toContain('applyEditorVersion(next,editorVersion)');
  for(const path of targets){
    const html=await read(path);
    expect(html,`${path} editor hook`).toContain('public-page-editor.js?v=');
  }
});
