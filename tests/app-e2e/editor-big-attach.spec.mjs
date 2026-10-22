import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
import {expectProjectDetail} from './helpers/project-detail.mjs';
import {openWriteFromEntry} from './helpers/write-opener.mjs';
// UI-크게첨부(2026-10-20 사용자 결정): (a) 조직 상세·프로젝트 상세의 업데이트 입력에도 [크게]. 같은 큰 편집 창(write-window.js)이
// 그 조직·프로젝트를 미리 고른 채 열리고, 저장하면 그 조직·프로젝트 기록으로 저장된 뒤 닫힌다. (b) 큰 편집 창에서도 [📎 첨부]
// (바구니 첨부 부품 basket-upload.js 그대로). 첨부는 바구니로 저장할 때만 — 조직·프로젝트 기록이나 노트로 저장할 때 첨부가 있으면
// 기존 안내. DB·Edge 변경 없음(기존 저장 경로만 부른다).
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const editor=page=>page.locator('#mdEditor');
async function fixture(page,width){
 await page.setViewportSize({width,height:844});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 const home=await openHome(page),notes=[],orgs=[],projects=[],uploads=[];
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',r=>{
  if(r.request().method()!=='POST')return r.fallback();
  const body=r.request().postDataJSON();notes.push(body);
  return r.fulfill({status:201,json:[{id:'new-'+notes.length,kind:body.kind||'basket',occurred_at:'2026-10-06T01:00:00Z',updated_at:'2026-10-06T01:00:00Z',created_at:'2026-10-06T01:00:00Z',title:null,attachments:[],metadata:{},archived_at:null,ai_export_allowed:true,...body}]});
 });
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_suborganization_updates',r=>r.request().method()==='POST'?(orgs.push(r.request().postDataJSON()),r.fulfill({status:201,json:[]})):r.fallback());
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_project_progress_updates',r=>r.request().method()==='POST'?(projects.push(r.request().postDataJSON()),r.fulfill({status:201,json:[]})):r.fallback());
 await page.route(u=>u.origin===SB&&u.pathname==='/functions/v1/basket-files',r=>{const body=r.request().postDataBuffer()?.toString('latin1')||'';uploads.push(body);return r.fulfill({json:{ok:true,note_id:'up-1',attachments:[{file_name:'a.txt',size_bytes:1,drive_file_id:'file_1',mime_type:'text/plain'}]}});});
 return {...home,errors,notes,orgs,projects,uploads};
}
const fits=page=>page.evaluate(()=>{const h=document.querySelector('#mdEditor .md-editor-head');return !!h&&h.scrollWidth<=h.clientWidth&&document.documentElement.scrollWidth<=innerWidth;});
async function chooseFile(page,trigger,name='a.txt'){
 const chooser=page.waitForEvent('filechooser');await trigger.click();
 await (await chooser).setFiles([{name,mimeType:'text/plain',buffer:Buffer.from('a')}]);
}

for(const width of [390,1280]){
 test(`조직 상세 [크게]: 그 조직이 고른 채 열리고, 저장하면 그 조직 기록으로 저장·닫힘 ${width}`,async({page})=>{
  const f=await fixture(page,width);
  await clickView(page,'team');await page.locator('[data-so-org="o"]').first().click();
  const modal=page.locator('#wdModal');await expect(modal).toBeVisible();await expect(page.locator('#wdTitle')).toHaveText('테스트 조직');
  const big=page.locator('#wdInboxBig');await expect(big).toBeVisible();await expect(big).toHaveText('크게');
  // The small input row: [크게] beside [저장], same height, one line, nothing cut off.
  const [b,s]=await Promise.all([big.boundingBox(),page.locator('#wdInboxSave').boundingBox()]);
  expect(Math.abs(b.y-s.y)).toBeLessThanOrEqual(1);expect(Math.abs(b.height-s.height)).toBeLessThanOrEqual(1);expect(b.x+b.width).toBeLessThanOrEqual(s.x);
  expect(await big.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await page.locator('#wdInboxText').fill('통화 내용 첫 줄\n둘째 줄');
  await big.click();
  const e=editor(page);await expect(e).toBeVisible();
  await expect(e.locator('.md-editor-text')).toHaveValue('통화 내용 첫 줄\n둘째 줄');
  await expect(e.locator('[data-md-kind="update"]')).toHaveText('테스트 조직');
  await expect(e.locator('[data-md-kind="update"]')).toHaveAttribute('aria-pressed','true');
  await expect(e.locator('[data-md-save-icon]')).toHaveAccessibleName('테스트 조직 기록으로 저장');
  expect(await fits(page)).toBe(true);
  // Closing without saving hands the text back to the small input.
  await e.locator('.md-editor-text').fill('큰 창에서 고친 기록');
  await e.locator('[data-close="mdEditor"]').click();await expect(page.locator('#mdEditor')).toHaveCount(0);
  await expect(page.locator('#wdInboxText')).toHaveValue('큰 창에서 고친 기록');expect(f.orgs).toEqual([]);
  // Save: this organization's record (the same body as [저장]), the window closes and the input empties.
  await big.click();await expect(e).toBeVisible();
  await e.locator('[data-md-save-icon]').click();
  await expect(page.locator('#mdEditor')).toHaveCount(0);
  await expect(page.locator('#toast')).toContainText('테스트 조직 기록에 저장했어요.');
  expect(f.orgs).toEqual([{organization_id:'o',raw_text:'큰 창에서 고친 기록',created_by:'home-test'}]);expect(f.notes).toEqual([]);
  await expect(page.locator('#wdInboxText')).toHaveValue('');await expect(modal).toBeVisible();
  expect(f.errors).toEqual([]);
 });

 test(`프로젝트 상세 [크게]: 그 프로젝트가 고른 채 열리고, 저장하면 그 프로젝트 기록으로 저장·닫힘 ${width}`,async({page})=>{
  const f=await fixture(page,width);
  await clickView(page,'projects');await page.locator('#projectGrid .ps3-plist [data-ps3-project="p"]').click();
  await expectProjectDetail(page,'p');await expect(page.locator('#ps3Title')).toContainText('테스트 프로젝트');
  const form=page.locator('#ps3-progress [data-ps3-record-input]'),big=form.locator('[data-ps3-record-big]');
  await expect(big).toBeVisible();await expect(big).toHaveAccessibleName('큰 창에서 쓰기');
  const [i,b,s]=await Promise.all([form.locator('input').boundingBox(),big.boundingBox(),form.getByRole('button',{name:'기록',exact:true}).boundingBox()]);
  // PRJ-화면다듬기: the icon sits inside the input, [기록] stays beside it.
  expect(Math.abs(s.y-i.y)).toBeLessThanOrEqual(1);expect(b.x).toBeGreaterThanOrEqual(i.x);expect(b.x+b.width).toBeLessThanOrEqual(i.x+i.width+1);expect(i.x+i.width).toBeLessThanOrEqual(s.x);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await form.locator('input').fill('발제자 섭외');
  await big.click();
  const e=editor(page);await expect(e).toBeVisible();
  await expect(e.locator('.md-editor-text')).toHaveValue('발제자 섭외');
  await expect(e.locator('[data-md-kind="update"]')).toHaveText('테스트 프로젝트');
  await expect(e.locator('[data-md-save-icon]')).toHaveAccessibleName('테스트 프로젝트 기록으로 저장');
  expect(await fits(page)).toBe(true);
  // Several lines closed without saving come back to [크게] as written (the small input shows them on one line).
  await e.locator('.md-editor-text').fill('발제자 섭외\n자료집 마감');
  await e.locator('[data-close="mdEditor"]').click();await expect(page.locator('#mdEditor')).toHaveCount(0);
  await expect(form.locator('input')).toHaveValue('발제자 섭외 자료집 마감');expect(f.projects).toEqual([]);
  await big.click();await expect(e.locator('.md-editor-text')).toHaveValue('발제자 섭외\n자료집 마감');
  await e.locator('[data-md-save-icon]').click();
  await expect(page.locator('#mdEditor')).toHaveCount(0);
  await expect(page.locator('#toast')).toContainText('테스트 프로젝트 기록에 저장했어요.');
  expect(f.projects).toHaveLength(1);expect(f.projects[0]).toMatchObject({project_id:'p',workstream_id:null,author_id:'home-test',summary:'발제자 섭외\n자료집 마감',effective_on:'2026-10-06'});
  await expect(form.locator('input')).toHaveValue('');await expect(page.locator('#ps3DetailModal')).toBeVisible();
  expect(f.errors).toEqual([]);
 });

 test(`큰 편집 창 [📎 첨부]: 바구니(또는 노트)로 저장할 때만, 조직 기록으로 저장하면 기존 안내 ${width}`,async({page})=>{
  const f=await fixture(page,width);
  // Menu [쓰기]: the window's own file batch.
  await openWriteFromEntry(page,width);
  const e=editor(page);await expect(e).toBeVisible();
  const clip=e.getByRole('button',{name:'파일 첨부',exact:true});await expect(clip).toBeVisible();
  // The same small button as the head (32px painted, 44px touch area) under the text, not covering it.
  const cb=await clip.boundingBox(),text=await e.locator('.md-editor-text').boundingBox();
  expect(cb.height).toBe(32);expect(await clip.evaluate(el=>parseFloat(getComputedStyle(el,'::after').height))).toBe(44);expect(cb.y).toBeGreaterThanOrEqual(text.y+text.height-1);
  // NOTE-파일붙이기: [노트] moves the same [📎 첨부] to the end of the format row; [업데이트] puts it back under the text.
  await e.locator('[data-md-kind="note"]').click();await expect(e.locator('.md-editor-tools').getByRole('button',{name:'파일 첨부',exact:true})).toBeVisible();
  await e.locator('[data-md-kind="update"]').click();await expect(e.locator('.md-editor-attach').getByRole('button',{name:'파일 첨부',exact:true})).toBeVisible();
  await e.locator('.md-editor-text').fill('파일과 함께 쓰는 업데이트');
  await chooseFile(page,clip);
  await expect(clip.locator('[data-basket-count]')).toHaveText('1');await expect(e.locator('[data-basket-file]')).toHaveCount(1);
  // An organization record with a file: the existing rule, nothing saved.
  await e.locator('[data-md-kind-menu]').click();await page.locator('#mdPlaceSheet').getByRole('button',{name:'테스트 조직',exact:true}).first().click();await page.locator('#mdPlaceSheet').getByRole('button',{name:'저장',exact:true}).click();
  await expect(e.locator('[data-md-kind="update"]')).toHaveText('테스트 조직');
  await e.locator('[data-md-save-icon]').click();
  await expect(e.locator('.md-editor-status')).toHaveText('첨부는 바구니로만 저장돼요. ▾에서 바구니를 고르거나 첨부를 빼 주세요.');
  expect([f.orgs,f.notes,f.uploads.length]).toEqual([[],[],0]);
  // Back to the basket: the text and file go through the basket upload path (one request with the text), then it closes.
  await e.locator('[data-md-kind="update"]').click();
  await e.locator('[data-md-kind-menu]').click();await page.locator('#mdPlaceSheet [data-sheet-basket] button').click();await page.locator('#mdPlaceSheet').getByRole('button',{name:'저장',exact:true}).click();
  await expect(e.locator('[data-md-save-icon]')).toHaveAccessibleName('바구니에 새 업데이트로 저장');
  await e.locator('[data-md-save-icon]').click();
  await expect(page.locator('#mdEditor')).toHaveCount(0);
  await expect(page.locator('#toast')).toContainText('바구니에 저장했어요.');
  expect(f.uploads).toHaveLength(1);expect(f.uploads[0]).toContain('name="raw_text"');expect(f.uploads[0]).toContain('filename="a.txt"');
  expect(f.notes).toEqual([]);expect(f.orgs).toEqual([]);
  expect(f.errors).toEqual([]);
 });

 test(`홈 [크게] [📎 첨부]: 홈 입력의 파일과 같은 묶음, 창에서 고른 파일이 홈 입력에도 보임 ${width}`,async({page})=>{
  const f=await fixture(page,width),q=page.locator('#homeView [data-home-quick]');
  await q.locator('[data-quick-input]').fill('홈 업데이트');
  await q.locator('[data-quick-big]').click();
  const e=editor(page);await expect(e).toBeVisible();
  const clip=e.getByRole('button',{name:'파일 첨부',exact:true});
  await chooseFile(page,clip,'b.txt');
  await expect(clip.locator('[data-basket-count]')).toHaveText('1');
  // Closing without saving: the file stays with the home input (one batch).
  await e.locator('[data-close="mdEditor"]').click();await expect(page.locator('#mdEditor')).toHaveCount(0);
  await expect(q.getByRole('button',{name:'파일 첨부',exact:true}).locator('[data-basket-count]')).toHaveText('1');
  await q.locator('[data-quick-big]').click();await expect(e).toBeVisible();
  await expect(e.locator('[data-basket-file]')).toHaveCount(1);
  await e.locator('[data-md-save-icon]').click();
  await expect(page.locator('#mdEditor')).toHaveCount(0);
  expect(f.uploads).toHaveLength(1);expect(f.uploads[0]).toContain('filename="b.txt"');
  expect(f.errors).toEqual([]);
 });
}

for(const width of [390,1280])test(`바구니 업데이트 수정 [큰 창에서 수정] [📎 첨부]: 수정 화면과 같은 파일 선택, 저장은 기존 [첨부 저장] ${width}`,async({page})=>{
 const f=await fixture(page,width);
 await page.route('**/rest/v1/app_notes**',r=>r.request().method()==='GET'?r.fulfill({json:[{id:'n',kind:'basket',raw_text:'고칠 업데이트',occurred_at:'2026-10-06',attachments:[]}]}):r.fallback());
 await page.locator('#homeView [data-goto="basket"]:visible,.mobile-tabs [data-view="basket"]:visible').click();
 await page.locator('[data-basket-row="n"]').click();
 await page.locator('[data-basket-note-more]').click();await page.locator('[data-basket-edit]').click();
 const detail=page.locator('[data-basket-detail]');
 await detail.locator('[data-basket-big-write]').click();
 const e=editor(page);await expect(e).toBeVisible();
 const clip=e.getByRole('button',{name:'파일 첨부',exact:true});await expect(clip).toBeVisible();
 await chooseFile(page,clip,'c.txt');await expect(clip.locator('[data-basket-count]')).toHaveText('1');
 await e.locator('[data-close="mdEditor"]').click();await expect(page.locator('#mdEditor')).toHaveCount(0);
 // The same selection on the edit screen; nothing uploaded until the existing [첨부 저장].
 await expect(detail.locator('.basket-edit-actions').getByRole('button',{name:'파일 첨부',exact:true}).locator('[data-basket-count]')).toHaveText('1');
 await expect(detail.locator('[data-basket-file]')).toHaveCount(1);expect(f.uploads).toHaveLength(0);
 expect(f.errors).toEqual([]);
});
