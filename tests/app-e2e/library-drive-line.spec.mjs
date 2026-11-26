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

async function boot(page,{width,place,mirror=[],topFiles=null,check=null}){
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
    if(path==='/functions/v1/workspace-drive'&&check&&url.searchParams.get('action')==='drive-check'){const b=req.postDataJSON();state.checkAsks=(state.checkAsks||[]);state.checkAsks.push(b);return ok(check(b))}
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
    expect(state.asks.length).toBeGreaterThan(0); // drive-place 읽기(맞추기 요청은 따로 센다)
    expect(state.asks.every(a=>a.method==='GET'&&a.query==='?action=drive-place')).toBe(true);
    // S69-41: [앱 폴더 모으기]는 내 프로필 '구글 드라이브' 칸으로 옮겼다 — 이 줄에는 저장 위치와 [열기 ↗]만.
    await expect(line.locator('button')).toHaveCount(0);
    await expect(line).not.toContainText('모으기');
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

test('④ 자료실 ⋯ [드라이브 폴더 맞추기]: 이어서 맞추고 옮긴 수를 알린다. 실패하면 줄 끝에 정리 대기',async({page})=>{
  const state=await boot(page,{width:1280,place:PLACE,mirror:[
    {ok:true,state:'aligned',pending:0,more:false},
    {ok:true,state:'not_aligned',folders_made:2,folders_fixed:0,files_moved:5,cant:0,pending:0,more:true,stopped:false},
    {ok:true,state:'aligned',folders_made:0,folders_fixed:0,files_moved:3,cant:1,pending:0,more:false,stopped:false},
    {ok:true,state:'not_aligned',folders_made:0,folders_fixed:0,files_moved:1,cant:0,pending:1,more:false,stopped:true}]});
  await expect(page.locator('#libraryDriveLine .lu-drive-where')).toBeVisible();
  await expect.poll(()=>state.mirrorAsks.length).toBe(1); // 처음 들어오면 '앞으로 같게' 한 번
  expect(state.mirrorAsks[0]).toEqual({mode:'auto'});
  await page.locator('#libraryTopMenuBtn').click();
  await page.locator('#luTopMenu [data-lu-top="drive-align"]').click();
  await expect(page.locator('#libraryFolderStatusLine')).toHaveText('드라이브 폴더를 맞췄어요 · 폴더 2개 만들고 자료 8개 옮겼어요 · 옮길 수 없는 자료 1개는 그대로');
  expect(state.mirrorAsks.slice(1)).toEqual([{mode:'align'},{mode:'align'}]);
  await expect(page.locator('#libraryDriveLine .lu-drive-note')).toHaveCount(0);
  await page.locator('#libraryTopMenuBtn').click();
  await page.locator('#luTopMenu [data-lu-top="drive-align"]').click();
  await expect(page.locator('#libraryDriveLine .lu-drive-note')).toHaveText('드라이브 정리 대기');
  await expect(page.locator('#libraryFolderStatusLine')).toContainText('다 맞추지 못했어요');
  expect(state.mirrorAsks.length).toBe(4);
});

test('저장 위치가 없으면 ⋯에 [드라이브 폴더 맞추기]도 없다',async({page})=>{
  const state=await boot(page,{width:390,place:null});
  await page.locator('#libraryTopMenuBtn').click();
  await expect(page.locator('#luTopMenu')).toBeVisible();
  await expect(page.locator('#luTopMenu [data-lu-top="drive-align"]')).toHaveCount(0);
  expect(state.mirrorAsks).toEqual([]);
});

// S69-40 [맨 위 파일 정리]: 열면 숫자만 묻고(바꾸지 않음) → [정리하기]는 이어서 부르며 같은 정리 번호 → 결과 한 줄·[되돌리기] → 정리 대기 줄은 제안 폴더가 골라져 있고 [보내기]. 지어낸 이름만.
for(const width of [390,1280]){
  test(`자료실 ⋯ [맨 위 파일 정리]: 판정 숫자 → 정리 → 정리 대기 보내기 (${width})`,async({page})=>{
    const F6='a6000000-0000-4000-8000-000000000006',FM='a6000000-0000-4000-8000-000000000009';
    let tidied=0;
    const scanBefore={ok:true,total:9,counts:{library:2,library_top:1,attach:1,old:1,temp:2,junk:1,dup:0,none:1},need_align:0,wait:[],folders:[{id:F6,name:'06. 선전'},{id:FM,name:'잡동사니'}],partial:false};
    const scanAfter={ok:true,total:1,counts:{library:0,library_top:1,attach:0,old:0,temp:0,junk:0,dup:0,none:0},need_align:0,wait:[{id:'waitFile00000001',name:'가상 속보.pdf',mime:'application/pdf',size:2048,suggest:F6},{id:'waitFile00000002',name:'가상 메모.txt',mime:'text/plain',size:10,suggest:null}],folders:scanBefore.folders,partial:false};
    const state=await boot(page,{width,place:PLACE,topFiles:b=>{
      if(b.action==='top-files-scan')return tidied?scanAfter:scanBefore;
      if(b.action==='top-files-tidy'){tidied++;return tidied===1?{ok:true,batch:'batch0001',moved:2,attached:1,trashed:2,waiting:0,cant:0,failed:0,left:3}:{ok:true,batch:'batch0001',moved:0,attached:0,trashed:1,waiting:2,cant:0,failed:0,left:0}}
      if(b.action==='top-files-wait')return {ok:true,document_id:'d1',moved:true};
      return {ok:false};
    }});
    await expect(page.locator('#libraryDriveLine .lu-drive-where')).toBeVisible();
    await page.locator('#libraryTopMenuBtn').click();
    await page.locator('#luTopMenu [data-lu-top="top-files"]').click();
    const m=page.locator('#libraryTopFilesModal');
    await expect(m).toBeVisible();
    await expect(m.locator('#libraryTopFilesSub')).toHaveText('드라이브 자료실 맨 위 파일 9개');
    await expect(m.locator('.lu-di-hint')).toContainText('제 폴더로 2 · 첨부 폴더로 1 · 휴지통 3(앱 임시 2·찌꺼기 1) · 정리 대기 2(바꿔 끼운 옛 원본 1·앱 기록 없음 1)');
    expect(state.topAsks).toEqual([{action:'top-files-scan'}]);
    await m.locator('[data-tf-apply]').click();
    await expect(m.locator('#libraryTopFilesStatus')).toHaveText('옮김 2 · 첨부로 1 · 휴지통 3 · 정리 대기 2');
    expect(state.topAsks.filter(a=>a.action==='top-files-tidy')).toEqual([{action:'top-files-tidy'},{action:'top-files-tidy',batch:'batch0001'}]);
    await expect(m.locator('[data-tf-undo]')).toBeVisible();
    const rows=m.locator('[data-tf-file]');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).locator('[data-tf-to]')).toHaveValue(F6);
    await expect(rows.nth(1).locator('[data-tf-to]')).toHaveValue('');
    if(process.env.TF_SHOTS)await page.screenshot({path:`${process.env.TF_SHOTS}/tf-${width}.png`});
    await rows.nth(0).locator('[data-tf-send]').click();
    await expect(m.locator('[data-tf-file]')).toHaveCount(1);
    expect(state.topAsks.at(-1)).toEqual({action:'top-files-wait',file_id:'waitFile00000001',to:F6});
    await m.locator('[data-tf-file] [data-tf-to]').selectOption('trash');
    await m.locator('[data-tf-file] [data-tf-send]').click();
    await expect(m.locator('[data-tf-file]')).toHaveCount(0);
    expect(state.topAsks.at(-1)).toEqual({action:'top-files-wait',file_id:'waitFile00000002',to:'trash'});
    const box=await m.locator('.modal-card').boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width+1);
  });
}

// S69-52 ① 자료실 ⋯ [드라이브와 맞는지 보기]: 열면 살피기만(바꾸지 않음) → 어긋남 네 종류(+자리) 줄과 개수 · 연결된 원본은 개수만 →
// 줄 [맞추기](이름은 어느 쪽으로) · [모두 맞추기](이어서·같은 번호) · [되돌리기](같은 번호). 가짜 서버·지어낸 이름만.
for(const width of [390,1280]){
  test(`자료실 ⋯ [드라이브와 맞는지 보기]: 어긋남 목록 → 줄 맞추기 → 모두 맞추기 → 되돌리기 (${width})`,async({page})=>{
    const A='a5200000-0000-4000-8000-000000000001',B='a5200000-0000-4000-8000-000000000002',C='a5200000-0000-4000-8000-000000000003',DD='a5200000-0000-4000-8000-000000000004';
    const full={ok:true,total:5,counts:{missing:1,extra:1,name:1,place:1,file:1},lines:{
      missing:[{kind:'missing',id:A,name:'가상 교섭',path:['가상 교섭']}],
      extra:[{kind:'extra',id:'extraFolder00001',name:'드라이브에만',path:['드라이브에만'],parent_ready:true,in_trash:false,can_app:true}],
      name:[{kind:'name',id:B,app_name:'자료실 이름',drive_name:'드라이브 이름',path:['자료실 이름'],suggest:null,can_app:true}],
      place:[{kind:'place',id:C,name:'가상 조직',path:['가상 조직'],drive_path:null,outside:true,suggest:null,can_app:false}],
      file:[{kind:'file',id:DD,title:'가상 자료',from:[],to:['가상 교섭']}]},linked:2,linked_lines:[{id:'x1',title:'연결 원본 하나'},{id:'x2',title:'연결 원본 둘'}],outside:0,waiting:0,partial:false};
    let phase=0;
    const state=await boot(page,{width,place:PLACE,check:b=>{
      if(b.op==='scan'){if(phase===0)return full;if(phase===1){const c=structuredClone(full);c.total=4;c.counts.name=0;c.lines.name=[];return c}return {ok:true,total:0,counts:{missing:0,extra:0,name:0,place:0,file:0},lines:{missing:[],extra:[],name:[],place:[],file:[]},linked:2,linked_lines:full.linked_lines,outside:0,waiting:0,partial:false}}
      if(b.op==='fix'&&b.lines){phase=1;return {ok:true,batch:'batch52a1',done:1,failed:0,cant:0,skipped:0,left:0,reasons:{}}}
      if(b.op==='fix'&&b.all){phase=2;return b.batch==='batch52a1'&&state.checkAsks.filter(x=>x.all).length===1?{ok:true,batch:'batch52a1',done:2,failed:0,cant:0,skipped:0,left:2,reasons:{}}:{ok:true,batch:'batch52a1',done:2,failed:0,cant:0,skipped:0,left:0,reasons:{}}}
      if(b.op==='undo'){phase=0;return {ok:true,restored:5,cant:0,left:0}}
      return {ok:false};
    }});
    await expect(page.locator('#libraryDriveLine .lu-drive-where')).toBeVisible();
    await page.locator('#libraryTopMenuBtn').click();
    await page.locator('#luTopMenu [data-lu-top="drive-check"]').click();
    const m=page.locator('#libraryDriveCheckModal');
    await expect(m).toBeVisible();
    await expect(m.locator('#libraryDriveCheckSub')).toHaveText('어긋난 곳 5개');
    await expect(m.locator('[data-dc-group] > summary .lu-di-path')).toHaveText(['드라이브에 없는 자료실 폴더','자료실에 없는 드라이브 폴더','다른 폴더에 있는 파일','이름 다른 폴더','자리 다른 폴더','연결된 원본']);
    await expect(m.locator('[data-dc-kind="file"]')).toContainText('드라이브 자료실 → 자료실 › 가상 교섭');
    await expect(m.locator('[data-dc-kind="place"]')).toContainText('자료실 밖으로 옮겨졌어요');
    await expect(m.locator('[data-dc-kind="place"] [data-dc-fix]')).toHaveText(['자료실 자리로']);
    await expect(m.locator('.lu-di-hint')).toContainText('연결된 원본 2개는 드라이브 원래 자리에 그대로 둬요');
    expect(state.checkAsks).toEqual([{op:'scan'}]);
    if(process.env.DC_SHOTS)await page.screenshot({path:`${process.env.DC_SHOTS}/dc-${width}.png`});
    // 이름 줄: 드라이브 이름으로
    await m.locator('[data-dc-kind="name"] [data-dc-to="app"]').click();
    await expect(m.locator('#libraryDriveCheckStatus')).toHaveText('맞춤 1');
    expect(state.checkAsks[1]).toEqual({op:'fix',lines:[{kind:'name',id:B,to:'app'}]});
    await expect(m.locator('#libraryDriveCheckSub')).toHaveText('어긋난 곳 4개');
    await expect(m.locator('[data-dc-undo]')).toBeVisible();
    // 모두 맞추기: 남은 것 이어서, 같은 번호
    await m.locator('[data-dc-all]').click();
    await expect(m.locator('#libraryDriveCheckStatus')).toHaveText('맞춤 4');
    expect(state.checkAsks.filter(x=>x.op==='fix'&&x.all)).toEqual([{op:'fix',all:true,batch:'batch52a1'},{op:'fix',all:true,batch:'batch52a1'}]);
    await expect(m.locator('#libraryDriveCheckSub')).toHaveText('드라이브와 같아요');
    await expect(m.locator('[data-dc-all]')).toBeDisabled();
    // 되돌리기
    await m.locator('[data-dc-undo]').click();
    await expect(m.locator('#libraryDriveCheckStatus')).toHaveText('되돌렸어요 · 5곳');
    expect(state.checkAsks.filter(x=>x.op==='undo')).toEqual([{op:'undo',batch:'batch52a1'}]);
    await expect(m.locator('#libraryDriveCheckSub')).toHaveText('어긋난 곳 5개');
    await expect(m.locator('[data-dc-undo]')).toBeHidden();
    // 바꾸지 않는 길로는 지우기 요청이 없다
    expect(state.checkAsks.every(x=>['scan','fix','undo'].includes(x.op))).toBe(true);
  });
}

test('저장 위치가 없으면 ⋯에 [드라이브와 맞는지 보기]도 없다',async({page})=>{
  await boot(page,{width:390,place:null});
  await page.locator('#libraryTopMenuBtn').click();
  await expect(page.locator('#luTopMenu')).toBeVisible();
  await expect(page.locator('#luTopMenu [data-lu-top="drive-check"]')).toHaveCount(0);
});
