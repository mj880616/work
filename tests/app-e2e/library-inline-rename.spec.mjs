// LIB-줄안이름바꾸기: 자료실 줄에서 창 없이 제목을 바꾼다(메뉴 [이름 바꾸기 F2] · 줄을 고른 채 F2). Synthetic server only. Fake documents, 390 and 1280.
import { appOrigin } from './helpers/test-origin.mjs';
import { test, expect } from '@playwright/test';
import { enterLogin } from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';
import { revealLibraryRow } from './helpers/library-tree.mjs';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const now=()=>new Date().toISOString();
const eq=(url,key)=>String(url.searchParams.get(key)||'').replace(/^eq\./,'');
const DOC=n=>`e1000000-0000-4000-8000-${String(n).padStart(12,'0')}`;

function doc(n,over={}){
  return {id:DOC(n),workspace_id:'workspace-1',project_id:null,organization_id:null,meeting_id:null,title:'가상 본교섭 요구안',category:'교섭',source:null,document_date:null,
    description:null,tags:[],file_id:'driveFile'+n,file_name:'원본'+n+'.hwpx',mime_type:'application/x-hwp',file_size:2048,drive_url:'https://drive.google.com/file/d/driveFile'+n+'/view',
    created_at:'2026-09-01T00:00:00Z',updated_at:'2026-09-01T00:00:00Z',field_origin:{title:'ai'},auto_classified:true,classification_note:'자동 분류',
    extracted_text:'글자',extraction_status:'ready',previous_files:[],reclassify_needed:false,...over};
}
function baseState(){
  return {user:{id:'user-1',email:'owner@example.org',user_metadata:{display_name:'자료실 관리자'}},workspace:{id:'workspace-1',slug:'team',name:'웹2'},
    docs:[doc(1),doc(2,{title:'두 번째 자료'})],patches:[],opened:0};
}
async function mockApp(page,state){
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method();
    const body=(()=>{try{return req.postDataJSON()}catch{return null}})();
    const ok=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token')return ok({access_token:'e2e-access',refresh_token:'e2e-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:state.user});
    if(path==='/auth/v1/user')return ok(state.user);
    if(path==='/auth/v1/logout')return ok({});
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[],eventColors:{}});
    if(path.startsWith('/functions/v1/'))return ok({});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:'workspace-1',user_id:state.user.id,role:'owner',workspace:state.workspace,created_at:now()}]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:state.user.id,display_name:'자료실 관리자',document_categories:['교섭','투쟁','교육','선전','정책','회의','기타']}]);
    if(path==='/rest/v1/app_workspaces')return ok([state.workspace]);
    if(path==='/rest/v1/app_meetings')return ok([]);
    if(path==='/rest/v1/app_library_classify_attempts')return ok({message:'not found'},404);
    if(path==='/rest/v1/app_documents'){
      const id=eq(url,'id');
      if(method==='GET')return ok(state.docs.filter(x=>(!id||x.id===id)&&(!url.searchParams.has('or')||!['ready','error'].includes(x.extraction_status))));
      if(method==='PATCH'){
        state.patches.push({id,body});
        const rows=state.docs.filter(row=>row.id===id);rows.forEach(row=>Object.assign(row,body||{}));
        return ok(rows);
      }
    }
    if(path.startsWith('/rest/v1/'))return ok([]);
    return ok({});
  });
}
async function boot(page,width){
  await page.setViewportSize({width,height:900});
  const state=baseState();await mockApp(page,state);
  // 입력칸을 눌러도 줄의 '열기'(Drive 새 탭)가 일어나지 않는지 본다.
  page.context().on('page',()=>{state.opened++});
  await page.goto(`${appOrigin}/app/?view=library`);
  await enterLogin(page);await signInWithSession(page,'owner@example.org');
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
  await expect(page.locator('[data-lu-document]')).toHaveCount(2);
  return state;
}
const row=(page,n)=>page.locator(`[data-lu-document="${DOC(n)}"]`);

for(const width of [390,1280])test.describe(`줄 안 이름 바꾸기 ${width}`,()=>{
  test('메뉴: 맨 위 [이름 바꾸기] → Enter 저장(사용자 값) → 되돌리기',async({page})=>{
    const state=await boot(page,width);
    await revealLibraryRow(page,DOC(1));
    await row(page,1).locator('.lu-more-trigger').click();
    const buttons=page.locator('#luMorePanel button');
    await expect(buttons.first()).toHaveText('선택');await expect(buttons.nth(1)).toHaveText(/^이름 바꾸기/);
    await expect(buttons.filter({hasText:/^(Drive에서 열기|내려받기)$/})).toHaveText(['Drive에서 열기','내려받기']);
    await expect(page.locator('#luMorePanel [data-lu-edit]')).toHaveText('정보 수정…');
    await expect(buttons.last()).toHaveText('삭제');
    await expect(page.locator('#luMorePanel .lu-menu-sep')).toHaveCount(1);
    for(const b of await buttons.all())expect((await b.boundingBox()).height).toBeLessThan(44);
    await page.locator('#luMorePanel [data-lu-rename]').click();
    const input=row(page,1).locator('.lu-rename-input');
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('가상 본교섭 요구안');
    expect(await input.evaluate(el=>[el.selectionStart,el.selectionEnd])).toEqual([0,'가상 본교섭 요구안'.length]);
    await input.fill('새 이름 요구안');await input.press('Enter');
    await expect(row(page,1).locator('.lu-row-title')).toHaveText('새 이름 요구안');
    await expect(page.locator('#libraryFolderStatusLine')).toContainText('이름을 바꿨어요');
    expect(state.patches).toHaveLength(1);
    const sent=state.patches[0].body;
    expect(sent.title).toBe('새 이름 요구안');expect(sent.field_origin.title).toBe('user');expect(sent.auto_classified).toBe(false);
    expect('file_name' in sent).toBe(false);
    expect(state.docs[0].file_name).toBe('원본1.hwpx');
    expect(state.opened).toBe(0);
    await page.locator('#libraryFolderStatusLine .lu-undo').click();
    await expect(row(page,1).locator('.lu-row-title')).toHaveText('가상 본교섭 요구안');
    expect(state.patches).toHaveLength(2);expect(state.patches[1].body.field_origin).toEqual({title:'ai'});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  });

  test('Esc는 취소, 바깥 누르기는 저장, 같은 이름·빈 이름은 저장하지 않음',async({page})=>{
    const state=await boot(page,width);
    await revealLibraryRow(page,DOC(1));
    const start=async()=>{await row(page,1).locator('.lu-more-trigger').click();await page.locator('#luMorePanel [data-lu-rename]').click();return row(page,1).locator('.lu-rename-input')};
    let input=await start();await input.fill('버릴 이름');await input.press('Escape');
    await expect(row(page,1).locator('.lu-rename-input')).toHaveCount(0);
    await expect(row(page,1).locator('.lu-row-title')).toHaveText('가상 본교섭 요구안');
    input=await start();await input.press('Enter');
    await expect(row(page,1).locator('.lu-rename-input')).toHaveCount(0);
    input=await start();await input.fill('   ');await input.press('Enter');
    await expect(row(page,1).locator('.lu-row-title')).toHaveText('가상 본교섭 요구안');
    expect(state.patches).toHaveLength(0);
    input=await start();await input.fill('바깥을 눌러 저장');
    await page.locator('#documentSearch').click();
    await expect(row(page,1).locator('.lu-row-title')).toHaveText('바깥을 눌러 저장');
    expect(state.patches).toHaveLength(1);expect(state.patches[0].body.title).toBe('바깥을 눌러 저장');
    expect(state.opened).toBe(0);
  });

  if(width>=761)test('PC: 줄을 고른 채 F2',async({page})=>{
    const state=await boot(page,width);
    await revealLibraryRow(page,DOC(2));
    await row(page,2).focus();await page.keyboard.press('F2');
    const input=row(page,2).locator('.lu-rename-input');
    await expect(input).toBeFocused();await expect(input).toHaveValue('두 번째 자료');
    await input.fill('F2로 바꿈');await input.press('Enter');
    await expect(row(page,2).locator('.lu-row-title')).toHaveText('F2로 바꿈');
    expect(state.patches.map(p=>p.id)).toEqual([DOC(2)]);
    // 입력칸 안의 F2·Space는 줄을 열거나 다시 시작하지 않는다.
    await expect(row(page,2)).toBeFocused();
  });
});
