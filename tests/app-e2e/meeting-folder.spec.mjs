import {test,expect} from '@playwright/test';
import {bootLibrary,libFolder,SB} from './helpers/library-folder-server.mjs';
import {signInWithSession} from './helpers/session-login.mjs';
import {addReport} from './helpers/report-add.mjs';
import {folderSheet,sheetRow,sheetGo} from './helpers/folder-sheet.mjs';
// MTG-정기회의자료폴더(사용자 11/24 21:03 "자료실 폴더 이름 중 회의 폴더 이름이 정기 회의 폴더 이름과 같고 매칭이 되어서.
//   저기에 회의자료 등을 올리면 저 폴더로 자동으로 가게"):
// 사업 보고(회의)에 올린 회의자료는 그 회의명과 짝지은 자료실 폴더에, 짝이 없으면 이름이 같은 폴더(띄어쓰기·가운뎃점만 맞춤) 하나에 들어간다.
// 둘 다 없으면 지금처럼(폴더 밖). 넣은 뒤 '…폴더에 넣었어요' 한 줄. 회의명 고르기 창 줄 ⋯ [자료실 폴더 정하기]로 짝을 서버에 정한다.
// 가짜 서버만 쓴다. 이름은 지어낸 것.
const MEETING={id:'mt-1',workspace_id:'workspace-1',title:'가상 정기 회의 3차',series_name:'가상 정기 회의',round_no:3,meeting_at:'2026-11-20T01:00:00Z',activity_kind:'meeting',created_by:'user-1'};
const FOLDERS=[
  libFolder('pp',null,{name:'가상 상위',sort_order:1024}),
  libFolder('same',null,{name:'가상 정기·회의',parent_id:'pp',sort_order:1024}),
  libFolder('pair',null,{name:'가상 짝 폴더',sort_order:2048}),
];
async function boot(page,init={}){
  const r=await bootLibrary(page,1440,{folders:FOLDERS,items:[],group:'폴더',init:{viewPrefs:null,meetings:[{...MEETING}],...init}});
  await page.route(`${SB}/functions/v1/document-actions*`,route=>route.fulfill({json:{ok:true}}));
  return r;
}
async function uploadForMeeting(page,meeting,name){
  await page.evaluate(m=>window.KPTULibrary.startUploadForMeeting(m),meeting);
  await expect(page.locator('#documentModal')).toBeVisible();
  await page.locator('#libraryFileInput').setInputFiles({name,mimeType:'application/pdf',buffer:Buffer.from('%PDF synthetic')});
  await page.locator('#saveDocumentBtn').click();
  await expect(page.locator('#documentModal')).toBeHidden();
}
const itemOf=(s,id)=>s.items.find(x=>x.document_id===id)?.folder_id;

test.describe('PC 1440',()=>{
  test.use({hasTouch:false});
  test('짝이 없으면 이름이 같은 폴더(가운뎃점·띄어쓰기만 다름)에 하나 · 넣었어요 한 줄 · 서버 칸이 아직 없어도 동작',async({page})=>{
    const {s,errors}=await boot(page);
    await uploadForMeeting(page,{id:MEETING.id,name:MEETING.series_name},'회의자료.pdf');
    await expect.poll(()=>itemOf(s,'upload-1')).toBe('same');
    expect(s.items.filter(x=>x.document_id==='upload-1')).toHaveLength(1);
    await expect(page.locator('#kptuNotice .kptu-notice-text')).toHaveText('‘가상 정기·회의’ 폴더에 넣었어요 1개');
    expect(s.meetingCalls||[]).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('짝지은 폴더가 이름이 같은 폴더보다 먼저 · 사업 보고 묶음 올리기(회의 녹음·파일로 만들기와 같은 들머리)도 같은 폴더',async({page})=>{
    const {s,errors}=await boot(page,{meetingKeys:true});
    s.folders.find(f=>f.id==='pair').meeting_key='가상정기회의';
    await uploadForMeeting(page,{id:MEETING.id,name:MEETING.series_name},'첫 자료.pdf');
    await expect.poll(()=>itemOf(s,'upload-1')).toBe('pair');
    await expect(page.locator('#kptuNotice .kptu-notice-text')).toHaveText('‘가상 짝 폴더’ 폴더에 넣었어요 1개');
    // 창 없이 올리는 길(사업 보고 저장 뒤 고른 파일·회의자료 놓기): 같은 뒤 줄에서 올라간 뒤 같은 폴더로.
    const doc=await page.evaluate(id=>window.KPTULibrary.sendFileForMeeting({id},new File(['%PDF synthetic'],'둘째.pdf',{type:'application/pdf'})).then(d=>d?.id||null),MEETING.id);
    expect(doc).toBe('upload-2');
    await expect.poll(()=>itemOf(s,'upload-2')).toBe('pair');
    expect(errors).toEqual([]);
  });

  test('짝도 같은 이름 폴더도 없으면 지금처럼 폴더 밖 · 알림 없음, 사진은 넣지 않는다',async({page})=>{
    const {s,errors}=await boot(page,{meetingKeys:true,meetings:[{...MEETING,series_name:'가상 없는 회의',title:'가상 없는 회의'}]});
    await uploadForMeeting(page,{id:MEETING.id,name:'가상 없는 회의'},'자료.pdf');
    await expect.poll(()=>s.uploads.length).toBe(1);
    await page.waitForTimeout(800);
    expect(s.items).toEqual([]);
    await expect(page.locator('#kptuNotice .kptu-notice-text',{hasText:'폴더에 넣었어요'})).toHaveCount(0);
    // 이름이 같은 회의라도 사진은 사업 보고 사진 칸에만(자료실 회의 폴더에 넣지 않는다).
    s.meetings=[{...MEETING}];
    const photo=await page.evaluate(id=>window.KPTULibrary.sendFileForMeeting({id},new File([new Uint8Array([0xff,0xd8,0xff,0xe0])],'사진.jpg',{type:'image/jpeg'})).then(d=>d?.id||null),MEETING.id);
    expect(photo).toBe('upload-2');
    await page.waitForTimeout(800);
    expect(s.items).toEqual([]);
    await expect(page.locator('#kptuNotice .kptu-notice-text',{hasText:'폴더에 넣었어요'})).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

// ---- 회의명 고르기 창 ⋯ [자료실 폴더 정하기] ----
const BASE=process.env.APP_E2E_ORIGIN||'http://127.0.0.1:8123';
const row=(id,name,at)=>({id,workspace_id:'mf-ws',project_id:null,activity_kind:'meeting',title:name,series_name:name,meeting_at:at,notes:'',transcript_text:'',created_by:'mf-user',result_status:'final'});
const meetings=[row('m1','예시 회의 1','2026-11-05T01:00:00Z'),row('m2','예시 회의 2','2026-11-01T01:00:00Z')];
async function mockPanel(page,state){
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method();
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token')return ok({access_token:'mf-access',refresh_token:'mf-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'mf-user'}});
    if(path==='/auth/v1/user')return ok({id:'mf-user',email:'mf@example.org',user_metadata:{display_name:'회의 폴더 QA'}});
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:'mf-ws',user_id:'mf-user',role:'owner',workspace:{id:'mf-ws',name:'QA'}}]);
    if(path==='/rest/v1/app_workspaces')return ok([{id:'mf-ws',name:'QA'}]);
    if(path==='/rest/v1/app_profiles'){
      if((url.searchParams.get('select')||'').includes('meeting_name_sorts'))return ok([{meeting_name_sorts:null}]);
      return ok([{user_id:'mf-user',display_name:'회의 폴더 QA'}]);
    }
    if(path==='/rest/v1/app_meetings')return ok(method==='GET'?meetings:[]);
    if(path==='/rest/v1/app_library_folders'){
      if(url.searchParams.get('meeting_key')==='not.is.null')return ok(state.folders.filter(f=>f.meeting_key).map(f=>({id:f.id,meeting_key:f.meeting_key})));
      return ok(state.folders);
    }
    if(path==='/rest/v1/rpc/app_library_folder_set_meeting'){
      const body=req.postDataJSON();state.calls.push(body);
      for(const f of state.folders)if(f.meeting_key===body.p_key&&f.id!==body.p_id)f.meeting_key=null;
      const f=state.folders.find(x=>x.id===body.p_id);f.meeting_key=body.p_key;return ok({ok:true,id:f.id,meeting_key:f.meeting_key});
    }
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[]});
    if(path==='/functions/v1/google-tasks')return ok({tasks:[],needs_reconnect:false});
    if(path==='/functions/v1/push-notifications')return ok({enabled:false,web_enabled:false,native_enabled:false,public_key:'qa'});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path.startsWith('/rest/v1/')||path.startsWith('/functions/v1/'))return ok([]);
    return ok({});
  });
}
const panel=page=>page.locator('#kptuNamePanel');
for(const [label,size,touch] of [['폰 412',{width:412,height:915},true],['PC 1280',{width:1280,height:900},false]]){
  test.describe(label,()=>{
    test.use({hasTouch:touch,isMobile:touch});
    test(`${label}: 회의명 줄 ⋯ [자료실 폴더 정하기] → 폴더 고르기 창 → [이 폴더로 정하기] = 서버에 짝, 한 줄 알림`,async({page})=>{
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.setViewportSize(size);
      const state={calls:[],folders:[
        {id:'f-a',workspace_id:'mf-ws',project_id:null,parent_id:null,name:'예시 폴더 A',sort_order:1024,created_at:'2026-10-01T00:00:00Z'},
        {id:'f-b',workspace_id:'mf-ws',project_id:null,parent_id:null,name:'예시 폴더 B',sort_order:2048,created_at:'2026-10-01T00:00:00Z'},
      ]};
      await mockPanel(page,state);
      await page.goto(`${BASE}/app/login/?return=${encodeURIComponent(`${BASE}/app/?view=meetings`)}`);
      await signInWithSession(page,'mf@example.org');
      await expect(page.locator('#meetingsView')).toBeVisible({timeout:15000});
      await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
      await addReport(page);
      await expect(page.locator('#meetingModal')).toBeVisible();
      await expect(page.locator('#meetingNameSelect')).toHaveAttribute('data-name-panel','1');
      await page.locator('#meetingNameSelect').click();
      await expect(panel(page)).toBeVisible();
      await panel(page).locator('.mnp-row',{hasText:'예시 회의 1'}).locator('.mnp-more').click();
      await expect(panel(page).locator('.mnp-title')).toHaveText('예시 회의 1');
      await expect(panel(page).locator('[data-mnp-act="folder"]')).toHaveText('자료실 폴더 정하기');
      await panel(page).locator('[data-mnp-act="folder"]').click();
      await expect(panel(page)).toBeHidden();
      // S69-62 공용 폴더 고르기 창('옮길 곳' 창 하나): 줄 누르기 = 고르기, [이 폴더로 정하기]로만 정한다.
      await expect(folderSheet(page)).toBeVisible();
      await sheetRow(page,'예시 폴더 B').click();
      await expect(sheetGo(page)).toHaveText('이 폴더로 정하기');
      await sheetGo(page).click();
      await expect.poll(()=>state.calls).toEqual([{p_id:'f-b',p_key:'예시회의1'}]);
      await expect(page.locator('#kptuNotice .kptu-notice-text')).toHaveText('‘예시 회의 1’ 자료는 ‘예시 폴더 B’ 폴더에 넣어요.');
      // 사업 보고 입력 창은 그대로 열려 있다(폴더만 정함).
      await expect(page.locator('#meetingModal')).toBeVisible();
      expect(errors).toEqual([]);
    });
  });
}
