// S69-20 ①의 자료실 저장 위치 줄은 S71-46에 없앴다(드라이브 열기는 ⋯, 못 옮겼을 때만 [다시] 한 줄).
// 가짜 서버만(실제 Supabase·Drive 없음): workspace-drive GET ?action=drive-place. 가짜 자료, 390·1280.
import { appOrigin } from './helpers/test-origin.mjs';
import { test, expect } from '@playwright/test';
import { enterLogin } from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const now=()=>new Date().toISOString();
const DOC='e0000000-0000-4000-8000-000000000001';
const FOLDER='libraryFolder0001';
const PLACE={folder_id:FOLDER,url:`https://drive.google.com/drive/folders/${FOLDER}`,path:['웹2','자료실']};

async function boot(page,{width,place,mirror=[],topFiles=null,}){
  await page.setViewportSize({width,height:900});
  const state={user:{id:'user-1',email:'owner@example.org',user_metadata:{display_name:'자료실 관리자'}},workspace:{id:'workspace-1',slug:'team',name:'웹2'},asks:[],mirror,mirrorAsks:[]};
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;
    const ok=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token')return ok({access_token:'e2e-access',refresh_token:'e2e-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:state.user});
    if(path==='/auth/v1/user')return ok(state.user);
    if(path==='/auth/v1/logout')return ok({});
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[],eventColors:{}});
    if(path==='/functions/v1/workspace-drive'&&url.searchParams.get('action')==='drive-mirror'){const b=(()=>{try{return req.postDataJSON()}catch{return null}})();state.mirrorAsks.push(b);return ok(state.mirror.length?state.mirror.shift():{ok:true,state:'aligned',folders_made:0,folders_fixed:0,files_moved:0,cant:0,pending:0,more:false,stopped:false})}
    if(path==='/functions/v1/workspace-drive'){state.asks.push({method:req.method(),query:url.search,body:req.postData()});return ok(url.searchParams.get('action')==='drive-place'?{ok:true,place}:{error:'Unknown action'},url.searchParams.get('action')==='drive-place'?200:400)}
    if(path==='/functions/v1/library-files'&&/^\{"action":"drive-auto"\}$/.test(req.postData()||''))return ok({ok:true,added:0}); // S70-73: 자료실을 열 때 자동 등록 부탁(이 시험과 무관)
    if(path==='/functions/v1/library-files'&&topFiles&&req.method()==='POST'){const b=req.postDataJSON();state.topAsks=(state.topAsks||[]);state.topAsks.push(b);return ok(topFiles(b))}
    if(path.startsWith('/functions/v1/'))return ok({});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:'workspace-1',user_id:state.user.id,role:'owner',workspace:state.workspace,created_at:now()}]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:state.user.id,display_name:'자료실 관리자',document_categories:['교섭','기타']}]);
    if(path==='/rest/v1/app_workspaces')return ok([state.workspace]);
    if(path==='/rest/v1/app_library_classify_attempts')return ok({message:'not found'},404);
    if(path==='/rest/v1/app_documents'&&req.method()==='GET')return ok([{id:DOC,workspace_id:'workspace-1',project_id:null,organization_id:null,meeting_id:null,title:'가짜 자료',category:'기타',tags:[],file_id:'driveFile0000001',file_name:'가짜.pdf',mime_type:'application/pdf',file_size:10,drive_url:'https://drive.google.com/file/d/driveFile0000001/view',created_at:'2026-11-01T00:00:00Z',updated_at:'2026-11-01T00:00:00Z',extraction_status:'ready',previous_files:[]}]);
    if(path.startsWith('/rest/v1/'))return ok([]);
    return ok({});
  });
  await page.goto(`${appOrigin}/app/?view=library`);
  await enterLogin(page);await signInWithSession(page,'owner@example.org');
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
  await expect(page.locator('[data-lu-document]')).toHaveCount(1);
  return state;
}

// S71-46 LIB-위치줄삭제(사용자 11/26 "자료실에서 이부분 불필요 없애"): 목록 맨 위 저장 위치 줄 '구글 드라이브 · … › 자료실  열기 ↗'은 없앴다.
// 드라이브 폴더 열기는 자료실 머리 ⋯ [드라이브에서 열기], 드라이브에 못 옮겼을 때만 목록 맨 위 작은 한 줄 '드라이브에 못 옮겼어요 [다시]'.
const noPlaceLine=async page=>{
  await expect(page.locator('#libraryDriveLine')).toHaveCount(0);
  await expect(page.locator('.lu-drive-where,a.lu-drive-open,.lu-drive-here')).toHaveCount(0);
  await expect(page.locator('#libraryListCard')).not.toContainText('구글 드라이브 ·');
};
for(const width of [390,1280]){
  test(`자료실 맨 위에 저장 위치 줄이 없고, ⋯ [드라이브에서 열기]로 드라이브 폴더를 연다 (${width})`,async({page,context})=>{
    const state=await boot(page,{width,place:PLACE});
    await expect.poll(()=>state.asks.length).toBeGreaterThan(0); // 저장 위치(주소)는 그대로 서버에서 읽는다
    expect(state.asks.every(a=>a.method==='GET'&&a.query==='?action=drive-place')).toBe(true);
    await noPlaceLine(page);
    await expect(page.locator('#libraryDriveNote')).toBeHidden(); // 평소엔 줄 없음
    await context.route('https://drive.google.com/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<title>drive</title>'}));
    await page.locator('#libraryTopMenuBtn').click();
    const open=page.locator('#luTopMenu [data-lu-top="drive-open"]');
    await expect(open).toHaveText('드라이브에서 열기');
    const [popup]=await Promise.all([context.waitForEvent('page'),open.click()]);
    expect(popup.url()).toBe(PLACE.url);
    await expect(page.locator('#luTopMenu')).toBeHidden();
    await noPlaceLine(page);
  });
}

test('저장 위치가 없으면(자료를 올린 적 없음·연결 없음) 줄도 ⋯ [드라이브에서 열기]도 없다',async({page})=>{
  await boot(page,{width:390,place:null});
  await noPlaceLine(page);
  await expect(page.locator('#libraryDriveNote')).toBeHidden();
  await page.locator('#libraryTopMenuBtn').click();
  await expect(page.locator('#luTopMenu')).toBeVisible();
  await expect(page.locator('#luTopMenu [data-lu-top="drive-open"]')).toHaveCount(0);
});

test('서버 답 주소가 드라이브 폴더 주소가 아니면 ⋯에 [드라이브에서 열기]를 두지 않는다',async({page})=>{
  await boot(page,{width:1280,place:{folder_id:FOLDER,url:'https://example.org/x',path:['웹2','자료실']}});
  await noPlaceLine(page);
  await page.locator('#libraryTopMenuBtn').click();
  await expect(page.locator('#luTopMenu')).toBeVisible();
  await expect(page.locator('#luTopMenu [data-lu-top="drive-open"]')).toHaveCount(0);
});

// S70-76 LIB-드라이브늘같게: 앱에서 자료실 표를 바꾸면 그 자리에서 '드라이브도 같게'를 부탁하고,
// 드라이브 쪽이 밀리면(그때만) 목록 맨 위 작은 한 줄 '드라이브에 못 옮겼어요 [다시]' — 누르면 그 자리에서 다시. 가짜 서버만.
for(const width of [390,1280]){
  test(`드라이브에 못 옮겼을 때만 맨 위 [다시] 한 줄, 누르면 다시 부탁하고 줄이 사라진다 (${width})`,async({page})=>{
    const state=await boot(page,{width,place:PLACE,mirror:[{ok:true,state:'aligned',pending:0,more:false}]});
    await expect.poll(()=>state.mirrorAsks.length).toBe(1); // 처음 들어오면 한 번(드라이브에서 바꾼 것 따라가기·밀린 것 다시)
    expect(state.mirrorAsks[0]).toEqual({mode:'auto'});
    const line=page.locator('#libraryDriveNote');
    await expect(line).toBeHidden();
    await noPlaceLine(page);
    // 옮기기(자료 연결 줄 쓰기) 직후: 드라이브 쪽이 실패 → 맨 위 한 줄
    state.mirror.push({ok:true,state:'aligned',folders_made:0,folders_fixed:0,files_moved:0,cant:0,pending:1,more:false,stopped:false,stage:'files'});
    await page.evaluate(()=>window.KPTURuntime.api('/rest/v1/app_library_folder_items',{method:'POST',prefer:'return=minimal',body:{document_id:'e0000000-0000-4000-8000-000000000001',folder_id:'a7600000-0000-4000-8000-000000000001',workspace_id:'workspace-1'},singleFlight:false}));
    await expect.poll(()=>state.mirrorAsks.length).toBe(2);
    await expect(line).toBeVisible();
    await expect(line.locator('.lu-drive-note')).toHaveText('드라이브에 못 옮겼어요');
    await expect(line).not.toContainText('구글 드라이브');
    await expect(line.locator('a')).toHaveCount(0);
    const box=await line.boundingBox(),list=await page.locator('#documentList').boundingBox();
    expect(box.height).toBeLessThan(36); // 작은 한 줄
    expect(box.y).toBeLessThan(list.y); // 목록 칸 맨 위
    const again=line.locator('[data-lu-drive-retry]');
    await expect(again).toHaveText('다시');
    await again.click();
    await expect.poll(()=>state.mirrorAsks.length).toBe(3);
    await expect(line).toBeHidden();
    await expect(page.locator('#libraryDriveNote .lu-drive-note')).toHaveCount(0);
  });
}

// S70-29(2026-11-25 명진 '다 없애 1회용 기능'): 자료실 ⋯ [드라이브 폴더 맞추기]·[맨 위 파일 정리]·[같은 내용 자료 정리]·[드라이브와 맞는지 보기]는 지웠다.
// 저장 위치가 있어도 ⋯에 넷 다 없다(S70-73: [드라이브에서 가져오기]도 지움 — 자료실을 열 때 자동 등록). S70-76·S71-46: 드라이브 쪽이 밀리면 맨 위 한 줄 '드라이브에 못 옮겼어요 [다시]'.
for(const width of [390,1280]){
  test(`자료실 ⋯에 한 번 정리 메뉴 넷·가져오기가 없다, 자동 맞추기는 그대로 (${width})`,async({page})=>{
    const state=await boot(page,{width,place:PLACE,mirror:[{ok:true,state:'not_aligned',folders_made:0,folders_fixed:0,files_moved:0,cant:0,pending:1,more:false,stopped:false}]});
    await expect.poll(()=>state.mirrorAsks.length).toBe(1); // 처음 들어오면 '앞으로 같게' 한 번
    expect(state.mirrorAsks[0]).toEqual({mode:'auto'});
    await expect(page.locator('#libraryDriveNote .lu-drive-note')).toHaveText('드라이브에 못 옮겼어요');
    await page.locator('#libraryTopMenuBtn').click();
    const menu=page.locator('#luTopMenu');
    await expect(menu).toBeVisible();
    await expect(menu.locator('[data-lu-top="drive-import"],[data-lu-top="drive-align"],[data-lu-top="top-files"],[data-lu-top="same-content"],[data-lu-top="drive-check"]')).toHaveCount(0);
    for(const word of ['드라이브에서 가져오기','드라이브 폴더 맞추기','맨 위 파일 정리','같은 내용 자료 정리','드라이브와 맞는지 보기'])await expect(menu).not.toContainText(word);
    expect(state.mirrorAsks.every(b=>b?.mode==='auto')).toBe(true);
    expect(state.asks.filter(a=>/drive-check|gather-folders/.test(a.query))).toEqual([]);
  });
}
