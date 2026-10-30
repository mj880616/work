import {selectFilter,filterOptions} from './helpers/filter-chips.mjs';
import {expandLibraryTree,revealLibraryRow} from './helpers/library-tree.mjs';
import {test,expect} from '@playwright/test';
import {clickView} from './helpers/shell-navigation.mjs';
import {fillDateTime} from './helpers/date-time.mjs';
import { signInWithSession } from './helpers/session-login.mjs';
import {showAllLibraryCategories} from './helpers/library-categories.mjs';
import {openMeetingResult,closeMeetingResult} from './helpers/meeting-open.mjs';
// 회의 목록의 회의자료 표시: 폰은 줄의 "회의자료 있음", PC 3단(MEET-결과3단)은 가운데 줄에 표시가 없고 오른쪽 결과의 회의자료 줄 수로 본다.
async function expectMeetingDocs(page,width,count){
  if(width<761){await expect(page.locator('#meetingList')).toContainText('회의자료 있음');return}
  await expect(page.locator('#meetingList .mcol-rounds')).not.toContainText('회의자료 있음');
  await expect(page.locator('#meetingList #mcolResult #mrdMaterials .mrd-file-row')).toHaveCount(count);
}


const BASE=process.env.APP_E2E_ORIGIN||'http://127.0.0.1:8123';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const DELETE_CONFIRM='“first.pdf” 자료 등록을 삭제할까요?\n파일도 Drive 휴지통으로 이동할 수 있습니다. 삭제 결과에서 원본 보존 여부를 확인해 주세요.';
const DELETE_LEGACY='자료 등록을 삭제했습니다. Drive 파일 처리 결과는 확인하지 못했습니다. 원본 상태를 직접 확인해 주세요.';
const DELETE_UNKNOWN='삭제 결과를 확인하지 못했습니다. 다시 삭제하지 말고 자료실 목록 또는 사업 보고 자료를 다시 열어 확인해 주세요. Drive 원본 상태도 직접 확인해 주세요.';
const DELETE_AUTH='로그인 세션을 확인하지 못했습니다. 다시 로그인한 뒤 자료 목록과 원본 상태를 먼저 확인해 주세요.';
const file=name=>({name,mimeType:'application/pdf',buffer:Buffer.from(name)});
const selectionDraft=page=>page.evaluate(()=>{const detail={otherDraft:false};window.dispatchEvent(new CustomEvent('kptu:before-reload',{detail}));return detail.otherDraft});
const meeting={id:'meeting-1',workspace_id:'ws',title:'자료 확인 회의',series_name:'자료 확인 회의',meeting_at:'2026-10-10T10:00:00Z',transcript_text:'회의 원문',created_by:'owner'};

async function boot(page,width){
  await page.setViewportSize({width,height:900});
  const state={docs:['first.pdf','second.pdf'].map((name,i)=>({id:'doc-'+i,workspace_id:'ws',meeting_id:meeting.id,file_name:name,title:name,category:'회의자료',tags:[],created_at:'2026-10-10T00:00:00Z'})),deletes:[],uploads:[],error:null,hold:false,release:null,errors:[],refreshes:0,deleteStatus:200,deletePayload:{ok:true}};
  page.on('pageerror',e=>state.errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')state.errors.push(m.text())});
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
    if(path==='/auth/v1/token'){if(url.searchParams.get('grant_type')==='refresh_token')state.refreshes++;return ok({access_token:'test-access',refresh_token:'test-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'owner'}});}
    if(path==='/auth/v1/user')return ok({id:'owner',email:'owner@example.org'});
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:'ws',user_id:'owner',role:'owner',workspace:{id:'ws',name:'테스트'}}]);
    if(path==='/rest/v1/app_workspaces')return ok([{id:'ws',name:'테스트'}]);
    if(path==='/rest/v1/app_meetings')return ok([{...meeting,...(req.method()==='POST'?req.postDataJSON():{})}]);
    if(path==='/rest/v1/app_documents'){
      const id=url.searchParams.get('id')?.replace(/^eq\./,''),mid=url.searchParams.get('meeting_id')?.replace(/^eq\./,'');
      return ok(state.docs.filter(d=>(!id||d.id===id)&&(!mid||d.meeting_id===mid)));
    }
    if(path==='/functions/v1/document-actions'){
      state.deletes.push(req.postDataJSON());
      if(state.deleteStatus!==200&&!(state.deleteStatus===401&&state.deletes.length>1))return route.fulfill({status:state.deleteStatus,json:state.deletePayload});
      if(state.error)return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:state.error})});
      state.docs=state.docs.filter(d=>d.id!==req.postDataJSON().document_id);
      return ok(state.deletePayload);
    }
    if(['/functions/v1/library-files','/functions/v1/meeting-files'].includes(path)){
      const raw=req.postDataBuffer().toString('utf8');
      state.uploads.push({path,raw});
      if(state.hold)await new Promise(resolve=>state.release=resolve);
      const name=raw.match(/filename="([^"]+)"/)?.[1];
      const doc={id:'uploaded-'+state.uploads.length,workspace_id:'ws',file_name:name,title:name,tags:[],meeting_id:path.endsWith('meeting-files')||raw.includes('name="meeting_id"')?meeting.id:null};
      state.docs.push(doc);
      return ok({ok:true,document:doc});
    }
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[]});
    if(path==='/functions/v1/google-tasks')return ok({tasks:[]});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    return ok([]);
  });
  await page.goto(`${BASE}/app/login/?return=${encodeURIComponent(BASE+'/app/?view=meetings')}`);
  await signInWithSession(page,'owner@example.org');
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
  return state;
}

for(const width of [390,1280]){
  // LIB-바로지우기: 자료실 지우기는 확인창 없이 바로 빠지고 뒤에서 보낸다 — 자료실 쪽은 library-quick-delete.spec.mjs가 본다.
  for(const view of ['meetings'])test(`delete helper fetch failure preserves documents and offers retry guidance ${view} ${width}px`,async({page})=>{
    const state=await boot(page,width),pageErrors=[];
    page.on('pageerror',e=>pageErrors.push(e.message));
    await page.route('**/app/document-delete.js*',route=>route.abort());
    if(view==='meetings'){
      await openMeetingResult(page,'meeting-1');
      await expect(page.locator('#meetingRoundDetailModal')).toBeVisible();
    }else{
      await clickView(page,'library');
    await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('library'));
      await showAllLibraryCategories(page);await expandLibraryTree(page);// UI-PC자료실: 자료실은 기본으로 [회의]가 꺼져 있어 회의자료 분류 자료를 보려면 켠다. LIB-토글트리: 모두 편다.
      await page.locator('[data-lu-menu="doc-0"]').click();
    }
    const alerts=[];page.on('dialog',async d=>{alerts.push(d.message());await d.accept()});
    await page.locator(view==='meetings'?'[data-mrd-delete-document="doc-0"]':'[data-lu-delete="doc-0"]').click();
    await expect.poll(()=>alerts).toEqual(['자료를 삭제하지 못했습니다. 관리자에게 오류 확인을 요청해 주세요.']);
    expect(state.deletes).toEqual([]);expect(state.docs).toHaveLength(2);expect(pageErrors).toEqual([]);
  });
  test(`meeting material deletion confirms, cancels and refreshes all three lists ${width}px`,async({page})=>{
    const state=await boot(page,width);
    await expectMeetingDocs(page,width,2);
    await openMeetingResult(page,'meeting-1');
    await expect(page.locator('#mrdMaterials .mrd-file-row')).toHaveCount(2);
    const remove=page.locator('[data-mrd-delete-document="doc-0"]');
    let canceled=false;page.once('dialog',async d=>{expect(d.message()).toBe('“first.pdf” 자료 등록을 삭제할까요?\n파일도 Drive 휴지통으로 이동할 수 있습니다. 삭제 결과에서 원본 보존 여부를 확인해 주세요.');await d.dismiss();canceled=true});
    await remove.click();
    await expect.poll(()=>canceled).toBe(true);
    await expect(remove).toBeEnabled();
    expect(state.deletes).toEqual([]);
    await expect(page.locator('#mrdMaterials .mrd-file-row')).toHaveCount(2);
    const confirmed=[];page.on('dialog',async d=>{confirmed.push({type:d.type(),message:d.message()});if(d.type()==='confirm')expect(d.message()).toBe(DELETE_CONFIRM);else expect(d.message()).toBe(DELETE_LEGACY);await d.accept()});
    await remove.click();
    await expect(page.locator('#mrdMaterials .mrd-file-row')).toHaveCount(1);
    expect(state.deletes).toEqual([{action:'delete',document_id:'doc-0'}]);
    expect(confirmed.map(d=>d.type)).toEqual(['confirm','alert']);
    await closeMeetingResult(page);
    await expectMeetingDocs(page,width,1);
    await clickView(page,'library');
    await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('library'));
    await showAllLibraryCategories(page);// UI-PC자료실: 회의 분류는 기본으로 꺼져 있다.
    await expect(page.locator('[data-lu-document]')).toHaveCount(1);
    expect(state.errors).toEqual([]);
  });

  test(`failed meeting material deletion uses library error guidance and keeps lists ${width}px`,async({page})=>{
    const state=await boot(page,width);state.error='permission denied';
    await openMeetingResult(page,'meeting-1');
    const alerts=[];
    page.on('dialog',async d=>{if(d.type()==='confirm')await d.accept();else{alerts.push(d.message());await d.accept()}});
    await page.locator('[data-mrd-delete-document="doc-0"]').click();
    await expect.poll(()=>alerts).toEqual([DELETE_UNKNOWN]);
    await expect(page.locator('#mrdMaterials .mrd-file-row')).toHaveCount(2);
    await closeMeetingResult(page);
    await expectMeetingDocs(page,width,2);
    expect(state.deletes).toEqual([{action:'delete',document_id:'doc-0'}]);
  });

  test(`library cancellation controls request files, empty reselection and upload locks ${width}px`,async({page})=>{
    const state=await boot(page,width);
    await clickView(page,'library');
    await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('library'));
    await page.locator('#newDocumentBtn').click();
    const input=page.locator('#libraryFileInput'),rows=page.locator('[data-lu-upload-file]');
    await input.setInputFiles([file('keep-a.pdf'),file('remove.pdf'),file('keep-b.pdf')]);
    await expect(rows).toHaveCount(3);
    const remove=page.getByRole('button',{name:'remove.pdf 선택 취소',exact:true});
    await remove.focus();await page.keyboard.press('Enter');
    await expect(rows).toHaveCount(2);
    await expect(page.locator('#librarySelectedFiles')).not.toContainText('remove.pdf');
    state.hold=true;
    await page.locator('#saveDocumentBtn').click();
    await expect.poll(()=>state.uploads.length).toBe(1);
    await expect(page.getByRole('button',{name:'keep-a.pdf 선택 취소',exact:true})).toBeDisabled();
    await expect(page.getByRole('button',{name:'keep-b.pdf 선택 취소',exact:true})).toBeDisabled();
    await expect(input).toBeDisabled();
    await expect(page.locator('#newDocumentBtn')).toBeDisabled();
    state.release();
    await expect.poll(()=>state.uploads.length).toBe(2);
    await expect(page.locator('[data-lu-upload-file].success')).toHaveCount(1);
    await expect(page.locator('[data-lu-upload-file].success button')).toHaveCount(0);
    state.hold=false;state.release();
    await expect(page.locator('#documentModal')).toBeHidden();
    expect(state.uploads.every(u=>u.path.endsWith('library-files')&&!u.raw.includes('remove.pdf'))).toBe(true);
    expect(state.uploads.map(u=>u.raw.match(/filename="([^"]+)"/)?.[1])).toEqual(['keep-a.pdf','keep-b.pdf']);
    await page.locator('#newDocumentBtn').click();
    await input.setInputFiles([file('same.pdf')]);
    await page.getByRole('button',{name:'same.pdf 선택 취소',exact:true}).click();
    await expect(rows).toHaveCount(0);
    await input.setInputFiles([file('same.pdf')]);
    await expect(rows).toHaveCount(1);
    expect(state.errors).toEqual([]);
  });

  test(`new meeting cancellation sends only retained files and locks on save ${width}px`,async({page})=>{
    const state=await boot(page,width);
    await page.locator('#newMeetingBtn').click();
    await page.locator('#meetingNameSelect').selectOption('__other__');
    await page.locator('#meetingTitle').fill('새 회의');
    await fillDateTime(page,'#meetingAt','2026-10-10T10:00');
    await page.locator('#meetingTranscript').fill('회의 원문');
    await page.locator('#meetingFiles').setInputFiles([file('keep.pdf'),file('remove.pdf')]);
    expect(await selectionDraft(page)).toBe(true);
    const remove=page.getByRole('button',{name:'remove.pdf 선택 취소',exact:true});
    await remove.focus();await page.keyboard.press('Space');
    await expect(page.locator('#meetingSelectedFiles')).not.toContainText('remove.pdf');
    state.hold=true;
    await page.locator('#saveMeetingBtn').click();
    await expect.poll(()=>state.uploads.length).toBe(1);
    await expect(page.getByRole('button',{name:'keep.pdf 선택 취소',exact:true})).toBeDisabled();
    await expect(page.locator('#meetingFiles')).toBeDisabled();
    await expect(page.locator('#newMeetingBtn')).toBeDisabled();
    state.hold=false;state.release();
    await expect(page.locator('#meetingModal')).toBeHidden();
    expect(state.uploads).toHaveLength(1);
    // MEET-파일AI분류: 새 사업 보고의 자료도 자료실 올리기와 같은 요청(meeting_id로 연결)이다.
    expect(state.uploads[0].path).toBe('/functions/v1/library-files');
    expect(state.uploads[0].raw).toContain('name="meeting_id"');
    expect(state.uploads[0].raw).toContain('keep.pdf');
    expect(state.uploads[0].raw).not.toContain('remove.pdf');
    expect(state.errors).toEqual([]);
  });

  // MEET-파일AI분류: 사업 보고 상세의 자료 [+]는 담당조직·프로젝트와 같은 자료실 올리기 창을 연다. 대기 파일은 ×로 뺄 수 있고 [등록]하면 meeting_id로 이 사업 보고에 붙는다.
  test(`meeting detail [+] opens the shared library upload window and attaches to the report ${width}px`,async({page})=>{
    const state=await boot(page,width);
    await openMeetingResult(page,'meeting-1');
    await expect(page.locator('#meetingRoundDetailModal')).toBeVisible();
    await expect(page.locator('#mrdFiles')).toHaveCount(0);
    await page.locator('#mrdPickFiles').click();
    await expect(page.locator('#documentModal')).toBeVisible();
    await expect(page.locator('#libraryUploadMeeting')).toContainText('사업 보고');
    await page.locator('#libraryFileInput').setInputFiles([file('detail-keep.pdf'),file('detail-remove.pdf')]);
    await expect(page.locator('[data-lu-upload-file]')).toHaveCount(2);
    await page.getByRole('button',{name:'detail-remove.pdf 선택 취소',exact:true}).click();
    await expect(page.locator('[data-lu-upload-file]')).toHaveCount(1);
    await page.locator('#saveDocumentBtn').click();
    await expect(page.locator('#documentModal')).toBeHidden();
    await expect.poll(()=>state.uploads.length).toBe(1);
    expect(state.uploads[0].path).toBe('/functions/v1/library-files');
    expect(state.uploads[0].raw).toContain('name="meeting_id"');
    expect(state.uploads[0].raw).toContain('detail-keep.pdf');
    expect(state.uploads[0].raw).not.toContain('detail-remove.pdf');
    await expect(page.locator('#mrdMaterials .mrd-file-row')).toHaveCount(3);
    expect(state.errors).toEqual([]);
  });
}

// These checks fail if any screen sends the provider-backed original, reads the
// next file before the current request settles, or posts an unreadable file.
async function observeSelectedFiles(page){
  await page.addInitScript(()=>{
    const originals=new Set(),nativeRead=File.prototype.arrayBuffer,nativeFetch=window.fetch;
    window.__copyReads=[];window.__copyUploads=[];window.__copyFailName='';
    document.addEventListener('change',event=>{
      if(event.target.matches('input[type=file]'))for(const file of event.target.files)originals.add(file);
    },true);
    File.prototype.arrayBuffer=async function(){
      if(originals.has(this)){
        window.__copyReads.push(this.name);
        if(this.name===window.__copyFailName)throw new DOMException('mock provider read failed','NotReadableError');
      }
      return nativeRead.call(this);
    };
    window.fetch=function(url,options){
      if(/\/functions\/v1\/(library|meeting)-files$/.test(String(url))&&options?.body instanceof FormData){
        const sent=options.body.get('file'),source=[...originals].find(file=>file.name===sent.name);
        window.__copyUploads.push({isOriginal:originals.has(sent),name:sent.name,type:sent.type,lastModified:sent.lastModified,sourceModified:source.lastModified,size:sent.size,sourceSize:source.size});
      }
      return nativeFetch.apply(this,arguments);
    };
  });
}
async function openUploadScreen(page,screen){
  if(screen==='library'){
    await clickView(page,'library');
    await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('library'));
    await page.locator('#newDocumentBtn').click();
    return {input:'#libraryFileInput',save:'#saveDocumentBtn',rows:'[data-lu-upload-file]',status:'#documentStatus'};
  }
  if(screen==='new meeting'){
    await page.locator('#newMeetingBtn').click();
    await page.locator('#meetingNameSelect').selectOption('__other__');
    await page.locator('#meetingTitle').fill('사본 업로드 회의');
    await fillDateTime(page,'#meetingAt','2026-10-10T10:00');
    await page.locator('#meetingTranscript').fill('원문');
    return {input:'#meetingFiles',save:'#saveMeetingBtn',rows:'#meetingSelectedFiles > div',status:'#toast'};
  }
  await openMeetingResult(page,'meeting-1');
  await expect(page.locator('#meetingRoundDetailModal')).toBeVisible();
  // MEET-파일AI분류: 사업 보고 상세의 [+]는 자료실 올리기 창을 연다(저장 버튼 [등록]).
  await page.locator('#mrdPickFiles').click();
  await expect(page.locator('#documentModal')).toBeVisible();
  return {input:'#libraryFileInput',save:'#saveDocumentBtn',rows:'[data-lu-upload-file]',status:'#documentStatus'};
}
const READ_ERROR='파일을 읽지 못했습니다. 파일을 다시 선택해 주세요.';
for(const width of [390,1280])for(const screen of ['library','new meeting','meeting detail']){
  test(`memory copy: ${screen} sends metadata-preserving copies sequentially ${width}px`,async({page})=>{
    await observeSelectedFiles(page);
    const state=await boot(page,width),ui=await openUploadScreen(page,screen);
    state.hold=true;
    await page.locator(ui.input).setInputFiles([file('한글 자료.pdf'),file('second.pdf')]);
    if(ui.save){expect(await page.evaluate(()=>window.__copyReads)).toEqual([]);await page.locator(ui.save).click()}
    await expect.poll(()=>state.uploads.length).toBe(1);
    expect(await page.evaluate(()=>window.__copyReads)).toEqual(['한글 자료.pdf']);
    state.hold=false;state.release();
    await expect.poll(()=>state.uploads.length).toBe(2);
    if(ui.save)await expect(page.locator(ui.save)).toBeEnabled();
    const sent=await page.evaluate(()=>window.__copyUploads);
    expect(sent.map(file=>file.name)).toEqual(['한글 자료.pdf','second.pdf']);
    for(const file of sent){
      expect(file.isOriginal).toBe(false);
      expect(file.type).toBe('application/pdf');
      expect(file.lastModified).toBe(file.sourceModified);
      expect(file.size).toBe(file.sourceSize);
    }
    expect(state.uploads[0].raw).toContain('Content-Type: application/pdf');
    expect(state.uploads[0].raw).toContain('한글 자료.pdf');
    expect(await page.evaluate(()=>window.__copyReads)).toEqual(['한글 자료.pdf','second.pdf']);
    expect(state.errors).toEqual([]);
  });
  test(`memory copy: ${screen} read failure sends zero file requests ${width}px`,async({page})=>{
    await observeSelectedFiles(page);
    const state=await boot(page,width),ui=await openUploadScreen(page,screen);
    await page.evaluate(()=>window.__copyFailName='unreadable.pdf');
    await page.locator(ui.input).setInputFiles(file('unreadable.pdf'));
    if(ui.save)await page.locator(ui.save).click();
    await expect(page.locator(ui.status)).toContainText(READ_ERROR);
    await expect(page.locator(ui.rows)).toContainText(READ_ERROR);
    if(ui.save)await expect(page.locator(ui.save)).toBeEnabled();
    expect(state.uploads).toEqual([]);
    expect(await page.evaluate(()=>window.__copyUploads)).toEqual([]);
    expect(await page.evaluate(()=>window.__copyReads)).toEqual(['unreadable.pdf']);
    if(screen==='library'){
      await page.locator(ui.save).click();
      expect(state.uploads).toEqual([]);
      expect(await page.evaluate(()=>window.__copyReads)).toEqual(['unreadable.pdf']);
      await page.locator(ui.input).setInputFiles(file('reselected.pdf'));
      await page.locator(ui.save).click();
      await expect(page.locator('#documentModal')).toBeHidden();
      expect(state.uploads).toHaveLength(1);
    }
    expect(state.errors).toEqual([]);
  });
  test(`memory copy: ${screen} skips only the unreadable file ${width}px`,async({page})=>{
    await observeSelectedFiles(page);
    const state=await boot(page,width),ui=await openUploadScreen(page,screen);
    await page.evaluate(()=>window.__copyFailName='unreadable.pdf');
    await page.locator(ui.input).setInputFiles([file('unreadable.pdf'),file('good.pdf')]);
    if(ui.save)await page.locator(ui.save).click();
    await expect(page.locator(ui.status)).toContainText(READ_ERROR);
    if(ui.save)await expect(page.locator(ui.save)).toBeEnabled();
    expect(state.uploads).toHaveLength(1);
    expect(state.uploads[0].raw).toContain('good.pdf');
    expect(state.uploads[0].raw).not.toContain('unreadable.pdf');
    expect(await page.evaluate(()=>window.__copyReads)).toEqual(['unreadable.pdf','good.pdf']);
    expect(state.errors).toEqual([]);
  });
}

async function openDeleteControl(page,view){
  if(view==='meetings'){
    await openMeetingResult(page,'meeting-1');
    await expect(page.locator('#mrdMaterials .mrd-file-row')).toHaveCount(2);
  }else{
    await clickView(page,'library');await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('library'));
    await showAllLibraryCategories(page);// UI-PC자료실: 회의 분류는 기본으로 꺼져 있다.
    await expandLibraryTree(page);await page.locator('[data-lu-menu="doc-0"]').click();
  }
  expect(await page.evaluate(()=>({owner:window.KPTURuntime.session.read()?.user?.id,token:!!window.KPTURuntime.session.read()?.access_token,workspace:window.KPTURuntime.context.read()?.workspace?.id,view:window.KPTURouter.current}))).toEqual({owner:'owner',token:true,workspace:'ws',view});
  return page.locator(view==='meetings'?'[data-mrd-delete-document="doc-0"]':'[data-lu-delete="doc-0"]');
}
function deleteDialogs(page,notice){
  const dialogs=[];
  page.on('dialog',async d=>{
    dialogs.push({type:d.type(),message:d.message()});
    if(d.type()==='confirm'){expect(d.message()).toBe(DELETE_CONFIRM);await d.accept()}
    else{expect(d.type()).toBe('alert');expect(d.message()).toBe(notice);await d.accept()}
  });
  return dialogs;
}
async function spyActualDeleteRuntime(page){
  await page.evaluate(()=>{
    const rt=window.KPTURuntime,api=rt.api;
    window.__deleteOptions=[];window.__deleteErrors=[];window.__deleteEvents=0;
    window.addEventListener('kptu:documents-changed',()=>window.__deleteEvents++);
    rt.api=function(path,options){
      if(!path.endsWith('document-actions'))return api(path,options);
      window.__deleteOptions.push(options);
      return api(path,options).catch(e=>{window.__deleteErrors.push({name:e.name,status:e.status,code:e.code,drive_result:e.drive_result,token_delete_result:e.token_delete_result,document_delete_result:e.document_delete_result});throw e});
    };
  });
}
const deleteResults=[
  [{ok:true,drive_result:'preserved',drive_preserved:true,reason:'note_reference'},'자료 등록을 삭제했습니다. 정리함 원본 파일은 Drive에 보존했습니다.'],
  [{ok:true,drive_result:'trashed',drive_preserved:false,reason:'ordinary_library'},'자료 등록을 삭제하고 파일을 Drive 휴지통으로 이동했습니다. 파일은 Drive 휴지통에서 확인해 주세요.'],
  [{ok:true,drive_result:'already_trashed',drive_preserved:false,reason:'ordinary_library'},'자료 등록을 삭제했습니다. 파일은 이미 Drive 휴지통에 있었습니다.'],
  [{ok:true,drive_result:'missing',drive_preserved:false,reason:'ordinary_library'},'자료 등록을 삭제했습니다. 연결된 Drive 파일은 찾을 수 없었습니다.'],
  [{ok:true,drive_result:'no_file',drive_preserved:false,reason:'ordinary_library'},'자료 등록을 삭제했습니다. 이 자료에 연결된 Drive 파일 ID는 없었습니다.'],
  [{ok:true},DELETE_LEGACY]
];
for(const width of [390,1280])for(const view of ['meetings']){// 자료실은 library-quick-delete.spec.mjs

  for(const [payload,notice] of deleteResults)test(`delete integration confirmed ${payload.drive_result||'legacy'} ${view} ${width}px`,async({page})=>{
    const state=await boot(page,width);state.deletePayload=payload;
    const remove=await openDeleteControl(page,view);await spyActualDeleteRuntime(page);
    const dialogs=deleteDialogs(page,notice);
    await remove.focus();await page.keyboard.press('Enter');
    await expect.poll(()=>dialogs.map(d=>d.type)).toEqual(['confirm','alert']);
    await expect(page.locator(view==='meetings'?'#mrdMaterials .mrd-file-row':'#documentList [data-lu-document]')).toHaveCount(1);
    expect(state.deletes).toEqual([{action:'delete',document_id:'doc-0'}]);
    expect(await page.evaluate(()=>window.__deleteEvents)).toBe(1);
    const opts=await page.evaluate(()=>window.__deleteOptions);
    expect(opts).toHaveLength(1);expect(opts[0]).toMatchObject({refreshSession:false,expectedSessionEpoch:await page.evaluate(()=>window.KPTURuntime.session.epoch())});
    expect(state.errors).toEqual([]);
  });
  for(const failure of ['401','400 phases','malformed','network'])test(`delete integration ${failure} one request conservative result ${view} ${width}px`,async({page})=>{
    const state=await boot(page,width),remove=await openDeleteControl(page,view);await spyActualDeleteRuntime(page);
    if(failure==='401'){state.deleteStatus=401;state.deletePayload={error:'JWT expired'}}
    if(failure==='400 phases'){state.deleteStatus=400;state.deletePayload={error:'자료 등록 삭제 결과를 확인하지 못했습니다.',code:'RESULT_UNKNOWN',drive_result:'preserved',token_delete_result:'confirmed',document_delete_result:'unknown'}}
    if(failure==='malformed')state.deletePayload=null;
    if(failure==='network')await page.route(`${SB}/functions/v1/document-actions`,route=>{state.deletes.push(route.request().postDataJSON());return route.abort('failed')});
    const dialogs=deleteDialogs(page,failure==='401'?DELETE_AUTH:DELETE_UNKNOWN);
    await remove.click();
    await expect.poll(()=>dialogs.map(d=>d.type)).toEqual(['confirm','alert']);
    expect(state.deletes).toEqual([{action:'delete',document_id:'doc-0'}]);expect(state.refreshes).toBe(0);
    expect(await page.evaluate(()=>window.__deleteEvents)).toBe(0);
    await expect(page.locator(view==='meetings'?'#mrdMaterials .mrd-file-row':'#documentList [data-lu-document]')).toHaveCount(2);
    if(failure==='400 phases')expect(await page.evaluate(()=>window.__deleteErrors)).toEqual([{name:'KPTURuntimeError',status:400,code:'http_400',drive_result:undefined,token_delete_result:undefined,document_delete_result:undefined}]);
    expect(await page.evaluate(()=>window.__deleteOptions[0])).toMatchObject({refreshSession:false,expectedSessionEpoch:await page.evaluate(()=>window.KPTURuntime.session.epoch())});
  });
}
