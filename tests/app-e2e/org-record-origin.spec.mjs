import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
// ORG-기록첨부표시이름 ①(S61-6, B안): 조직 기록 입력칸에서 바로 올린 기록(연결 origin 'record_input')은 일반 기록처럼 날짜만 —
// '잊지 말기 연결' 이름표·표시 아이콘 없음. 잊지 말기에서 옮긴 연결('basket')과 표시가 없는 지난 연결(null)은 지금처럼 '잊지 말기 연결'.
// 저장은 실제 화면 길(입력칸 → app_basket_confirm_links에 origin 'record_input')이고, 가짜 서버가 받은 origin을 그대로 돌려준다. 자료는 모두 가짜.
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const at='2026-11-12T01:00:00Z';
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
const png=name=>({name,mimeType:'image/png',buffer:PNG});
const OLD_BASKET='55555555-0000-4000-8000-000000000001',OLD_NULL='55555555-0000-4000-8000-000000000002';

async function fixture(page,width){
 await page.setViewportSize({width,height:width>900?800:915});
 const errors=[],rpc=[];page.on('pageerror',e=>errors.push(e.message));
 await openHome(page);
 let stamp=10,seq=0;
 const notes=[
  {id:'nb',workspace_id:'w',kind:'basket',title:null,raw_text:'잊지 말기에서 옮긴 합성 회의 메모',occurred_at:'2026-11-10T02:00:00Z',created_at:at,updated_at:at,archived_at:null,ai_export_allowed:true,attachments:[],metadata:{}},
  {id:'nn',workspace_id:'w',kind:'basket',title:null,raw_text:'예전에 이은 합성 기록',occurred_at:'2026-11-09T02:00:00Z',created_at:at,updated_at:at,archived_at:null,ai_export_allowed:true,attachments:[],metadata:{}},
 ];
 const links=[
  {id:OLD_BASKET,workspace_id:'w',summary:null,origin:'basket',note_id:'nb',organization_id:'o',project_id:null,status:'confirmed'},
  {id:OLD_NULL,workspace_id:'w',summary:null,origin:null,note_id:'nn',organization_id:'o',project_id:null,status:'confirmed'},
 ];
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',async r=>{
  const req=r.request(),q=new URL(req.url()).searchParams;
  if(req.method()==='GET'){const id=q.get('id');return r.fulfill({json:(id?notes.filter(n=>'eq.'+n.id===id):notes).map(n=>structuredClone(n))});}
  if(req.method()==='POST'){const body=req.postDataJSON(),row={id:'up-'+(++seq),workspace_id:'w',kind:'basket',title:null,occurred_at:'2026-11-12T03:00:00Z',created_at:at,updated_at:`2026-11-12T03:00:${String(stamp++).padStart(2,'0')}Z`,archived_at:null,ai_export_allowed:true,attachments:[],metadata:{},...body};notes.unshift(row);return r.fulfill({status:201,json:[structuredClone(row)]});}
  return r.fallback();
 });
 // 연결 목록: 가짜 서버가 저장한 연결(받은 origin 그대로) + 메모.
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_record_links',r=>r.request().method()==='GET'?r.fulfill({json:links.map(l=>({...l,note:structuredClone(notes.find(n=>n.id===l.note_id))}))}):r.fallback());
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/rpc/app_basket_confirm_links',r=>{
  const body=r.request().postDataJSON();rpc.push(body);
  for(const t of body.p_targets)links.push({id:'66666666-0000-4000-8000-00000000000'+links.length,workspace_id:'w',summary:t.summary??null,origin:t.origin??null,note_id:body.p_note_id,organization_id:t.kind==='organization'?t.target_id:null,project_id:t.kind==='project'?t.target_id:null,status:'confirmed'});
  return r.fulfill({json:{ok:true,created:body.p_targets.length,existing:0}});
 });
 await page.route(u=>u.origin===SB&&u.pathname==='/functions/v1/document-actions',r=>{const b=r.request().postDataJSON();return r.fulfill({json:{ok:true,result:'created',document:{id:'doc-'+b.drive_file_id,title:'합성 자료'}}});});
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_documents',r=>{
  if(r.request().method()!=='PATCH')return r.fallback();
  const id=new URL(r.request().url()).searchParams.get('id').slice(3),b=r.request().postDataJSON();
  return r.fulfill({json:[{id,project_id:b.project_id??null,organization_id:b.organization_id??null,file_id:id.slice(4)}]});
 });
 await page.route(u=>u.origin===SB&&u.pathname==='/functions/v1/basket-files',async r=>{
  const req=r.request();
  if(req.method()==='GET'){const action=new URL(req.url()).searchParams.get('action');if(action==='photo')return r.fulfill({status:200,contentType:'image/png',body:PNG});return r.fulfill({json:{ok:false,code:'OCR_UNSUPPORTED'}});}
  const raw=req.postDataBuffer()?.toString('latin1')||'',noteId=raw.match(/name="note_id"\r\n\r\n([^\r]+)/)?.[1]||null,name=Buffer.from(raw.match(/filename="([^"]*)"/)?.[1]||'','latin1').toString('utf8');
  const row=notes.find(n=>n.id===noteId);if(!row)return r.fulfill({status:404,json:{error:'없음',code:'note_not_found'}});
  row.attachments=[...row.attachments,{drive_file_id:'drv'+row.attachments.length+name.length,file_name:name,mime_type:'image/png',size_bytes:4}];
  row.updated_at=`2026-11-12T04:00:${String(stamp++).padStart(2,'0')}Z`;
  return r.fulfill({json:{ok:true,note_id:row.id,attachments:row.attachments}});
 });
 await clickView(page,'team');await page.locator('[data-so-org="o"]').first().click();
 await expect(page.locator('#wdModal')).toBeVisible();
 return {errors,rpc,links,row:id=>page.locator(`#wdUpdates [data-basket-link="${id}"]`)};
}
const shot=async(page,name)=>{if(process.env.S61_6_SHOTS)await page.screenshot({path:`docs/design/screens/s61-6/${name}.png`})};

for(const width of [412,1280]){
 test(`조직 기록 입력칸에 사진 3장+글 저장 → 일반 기록처럼 날짜만, 잊지 말기에서 옮긴 것·지난 것은 '잊지 말기 연결' ${width}`,async({page})=>{
  const f=await fixture(page,width);
  // 지난 연결 두 줄: 둘 다 '잊지 말기 연결'(표시 아이콘 포함).
  for(const id of [OLD_BASKET,OLD_NULL]){
   await expect(f.row(id).locator('.basket-link-open small')).toContainText('잊지 말기 연결');
   await expect(f.row(id).locator('[data-record-mark]')).toHaveCount(1);
   await expect(f.row(id).locator('[data-basket-link-menu]')).toHaveAttribute('aria-label','잊지 말기 기록 메뉴');
  }
  await page.locator('#wdInboxText').fill('합성 지부 간담회 결과');
  await page.locator('#wdInboxAttach').setInputFiles([png('간담회 1.png'),png('간담회 2.png'),png('간담회 3.png')]);
  await expect(page.locator('#wdInboxFiles [data-basket-file]')).toHaveCount(3);
  await page.locator('#wdInboxSave').click();
  await expect(page.locator('#wdInboxState')).toHaveText('저장했어요.');
  expect(f.rpc.map(c=>c.p_targets)).toEqual([[{kind:'organization',target_id:'o',reason:'직접 연결',origin:'record_input'}]]);
  const made=f.links.at(-1).id,row=f.row(made);
  await expect(row.locator('[data-link-summary-text]')).toHaveText('합성 지부 간담회 결과');
  await expect(row.locator('.basket-link-open small')).not.toContainText('잊지 말기');
  await expect(row.locator('.basket-link-open small time')).toHaveText(/2026/);
  await expect(row.locator('[data-record-mark]')).toHaveCount(0);
  await expect(row.locator('[data-basket-link-menu]')).toHaveAttribute('aria-label','기록 메뉴');
  // 사진 3장이 다 올라간 뒤 목록을 다시 읽으면 그 줄 아래 사진 띠가 [사진 3]이 된다(이름표는 그대로 없음).
  await expect(page.locator('#uploadDock:not([hidden])')).toContainText('사진 3장 올렸어요');
  await page.evaluate(()=>window.dispatchEvent(new Event('kptu:basket-links-changed')));
  await expect(row.locator('[data-record-photos] > summary')).toContainText('사진 3');
  await expect(row.locator('.basket-link-open small')).not.toContainText('잊지 말기');
  await expect(f.row(OLD_BASKET).locator('.basket-link-open small')).toContainText('잊지 말기 연결');
  await row.evaluate(el=>el.scrollIntoView({block:'start'}));
  await shot(page,`org-records-${width}`);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(f.errors).toEqual([]);
 });
}
