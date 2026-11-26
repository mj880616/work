// LIB-여러개삭제: 가짜 서버와 시나리오. @playwright/test에 의존하지 않아(검사는 check로 받음) 크롬 실측 스크립트도 같은 시나리오를 쓴다.
import {showAllLibraryCategories} from './library-categories.mjs';
import {signInWithSession} from './session-login.mjs';
import {libraryTopMenu,libraryExpandItem} from './library-tree.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const project={id:'p1',workspace_id:'ws',owner_id:'owner',name:'교섭 준비',status:'active',sort_order:1,metadata:{project_system:'v2'}};
const pad=n=>String(n).padStart(2,'0');
// S70: n으로 시작하는 자료는 [드라이브에서 가져오기]로 연결만 한 드라이브 원본(classification_note 표식).
const doc=(id,project_id,i)=>({id,workspace_id:'ws',project_id,file_name:id+'.pdf',title:id+'.pdf',category:'교섭',tags:[],mime_type:'application/pdf',file_id:'f-'+id,classification_note:id.startsWith('n')?'드라이브에서 가져옴 · 파일명 기반 자동분류':'파일명 기반 자동분류',created_at:`2026-10-${pad(i%28+1)}T00:00:${pad(i%60)}Z`,document_date:`2026-10-${pad(i%28+1)}`});
export const manyDocs=n=>Array.from({length:n},(_,i)=>doc((i%2?'n':'b')+i,'p1',i));
export async function setup(page,width,{failIds=[],docs=null}={}){
  await page.setViewportSize({width,height:900});
  const state={docs:docs||[doc('a1','p1',0),doc('a2','p1',1),doc('a3','p1',2),doc('n1',null,3),doc('n2',null,4)],deletes:[],inflight:0,peak:0,failIds,errors:[]};
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
      // S70 LIB-묶음삭제: 여러 개는 'delete-many' 한 요청(자료마다 결과). 연결 원본은 드라이브를 두었다고 답한다(실제 Drive 판단은 서버 시험이 본다).
      if(body.action==='delete-many'){
        const results=body.document_ids.map(id=>state.failIds.includes(id)?{id,ok:false,code:'FAILED'}:{id,ok:true,...(id.startsWith('n')?{drive_result:'preserved',drive_preserved:true,reason:'linked_original'}:{drive_result:'trashed',drive_preserved:false,reason:'ordinary_library'})});
        const gone=new Set(results.filter(x=>x.ok).map(x=>x.id));state.docs=state.docs.filter(d=>!gone.has(d.id));
        return ok({ok:true,stopped:false,results});
      }
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
  await showAllLibraryCategories(page);// LIB-위쪽한줄: 분류는 [분류 ▾] 창(그려진 뒤까지 helper가 기다림)
  const now=await libraryExpandItem(page);
  if(!now.disabled&&now.text==='모두 펴기')await libraryTopMenu(page,'expand');
  await page.waitForFunction(()=>document.querySelectorAll('#documentList [data-lu-document]').length>0&&!document.querySelector('#documentList details[data-lu-node]:not([open])'));
}
const count=page=>page.locator('#librarySelectCount').textContent();
export async function run(page,base,width,check,{shot=null}={}){
  const state=await setup(page,width,{failIds:['a2']});
  await openLibrary(page,base);
  const rows=()=>page.locator('#documentList [data-lu-document]').count();
  check(await rows(),5,'rows');
  check(await page.locator('#documentList .lu-pick').count(),0,'no boxes before select');
  await libraryTopMenu(page,'select');
  check(await page.locator('#documentList [data-lu-pick]').count(),5,'row boxes');
  check(await page.locator('#librarySelectBar').isVisible(),true,'bar visible');
  check(await count(page),'0개 선택됨','count zero');
  check(await page.locator('#librarySelectDelete').isDisabled(),true,'delete disabled at zero');
  // 한 줄 고르기
  await page.locator('[data-lu-pick="n1"]').click();
  check(await count(page),'1개 선택됨','one');
  check(state.deletes.length,0,'row pick does not delete');
  check(await page.locator('#documentList [data-lu-pick-node]').count()>0,true,'folder boxes');
  // 폴더 칸 → 그 안 자료 모두
  const folderBox=page.locator('[data-lu-node="p:p1"] > summary [data-lu-pick-node]');
  await folderBox.click();
  check(await count(page),'4개 선택됨','folder selects its documents');
  check(await page.locator('[data-lu-pick="a1"]').isChecked(),true,'folder child checked');
  // 전체 칩: 모두 → 해제
  await page.locator('#librarySelectAll').click();
  check(await count(page),'5개 선택됨','all');
  check(await page.locator('#librarySelectAll').getAttribute('aria-checked'),'true','all chip on');
  if(shot)await page.screenshot({path:shot,fullPage:false});
  await page.locator('#librarySelectAll').click();
  check(await count(page),'0개 선택됨','all off');
  // K1 한 규칙(I-6, 2026-11-25 사용자 결정 6 — 예전 S70 LIB-묶음삭제 '여럿은 한 번 묻기'를 바꿈): 지운 뒤 [되돌리기]가 있으니 여럿도 묻지 않는다.
  // LIB-바로지우기 그대로: 바로 목록에서 빠지고 작은 알림 '5개를 삭제했어요 · 되돌리기'(드라이브 원본을 둔 수 한 줄). 서버 요청은 알림이 사라진 뒤에 보낸다.
  await page.locator('#librarySelectAll').click();
  const dialogs=[];page.on('dialog',async d=>{dialogs.push(d.type());await d.dismiss()});
  await page.locator('#librarySelectDelete').click();
  check(await rows(),0,'rows leave at once');
  check(await page.locator('.kptu-ask').count(),0,'no confirm (undo instead)');
  check(await page.locator('#kptuNotice .kptu-notice-text').textContent(),'5개를 삭제했어요','small notice');
  check(await page.locator('#kptuNotice .kptu-notice-note').textContent(),'드라이브에서 가져온 2개는 드라이브 원본을 그대로 둬요.','notice says Drive originals stay');
  check(state.deletes.length,0,'nothing sent before undo window ends');
  // 되돌리기: 요청 없이 모두 되살림
  await page.locator('#kptuNotice .kptu-notice-undo').click();
  check(await rows(),5,'undo restores rows');
  await page.waitForTimeout(7000);
  check(state.deletes.length,0,'undo sends nothing');
  // 다시 고르고 지우기: 알림이 사라진 뒤 차례로 보내고 a2만 실패해 되살아난다
  await libraryTopMenu(page,'select');
  await page.locator('#librarySelectAll').click();
  await page.locator('#librarySelectDelete').click();
  check(await rows(),0,'rows leave again');
  await page.waitForFunction(()=>document.querySelectorAll('#documentList [data-lu-document]').length===1,null,{timeout:20000});
  check(state.deletes.length,1,'one server request for all');
  check(state.deletes[0].action,'delete-many','bulk action');
  check(state.deletes[0].document_ids,['a3','a2','a1','n2','n1'],'all picked ids in screen order');
  check(await page.locator('[data-lu-document="a2"]').count(),1,'failed row comes back');
  check(await page.locator('#kptuNotice .kptu-notice-text').textContent(),'4개를 삭제했고 1개는 삭제하지 못했어요.','partial failure notice');
  check(dialogs,[],'no browser dialogs');
  check(await page.locator('#documentList .lu-pick').count(),0,'select mode ends after delete');
  check(await page.locator('#librarySelectBar').isVisible(),false,'bar hidden');
  check(await page.locator('#libraryTopMenuBtn').isVisible(),true,'top menu still there');
  check(state.errors,[],'no page errors');
  return state;
}

// S70 LIB-묶음삭제(사용자 11/24 "2300개 다 삭제했는데 왜 삭제가 안 되지"): 한 묶음에 320개 — [전체]가 접힌 것까지 모두 고르고 정확한 수를 보이며,
// [삭제] 한 번에 모두 지워진다(서버 'delete-many' 40개씩, 빠짐·겹침 없음). 진행 'n/전체', 끝 알림 'N개를 삭제했어요' + 드라이브 원본을 둔 수.
export async function runMany(page,base,width,check,n=320){
  const state=await setup(page,width,{docs:manyDocs(n)});
  await openLibrary(page,base);
  await libraryTopMenu(page,'select');
  await page.locator('#librarySelectAll').click();
  check(/^320개 선택됨/.test(await count(page)),true,'all picks every document in the group, folded ones too');
  await page.locator('#librarySelectDelete').click(); // K1 한 규칙(I-6): [되돌리기]가 있으니 묻지 않는다
  check(await page.locator('#documentList [data-lu-document]').count(),0,'rows leave at once');
  check(await page.locator('.kptu-ask').count(),0,'no confirm (undo instead)');
  await page.waitForFunction(()=>/^삭제하는 중 \d+\/320$/.test(document.querySelector('#kptuNotice .kptu-notice-text')?.textContent||''),null,{timeout:15000});
  await page.waitForFunction(()=>(document.querySelector('#kptuNotice .kptu-notice-text')?.textContent||'')==='320개를 삭제했어요.',null,{timeout:30000});
  const sent=state.deletes.flatMap(x=>x.document_ids||[]);
  check(state.deletes.every(x=>x.action==='delete-many'&&x.document_ids.length<=50),true,'bulk requests of at most 50');
  check(sent.length,n,'every id sent once');
  check(new Set(sent).size,n,'no id twice');
  check(state.docs.length,0,'server list empty');
  check(await page.locator('#kptuNotice .kptu-notice-note').textContent(),`드라이브에서 가져온 ${n/2}개는 드라이브 원본을 그대로 뒀어요.`,'preserved note');
  check(await page.locator('#documentList [data-lu-document]').count(),0,'nothing comes back');
  check(state.errors,[],'no page errors');
  return state;
}
