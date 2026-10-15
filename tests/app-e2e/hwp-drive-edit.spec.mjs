import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {openHome} from './helpers/home-entry.mjs';
import {testOrigin} from './helpers/test-origin.mjs';
import {servePagesCors} from './helpers/hwp-editor.mjs';
// HWP-편집기 2단계: [편집] on an HWP/HWPX library document or basket attachment opens the sandboxed editor with the
// Drive file (document-actions hwp-open). [새 파일로 저장] is the default (library-files / basket-files); [원본에 덮어쓰기]
// is offered for HWP originals only, after one confirmation, and sends the revision seen at open. Unknown results are
// never sent again; an older server refuses before anything changes.
test.use({hasTouch:true});
test.setTimeout(120000);
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',stamp='2026-10-06T01:00:00.123456+00:00';
const DOC='20000000-0000-4000-8000-000000000001',NOTE='10000000-0000-4000-8000-000000000001';
const HWP=readFileSync(new URL('../fixtures/hwp-lab/sample.hwp',import.meta.url)),HWPX=readFileSync(new URL('../fixtures/hwp-lab/sample.hwpx',import.meta.url));
const MD5A='a'.repeat(32),MD5B='b'.repeat(32);
const docs=[
  {id:DOC,workspace_id:'w',title:'주간보고',file_name:'주간보고.hwp',file_id:'drive-hwp',category:'회의자료',source:null,document_date:'2026-10-05',project_id:null,meeting_id:null,tags:['인력'],created_at:stamp},
  {id:'20000000-0000-4000-8000-000000000002',workspace_id:'w',title:'안내문',file_name:'안내문.pdf',file_id:'drive-pdf',category:'기타',project_id:null,meeting_id:null,tags:[],created_at:stamp},
];
const attachments=[{drive_file_id:'drive-hwpx',file_name:'안건.hwpx',mime_type:'application/octet-stream',size_bytes:HWPX.length},{drive_file_id:'drive-jpg',file_name:'사진.jpg',mime_type:'image/jpeg',size_bytes:10}];
const cors={'access-control-allow-origin':'*','access-control-expose-headers':'X-Web2-Hwp'};
const info=(o={})=>({source:'library',file_name:'주간보고.hwp',format:'hwp',size:HWP.length,revision:'rev-1',md5:MD5A,can_overwrite:true,shared:false,...o});
const opened=(route,bytes,meta)=>route.fulfill({status:200,headers:{...cors,'content-type':'application/octet-stream','x-web2-hwp':encodeURIComponent(JSON.stringify(meta))},body:bytes});

// Field values and the file bytes of a multipart body.
function multipart(request){
  const type=request.headers()['content-type']||'',boundary=type.split('boundary=')[1],raw=request.postDataBuffer();
  const parts={},text=raw.toString('latin1');
  for(const chunk of text.split('--'+boundary).slice(1,-1)){
    const [head,...rest]=chunk.split('\r\n\r\n'),body=rest.join('\r\n\r\n').replace(/\r\n$/,'');
    const name=/name="([^"]+)"/.exec(head)?.[1],file=/filename="([^"]*)"/.exec(head)?.[1];
    parts[name]=file!==undefined?{file:Buffer.from(file,'latin1').toString('utf8'),bytes:[...Buffer.from(body,'latin1').subarray(0,4)]}:Buffer.from(body,'latin1').toString('utf8');
  }
  return parts;
}

async function fixture(page,width,{open,library,basket,overwrite}={}){
  await page.setViewportSize({width,height:width<761?844:900});
  await servePagesCors(page);
  const sent={open:[],library:[],basket:[],overwrite:[]},errors=[],external=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',request=>{const url=new URL(request.url());if(['http:','https:'].includes(url.protocol)&&url.origin!==testOrigin&&url.origin!==SB)external.push(request.url())});
  await openHome(page);
  for(const t of ['app_suborganizations','app_suborganization_assignees','app_spaces','app_record_links','app_meetings'])await page.route(SB+'/rest/v1/'+t+'?**',r=>r.fulfill({json:[]}));
  await page.route(SB+'/rest/v1/app_documents?**',r=>r.fulfill({json:docs}));
  const note={id:NOTE,workspace_id:'w',occurred_at:stamp,updated_at:stamp,raw_text:'회의 안건 메모',ai_export_allowed:true,archived_at:null,attachments,metadata:{}};
  await page.route(SB+'/rest/v1/app_notes?**',r=>{const q=new URL(r.request().url()).searchParams;if(q.get('metadata'))return r.fulfill({json:[]});return r.fulfill({json:[note].slice(Number(q.get('offset')||0))})});
  await page.route(SB+'/functions/v1/document-actions',async route=>{
    const request=route.request();
    if(request.method()==='OPTIONS')return route.fulfill({status:200,headers:cors});
    if((request.headers()['content-type']||'').startsWith('multipart/')){const body=multipart(request);sent.overwrite.push(body);return overwrite?overwrite(route,body,sent.overwrite.length):route.fulfill({status:500,headers:cors,json:{}})}
    const body=request.postDataJSON();sent.open.push(body);
    if(open)return open(route,body);
    return body.document_id?opened(route,HWP,info()):opened(route,HWPX,info({source:'basket',file_name:'안건.hwpx',format:'hwpx',size:HWPX.length,can_overwrite:false}));
  });
  await page.route(SB+'/functions/v1/library-files',route=>{const body=multipart(route.request());sent.library.push(body);return library?library(route,body):route.fulfill({headers:cors,json:{ok:true,document:{id:'doc-new',title:body.title}}})});
  await page.route(SB+'/functions/v1/basket-files',route=>{const body=multipart(route.request());sent.basket.push(body);return basket?basket(route,body):route.fulfill({headers:cors,json:{ok:true,note_id:NOTE,attachments:[...attachments,{drive_file_id:'drive-new',file_name:body.file.file,mime_type:'application/x-hwp',size_bytes:100}]}})});
  return {sent,errors,external};
}
const press=async(page,locator,width)=>{await expect(locator).toBeVisible();if(width<761)await locator.tap();else await locator.click();};
async function editLibraryDocument(page,width){
  await page.evaluate(()=>window.KPTURouter.go('library'));
  await press(page,page.locator(`[data-lu-menu="${docs[1].id}"]`),width);
  await expect(page.locator('#luMorePanel [data-lu-hwp-edit]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await press(page,page.locator(`[data-lu-menu="${DOC}"]`),width);
  await expect(page.locator('#luMorePanel button').first()).toHaveText('편집');
  await press(page,page.locator('#luMorePanel [data-lu-hwp-edit]'),width);
  await expect(page.locator('#hwp-labView')).toBeVisible();
}
const status=page=>page.locator('#hwpLabStatus');
async function typeInEditor(page,width,text){
  const editor=page.frameLocator('#hwpLabEditor iframe');
  await editor.locator('#scroll-container').click({position:{x:width<761?60:200,y:width<761?60:120}});
  await page.keyboard.press('Control+Home');
  await page.keyboard.type(text);
}

for(const width of [390,1280])test(`a library HWP opens from Drive and is saved as a new library document by default ${width}`,async({page},info_)=>{
  const f=await fixture(page,width);
  await editLibraryDocument(page,width);
  await expect(page.locator('#hwpLabTitle')).toHaveText('HWP 편집');
  await expect(status(page)).toHaveText('주간보고.hwp · 1쪽을 열었어요. 고친 뒤 [새 파일로 저장]을 누르세요.',{timeout:60000});
  await expect(page.locator('#hwpLabEditor iframe')).toHaveAttribute('sandbox','allow-scripts');
  await expect(page.locator('#hwpLabPick')).toBeHidden();
  await expect(page.getByRole('button',{name:'새 파일로 저장'})).toBeEnabled();
  await expect(page.getByRole('button',{name:'원본에 덮어쓰기'})).toBeVisible();
  // Only the document ID goes to the server; the file and workspace come from the server row.
  expect(f.sent.open).toEqual([{action:'hwp-open',document_id:DOC}]);
  await typeInEditor(page,width,'고친문장');
  await press(page,page.getByRole('button',{name:'새 파일로 저장'}),width);
  await expect(status(page)).toHaveText('자료실에 새 문서로 등록했어요. 원본은 그대로예요.',{timeout:30000});
  expect(f.sent.library).toHaveLength(1);
  const saved=f.sent.library[0];
  expect(saved.file).toEqual({file:'주간보고-수정.hwp',bytes:[0xd0,0xcf,0x11,0xe0]});
  expect({title:saved.title,category:saved.category,document_date:saved.document_date,tags:saved.tags,project:saved.project_id,meeting:saved.meeting_id}).toEqual({title:'주간보고 (수정)',category:'회의자료',document_date:'2026-10-05',tags:'인력',project:undefined,meeting:undefined});
  expect(f.sent.overwrite).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info_.outputPath(`hwp-drive-${width}.png`)});
  // [자료실에서 보기] shows the new document in the library.
  await page.route(SB+'/rest/v1/app_documents?**',r=>r.fulfill({json:[...docs,{...docs[0],id:'doc-new',title:'주간보고 (수정)',file_name:'주간보고-수정.hwp'}]}));
  await press(page,page.getByRole('link',{name:'자료실에서 보기'}),width);
  await expect(page.locator('#libraryView')).toBeVisible();
  await expect(page.locator('#documentList [data-lu-document="doc-new"]')).toBeFocused();
  expect(f.external).toEqual([]);
  expect(f.errors).toEqual([]);
});

test('overwrite asks once, says both sides change for a shared file, and sends the opened revision with a backup first',async({page})=>{
  const replies=[{ok:true,result:'overwritten',backup:{id:'b1',name:'주간보고 편집 전 백업 2026-10-06 1000.hwp'},revision:'rev-2',md5:MD5B,size:9}];
  const f=await fixture(page,390,{
    open:(route)=>opened(route,HWP,info({shared:true})),
    overwrite:(route,body,n)=>route.fulfill({headers:cors,json:{...replies[0],revision:'rev-'+(n+1)}}),
  });
  await editLibraryDocument(page,390);
  await expect(status(page)).toHaveText(/이 파일은 바구니와 자료실이 같은 원본을 써요/,{timeout:60000});
  const dialogs=[];
  page.once('dialog',dialog=>{dialogs.push(dialog.message());void dialog.dismiss()});
  await press(page,page.getByRole('button',{name:'원본에 덮어쓰기'}),390);
  await expect.poll(()=>dialogs.length).toBe(1);
  expect(dialogs[0]).toContain('바구니와 자료실 양쪽에 반영돼요.');
  expect(dialogs[0]).toContain('Web2 편집 백업');
  expect(f.sent.overwrite).toEqual([]);

  page.once('dialog',dialog=>void dialog.accept());
  await press(page,page.getByRole('button',{name:'원본에 덮어쓰기'}),390);
  await expect(status(page)).toHaveText('원본에 덮어썼어요. 고치기 전 사본은 Drive "Web2 편집 백업" 폴더에 "주간보고 편집 전 백업 2026-10-06 1000.hwp"으로 보관했어요.',{timeout:30000});
  expect(f.sent.overwrite).toHaveLength(1);
  const {file,...fields}=f.sent.overwrite[0];
  expect(fields).toEqual({action:'hwp-overwrite',document_id:DOC,base_revision:'rev-1',base_md5:MD5A,confirm_shared:'1'});
  expect(file.bytes).toEqual([0xd0,0xcf,0x11,0xe0]);
  // The next overwrite builds on the revision the server returned.
  page.once('dialog',dialog=>void dialog.accept());
  await press(page,page.getByRole('button',{name:'원본에 덮어쓰기'}),390);
  await expect.poll(()=>f.sent.overwrite.length).toBe(2);
  expect(f.sent.overwrite[1].base_revision).toBe('rev-2');
  expect(f.sent.overwrite[1].base_md5).toBe(MD5B);
  expect(f.sent.library).toEqual([]);
  expect(f.errors).toEqual([]);
});

for(const width of [390,1280])test(`a basket HWPX attachment is saved as a new HWP attachment of the same note, never overwritten ${width}`,async({page})=>{
  const f=await fixture(page,width);
  await page.evaluate(()=>window.KPTURouter.go('basket'));
  await page.locator('[data-basket-filter="all"]').click();
  await press(page,page.locator(`[data-basket-row="${NOTE}"]`),width);
  await expect(page.locator('[data-basket-hwp="drive-jpg"]')).toHaveCount(0);
  await press(page,page.getByRole('button',{name:'안건.hwpx 편집'}),width);
  await expect(status(page)).toHaveText('안건.hwpx · 1쪽을 열었어요. HWPX 원본은 새 HWP 파일로만 저장해요. 고친 뒤 [새 파일로 저장]을 누르세요.',{timeout:60000});
  expect(f.sent.open).toEqual([{action:'hwp-open',note_id:NOTE,drive_file_id:'drive-hwpx'}]);
  await expect(page.getByRole('button',{name:'원본에 덮어쓰기'})).toBeHidden();
  await press(page,page.getByRole('button',{name:'새 파일로 저장'}),width);
  await expect(status(page)).toHaveText('같은 메모에 새 첨부로 추가했어요. 원본은 그대로예요.',{timeout:30000});
  expect(f.sent.basket).toEqual([{file:{file:'안건-수정.hwp',bytes:[0xd0,0xcf,0x11,0xe0]},note_id:NOTE}]);
  // [돌아가기] returns to the same note.
  await press(page,page.getByRole('button',{name:'돌아가기'}),width);
  await expect(page.locator('#basketView')).toBeVisible();
  await expect(page.locator('[data-basket-read-text]')).toContainText('회의 안건 메모');
  expect(f.sent.overwrite).toEqual([]);
  expect(f.external).toEqual([]);
  expect(f.errors).toEqual([]);
});

test('before the server is deployed, [편집] changes nothing and offers no save',async({page})=>{
  const f=await fixture(page,390,{open:route=>route.fulfill({status:400,headers:cors,json:{error:'Unknown action'}})});
  await editLibraryDocument(page,390);
  await expect(status(page)).toHaveText('HWP 편집 서버가 아직 준비되지 않았어요. 아무것도 바뀌지 않았어요.',{timeout:60000});
  await expect(page.getByRole('button',{name:'새 파일로 저장'})).toBeDisabled();
  await expect(page.getByRole('button',{name:'원본에 덮어쓰기'})).toBeHidden();
  expect(f.sent.open).toHaveLength(1);
  expect([f.sent.library,f.sent.basket,f.sent.overwrite]).toEqual([[],[],[]]);
});

test('unknown results are never sent again; a changed original keeps only [새 파일로 저장]',async({page})=>{
  let overwriteReply=route=>route.fulfill({status:503,headers:cors,json:{error:'x',code:'RESULT_UNKNOWN'}});
  const f=await fixture(page,1280,{library:route=>route.abort('failed'),overwrite:route=>overwriteReply(route)});
  await editLibraryDocument(page,1280);
  await expect(status(page)).toHaveText(/1쪽을 열었어요/,{timeout:60000});
  await page.getByRole('button',{name:'새 파일로 저장'}).click();
  await expect(status(page)).toHaveText('저장했는지 확인하지 못했어요. 다시 저장하지 말고 자료실에서 먼저 확인해 주세요.',{timeout:30000});
  await expect(page.getByRole('button',{name:'새 파일로 저장'})).toBeDisabled();
  expect(f.sent.library).toHaveLength(1);

  page.once('dialog',dialog=>void dialog.accept());
  await page.getByRole('button',{name:'원본에 덮어쓰기'}).click();
  await expect(status(page)).toHaveText('덮어쓰기 결과를 확인하지 못했어요. 다시 저장하지 말고 Drive에서 원본을 먼저 확인해 주세요.',{timeout:30000});
  await expect(page.getByRole('button',{name:'원본에 덮어쓰기'})).toBeDisabled();
  expect(f.sent.overwrite).toHaveLength(1);
});

test('a changed Drive original is not overwritten and unsaved edits are not dropped silently',async({page})=>{
  const f=await fixture(page,390,{overwrite:route=>route.fulfill({status:409,headers:cors,json:{error:'x',code:'VERSION_CHANGED'}})});
  await editLibraryDocument(page,390);
  await expect(status(page)).toHaveText(/1쪽을 열었어요/,{timeout:60000});
  await typeInEditor(page,390,'추가');
  page.once('dialog',dialog=>void dialog.accept());
  await press(page,page.getByRole('button',{name:'원본에 덮어쓰기'}),390);
  await expect(status(page)).toHaveText('연 뒤에 Drive의 원본이 바뀌어 덮어쓰지 않았어요. [새 파일로 저장]을 써 주세요.',{timeout:30000});
  await expect(page.getByRole('button',{name:'원본에 덮어쓰기'})).toBeDisabled();
  await expect(page.getByRole('button',{name:'새 파일로 저장'})).toBeEnabled();
  // Leaving with unsaved edits asks first; staying keeps the editor.
  const asked=[];
  page.once('dialog',dialog=>{asked.push(dialog.message());void dialog.dismiss()});
  await press(page,page.getByRole('button',{name:'돌아가기'}),390);
  await expect.poll(()=>asked.length).toBe(1);
  expect(asked[0]).toContain('저장하지 않은 고친 내용');
  await expect(page.locator('#hwp-labView')).toBeVisible();
  expect(f.sent.overwrite).toHaveLength(1);
  expect(f.errors).toEqual([]);
});
