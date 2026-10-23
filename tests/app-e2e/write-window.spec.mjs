import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {openWriteFromEntry} from './helpers/write-opener.mjs';
// BASKET-업데이트통합 PR 2: 쓰기·노트 [+]·홈 [크게] 어디서 열어도 같은 편집 창. 저장 아이콘 옆 [업데이트 ▾ | 노트],
// 업데이트는 ▾에서 고른 곳(없으면 바구니)으로, 노트는 노트로. 저장하면 닫힌다(저장하고 닫기). 저장 경로는 기존 그대로.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const quick=page=>page.locator('#homeView [data-home-quick]');
const editor=page=>page.locator('#mdEditor');
const sheet=page=>page.locator('#mdPlaceSheet');
async function fixture(page,width){
 await page.setViewportSize({width,height:844});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 const home=await openHome(page),notes=[],orgs=[],projects=[];
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',r=>{
  if(r.request().method()!=='POST')return r.fallback();
  const body=r.request().postDataJSON();notes.push(body);
  return r.fulfill({status:201,json:[{id:'new-'+notes.length,kind:'basket',occurred_at:'2026-10-06T01:00:00Z',updated_at:'2026-10-06T01:00:00Z',created_at:'2026-10-06T01:00:00Z',title:null,attachments:[],metadata:{},archived_at:null,ai_export_allowed:true,...body}]});
 });
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_suborganization_updates',r=>r.request().method()==='POST'?(orgs.push(r.request().postDataJSON()),r.fulfill({status:201,json:[]})):r.fallback());
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_project_progress_updates',r=>r.request().method()==='POST'?(projects.push(r.request().postDataJSON()),r.fulfill({status:201,json:[]})):r.fallback());
 return {...home,errors,notes,orgs,projects};
}
async function openWriter(page,width){
 await openWriteFromEntry(page,width);
 await expect(editor(page)).toBeVisible();return editor(page);
}
const fits=page=>page.evaluate(()=>{const h=document.querySelector('#mdEditor .md-editor-head');return !!h&&h.scrollWidth<=h.clientWidth&&document.documentElement.scrollWidth<=innerWidth;});

for(const width of [390,1280]){
 test(`home [크게]: same window with the input text; update with no place saves to the basket and closes ${width}`,async({page})=>{
  const f=await fixture(page,width),q=quick(page);
  await q.locator('[data-quick-input]').fill('홈에서 쓰던 업데이트');
  const big=q.locator('[data-quick-big]');await expect(big).toBeVisible();await expect(big).toHaveAccessibleName('큰 창에서 쓰기');
  // [할 일] hides it; [업데이트] shows it again.
  await q.locator('[data-quick-mode="task"]').click();await expect(big).toBeHidden();await q.locator('[data-quick-mode="update"]').click();await expect(big).toBeVisible();
  await big.click();
  const e=editor(page);await expect(e).toBeVisible();
  await expect(e.locator('.md-editor-text')).toHaveValue('홈에서 쓰던 업데이트');
  await expect(e.locator('[data-md-kind="update"]')).toHaveAttribute('aria-pressed','true');
  await expect(e.locator('[data-md-save-icon]')).toHaveAccessibleName('바구니에 새 업데이트로 저장');
  expect(await fits(page)).toBe(true);
  // Typing in the window goes back to the input; closing without saving keeps it there.
  await e.locator('.md-editor-text').fill('큰 창에서 고친 업데이트');
  await e.locator('[data-close="mdEditor"]').click();await expect(page.locator('#mdEditor')).toHaveCount(0);
  await expect(q.locator('[data-quick-input]')).toHaveValue('큰 창에서 고친 업데이트');
  expect(f.notes).toEqual([]);
  await big.click();await expect(e.locator('.md-editor-text')).toHaveValue('큰 창에서 고친 업데이트');
  await e.locator('[data-md-save-icon]').click();
  await expect(page.locator('#mdEditor')).toHaveCount(0);
  await expect(page.locator('#toast')).toContainText('바구니에 저장했어요.');
  await expect(q.locator('[data-quick-input]')).toHaveValue('');
  expect(f.notes).toEqual([{workspace_id:'w',raw_text:'큰 창에서 고친 업데이트'}]);expect(f.orgs).toEqual([]);expect(f.projects).toEqual([]);
  expect(f.errors).toEqual([]);
 });

 test(`home [크게]: a place chosen at home comes along; ▾ in the window changes it; organization and project records ${width}`,async({page})=>{
  const f=await fixture(page,width),q=quick(page);
  await q.locator('[data-quick-input]').fill('조직 기록');
  await q.locator('[data-quick-org]').click();await page.getByRole('dialog').getByRole('button',{name:'테스트 조직',exact:true}).first().click();await page.getByRole('dialog').getByRole('button',{name:'저장',exact:true}).click();
  await expect(q).toHaveAttribute('data-mode','update');
  await q.locator('[data-quick-big]').click();
  const e=editor(page);await expect(e).toBeVisible();
  await expect(e.locator('[data-md-kind="update"]')).toHaveText('테스트 조직');
  await expect(e.locator('[data-md-kind-menu]')).toHaveAccessibleName('기록할 곳 선택: 테스트 조직');
  await expect(e.locator('[data-md-save-icon]')).toHaveAccessibleName('테스트 조직 기록으로 저장');
  await e.locator('[data-md-save-icon]').click();
  await expect(page.locator('#mdEditor')).toHaveCount(0);
  expect(f.orgs).toEqual([{organization_id:'o',raw_text:'조직 기록',created_by:'home-test'}]);expect(f.notes).toEqual([]);
  // A project picked inside the window: the home input follows the same place.
  await q.locator('[data-quick-input]').fill('프로젝트 진행');
  await q.locator('[data-quick-big]').click();await expect(e).toBeVisible();
  await e.locator('[data-md-kind-menu]').click();await expect(sheet(page)).toBeVisible();
  await expect(sheet(page).locator('[data-sheet-basket] button')).toHaveText('바구니(미분류)');
  await sheet(page).locator('[data-sheet-projects]').getByRole('button',{name:'테스트 프로젝트',exact:true}).click();
  // UPD-여러곳고르기: the press only marks it; [저장] keeps it (the home input went back to the basket after the add above).
  await expect(sheet(page)).toBeVisible();await expect(sheet(page).locator('[data-sheet-count]')).toHaveText('1곳 선택됨');
  await sheet(page).getByRole('button',{name:'저장',exact:true}).click();await expect(sheet(page)).toBeHidden();
  await expect(e.locator('[data-md-kind="update"]')).toHaveText('테스트 프로젝트');
  await expect(e.locator('.md-editor-status')).toHaveText('테스트 프로젝트 기록에 저장돼요.');
  await e.locator('[data-md-save-icon]').click();await expect(page.locator('#mdEditor')).toHaveCount(0);
  expect(f.projects).toHaveLength(1);expect(f.projects[0]).toMatchObject({project_id:'p',workstream_id:null,author_id:'home-test',summary:'프로젝트 진행'});
  // UI-기록할곳되돌리기: after the add, the home input goes back to the basket; the project just used is first on the 최근 line.
  await expect(q.locator('[data-quick-org]')).toHaveAccessibleName('기록할 곳 선택');
  const home=page.locator('#homeChoiceSheet');await q.locator('[data-quick-org]').click();await expect(home).toBeVisible();
  await expect(home.locator('[data-sheet-recent] [data-sheet-value]').first()).toHaveText('테스트 프로젝트');
  await expect(home.locator('[data-sheet-basket] button')).toHaveAttribute('aria-pressed','true');
  await page.keyboard.press('Escape');await expect(home).toBeHidden();
  expect(f.errors).toEqual([]);
 });

 test(`menu [쓰기]: [업데이트 ▾] picks an organization; [노트] shows a title line and saves a note ${width}`,async({page})=>{
  const f=await fixture(page,width);
  const e=await openWriter(page,width);
  await expect(e.locator('[data-md-kind="update"]')).toHaveAttribute('aria-pressed','true');
  await expect(e.locator('[data-md-title]')).toBeHidden();
  await e.locator('.md-editor-text').fill('쓰기에서 조직으로');
  await e.locator('[data-md-kind-menu]').click();await expect(sheet(page)).toBeVisible();
  await sheet(page).getByRole('button',{name:'테스트 조직',exact:true}).first().click();await sheet(page).getByRole('button',{name:'저장',exact:true}).click();
  await expect(e.locator('[data-md-kind="update"]')).toHaveText('테스트 조직');
  expect(await fits(page)).toBe(true);
  await e.locator('[data-md-save-icon]').click();await expect(page.locator('#mdEditor')).toHaveCount(0);
  await expect(page.locator('#toast')).toContainText('테스트 조직 기록에 저장했어요.');
  expect(f.orgs).toEqual([{organization_id:'o',raw_text:'쓰기에서 조직으로',created_by:'home-test'}]);expect(f.notes).toEqual([]);
  // The next [쓰기] starts again at the basket.
  const again=await openWriter(page,width);
  await expect(again.locator('[data-md-kind="update"]')).toHaveText('업데이트');
  await again.locator('[data-md-kind="note"]').click();
  await expect(again.locator('[data-md-title]')).toBeVisible();await expect(again.locator('[data-md-save-icon]')).toHaveAccessibleName('새 노트로 저장');
  await again.locator('[data-md-title]').fill('노트 제목');await again.locator('.md-editor-text').fill('노트 본문');
  await again.locator('[data-md-save-icon]').click();await expect(page.locator('#mdEditor')).toHaveCount(0);
  // NOTE-마크다운선택: a new note is saved with 마크다운 off.
  expect(f.notes).toEqual([{workspace_id:'w',kind:'note',title:'노트 제목',raw_text:'노트 본문',metadata:{markdown:false}}]);
  await expect.poll(()=>page.evaluate(()=>window.KPTURouter.current)).toBe('basket');
  expect(f.errors).toEqual([]);
 });
}

test('attachments in the home input stay when an organization is chosen in the window, and go with a note',async({page})=>{
 const f=await fixture(page,1280),q=quick(page),uploads=[];
 await page.route(u=>u.origin===SB&&u.pathname==='/functions/v1/basket-files',r=>{const raw=r.request().postDataBuffer()?.toString('utf8')||'';uploads.push(raw);const id=raw.match(/name="note_id"\r\n\r\n([^\r]+)/)?.[1];return r.fulfill({json:{ok:true,note_id:id,attachments:[{drive_file_id:'f1',file_name:'메모.txt',mime_type:'text/plain',size_bytes:6}]}});});
 await q.locator('#quickBasketFiles').setInputFiles({name:'메모.txt',mimeType:'text/plain',buffer:Buffer.from('합성')});
 await q.locator('[data-quick-input]').fill('첨부와 함께');
 await q.locator('[data-quick-big]').click();
 const e=editor(page);await expect(e).toBeVisible();
 await e.locator('[data-md-kind-menu]').click();await sheet(page).getByRole('button',{name:'테스트 조직',exact:true}).first().click();await sheet(page).getByRole('button',{name:'저장',exact:true}).click();
 // BUG-업데이트첨부연결: the file stays with the organization chosen (saving there: update-attach-target.spec.mjs).
 await expect(e.locator('[data-basket-file]')).toHaveCount(1);
 expect(f.notes).toEqual([]);expect(f.orgs).toEqual([]);expect(uploads).toEqual([]);
 // NOTE-파일붙이기: as a note, the note is made first and the home input's file goes up with its id; the home input empties.
 await e.locator('[data-md-kind="note"]').click();
 await expect(e.locator('.md-editor-tools [data-basket-clip]')).toBeVisible();
 await e.locator('[data-md-save-icon]').click();await expect(page.locator('#mdEditor')).toHaveCount(0);
 expect(f.notes).toEqual([{workspace_id:'w',kind:'note',title:'첨부와 함께',raw_text:'첨부와 함께',metadata:{markdown:false}}]);
 expect(uploads).toHaveLength(1);expect(uploads[0]).toContain('filename="메모.txt"');expect(uploads[0]).toMatch(/name="note_id"\r\n\r\n/);expect(uploads[0]).not.toContain('name="raw_text"');
 await expect(q.locator('[data-quick-input]')).toHaveValue('');await expect(q.locator('[data-basket-file]')).toHaveCount(0);
 expect(f.errors).toEqual([]);
});
