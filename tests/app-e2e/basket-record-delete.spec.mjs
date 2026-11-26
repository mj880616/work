import {testOrigin} from './helpers/test-origin.mjs';
import {test,expect} from '@playwright/test';
import {noteAction,openBasketNote} from './helpers/basket-more.mjs';
import {openHome} from './helpers/home-entry.mjs';
import {linkAction} from './helpers/basket-link-menu.mjs';
import {noteTrash} from './helpers/note-trash.mjs';
import {answerAsk,askGap} from './helpers/small-notice.mjs';
import { pickBasketView } from './helpers/forget-view.mjs';
test.use({hasTouch:true});
const fixture=testOrigin+'/tests/app-e2e/basket-link-detail-fixture.html',SB='https://xmlkxfjeagycwttklxjw.supabase.co';
// BUG-바구니연결해제: one wording on every screen, naming the place. Actions live in the line's ⋯ (helpers/basket-link-menu.mjs).
// S71-71 RECORD-기록하나로: 기록 줄 ⋯ [삭제] = 그 기록(연결 줄)만 지우기, 원문 업데이트는 그대로.
const DISCONNECT={organization:'이 기록을 삭제할까요?'};
const more=row=>row.getByRole('button',{name:'기록 메뉴',exact:true});
async function tap(page,locator,width){await expect(locator).toBeVisible();if(width<761){await locator.tap();}else await locator.click();}
// basket-files note-delete model: trash count comes from the test, the note and its links go away like the real cascade.
const CORS={'access-control-allow-origin':'*','access-control-allow-headers':'authorization, x-client-info, apikey, content-type','access-control-allow-methods':'GET, POST, OPTIONS'};
async function server(page,mode={}){const posts=[];await page.route(url=>url.href==='https://fixture.invalid/functions/v1/basket-files?action=note-delete',async route=>{const req=route.request();if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:CORS});
 const r={fulfill:o=>route.fulfill({...o,headers:CORS})},body=JSON.parse(req.postData());posts.push({body,auth:req.headers().authorization});
 if(mode.legacy)return r.fulfill({status:400,json:{ok:false,code:'OCR_REQUEST_INVALID',retryable:false,result_unknown:false,ocr_saved:false,text_changed:false}});
 if(mode.fail)return r.fulfill({status:503,json:{action:'note-delete',note_id:body.note_id,attachments_total:1,trashed:0,failed:0,unknown:0,ok:false,note_deleted:false,code:'note_delete_unavailable',retryable:false}});
 const total=await page.evaluate(id=>{const s=window.__detailState,n=s.notes.find(x=>x.id===id);s.notes=s.notes.filter(x=>x.id!==id);s.links=s.links.filter(x=>x.note_id!==id);return n?.attachments.length||0;},body.note_id);
 return r.fulfill({json:{action:'note-delete',note_id:body.note_id,attachments_total:total,trashed:total-(mode.failed||0),failed:mode.failed||0,unknown:0,ok:true,note_deleted:true}});});return posts;}
async function ready(page,mode){const errors=[];page.on('pageerror',e=>errors.push(e.message));page.__posts=await server(page,mode);await page.goto(fixture);await expect.poll(()=>page.evaluate(()=>window.__detailReady===true)).toBe(true);
 // A second note with its own link proves deleting one original never touches another note's records.
 await page.evaluate(()=>{const s=window.__detailState;s.notes[0].attachments=[{drive_file_id:'f1',file_name:'사진.jpg',mime_type:'image/jpeg',size_bytes:10}];s.notes[0].updated_at='2026-10-11T01:00:00Z';s.notes.push({id:'10000000-0000-4000-8000-000000000009',workspace_id:'detail-workspace',occurred_at:'2026-10-09T01:00:00Z',raw_text:'다른 메모',attachments:[]});s.links.push({id:'40000000-0000-4000-8000-000000000009',note_id:'10000000-0000-4000-8000-000000000009',source_type:'note',workspace_id:'detail-workspace',organization_id:s.ids.org,project_id:null,status:'confirmed',summary:'다른 메모 요약'});window.__linkEvents=0;addEventListener('kptu:basket-links-changed',()=>window.__linkEvents++);});
 return errors;}
async function open(page,kind){await page.evaluate(kind=>{const s=window.__detailState;if(kind==='project')for(const row of s.links){row.project_id=s.ids.project;row.organization_id=null}return kind==='organization'?window.KPTUWorkplace.open(s.ids.org):window.KPTUProjects.open(s.ids.project)},kind);
 const host=page.locator(kind==='organization'?'#wdUpdates':'#ps3-progress [data-ps3-records]');await expect(host.locator('[data-basket-link]')).toHaveCount(3);return host;}
const ids=page=>page.evaluate(()=>window.__detailState.ids);
const deletes=page=>page.evaluate(()=>(window.__detailState.deletes||[]).map(path=>{const u=new URL(path,'https://fixture.invalid');return {table:u.pathname.split('/').pop(),params:Object.fromEntries(u.searchParams)};}));

for(const width of [390,1280])for(const kind of ['organization'])test(`${kind} record [삭제] removes only that link row ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:900});const errors=await ready(page),host=await open(page,kind),{link,nullLink,note}=await ids(page),row=host.locator(`[data-basket-link="${link}"]`);
 await expect(more(row)).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 if(width===390&&kind==='organization'){await row.scrollIntoViewIfNeeded();await row.screenshot({path:info.outputPath('link-record-line-390.png')});}
 const messages=[];
 await linkAction(row,'삭제',{tap:width<761});messages.push(await answerAsk(page,true));
 await expect(row).toHaveCount(0);expect(messages).toEqual([DISCONNECT[kind]]);
 await expect(host.locator(`[data-basket-link="${nullLink}"]`)).toBeVisible();await expect(host.locator('[data-basket-link]')).toHaveCount(2);
 expect(await deletes(page)).toEqual([{table:'app_record_links',params:{id:'eq.'+link,workspace_id:'eq.detail-workspace',select:'id'}}]);
 expect(await page.evaluate(n=>window.__detailState.notes.some(x=>x.id===n),note)).toBe(true);
 await expect.poll(()=>page.evaluate(()=>window.__linkEvents)).toBeGreaterThan(0);expect(errors).toEqual([]);
});

for(const kind of ['organization'])test(`${kind} cancel on the confirmation changes nothing`,async({page})=>{
 const errors=await ready(page),host=await open(page,kind),{link}=await ids(page),row=host.locator(`[data-basket-link="${link}"]`);
 for(const name of ['삭제']){await linkAction(row,name);await answerAsk(page,false);await expect(more(row)).toBeEnabled();await expect(more(row)).toBeFocused();}
 await expect(host.locator('[data-basket-link]')).toHaveCount(3);await expect(row.locator('[data-link-action-status]')).toBeHidden();expect(await deletes(page)).toEqual([]);
 expect(await page.evaluate(()=>window.__linkEvents)).toBe(0);expect(errors).toEqual([]);
});

// S71-71 RECORD-기록하나로: 기록 줄에서 원문(업데이트)을 휴지통에 보내는 길은 없다 — ⋯에 [원문 삭제]가 없고 원문 쓰기도 없다.
test('organization record ⋯ has no original delete; the update itself is never deleted from a record line',async({page})=>{
 const errors=await ready(page),host=await open(page,'organization'),{link}=await ids(page),row=host.locator(`[data-basket-link="${link}"]`);
 await more(row).click();await expect(page.locator('#basketLinkMenu')).toBeVisible();
 await expect(page.locator('#basketLinkMenu button')).toHaveText([/^수정$/,/^메모( \d+)?$/,/^삭제$/]);
 await expect(page.locator('#basketLinkMenu').getByRole('button',{name:'원문 삭제'})).toHaveCount(0);await page.keyboard.press('Escape');
 expect(await deletes(page)).toEqual([]);expect(page.__posts).toEqual([]);expect(errors).toEqual([]);
});

for(const width of [390,1280])test(`project basket rows are plain records (no link to the memo) and offer no summary edit or original delete ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});const errors=await ready(page),host=await open(page,'project'),{link}=await ids(page);
 await expect(host.getByRole('button',{name:'연결 해제'})).toHaveCount(0);await expect(host.getByRole('button',{name:'원문 삭제'})).toHaveCount(0);await expect(host.locator('[data-link-disconnect],[data-link-note-delete],[data-link-summary-edit]')).toHaveCount(0);
 await expect(host.locator(`[data-basket-link="${link}"] a`)).toHaveCount(0); // S71-57: 잊지 말기로 가는 링크 없음expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(await deletes(page)).toEqual([]);expect(page.__posts).toEqual([]);expect(await page.evaluate(()=>window.__detailState.links.length)).toBe(3);expect(errors).toEqual([]);
});

for(const name of ['삭제'])test(`record ${name} failure keeps the row and explains in plain words`,async({page})=>{
 const errors=await ready(page,{fail:true}),host=await open(page,'organization'),{link}=await ids(page),row=host.locator(`[data-basket-link="${link}"]`);
 await page.evaluate(()=>window.__detailState.failDelete=403);await linkAction(row,name);await answerAsk(page,true);
 await expect(row.locator('[data-link-action-status]')).toHaveText('기록을 삭제하지 못했어요. 다시 시도해 주세요.');
 await expect(host.locator('[data-basket-link]')).toHaveCount(3);await expect(more(row)).toBeEnabled();expect(errors).toEqual([]);
});

test('lost delete response is re-read and shows the real state',async({page})=>{
 const errors=await ready(page),host=await open(page,'organization'),{link}=await ids(page);
 await page.evaluate(()=>window.__detailState.loseDeleteResponse=true);await linkAction(host.locator(`[data-basket-link="${link}"]`),'삭제');await answerAsk(page,true);
 await expect(host.locator(`[data-basket-link="${link}"]`)).toHaveCount(0);await expect(host.locator('[data-basket-link]')).toHaveCount(2);expect(errors).toEqual([]);
});

test('an open record edit blocks delete without a dialog',async({page})=>{
 const errors=await ready(page),host=await open(page,'organization'),{link}=await ids(page),row=host.locator(`[data-basket-link="${link}"]`);
 await linkAction(row,'수정');await row.locator('textarea').fill('작성 중');page.on('dialog',d=>{throw Error('unexpected dialog '+d.message());});
 await linkAction(row,'삭제');await expect(row.locator('[data-link-action-status]')).toHaveText('수정을 먼저 저장하거나 취소해 주세요.');
 await expect(row.locator('textarea')).toHaveValue('작성 중');expect(await deletes(page)).toEqual([]);expect(errors).toEqual([]);
});

test('a late disconnect result never paints into another opened organization',async({page})=>{
 const errors=await ready(page),host=await open(page,'organization'),{link}=await ids(page);
 await page.evaluate(id=>{const s=window.__detailState;s.holdTable='app_record_links';s.holdTarget='id=eq.'+id;},link);
 const button=more(host.locator(`[data-basket-link="${link}"]`));await linkAction(host.locator(`[data-basket-link="${link}"]`),'삭제');await answerAsk(page,true);await expect(button).toBeDisabled();
 await expect.poll(()=>page.evaluate(()=>typeof window.__detailState.release)).toBe('function');
 await page.evaluate(()=>window.KPTUWorkplace.open(window.__detailState.ids.otherOrg));await expect(page.locator('#wdTitle')).toHaveText('다른 담당조직');
 await page.evaluate(()=>{const s=window.__detailState;s.holdTable=null;s.release();});
 await expect.poll(()=>page.evaluate(()=>window.__detailState.links.length)).toBe(2);
 await expect(page.locator('#wdUpdates [data-basket-link]')).toHaveCount(0);await expect(page.locator('#wdUpdates [data-link-action-status]:not([hidden])')).toHaveCount(0);expect(errors).toEqual([]);
});

async function basket(page,{fail=0,mode='ok'}={}){
 const errors=[],writes=[],posts=[];page.on('pageerror',e=>errors.push(e.message));
 const notes=[{id:'n',workspace_id:'w',raw_text:'삭제할 메모\n둘째 줄',occurred_at:'2026-10-06T01:00:00Z',updated_at:'2026-10-06T01:00:00Z',ai_export_allowed:true,attachments:[{drive_file_id:'file_1',file_name:'회의.txt',size_bytes:12,mime_type:'text/plain'}]},{id:'keep',workspace_id:'w',raw_text:'남을 메모',occurred_at:'2026-10-05T01:00:00Z',updated_at:'2026-10-05T01:00:00Z',ai_export_allowed:true,attachments:[]}];
 const links=[{id:'l1',note_id:'n',workspace_id:'w',status:'confirmed',organization_id:'o',organization:{name:'합성 조직'}}];
 await openHome(page);
 // 나중에 등록한 가로채기가 먼저 적용되므로, 홈 기본 응답을 깐 뒤에 휴지통 함수 흉내를 등록한다.
 const trash=await noteTrash(page,SB,{mode:mode==='missing'?'missing':'ready'});
 await page.route(SB+'/rest/v1/app_notes**',r=>{const req=r.request(),u=new URL(req.url()),id=u.searchParams.get('id')?.slice(3);
  if(req.method()==='GET')return r.fulfill({json:id?notes.filter(n=>n.id===id):notes});
  if(req.method()==='DELETE'){writes.push(Object.fromEntries(u.searchParams));if(fail)return r.fulfill({status:fail,json:{message:'RLS 거부'}});const i=notes.findIndex(n=>n.id===id);const removed=i<0?[]:notes.splice(i,1);const parked=links.filter(l=>l.note_id===id);for(let j=links.length-1;j>=0;j--)if(links[j].note_id===id)links.splice(j,1);
   // 삭제 가로채기 흉내: 행은 휴지통으로 가고(연결은 보관), 응답에는 지운 행이 없다.
   removed.forEach(n=>{trash.take(n,parked.length);trash.onRestore=back=>{notes.push(back);links.push(...parked);};});return r.fulfill({json:[]});}
  return r.fallback();});
 // 화면은 예전 note-delete 경로를 더 쓰지 않는다: 불리면 posts에 남아 시험이 실패한다.
 await page.route(url=>url.href===SB+'/functions/v1/basket-files?action=note-delete',r=>{posts.push({body:JSON.parse(r.request().postData())});return r.fulfill({status:500,json:{}});});
 await page.route(SB+'/rest/v1/app_record_links?**',r=>{const u=new URL(r.request().url()),q=u.searchParams.get('note_id');if(!q)return r.fallback();const wanted=q.startsWith('eq.')?[q.slice(3)]:q.slice(4,-1).split(',');return r.fulfill({json:links.filter(l=>wanted.includes(l.note_id)&&(!u.searchParams.get('status')||l.status==='confirmed'))});});
 return {notes,links,writes,posts,errors,trash};
}
async function openNote(page,width){await tap(page,page.locator('#homeView [data-home-quick] [data-goto="basket"]:visible,.mobile-tabs [data-view="basket"]:visible').first(),width);await openBasketNote(page,'n',width<761?l=>l.tap():null);await expect(page.locator('[data-basket-read-text]')).toBeVisible();}

// TRASH-다른삭제 5단계: 업데이트 [삭제]는 휴지통으로 간다. 확인창 글, '휴지통으로 옮겼어요 · 되돌리기' 한 줄, 되돌리면 목록에 다시 나타남.
const CONFIRM='업데이트를 휴지통으로 옮길까요?\n첨부 파일 1개는 Drive에 그대로 남습니다.\n연결된 1곳은 그대로 이어져 있고, 휴지통에서 되돌리면 원래 자리로 돌아옵니다.';
for(const width of [390,1280])test(`basket read view moves the update to the trash, offers undo and returns to the list ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:900});const f=await basket(page);await openNote(page,width);const detail=page.locator('[data-basket-detail]');
 // UI-디자인손질 6: 수정·삭제 live in the note's [⋯]; while editing that menu is gone.
 await noteAction(page,'[data-basket-edit]',{press:l=>tap(page,l,width)});await expect(detail.locator('[data-basket-note-more]')).toBeHidden();await expect(detail.locator('[data-basket-delete]')).toBeHidden();
 await tap(page,detail.locator('[data-basket-cancel]'),width);await expect(detail.locator('[data-basket-note-more]')).toBeVisible();
 if(width===390)await page.screenshot({path:info.outputPath('basket-read-delete-390.png'),fullPage:true});
 const messages=[];
 await noteAction(page,'[data-basket-delete]',{press:l=>tap(page,l,width)});messages.push(await answerAsk(page,true));
 await expect(detail).toBeHidden();await expect(page.locator('[data-basket-row="n"]')).toHaveCount(0);
 const notice=page.locator('[data-undo-notice]');await expect(notice).toContainText('업데이트를 휴지통으로 옮겼어요.');await expect(notice.getByRole('button',{name:'되돌리기'})).toBeVisible();
 expect(messages).toEqual([CONFIRM]);
 // 예전 서버 note-delete 경로는 더 쓰지 않고, owner-RLS DELETE 한 번(가로채기가 휴지통 표시로 바꿈)만 보낸다.
 expect(f.posts).toEqual([]);expect(f.writes).toEqual([{id:'eq.n',workspace_id:'eq.w',select:'id'}]);
 expect(f.trash.trash.map(n=>n.id)).toEqual(['n']);expect(f.links.length).toBe(0);expect(new URL(page.url()).searchParams.has('note')).toBe(false);
 await notice.getByRole('button',{name:'되돌리기'}).click();
 await expect(notice).toContainText('되돌렸습니다.');
 expect(f.trash.rpc.filter(r=>r.fn==='app_trash_restore')).toEqual([{fn:'app_trash_restore',kind:'note',id:'n'}]);
 // S71-58 FORGET-처리전만: 되살린 메모는 연결이 있어(처리한 것) 처리 전 목록에는 없다.
 await expect(page.locator('[data-basket-row="n"]')).toHaveCount(0);expect(f.trash.trash).toEqual([]);expect(f.links.length).toBe(1);
 // UI-바구니거르기 → S52-20: the kept memo (no link) sits in 처리 전 (= 미분류).
 await pickBasketView(page,'unclassified');await expect(page.locator('[data-basket-row="keep"]')).toBeVisible();
 if(width===390)await page.screenshot({path:info.outputPath('basket-delete-result-390.png')});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(f.errors).toEqual([]);
});

for(const width of [390,1280])test(`basket delete cancel keeps the read view and sends nothing ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});const f=await basket(page);await openNote(page,width);const detail=page.locator('[data-basket-detail]');
 await noteAction(page,'[data-basket-delete]');await answerAsk(page,false);
 // Cancelling returns focus to the note's [⋯], where 삭제 lives.
 await expect(detail.locator('[data-basket-read-text]')).toBeVisible();await expect(detail.locator('[data-basket-note-more]')).toBeFocused();await expect(detail.locator('[data-basket-delete]')).toBeEnabled();
 expect(f.writes).toEqual([]);expect(f.posts).toEqual([]);expect(f.notes.map(n=>n.id)).toEqual(['n','keep']);await expect(detail.locator('[data-basket-status]')).toHaveText('');expect(f.errors).toEqual([]);
});

test('basket delete before the database is ready explains and sends no delete',async({page})=>{
 const f=await basket(page,{mode:'missing'});await openNote(page,390);const detail=page.locator('[data-basket-detail]');
 page.on('dialog',d=>{throw Error('unexpected dialog '+d.message());});await noteAction(page,'[data-basket-delete]');
 await expect(detail.locator('[data-basket-status]')).toHaveText('노트·업데이트 휴지통은 준비 중입니다. 준비가 끝나기 전에는 삭제할 수 없어요.');await expect(detail.locator('[data-basket-read-text]')).toBeVisible();
 expect(f.writes).toEqual([]);expect(f.posts).toEqual([]);expect(f.notes.some(n=>n.id==='n')).toBe(true);expect(f.errors).toEqual([]);
});

test('basket delete failure keeps the note open with a plain error',async({page})=>{
 const f=await basket(page,{fail:500});await openNote(page,390);const detail=page.locator('[data-basket-detail]');
 await noteAction(page,'[data-basket-delete]');await answerAsk(page,true);
 await expect(detail.locator('[data-basket-status]')).toHaveText('업데이트를 삭제하지 못했어요. 다시 시도해 주세요.');await expect(detail.locator('[data-basket-read-text]')).toBeVisible();await expect(detail.locator('[data-basket-delete]')).toBeEnabled();
 expect(f.notes.some(n=>n.id==='n')).toBe(true);expect(f.posts).toEqual([]);expect(f.trash.trash).toEqual([]);expect(f.errors).toEqual([]);
});

// S69-13 UI-확인창누른자리: 노트 ⋯ 메뉴 [삭제]의 확인창도 그 ⋯ 옆(폰은 하단바 위)에 뜬다.
for(const width of [412,1440])test(`basket delete confirm opens beside the note's [⋯] ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});const f=await basket(page);await openNote(page,width);const detail=page.locator('[data-basket-detail]');
 await noteAction(page,'[data-basket-delete]',{press:l=>tap(page,l,width)});
 const {gap,aboveBar}=await askGap(page,detail.locator('[data-basket-note-more]'));expect(gap).toBeLessThanOrEqual(12);expect(aboveBar).toBe(true);
 await answerAsk(page,false);expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});
