import {test,expect} from '@playwright/test';
import {noteAction,showBasketRow} from './helpers/basket-more.mjs';
import {openHome} from './helpers/home-entry.mjs';
// BASKET-4b-1 C: [자료실로 보내기] on a basket note attachment. Server results only;
// a refusal changes nothing, an unknown result is never sent again.
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',stamp='2026-10-06T01:00:00.123456+00:00';
const n='10000000-0000-4000-8000-000000000001';
const files=[{drive_file_id:'drive-a',file_name:'회의 사진.jpg',mime_type:'image/jpeg',size_bytes:2048},{drive_file_id:'drive-b',file_name:'안내문.pdf',mime_type:'application/pdf',size_bytes:4096}];
async function fixture(page,width,reply){
 await page.setViewportSize({width,height:width<761?844:900});
 const home=await openHome(page),errors=[],sends=[],changed=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
 const note={id:n,workspace_id:'w',occurred_at:stamp,updated_at:stamp,raw_text:'10/20 기자회견 자료',ai_export_allowed:true,archived_at:null,attachments:files,metadata:{}};
 for(const t of ['app_suborganizations','app_suborganization_assignees','app_spaces','app_record_links'])await page.route(SB+'/rest/v1/'+t+'?**',r=>r.fulfill({json:[]}));
 await page.route(SB+'/rest/v1/app_notes?**',r=>{const q=new URL(r.request().url()).searchParams;if(r.request().method()!=='GET')return r.fulfill({status:500,json:{}});if(q.get('metadata'))return r.fulfill({json:[]});return r.fulfill({json:[note].slice(Number(q.get('offset')||0))});});
 await page.route(SB+'/functions/v1/document-actions',async route=>{const body=route.request().postDataJSON();sends.push(body);return reply(route,body,sends.length);});
 await page.exposeFunction('__libraryChanged',d=>changed.push(d));
 await page.evaluate(()=>addEventListener('kptu:documents-changed',e=>window.__libraryChanged(e.detail)));
 await page.evaluate(()=>window.KPTURouter.go('basket'));await showBasketRow(page,n);
 const row=page.locator(`[data-basket-row="${n}"]`);if(width<761)await row.tap();else await row.click();
 await expect(page.locator('[data-basket-read-text]')).toBeVisible();
 return {home,errors,sends,changed,box:id=>page.locator(`[data-basket-library="${id}"]`),meta:id=>page.locator(`[data-basket-file-card="${id}"] .basket-file-meta`),result:id=>page.locator(`[data-basket-library-status="${id}"]`)};
}
const press=async(page,locator,width)=>{await expect(locator).toBeVisible();if(width<761)await locator.tap();else await locator.click();};

for(const width of [390,1280])test(`sending an attachment registers it once and shows the library state ${width}`,async({page},info)=>{
 const f=await fixture(page,width,(route,body)=>route.fulfill({json:{ok:true,result:body.drive_file_id==='drive-a'?'created':'exists',document:{id:'doc-'+body.drive_file_id,title:'x'}}}));
 const a=f.box('drive-a'),b=f.box('drive-b');
 await expect(a.getByRole('button')).toHaveText('자료실로 보내기');await expect(b.getByRole('button')).toHaveText('자료실로 보내기');
 await press(page,a.getByRole('button'),width);
 // UI-바구니상세개편: the result is a short notice; the file's size line says it is in the library, and the small
 // [자료실로 보내기] link becomes [자료실에서 보기] (no button to press again).
 await expect(page.locator('#toast')).toHaveText('자료실로 보냈어요. 바구니와 같은 Drive 원본을 씁니다.');await expect(f.result('drive-a')).toHaveCount(0);
 await expect(f.meta('drive-a')).toHaveText('2.0 KB · 자료실에 있음 ✓');await expect(a.getByRole('button')).toHaveCount(0);
 await expect(a.getByRole('link',{name:'회의 사진.jpg 자료실에서 보기'})).toHaveAttribute('data-basket-library-open','doc-drive-a');
 expect(f.sends).toEqual([{action:'register-basket-attachment',note_id:n,drive_file_id:'drive-a'}]);
 await expect.poll(()=>f.changed.length).toBe(1);
 await press(page,b.getByRole('button'),width);
 await expect(page.locator('#toast')).toHaveText('이미 자료실에 있어요.');await expect(f.meta('drive-b')).toHaveText('4.0 KB · 자료실에 있음 ✓');
 await expect(b.getByRole('link',{name:'안내문.pdf 자료실에서 보기'})).toHaveAttribute('data-basket-library-open','doc-drive-b');
 expect(f.sends).toHaveLength(2);expect(f.changed).toHaveLength(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 if(width===390)await page.screenshot({path:info.outputPath('library-send-390.png'),fullPage:true});
 // The edit view has no send controls; reading again brings them back with the same state.
 await noteAction(page,'[data-basket-edit]',{press:l=>press(page,l,width)});
 await expect(page.locator('[data-basket-library]')).toHaveCount(2);for(const box of await page.locator('[data-basket-library]').all())await expect(box).toBeHidden();
 await press(page,page.locator('[data-basket-cancel]'),width);
 await expect(f.meta('drive-a')).toHaveText('2.0 KB · 자료실에 있음 ✓');
 expect(f.errors).toEqual([]);
});

for(const width of [390,1280])test(`자료실에서 보기 opens the library at that document ${width}`,async({page})=>{
 const f=await fixture(page,width,route=>route.fulfill({json:{ok:true,result:'created',document:{id:'doc-drive-a',title:'회의 사진.jpg'}}}));
 await page.route(SB+'/rest/v1/app_documents?**',r=>r.fulfill({json:[{id:'doc-other',workspace_id:'w',title:'다른 자료',file_name:'other.pdf',project_id:null,meeting_id:null,created_at:stamp},{id:'doc-drive-a',workspace_id:'w',title:'회의 사진.jpg',file_name:'회의 사진.jpg',project_id:null,meeting_id:null,created_at:stamp}]}));
 const a=f.box('drive-a');
 await press(page,a.getByRole('button'),width);
 const link=a.getByRole('link',{name:'회의 사진.jpg 자료실에서 보기'});
 await expect(link).toHaveAttribute('href','./?view=library');
 await press(page,link,width);
 await expect(page.locator('#libraryView')).toBeVisible();
 await expect(page.locator('#documentList [data-lu-document="doc-drive-a"]')).toBeFocused();
 expect(f.sends).toHaveLength(1);
 expect(f.errors).toEqual([]);
});

test('an older server refuses before any change and the button stays usable',async({page})=>{
 const f=await fixture(page,390,route=>route.fulfill({status:400,json:{error:'document_id가 필요합니다.'}}));
 const a=f.box('drive-a');
 await press(page,a.getByRole('button'),390);
 await expect(f.result('drive-a')).toHaveText('자료실 보내기가 아직 준비되지 않았어요. 아무것도 바뀌지 않았어요.');
 await expect(a.getByRole('button')).toBeEnabled();await expect(a.getByRole('button')).toHaveText('자료실로 보내기');
 expect(f.sends).toHaveLength(1);expect(f.changed).toEqual([]);
 // Notes and links are not written by this flow.
 expect(f.errors.filter(e=>!/400/.test(e))).toEqual([]);
});

for(const [name,reply] of [['503 result unknown',route=>route.fulfill({status:503,json:{error:'x',code:'RESULT_UNKNOWN'}})],['lost response',route=>route.abort('failed')],['odd success body',route=>route.fulfill({json:{ok:true}})]])
test(`an unknown result (${name}) is reported and never sent again`,async({page})=>{
 const f=await fixture(page,390,reply);
 const a=f.box('drive-a');
 await press(page,a.getByRole('button'),390);
 await expect(f.result('drive-a')).toHaveText('자료실로 보냈는지 확인하지 못했어요. 다시 보내지 말고 자료실 목록에서 먼저 확인해 주세요.');
 // A state in the size line, not a button: there is nothing to press again and no document to link (only Drive).
 // The refusal/unknown line stays readable under the file (one line, not a passing notice).
 await expect(f.meta('drive-a')).toHaveText('2.0 KB · 자료실에서 확인해 주세요');
 const card=await page.locator('[data-basket-file-card="drive-a"] .basket-file-body').boundingBox(),line=await f.result('drive-a').boundingBox();
 expect(line.y).toBeGreaterThanOrEqual(card.y+card.height-1);
 await expect(a.getByRole('button')).toHaveCount(0);await expect(a.getByRole('link')).toHaveText(['Drive에서 열기']);
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>setTimeout(r,50))));
 expect(f.sends).toHaveLength(1);expect(f.changed).toEqual([]);
 // The other attachment is independent.
 await expect(f.box('drive-b').getByRole('button')).toBeEnabled();
});

test('a slow send keeps the button off and a result after an account switch is not shown',async({page})=>{
 let release;const gate=new Promise(r=>release=r);
 const f=await fixture(page,390,async route=>{await gate;return route.fulfill({json:{ok:true,result:'created',document:{id:'doc-a',title:'x'}}});});
 const a=f.box('drive-a');
 await press(page,a.getByRole('button'),390);
 await expect(a.getByRole('button')).toHaveText('보내는 중…');await expect(a.getByRole('button')).toBeDisabled();
 await page.evaluate(()=>{const rt=window.KPTURuntime;const c=rt.context.read();rt.context.set({...c,workspace:{...c.workspace,id:'other-workspace'}});window.dispatchEvent(new CustomEvent('kptu:session-changed',{detail:{session:rt.session.read()}}));});
 const done=page.waitForResponse(r=>r.url().includes('/functions/v1/document-actions'));release();await done;
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>setTimeout(r,50))));
 await expect(page.locator('[data-basket-library-status]:has-text("자료실로 보냈어요")')).toHaveCount(0);await expect(page.locator('#toast')).not.toContainText('자료실로 보냈어요');
 expect(f.sends).toHaveLength(1);
});

// LIB-AI자동분류 ⑤: a newly sent attachment gets the same AI fill as an upload (text read, then fill), with no wait,
// no extra notice and no AI marker. An existing registration ('exists') is not filled again. AI failure changes nothing on screen.
test('a newly sent attachment is filled in the background like an upload',async({page})=>{
 const DOC='e0000000-0000-4000-8000-0000000000aa',fills=[];
 const f=await fixture(page,390,(route,body)=>body.action==='document-text'?route.fulfill({json:{ok:true,status:'error',reason:'unsupported'}})
  :route.fulfill({json:{ok:true,result:body.drive_file_id==='drive-a'?'created':'exists',document:{id:body.drive_file_id==='drive-a'?DOC:'doc-b',title:'x'}}}));
 // Registered after the home fixture's catch-all so this route wins (Playwright uses the latest matching route).
 await page.route(SB+'/functions/v1/ai-assist',async route=>{fills.push(route.request().postDataJSON());return route.fulfill({status:503,json:{ok:false,error:'ai_busy',message:'x'}});});
 await press(page,f.box('drive-a').getByRole('button'),390);
 await expect(page.locator('#toast')).toHaveText('자료실로 보냈어요. 바구니와 같은 Drive 원본을 씁니다.');
 await expect.poll(()=>fills.length).toBe(1);
 expect(fills[0]).toEqual({kind:'library_fill',mode:'fill',document_ids:[DOC],keep:[]});
 expect(f.sends).toEqual([{action:'register-basket-attachment',note_id:n,drive_file_id:'drive-a'},{action:'document-text',document_id:DOC}]);
 await press(page,f.box('drive-b').getByRole('button'),390);
 await expect(page.locator('#toast')).toHaveText('이미 자료실에 있어요.');
 await page.waitForTimeout(300);expect(fills.length).toBe(1);
 await expect(f.meta('drive-a')).toHaveText('2.0 KB · 자료실에 있음 ✓');
 expect(await page.locator('[data-basket-file-card]').allInnerTexts()).not.toContainEqual(expect.stringMatching(/AI/));
});
