import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import {noteMenuAction} from './helpers/note-menu.mjs';
import { basketKindButton, openKindMenu } from './helpers/basket-kind.mjs';
import { expectNoteTitle } from './helpers/note-title.mjs';
import { closeNote } from './helpers/note-close.mjs';
// BUG-노트HTML표시: a note's .html attachment (ChatGPT HTML) shows in the same sandboxed frame as the memo read view
// (html-frame.js, document-actions `html-view`), so a note made only of HTML no longer says "본문이 없는 노트입니다.".
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
test.use({hasTouch:true});
// Report captures go to CAPTURE_DIR when it is set (docs/review/bug-note-html), else the test output folder.
const shot=(info,name)=>process.env.CAPTURE_DIR?`${process.env.CAPTURE_DIR}/${name}`:info.outputPath(name);
const HTML=`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>정리</title>
<style>body{font-family:sans-serif}.card{border:2px solid #2a6;border-radius:12px;padding:16px;margin:8px}</style></head>
<body><div class="card" id="card">GPT 카드 정리 <svg width="32" height="32"><circle cx="16" cy="16" r="14" fill="teal"/></svg></div>
<script>try{parent.document.title;parent.postMessage({type:'web2-note-probe',parent:'ok'},'*')}catch(e){parent.postMessage({type:'web2-note-probe',parent:'blocked:'+e.name},'*')}</script></body></html>`;
const at='2026-10-18T01:00:00Z';
const html=(id,name)=>({drive_file_id:id,file_name:name,mime_type:'text/html',size_bytes:300});
function store(){
 const row=(id,kind,title,raw_text,attachments,updated)=>({id,workspace_id:'w',kind,title,raw_text,occurred_at:at,created_at:at,updated_at:updated,archived_at:null,ai_export_allowed:true,attachments,metadata:{}});
 return [
  row('m-html','basket',null,'',[html('memo_html','chatgpt-20261018-0800.html')],'2026-10-18T00:00:00Z'),
  row('n-html','note','GPT 답변 HTML','',[html('note_html','chatgpt-20261018-0900.html')],'2026-10-18T03:00:00Z'),
  row('n-both','note','글과 HTML','## 요약\n\n- 첫 줄',[{drive_file_id:'hwp_1',file_name:'회의록.hwp',mime_type:'application/x-hwp',size_bytes:2048},html('both_a','a.html'),html('both_b','b.htm')],'2026-10-18T02:00:00Z'),
  row('n-empty','note','빈 노트','',[],'2026-10-18T01:00:00Z'),
 ];
}
async function fixture(page){
 const rows=store(),writes=[],errors=[],htmlCalls=[],outside=[];
 page.on('pageerror',e=>errors.push(e.message));
 // Any http(s) request made by a frame (not the Web2 page) is a leak.
 page.on('request',r=>{const u=new URL(r.url());if((u.protocol==='http:'||u.protocol==='https:')&&r.frame()!==page.mainFrame())outside.push(r.url());});
 await openHome(page);
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',async r=>{
  const req=r.request(),q=new URL(req.url()).searchParams;
  const pick=row=>(!q.get('kind')||'eq.'+row.kind===q.get('kind'))&&(!q.get('id')||'eq.'+row.id===q.get('id'));
  if(req.method()==='GET'){if(q.get('metadata'))return r.fulfill({json:[]});return r.fulfill({json:rows.filter(pick).slice(Number(q.get('offset')||0))});}
  if(req.method()==='PATCH'){const body=req.postDataJSON();writes.push({query:Object.fromEntries(q),body});const hit=rows.filter(pick);for(const row of hit)Object.assign(row,body,{updated_at:'2026-10-18T05:00:00Z'});return r.fulfill({json:hit});}
  return r.fulfill({status:500,json:{}});
 });
 await page.route(SB+'/rest/v1/app_record_links?**',r=>new URL(r.request().url()).searchParams.has('note_id')?r.fulfill({json:[]}):r.fallback());
 await page.route(SB+'/functions/v1/document-actions',r=>{const body=r.request().postDataJSON();htmlCalls.push(body);return r.fulfill({json:{ok:true,file_name:body.drive_file_id+'.html',html:HTML.replace('GPT 카드 정리',`GPT 카드 정리 ${body.drive_file_id}`)}});});
 await page.evaluate(()=>window.KPTURouter.go('basket'));
 await expect(page.locator('[data-basket-row="m-html"]')).toBeVisible();
 return {rows,writes,errors,htmlCalls,outside};
}
async function press(page,locator,width){
 await expect(locator).toBeVisible();
 // Phone: a real touch tap (Playwright waits for the element to be stable, even if the list repaints).
 if(width<761)await locator.tap();else await locator.click();
}
const openNote=async(page,id,width)=>{await openKindMenu(page,'note');await press(page,basketKindButton(page,'note'),width);await press(page,page.locator(`[data-note-row="${id}"]`),width);return page.locator('[data-note-detail]');};

for(const width of [390,1280]){
 test(`a note with only an .html attachment shows it in the sandboxed frame, no "no body" sentence ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});const f=await fixture(page);
  const probe=page.evaluate(()=>new Promise(resolve=>addEventListener('message',e=>{if(e.data?.type==='web2-note-probe')resolve(e.data.parent);})));
  const detail=await openNote(page,'n-html',width);
  await expectNoteTitle(page,'GPT 답변 HTML');
  const view=detail.locator('[data-basket-html-view="note_html"]'),frame=view.locator('iframe.html-frame-view');
  await expect(frame).toHaveCount(1);
  await expect(frame).toHaveAttribute('sandbox','allow-scripts');
  await expect(frame).toHaveAttribute('referrerpolicy','no-referrer');
  // The CSP that blocks every network request comes first in the frame document.
  const srcdoc=await frame.getAttribute('srcdoc');
  expect(srcdoc).toMatch(/^<!DOCTYPE html><meta http-equiv="Content-Security-Policy" content="default-src 'none'/);
  await expect(page.frameLocator('[data-basket-html-view="note_html"] iframe').locator('#card')).toContainText('GPT 카드 정리 note_html');
  expect(await probe).toMatch(/^blocked:/);
  expect(f.htmlCalls).toEqual([{action:'html-view',note_id:'n-html',drive_file_id:'note_html'}]);
  await expect(detail).not.toContainText('본문이 없는 노트입니다.');
  await expect(detail.locator('[data-basket-read-text]')).toBeHidden();
  // The HTML area takes focus when there is no body text.
  await expect(detail.locator('[data-basket-html-views]')).toBeFocused();
  // The file line with [Drive에서 열기] stays.
  await expect(detail.locator('[data-note-attachments] .note-file-line')).toHaveCount(1);
  await expect(detail.locator('[data-note-attachments]')).toContainText('chatgpt-20261018-0900.html');
  await expect(detail.locator('[data-note-attachments] a.file-line-link')).toHaveAttribute('href',/note_html/);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(f.outside).toEqual([]);expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
 });

 test(`a note with text and two .html files: text first, then each frame in attachment order ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});const f=await fixture(page);
  const detail=await openNote(page,'n-both',width);
  await expect(detail.locator('[data-basket-read-text] h2')).toHaveText('요약');
  const views=detail.locator('[data-basket-html-view]');
  await expect(views).toHaveCount(2);
  await expect(views.nth(0)).toHaveAttribute('data-basket-html-view','both_a');await expect(views.nth(1)).toHaveAttribute('data-basket-html-view','both_b');
  await expect(detail.locator('[data-basket-html-views] iframe[sandbox="allow-scripts"]')).toHaveCount(2);
  const [text,first]=await Promise.all([detail.locator('[data-basket-read-text]').boundingBox(),views.nth(0).boundingBox()]);
  expect(first.y).toBeGreaterThan(text.y+text.height-1);
  // The .hwp file is not framed; all three stay as file lines.
  await expect(detail.locator('[data-note-attachments] .note-file-line')).toHaveCount(3);
  expect(f.htmlCalls.map(c=>c.drive_file_id).sort()).toEqual(['both_a','both_b']);
  await expect(detail.locator('[data-basket-read-text]')).toBeFocused();
  // [수정] → [취소] keeps the frames (read once per opened note, not sent again).
  await noteMenuAction(page,'data-note-edit',{width});
  await expect(detail.locator('[data-note-read]')).toBeHidden();
  // ED③ 노트: the edit field is the new editor, opened from the old markdown letters (heading + list).
  await expect(detail.locator('[data-note-body-field] .ProseMirror .ed-h2')).toHaveText('요약');
  await expect(detail.locator('[data-note-body-field] .ProseMirror li')).toHaveText('첫 줄');
  await press(page,detail.locator('[data-note-cancel]'),width);
  await expect(detail.locator('[data-basket-html-views] iframe')).toHaveCount(2);
  expect(f.htmlCalls).toHaveLength(2);
  // Saving a new body keeps the frames under the new text.
  await noteMenuAction(page,'data-note-edit',{width});
  const field=detail.locator('[data-note-body-field] .ProseMirror');await expect(field).toBeVisible();
  await field.click();await page.keyboard.press('Control+A');await page.keyboard.insertText('새 본문');
  await press(page,detail.locator('[data-note-save]'),width);
  await expect(page.locator('#toast')).toContainText('노트를 저장했습니다.');
  await expect(detail.locator('[data-basket-read-text]')).toContainText('새 본문');
  await expect(detail.locator('[data-basket-html-views] iframe')).toHaveCount(2);
  expect(f.writes).toHaveLength(1);expect(f.writes[0].query).toMatchObject({id:'eq.n-both',kind:'eq.note'});
  expect(f.errors).toEqual([]);
 });

 test(`a note with no text and no file still says it has no body; memo HTML still shows ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});const f=await fixture(page);
  const detail=await openNote(page,'n-empty',width);
  await expect(detail.locator('[data-basket-read-text]')).toHaveText('본문이 없는 노트입니다.');
  await expect(detail.locator('[data-basket-html-views] iframe')).toHaveCount(0);
  await closeNote(page);
  // Memo read view (regression): same frame for a memo's .html attachment.
  await press(page,basketKindButton(page,'memo'),width);
  await press(page,page.locator('[data-basket-row="m-html"]'),width);
  const frame=page.locator('[data-basket-detail] [data-basket-html-view="memo_html"] iframe.html-frame-view');
  await expect(frame).toHaveAttribute('sandbox','allow-scripts');
  await expect(page.frameLocator('[data-basket-html-view="memo_html"] iframe').locator('#card')).toContainText('GPT 카드 정리 memo_html');
  expect(f.htmlCalls).toEqual([{action:'html-view',note_id:'m-html',drive_file_id:'memo_html'}]);
  expect(f.errors).toEqual([]);
 });
}

for(const scheme of ['light','dark'])test(`report capture: note with only HTML (${scheme}) 390`,async({page},info)=>{
 await page.emulateMedia({colorScheme:scheme});await page.setViewportSize({width:390,height:900});await fixture(page);
 const detail=await openNote(page,'n-html',390);
 await expect(page.frameLocator('[data-basket-html-view="note_html"] iframe').locator('#card')).toBeVisible();
 await page.waitForTimeout(200);
 await page.screenshot({path:shot(info,`note-html-${scheme}-390.png`)});
 await expect(detail).not.toContainText('본문이 없는 노트입니다.');
});
