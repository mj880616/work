import {test,expect} from '@playwright/test';
import {chooseBasketKind} from './helpers/basket-kind.mjs';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
import {expectProjectDetail} from './helpers/project-detail.mjs';
import {typeInto,edWin,edWinText} from './helpers/note-editor.mjs';
import {expectProjectTitle} from './helpers/screen-title.mjs';
// UI-크게첨부(2026-10-20 사용자 결정): (a) 조직 상세·프로젝트 상세의 업데이트 입력에도 [크게](프로젝트 상세 쪽은 MTG-프로젝트합치기 3단계에서 입력칸과 함께 없어짐). ED③ 기록(순서 5)부터 업데이트의 새 큰 창
// (update-window.js, #edWindow)이 그 조직·프로젝트를 미리 고른 채 열리고, 저장하면 그 조직·프로젝트 기록으로(글자와 서식 함께) 저장된 뒤 닫힌다. (b) 큰 편집 창에서도 [📎 첨부]
// (바구니 첨부 부품 basket-upload.js 그대로). 첨부는 바구니로 저장할 때만 — 조직·프로젝트 기록이나 노트로 저장할 때 첨부가 있으면
// 기존 안내. DB·Edge 변경 없음(기존 저장 경로만 부른다).
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
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
const fits=page=>page.evaluate(()=>{const h=document.querySelector('#edWindow .ed-window-head');return !!h&&h.scrollWidth<=h.clientWidth&&document.documentElement.scrollWidth<=innerWidth;});
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
  const [b,s]=await Promise.all([big.boundingBox(),page.locator('#wdInboxSave').boundingBox()]);
  // ORG-PC상세정리 → UI-전수디자인점검 F08: PC 칸·폰 창 모두 ⤢는 입력칸 안 오른쪽 아래, [저장](32px)은 그 아래 오른쪽.
  const t=await page.locator('#wdInboxText').boundingBox();
  expect(b.x+b.width).toBeLessThanOrEqual(t.x+t.width);expect(b.y+b.height).toBeLessThanOrEqual(t.y+t.height);expect(s.y).toBeGreaterThanOrEqual(t.y+t.height);
  expect(b.height).toBe(32);expect(s.height).toBe(32);
  await page.locator('#wdInboxText').fill('통화 내용 첫 줄\n둘째 줄');
  await big.click();
  const e=edWin(page);await expect(e).toBeVisible();
  await expect(edWinText(page)).toContainText('통화 내용 첫 줄');await expect(edWinText(page)).toContainText('둘째 줄');
  await expect(e.locator('[data-edw-place]')).toHaveText('테스트 조직 ▾');
  await expect(e.locator('[data-edw-save]')).toHaveAccessibleName('업데이트로 저장');
  expect(await fits(page)).toBe(true);
  // Closing without saving hands the letters back to the small input.
  await typeInto(page,edWinText(page),'큰 창에서 고친 기록');
  await e.locator('[data-close="edWindow"]').click();
  await page.locator('#edwCloseSheet').getByRole('button',{name:'저장하지 않고 닫기',exact:true}).click();await expect(page.locator('#edWindow')).toHaveCount(0);
  await expect(page.locator('#wdInboxText')).toHaveValue('큰 창에서 고친 기록');expect(f.orgs).toEqual([]);
  // Save: this organization's record (letters and the saved form), the window closes and the input empties.
  await big.click();await expect(e).toBeVisible();
  await e.locator('[data-edw-save]').click();
  await expect(page.locator('#edWindow')).toHaveCount(0);
  await expect(page.locator('#toast')).toContainText('테스트 조직 기록에 저장했어요.');
  expect(f.orgs).toHaveLength(1);expect(f.orgs[0]).toMatchObject({organization_id:'o',raw_text:'큰 창에서 고친 기록',created_by:'home-test'});expect(f.orgs[0].doc).toMatchObject({v:'ed1'});expect(f.notes).toEqual([]);
  await expect(page.locator('#wdInboxText')).toHaveValue('');await expect(modal).toBeVisible();
  expect(f.errors).toEqual([]);
 });

 // MTG-프로젝트합치기 3단계: 프로젝트 상세의 기록 입력칸과 [크게](⤢)는 없어졌다(기록은 사업 보고 한 곳, 명진 결정). 상세에서 큰 창이 열리지 않고
 // 진행 기록도 쓰지 않는지만 본다(지난 기록 목록은 project-record-input.spec.mjs가 본다).
 test(`프로젝트 상세: 기록 입력칸·[크게]가 없고 진행 기록을 쓰지 않음 ${width}`,async({page})=>{
  const f=await fixture(page,width);
  await clickView(page,'projects');await page.locator('#projectGrid .ps3-plist [data-ps3-project="p"]').click();
  await expectProjectDetail(page,'p');await expectProjectTitle(page,'테스트 프로젝트',{contains:true});
  await expect(page.locator('#ps3-progress')).toBeVisible();
  await expect(page.locator('#ps3Body [data-ps3-record-input],#ps3Body [data-ps3-record-big]')).toHaveCount(0);
  await expect(page.locator('#edWindow')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(f.projects).toEqual([]);
  expect(f.errors).toEqual([]);
 });

 // ED③ 순서 6: the old write window's [📎 첨부] test went with the window; the new window's file batch is in update-window.spec.mjs and update-attach-target.spec.mjs.

 test(`홈 [크게] [📎 첨부]: 홈 입력의 파일과 같은 묶음, 창에서 고른 파일이 홈 입력에도 보임 ${width}`,async({page})=>{
  const f=await fixture(page,width),q=page.locator('#homeView [data-home-quick]');
  await q.locator('[data-quick-input]').fill('홈 업데이트');
  await q.locator('[data-quick-big]').click();
  const e=page.locator('#edWindow');await expect(e).toBeVisible();
  const clip=e.getByRole('button',{name:'파일 첨부',exact:true});
  await chooseFile(page,clip,'b.txt');
  await expect(clip.locator('[data-basket-count]')).toHaveText('1');
  // Closing without saving: the file stays with the home input (one batch). The window asks first (a file was chosen).
  await e.locator('[data-close="edWindow"]').click();
  await page.locator('#edwCloseSheet').getByRole('button',{name:'저장하지 않고 닫기',exact:true}).click();await expect(page.locator('#edWindow')).toHaveCount(0);
  await expect(q.getByRole('button',{name:'파일 첨부',exact:true}).locator('[data-basket-count]')).toHaveText('1');
  await q.locator('[data-quick-big]').click();await expect(e).toBeVisible();
  await expect(e.locator('[data-basket-file]')).toHaveCount(1);
  await e.locator('[data-edw-save]').click();
  await expect(page.locator('#edWindow')).toHaveCount(0);
  expect(f.uploads).toHaveLength(1);expect(f.uploads[0]).toContain('filename="b.txt"');
  expect(f.errors).toEqual([]);
 });
}

for(const width of [390,1280])test(`정리함 업데이트 수정 [큰 창에서 수정] [📎 첨부]: 수정 화면과 같은 파일 선택, 저장은 기존 [첨부 저장] ${width}`,async({page})=>{
 const f=await fixture(page,width);
 await page.route('**/rest/v1/app_notes**',r=>r.request().method()==='GET'?r.fulfill({json:[{id:'n',kind:'basket',raw_text:'고칠 업데이트',occurred_at:'2026-10-06',attachments:[]}]}):r.fallback());
 await page.locator('#homeView [data-home-quick] [data-goto="basket"]:visible,.mobile-tabs [data-view="basket"]:visible').click();
 await page.locator('[data-basket-row="n"]').click();
 await page.locator('[data-basket-note-more]').click();await page.locator('[data-basket-edit]').click();
 const detail=page.locator('[data-basket-detail]');
 await detail.locator('[data-basket-big-write]').click();
 const e=page.locator('#edWindow');await expect(e).toBeVisible();
 const clip=e.getByRole('button',{name:'파일 첨부',exact:true});await expect(clip).toBeVisible();
 await chooseFile(page,clip,'c.txt');await expect(clip.locator('[data-basket-count]')).toHaveText('1');
 await e.locator('[data-close="edWindow"]').click();
 await page.locator('#edwCloseSheet').getByRole('button',{name:'저장하지 않고 닫기',exact:true}).click();await expect(page.locator('#edWindow')).toHaveCount(0);
 // The same selection on the edit screen; nothing uploaded until the existing [첨부 저장].
 await expect(detail.locator('.basket-edit-actions').getByRole('button',{name:'파일 첨부',exact:true}).locator('[data-basket-count]')).toHaveText('1');
 await expect(detail.locator('[data-basket-file]')).toHaveCount(1);expect(f.uploads).toHaveLength(0);
 expect(f.errors).toEqual([]);
});

// BUG-폰바구니첨부 → ED③ 노트: the note list's own input hands its file batch to the note's new big window (#edWindow). That window
// writes a note only (no [업데이트] switch; an update is written from the update input), and [저장] sends the input's files with the new
// note (its id), once; the input's file list empties afterwards.
for(const width of [390,1280])test(`노트 입력칸의 파일: [크게] 새 노트 창에서 저장하면 노트에 붙고 입력칸 비움 ${width}`,async({page})=>{
 const f=await fixture(page,width);
 await page.evaluate(()=>window.KPTURouter.go('basket'));
 // [노트] is its own menu item: the sidebar row on a PC, the [메뉴] sheet row on a phone.
 await chooseBasketKind(page,'note');
 const q=page.locator('#basketView [data-note-list] [data-quick-big]:visible').first();
 const qclip=page.locator('#basketView [data-note-list] [data-quick-file-picker] [data-basket-clip]');
 await page.locator('#basketView [data-note-list] [data-quick-input]').click();
 await chooseFile(page,qclip,'m.txt');await expect(qclip.locator('[data-basket-count]')).toHaveText('1');
 await q.click();
 const e=page.locator('#edWindow');await expect(e).toBeVisible();
 await expect(e.locator('[data-edw-attach] [data-basket-file]')).toHaveCount(1);
 const text=e.locator('.ed-window-body .ProseMirror');await text.click();await page.keyboard.insertText('파일 붙은 노트');
 await e.locator('[data-edw-save]').click();
 await expect(page.locator('#edWindow')).toHaveCount(0);
 expect(f.notes).toHaveLength(1);expect(f.uploads).toHaveLength(1);expect(f.uploads[0]).toContain('filename="m.txt"');expect(f.uploads[0]).toContain('name="note_id"');
 await expect(qclip.locator('[data-basket-count]')).toBeHidden();
 expect(f.errors).toEqual([]);
});
