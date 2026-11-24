// S69-20 ①: 자료실 목록 위 작은 한 줄 '구글 드라이브 · 웹2 › 자료실  열기 ↗'.
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

async function boot(page,{width,place}){
  await page.setViewportSize({width,height:900});
  const state={user:{id:'user-1',email:'owner@example.org',user_metadata:{display_name:'자료실 관리자'}},workspace:{id:'workspace-1',slug:'team',name:'웹2'},asks:[]};
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;
    const ok=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token')return ok({access_token:'e2e-access',refresh_token:'e2e-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:state.user});
    if(path==='/auth/v1/user')return ok(state.user);
    if(path==='/auth/v1/logout')return ok({});
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[],eventColors:{}});
    if(path==='/functions/v1/workspace-drive'){state.asks.push({method:req.method(),query:url.search});return ok(url.searchParams.get('action')==='drive-place'?{ok:true,place}:{error:'Unknown action'},url.searchParams.get('action')==='drive-place'?200:400)}
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

for(const width of [390,1280]){
  test(`자료실 위에 드라이브 저장 위치 한 줄과 [열기 ↗]가 보인다 (${width})`,async({page})=>{
    const state=await boot(page,{width,place:PLACE});
    const line=page.locator('#libraryDriveLine');
    await expect(line).toBeVisible();
    await expect(line.locator('.lu-drive-where')).toHaveText('구글 드라이브 · 웹2 › 자료실');
    const open=line.locator('a.lu-drive-open');
    await expect(open).toHaveText('열기 ↗');
    await expect(open).toHaveAttribute('href',PLACE.url);
    await expect(open).toHaveAttribute('target','_blank');
    await expect(open).toHaveAttribute('rel',/noopener/);
    // 서버에는 모양이 정해진 요청 하나만(폴더 id·이름은 서버가 정함).
    expect(state.asks.length).toBeGreaterThan(0);
    expect(state.asks.every(a=>a.method==='GET'&&a.query==='?action=drive-place')).toBe(true);
    // 콤팩트: 한 줄 높이(글자 12px 안팎) — 큰 카드·안내문 없음.
    const box=await line.boundingBox();
    expect(box.height).toBeLessThan(width<500?44:24);
    // 한 줄이 목록 위에 있다.
    const list=await page.locator('#documentList').boundingBox();
    expect(box.y).toBeLessThan(list.y);
  });
}

test('저장 위치가 없으면(자료를 올린 적 없음·연결 없음) 줄을 그리지 않는다',async({page})=>{
  await boot(page,{width:390,place:null});
  await expect(page.locator('#libraryDriveLine')).toBeHidden();
  await expect(page.locator('#libraryDriveLine a')).toHaveCount(0);
});

test('서버 답 주소가 드라이브 폴더 주소가 아니면 그리지 않는다',async({page})=>{
  await boot(page,{width:1280,place:{folder_id:FOLDER,url:'https://example.org/x',path:['웹2','자료실']}});
  await expect(page.locator('#libraryDriveLine')).toBeHidden();
});
