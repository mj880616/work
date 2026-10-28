// LIB-여러개삭제: 가짜 서버와 시나리오. @playwright/test에 의존하지 않아(검사는 check로 받음) 크롬 실측 스크립트도 같은 시나리오를 쓴다.
import {signInWithSession} from './session-login.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const project={id:'p1',workspace_id:'ws',owner_id:'owner',name:'교섭 준비',status:'active',sort_order:1,metadata:{project_system:'v2'}};
const doc=(id,project_id,i)=>({id,workspace_id:'ws',project_id,file_name:id+'.pdf',title:id+'.pdf',category:'교섭',tags:[],mime_type:'application/pdf',created_at:`2026-10-0${i+1}T00:00:00Z`,document_date:`2026-10-0${i+1}`});
export async function setup(page,width,{failIds=[]}={}){
  await page.setViewportSize({width,height:900});
  const state={docs:[doc('a1','p1',0),doc('a2','p1',1),doc('a3','p1',2),doc('n1',null,3),doc('n2',null,4)],deletes:[],inflight:0,peak:0,failIds,errors:[]};
  page.on('pageerror',e=>state.errors.push(e.message));
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname,ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
    if(path==='/auth/v1/token')return ok({access_token:'test-access',refresh_token:'test-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'owner'}});
    if(path==='/auth/v1/user')return ok({id:'owner',email:'owner@example.org'});
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:'ws',user_id:'owner',role:'owner',workspace:{id:'ws',name:'테스트'}}]);
    if(path==='/rest/v1/app_workspaces')return ok([{id:'ws',name:'테스트'}]);
    if(path==='/rest/v1/app_spaces')return ok([project]);
    if(path==='/rest/v1/app_documents'){const id=url.searchParams.get('id')?.replace(/^eq\./,'');return ok(state.docs.filter(d=>!id||d.id===id))}
    if(path==='/functions/v1/document-actions'){
      const body=req.postDataJSON();state.deletes.push(body);state.inflight++;state.peak=Math.max(state.peak,state.inflight);
      await new Promise(r=>setTimeout(r,60));state.inflight--;
      if(state.failIds.includes(body.document_id))return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'denied'})});
      state.docs=state.docs.filter(d=>d.id!==body.document_id);
      return ok({ok:true,drive_result:'trashed',drive_preserved:false,reason:'ordinary_library'});
    }
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[]});
    if(path==='/functions/v1/google-tasks')return ok({tasks:[]});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    return ok([]);
  });
  return state;
}
export async function openLibrary(page,base){
  await page.goto(`${base}/app/login/?return=${encodeURIComponent(base+'/app/?view=library')}`);
  await signInWithSession(page,'owner@example.org');
  await page.waitForFunction(()=>document.querySelector('#appView.kptu-ui-ready')&&window.KPTUViewLoader?.isLoaded('library')&&window.__KPTU_LIBRARY_UPLOAD_READY__,null,{timeout:20000});
  await page.evaluate(()=>window.__KPTU_LIBRARY_UPLOAD_READY__);
  // 분류 칩은 모두 켜고 트리는 모두 편다.
  await page.waitForSelector('#libraryCategoryFilter [data-lu-category]:not([data-lu-category="all"])');
  for(const chip of await page.locator('#libraryCategoryFilter [data-lu-category]:not([data-lu-category="all"])').all())if(await chip.getAttribute('aria-pressed')!=='true')await chip.click();
  const all=page.locator('#libraryExpandAll');
  if(await all.isEnabled()&&await all.getAttribute('data-lu-expand')!=='close')await all.click();
  await page.waitForFunction(()=>document.querySelectorAll('#documentList [data-lu-document]').length>0&&!document.querySelector('#documentList details[data-lu-node]:not([open])'));
}
const count=page=>page.locator('#librarySelectCount').textContent();
export async function run(page,base,width,check,{shot=null}={}){
  const state=await setup(page,width,{failIds:['a2']});
  await openLibrary(page,base);
  const rows=()=>page.locator('#documentList [data-lu-document]').count();
  check(await rows(),5,'rows');
  check(await page.locator('#documentList .lu-pick').count(),0,'no boxes before select');
  await page.locator('#librarySelectBtn').click();
  check(await page.locator('#documentList [data-lu-pick]').count(),5,'row boxes');
  check(await page.locator('#librarySelectBar').isVisible(),true,'bar visible');
  check(await count(page),'0개 골랐음','count zero');
  check(await page.locator('#librarySelectDelete').isDisabled(),true,'delete disabled at zero');
  // 한 줄 고르기
  await page.locator('[data-lu-pick="n1"]').click();
  check(await count(page),'1개 골랐음','one');
  check(state.deletes.length,0,'row pick does not delete');
  check(await page.locator('#documentList [data-lu-pick-node]').count()>0,true,'folder boxes');
  // 폴더 칸 → 그 안 자료 모두
  const folderBox=page.locator('[data-lu-node="p:p1"] > summary [data-lu-pick-node]');
  await folderBox.click();
  check(await count(page),'4개 골랐음','folder selects its documents');
  check(await page.locator('[data-lu-pick="a1"]').isChecked(),true,'folder child checked');
  // 전체 칩: 모두 → 해제
  await page.locator('#librarySelectAll').click();
  check(await count(page),'5개 골랐음','all');
  check(await page.locator('#librarySelectAll').getAttribute('aria-checked'),'true','all chip on');
  if(shot)await page.screenshot({path:shot,fullPage:false});
  await page.locator('#librarySelectAll').click();
  check(await count(page),'0개 골랐음','all off');
  // LIB-바로지우기: 묻지 않고 바로 목록에서 빠지고 작은 알림 '5개를 지웠어요 · 되돌리기'. 서버 요청은 알림이 사라진 뒤에 보낸다.
  await page.locator('#librarySelectAll').click();
  const dialogs=[];page.on('dialog',async d=>{dialogs.push(d.type());await d.dismiss()});
  await page.locator('#librarySelectDelete').click();
  check(await rows(),0,'rows leave at once');
  check(await page.locator('#kptuNotice .kptu-notice-text').textContent(),'5개를 지웠어요','small notice');
  check(state.deletes.length,0,'nothing sent before undo window ends');
  // 되돌리기: 요청 없이 모두 되살림
  await page.locator('#kptuNotice .kptu-notice-undo').click();
  check(await rows(),5,'undo restores rows');
  await page.waitForTimeout(7000);
  check(state.deletes.length,0,'undo sends nothing');
  // 다시 고르고 지우기: 알림이 사라진 뒤 차례로 보내고 a2만 실패해 되살아난다
  await page.locator('#librarySelectBtn').click();
  await page.locator('#librarySelectAll').click();
  await page.locator('#librarySelectDelete').click();
  check(await rows(),0,'rows leave again');
  await page.waitForFunction(()=>document.querySelectorAll('#documentList [data-lu-document]').length===1,null,{timeout:20000});
  check(state.deletes.map(x=>x.document_id),['a3','a2','a1','n2','n1'],'same server path, one by one in screen order');
  check(state.deletes.every(x=>x.action==='delete'),true,'action delete');
  check(state.peak,1,'one request at a time');
  check(await page.locator('[data-lu-document="a2"]').count(),1,'failed row comes back');
  check(/^4개를 지웠고 1개는 지우지 못해 되살렸어요/.test(await page.locator('#kptuNotice .kptu-notice-text').textContent()),true,'partial failure notice');
  check(dialogs,[],'no browser dialogs');
  check(await page.locator('#documentList .lu-pick').count(),0,'select mode ends after delete');
  check(await page.locator('#librarySelectBar').isVisible(),false,'bar hidden');
  check(await page.locator('#librarySelectBtn').isVisible(),true,'select button back');
  check(state.errors,[],'no page errors');
  return state;
}
