import {test,expect} from '@playwright/test';
import {clickView} from './helpers/shell-navigation.mjs';

const BASE=process.env.APP_E2E_ORIGIN||'http://127.0.0.1:8123';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const file=name=>({name,mimeType:'application/pdf',buffer:Buffer.from(name)});
const selectionDraft=page=>page.evaluate(()=>{const detail={otherDraft:false};window.dispatchEvent(new CustomEvent('kptu:before-reload',{detail}));return detail.otherDraft});
const meeting={id:'meeting-1',workspace_id:'ws',title:'자료 확인 회의',series_name:'자료 확인 회의',meeting_at:'2026-10-10T10:00:00Z',transcript_text:'회의 원문',created_by:'owner'};

async function boot(page,width){
  await page.setViewportSize({width,height:900});
  const state={docs:['first.pdf','second.pdf'].map((name,i)=>({id:'doc-'+i,workspace_id:'ws',meeting_id:meeting.id,file_name:name,title:name,category:'회의자료',tags:[],created_at:'2026-10-10T00:00:00Z'})),deletes:[],uploads:[],error:null,hold:false,release:null,errors:[]};
  page.on('pageerror',e=>state.errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')state.errors.push(m.text())});
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
    if(path==='/auth/v1/token')return ok({access_token:'test-access',refresh_token:'test-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600});
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
      if(state.error)return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:state.error})});
      state.docs=state.docs.filter(d=>d.id!==req.postDataJSON().document_id);
      return ok({ok:true});
    }
    if(['/functions/v1/library-files','/functions/v1/meeting-files'].includes(path)){
      const raw=req.postDataBuffer().toString('utf8');
      state.uploads.push({path,raw});
      if(state.hold)await new Promise(resolve=>state.release=resolve);
      const name=raw.match(/filename="([^"]+)"/)?.[1];
      const doc={id:'uploaded-'+state.uploads.length,workspace_id:'ws',file_name:name,title:name,tags:[],meeting_id:path.endsWith('meeting-files')?meeting.id:null};
      state.docs.push(doc);
      return ok({ok:true,document:doc});
    }
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[]});
    if(path==='/functions/v1/google-tasks')return ok({tasks:[]});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    return ok([]);
  });
  await page.goto(`${BASE}/app/login/?return=${encodeURIComponent(BASE+'/app/?view=meetings')}`);
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill('owner@example.org');
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
  return state;
}

for(const width of [390,1280]){
  for(const view of ['meetings','library'])test(`delete helper fetch failure preserves documents and offers retry guidance ${view} ${width}px`,async({page})=>{
    const state=await boot(page,width),pageErrors=[];
    page.on('pageerror',e=>pageErrors.push(e.message));
    await page.route('**/app/document-delete.js*',route=>route.abort());
    if(view==='meetings'){
      await page.locator('[data-mrd-meeting="meeting-1"]').click();
      await expect(page.locator('#meetingRoundDetailModal')).toBeVisible();
    }else{
      await clickView(page,'library');
    await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('library'));
      await page.locator('#libraryViewFilter').selectOption('meetings');
      await page.locator('[data-lu-menu="doc-0"]').click();
    }
    const alerts=[];page.on('dialog',async d=>{alerts.push(d.message());await d.accept()});
    await page.locator(view==='meetings'?'[data-mrd-delete-document="doc-0"]':'[data-lu-delete="doc-0"]').click();
    await expect.poll(()=>alerts).toEqual(['자료를 삭제하지 못했습니다. 관리자에게 오류 확인을 요청해 주세요.']);
    expect(state.deletes).toEqual([]);expect(state.docs).toHaveLength(2);expect(pageErrors).toEqual([]);
  });
  test(`meeting material deletion confirms, cancels and refreshes all three lists ${width}px`,async({page})=>{
    const state=await boot(page,width);
    await expect(page.locator('#meetingList')).toContainText('자료 2');
    await page.locator('[data-mrd-meeting="meeting-1"]').click();
    await expect(page.locator('#mrdMaterials .mrd-file-row')).toHaveCount(2);
    const remove=page.locator('[data-mrd-delete-document="doc-0"]');
    let canceled=false;page.once('dialog',async d=>{expect(d.message()).toBe('“first.pdf” 파일을 삭제할까요?\nDrive 휴지통으로 이동합니다. Drive 휴지통에서 30일 안에 복구할 수 있습니다.');await d.dismiss();canceled=true});
    await remove.click();
    await expect.poll(()=>canceled).toBe(true);
    await expect(remove).toBeEnabled();
    expect(state.deletes).toEqual([]);
    await expect(page.locator('#mrdMaterials .mrd-file-row')).toHaveCount(2);
    page.once('dialog',d=>d.accept());
    await remove.click();
    await expect(page.locator('#mrdMaterials .mrd-file-row')).toHaveCount(1);
    expect(state.deletes).toEqual([{action:'delete',document_id:'doc-0'}]);
    await page.locator('#mrdClose').click();
    await expect(page.locator('#meetingList')).toContainText('자료 1');
    await clickView(page,'library');
    await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('library'));
    await page.locator('#libraryViewFilter').selectOption('meetings');
    await expect(page.locator('[data-lu-document]')).toHaveCount(1);
    expect(state.errors).toEqual([]);
  });

  test(`failed meeting material deletion uses library error guidance and keeps lists ${width}px`,async({page})=>{
    const state=await boot(page,width);state.error='permission denied';
    await page.locator('[data-mrd-meeting="meeting-1"]').click();
    const alerts=[];
    page.on('dialog',async d=>{if(d.type()==='confirm')await d.accept();else{alerts.push(d.message());await d.accept()}});
    await page.locator('[data-mrd-delete-document="doc-0"]').click();
    await expect.poll(()=>alerts).toEqual(['자료를 삭제하지 못했습니다. 관리자에게 오류 확인을 요청해 주세요.']);
    await expect(page.locator('#mrdMaterials .mrd-file-row')).toHaveCount(2);
    await page.locator('#mrdClose').click();
    await expect(page.locator('#meetingList')).toContainText('자료 2');
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
    await page.locator('#meetingAt').fill('2026-10-10T10:00');
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
    expect(state.uploads[0].path).toBe('/functions/v1/meeting-files');
    expect(state.uploads[0].raw).toContain('keep.pdf');
    expect(state.uploads[0].raw).not.toContain('remove.pdf');
    expect(state.errors).toEqual([]);
  });

  test(`meeting detail stages files for cancellation before upload ${width}px`,async({page})=>{
    const state=await boot(page,width);
    await page.locator('[data-mrd-meeting="meeting-1"]').click();
    await expect(page.locator('#meetingRoundDetailModal')).toBeVisible();
    await page.locator('#mrdFiles').setInputFiles([file('detail-keep.pdf'),file('detail-remove.pdf')]);
    await expect(page.locator('#mrdSelectedFiles')).toContainText('detail-keep.pdf');
    expect(await selectionDraft(page)).toBe(true);
    await page.getByRole('button',{name:'detail-remove.pdf 선택 취소',exact:true}).click();
    expect(state.uploads).toEqual([]);
    state.hold=true;
    await page.locator('#mrdUpload').click();
    await expect.poll(()=>state.uploads.length).toBe(1);
    await expect(page.getByRole('button',{name:'detail-keep.pdf 선택 취소',exact:true})).toBeDisabled();
    state.hold=false;state.release();
    await expect(page.locator('#mrdMaterials .mrd-file-row')).toHaveCount(3);
    expect(state.uploads).toHaveLength(1);
    expect(state.uploads[0].raw).not.toContain('detail-remove.pdf');
    expect(await selectionDraft(page)).toBe(false);
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
    await page.locator('#meetingAt').fill('2026-10-10T10:00');
    await page.locator('#meetingTranscript').fill('원문');
    return {input:'#meetingFiles',save:'#saveMeetingBtn',rows:'#meetingSelectedFiles > div',status:'#toast'};
  }
  await page.locator('[data-mrd-meeting="meeting-1"]').click();
  await expect(page.locator('#meetingRoundDetailModal')).toBeVisible();
  return {input:'#mrdFiles',save:'#mrdUpload',rows:'#mrdSelectedFiles > div',status:'#mrdStatus'};
}
const READ_ERROR='파일을 읽지 못했습니다. 파일을 다시 선택해 주세요.';
for(const width of [390,1280])for(const screen of ['library','new meeting','meeting detail']){
  test(`memory copy: ${screen} sends metadata-preserving copies sequentially ${width}px`,async({page})=>{
    await observeSelectedFiles(page);
    const state=await boot(page,width),ui=await openUploadScreen(page,screen);
    await page.locator(ui.input).setInputFiles([file('한글 자료.pdf'),file('second.pdf')]);
    expect(await page.evaluate(()=>window.__copyReads)).toEqual([]);
    state.hold=true;
    await page.locator(ui.save).click();
    await expect.poll(()=>state.uploads.length).toBe(1);
    expect(await page.evaluate(()=>window.__copyReads)).toEqual(['한글 자료.pdf']);
    state.hold=false;state.release();
    await expect.poll(()=>state.uploads.length).toBe(2);
    await expect(page.locator(ui.save)).toBeEnabled();
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
    await page.locator(ui.save).click();
    await expect(page.locator(ui.status)).toContainText(READ_ERROR);
    await expect(page.locator(ui.rows)).toContainText(READ_ERROR);
    await expect(page.locator(ui.save)).toBeEnabled();
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
    await page.locator(ui.save).click();
    await expect(page.locator(ui.status)).toContainText(READ_ERROR);
    await expect(page.locator(ui.save)).toBeEnabled();
    expect(state.uploads).toHaveLength(1);
    expect(state.uploads[0].raw).toContain('good.pdf');
    expect(state.uploads[0].raw).not.toContain('unreadable.pdf');
    expect(await page.evaluate(()=>window.__copyReads)).toEqual(['unreadable.pdf','good.pdf']);
    expect(state.errors).toEqual([]);
  });
}
