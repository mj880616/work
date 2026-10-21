import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
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
 if(width<761){await page.locator('#mobileMenuTab').click();await page.locator('#mobileMenu [data-menu-write]').click();}
 else await page.locator('#appView>.app-nav [data-menu-write]').click();
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
  await q.locator('[data-quick-org]').click();await page.getByRole('dialog').getByRole('button',{name:'테스트 조직',exact:true}).first().click();
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
  await expect(sheet(page)).toBeHidden();
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
  await sheet(page).getByRole('button',{name:'테스트 조직',exact:true}).first().click();
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

test('attachments in the home input go only with a basket update',async({page})=>{
 const f=await fixture(page,1280),q=quick(page);
 await page.route(u=>u.origin===SB&&u.pathname==='/functions/v1/basket-files',r=>r.fulfill({json:{ok:true}}));
 await q.locator('#quickBasketFiles').setInputFiles({name:'메모.txt',mimeType:'text/plain',buffer:Buffer.from('합성')});
 await q.locator('[data-quick-input]').fill('첨부와 함께');
 await q.locator('[data-quick-big]').click();
 const e=editor(page);await expect(e).toBeVisible();
 await e.locator('[data-md-kind="note"]').click();await e.locator('[data-md-save-icon]').click();
 await expect(e.locator('.md-editor-status')).toHaveText('첨부는 업데이트(바구니)로만 저장돼요. 업데이트로 바꾸거나 첨부를 빼 주세요.');
 await e.locator('[data-md-kind-menu]').click();await sheet(page).getByRole('button',{name:'테스트 조직',exact:true}).first().click();
 await e.locator('[data-md-save-icon]').click();
 await expect(e.locator('.md-editor-status')).toHaveText('첨부는 바구니로만 저장돼요. ▾에서 바구니를 고르거나 첨부를 빼 주세요.');
 expect(f.notes).toEqual([]);expect(f.orgs).toEqual([]);
 await e.locator('[data-close="mdEditor"]').click();await expect(q.locator('[data-quick-input]')).toHaveValue('첨부와 함께');
 expect(f.errors).toEqual([]);
});
