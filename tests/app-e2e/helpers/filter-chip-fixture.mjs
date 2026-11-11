import { appOrigin } from './test-origin.mjs';
import {clickView} from './shell-navigation.mjs';
import { expect } from '@playwright/test';
import {execFileSync} from 'node:child_process';
import { enterLogin } from './login-entry.mjs';
import { signInWithSession } from './session-login.mjs';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const now=()=>new Date().toISOString();
const eq=(url,key)=>String(url.searchParams.get(key)||'').replace(/^eq\./,'');
const V2={project_system:'v2',management_version:2};

function baseState(){
  const space=(id,name,sort,extra={})=>({id,workspace_id:'workspace-1',name,description:null,parent_id:null,status:'active',visibility:'private',owner_id:'user-1',sort_order:sort,created_at:`2026-09-01T00:00:${String(sort).padStart(2,'0')}Z`,updated_at:now(),metadata:{...V2},...extra});
  return {
    // LIB-두칸보기(S55-11): 자료실 [▥ 두 칸]은 PC·펼친 폴드 기본 켬. 지금까지의 자료실 시험은 한 칸(나무 | 목록)을 보므로 기본은 끔으로 두고,
    // 두 칸 시험은 viewPrefs를 null(기본 켬) 또는 {library_two:true}로 바꾼다. 화면의 view_prefs 읽기·쓰기는 이 값을 쓴다.
    viewPrefs:{library_two:false},
    user:{id:'user-1',email:'owner@example.org',user_metadata:{display_name:'자료실 관리자'}},
    workspace:{id:'workspace-1',slug:'team',name:'웹2'},
    spaces:[
      space('legacy-1','기존 일반 공간',5,{metadata:{}}),
      space('top-a','공공기관 기능개혁 대응',10),
      space('child-a1','국토부 대응',20,{parent_id:'top-a',metadata:{}}),
      space('child-a2','산자부 대응',30,{parent_id:'top-a'}),
      space('child-a3','보관된 하위',35,{parent_id:'top-a',status:'archived'}),
      space('top-b','민자철도 정책 대응',40),
      space('child-b1','9/29 국회토론회',50,{parent_id:'top-b',status:'done'}),
      space('top-c','보관된 상위',60,{status:'archived'}),
      space('child-c1','보관 상위의 하위',65,{parent_id:'top-c'}),
      space('orphan-1','고아 하위 프로젝트',70,{parent_id:'legacy-1'}),
      space('other-owner','다른 사용자 프로젝트',15,{owner_id:'user-2'})
    ],
    docs:[
      {id:'doc-a',workspace_id:'workspace-1',project_id:'top-a',title:'상위 자료',category:'정부자료',tags:[],created_at:now()},
      {id:'doc-a1',workspace_id:'workspace-1',project_id:'child-a1',title:'하위 자료',category:'정책자료',tags:[],created_at:now()},
      {id:'doc-none',workspace_id:'workspace-1',project_id:null,title:'미연결 자료',category:'기타',tags:[],created_at:now()},
      {id:'doc-archived',workspace_id:'workspace-1',project_id:'top-c',title:'보관 프로젝트 자료',category:'기타',source:'원래 출처',tags:[],created_at:now()},
      {id:'doc-legacy',workspace_id:'workspace-1',project_id:'legacy-1',title:'기존 공간 자료',category:'기타',tags:[],created_at:now()},
      {id:'doc-missing',workspace_id:'workspace-1',project_id:'gone-1',title:'확인 불가 자료',category:'기타',tags:[],created_at:now()}
    ],
    uploads:[],patches:[],spaceReads:[]
  };
}

async function mockApp(page,state){
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method();
    const body=(()=>{try{return req.postDataJSON()}catch{return null}})();
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token')return ok({access_token:'e2e-access',refresh_token:'e2e-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:state.user});
    if(path==='/auth/v1/user')return ok(state.user);
    if(path==='/auth/v1/logout')return ok({});
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[],eventColors:{}});
    if(path==='/functions/v1/library-files'){
      const raw=(req.postDataBuffer()||Buffer.from('')).toString('utf8');
      const field=name=>raw.match(new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`))?.[1]??null;
      state.uploadAttempts?.push(field('project_id'));
      const failure=state.uploadFailures?.shift();
      if(failure)return route.fulfill({status:failure.status,contentType:'application/json',body:JSON.stringify(failure.body)});
      const row={id:`upload-${state.uploads.length+1}`,workspace_id:'workspace-1',project_id:field('project_id'),title:field('title')||'업로드',category:'기타',tags:[],created_at:now()};
      state.uploads.push(row);state.docs.push(row);
      // LIB-받는폴더: DB 넣기 뒤 트리거처럼, 받는 폴더가 켜져 있고 그 폴더가 있으면(휴지통 아님) 새 자료를 그 폴더에 넣는다(state.items = 폴더 연결 표).
      if(state.receiveFolder&&Array.isArray(state.items)&&(state.folders||[]).some(f=>f.id===state.receiveFolder))state.items.push({workspace_id:'workspace-1',document_id:row.id,folder_id:state.receiveFolder});
      return ok({ok:true,document:row});
    }
    if(path==='/functions/v1/workspace-drive'){state.downloads.push(body);return ok({url:`${appOrigin}/tests/app-e2e/library-open-fixture.html?download=1`})}
    if(path==='/functions/v1/document-actions'){state.deletes.push(body);state.docs=state.docs.filter(d=>d.id!==body.document_id);return ok({ok:true})}
    if(path.startsWith('/functions/v1/'))return ok({});
    // S51-28: state.documentCategories(분류 목록)를 주면 분류 함수 셋(추가·이름 바꾸기·지우기)을 DB 규칙만큼 흉내 낸다(state.categoryCalls에 쌓음).
    if(state.documentCategories&&/^\/rest\/v1\/rpc\/app_document_(category|subcategory)_/.test(path)){
      const fn=path.split('/').pop(),list=state.documentCategories;(state.categoryCalls||(state.categoryCalls=[])).push({fn,body});
      const done=next=>{state.documentCategories=next;return ok({ok:true,categories:next,documents:0})};
      if(fn==='app_document_category_add')return list.includes(body.p_name)?ok({ok:false,error:'CATEGORY_EXISTS'}):done([...list,body.p_name]);
      if(fn==='app_document_category_rename')return !list.includes(body.p_from)?ok({ok:false,error:'CATEGORY_NOT_FOUND'}):list.includes(body.p_to)?ok({ok:false,error:'CATEGORY_EXISTS'}):done(list.map(x=>x===body.p_from?body.p_to:x));
      if(fn==='app_document_category_delete'||fn==='app_document_subcategory_delete')return done(list.filter(x=>x!==body.p_name));
      if(fn==='app_document_category_delete_group')return done(list.filter(x=>x!==body.p_name&&!x.startsWith(body.p_name+'›')));
      return ok({ok:false,error:'REFUSED'});
    }
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:'workspace-1',user_id:state.user.id,role:'owner',workspace:state.workspace,created_at:now()}]);
    if(path==='/rest/v1/app_profiles'){
      // 자료실 보기 기억(LIB-보기기억): 내 프로필 행의 library_view 칸. state.libraryViewMissing이면 칸이 아직 없는 서버(적용 전)처럼 400.
      // LIB-받는폴더(S59-11): 내 프로필 행의 library_receive_folder 칸. state에 receiveFolder 키가 있을 때만 그 칸이 있는 서버(적용 뒤),
      // 없으면 칸이 아직 없는 서버처럼 그 칸을 고르거나 쓰면 400(42703). receiveFolderFail이면 쓰기 500. 없는 폴더 id면 외래 키 거절(409·23503).
      const receiveCol=method==='PATCH'?!!body&&'library_receive_folder' in body:(url.searchParams.get('select')||'').includes('library_receive_folder');
      if(receiveCol){
        if(!('receiveFolder' in state))return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({code:'42703',message:'column app_profiles.library_receive_folder does not exist'})});
        if(method==='PATCH'){
          (state.receivePatches||(state.receivePatches=[])).push(body.library_receive_folder);
          if(state.receiveFolderFail)return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({message:'fail'})});
          if(body.library_receive_folder!==null&&!(state.folders||[]).some(f=>f.id===body.library_receive_folder))return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({code:'23503',message:'insert or update on table "app_profiles" violates foreign key constraint "app_profiles_library_receive_folder_fkey"'})});
          state.receiveFolder=body.library_receive_folder;
        }
        return ok([{user_id:state.user.id,library_receive_folder:state.receiveFolder}]);
      }
      if(method==='PATCH'){
        if(state.libraryViewMissing)return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({code:'42703',message:'column app_profiles.library_view does not exist'})});
        (state.profilePatches||(state.profilePatches=[])).push(body);
        // LIB-폴더묶기기억 적용 전 서버: 검사가 group_by 'folder'를 거절(400, 검사 위반).
        if(state.libraryViewNoFolder&&body?.library_view?.group_by==='folder')return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({code:'23514',message:'new row for relation "app_profiles" violates check constraint "app_profiles_library_view_check"'})});
        // LIB-폴더로옮기기 적용 전 서버: 검사가 recent_folders 칸을 거절(400, 검사 위반).
        if(state.libraryViewNoRecent&&body?.library_view&&'recent_folders' in body.library_view)return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({code:'23514',message:'new row for relation "app_profiles" violates check constraint "app_profiles_library_view_check"'})});
        // LIB-폴더보기 칩 순서 적용 전 서버: 검사가 group_order 칸을 거절(400, 검사 위반).
        if(state.libraryViewNoOrder&&body?.library_view&&'group_order' in body.library_view)return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({code:'23514',message:'new row for relation "app_profiles" violates check constraint "app_profiles_library_view_check"'})});
        if(state.libraryViewFail)return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({message:'fail'})});
        // S51-28 분류 순서: 지금 목록과 같을 때만 고친다(document_categories=eq.{…}). 다르면 고친 줄 없음([]).
        if(body&&'document_categories' in body){
          const want=url.searchParams.get('document_categories'),now='eq.{'+(state.documentCategories||[]).map(x=>'"'+x.replace(/[\\"]/g,c=>'\\'+c)+'"').join(',')+'}';
          if(want!==now)return ok([]);
          state.documentCategories=body.document_categories;return ok([{user_id:state.user.id,document_categories:state.documentCategories}]);
        }
        // S56-36 회의명 정리(meeting_name_sorts): state에 meetingNameSorts가 있을 때만 그 칸이 있는 서버처럼 읽고 고친다.
        if(body&&'meeting_name_sorts' in body&&'meetingNameSorts' in state){state.meetingNameSorts=body.meeting_name_sorts;return ok([{user_id:state.user.id,meeting_name_sorts:state.meetingNameSorts}])}
        if(body&&'view_prefs' in body){state.viewPrefs=body.view_prefs;(state.viewPrefsPatches||(state.viewPrefsPatches=[])).push(body.view_prefs);return ok([{user_id:state.user.id}])}
        if(body&&'library_view' in body)state.libraryView=body.library_view;
        return ok([{user_id:state.user.id,display_name:'자료실 관리자',library_view:state.libraryView??null}]);
      }
      if(state.libraryViewMissing&&url.searchParams.get('select')?.includes('library_view'))return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({code:'42703',message:'column app_profiles.library_view does not exist'})});
      (state.profileReads||(state.profileReads=[])).push(url.search);
      return ok([{user_id:state.user.id,display_name:'자료실 관리자',library_view:state.libraryView??null,view_prefs:state.viewPrefs??null,...(state.documentCategories?{document_categories:state.documentCategories}:{}),...('meetingNameSorts' in state?{meeting_name_sorts:state.meetingNameSorts}:{})}]);
    }
    if(path==='/rest/v1/app_library_folders'&&method==='GET')return ok(state.folders||[]);
    if(path==='/rest/v1/app_library_folder_items'&&method==='GET')return ok(state.folderItems||[]);
    if(path==='/rest/v1/app_workspaces')return ok([state.workspace]);
    if(path==='/rest/v1/app_spaces'){
      if(method==='GET'){
        const id=eq(url,'id'),owner=eq(url,'owner_id');
        state.spaceReads.push(url.search);
        let rows=id?state.spaces.filter(x=>x.id===id):state.spaces;
        rows=rows.filter(x=>!owner||x.owner_id===owner).sort((a,b)=>a.sort_order-b.sort_order);
        return ok(rows);
      }
      if(method==='POST'){const row={...(body||{}),id:`project-new-${state.spaces.length+1}`,created_at:now(),updated_at:now()};state.spaces.push(row);return ok([row])}
      if(method==='PATCH'){const id=eq(url,'id'),row=state.spaces.find(x=>x.id===id);if(row)Object.assign(row,body||{},{updated_at:now()});return ok([])}
    }
    if(path==='/rest/v1/app_meetings'&&method==='POST'){const row={...body,id:'new-meeting'};state.meetings.push(row);state.meetingWrites.push(body);return ok([row])}
    if(path==='/rest/v1/app_meetings'&&method==='PATCH'){
      const id=eq(url,'id'),workspace=eq(url,'workspace_id');
      const rows=(state.meetings||[]).filter(row=>id&&workspace&&row.id===id&&row.workspace_id===workspace);
      if(!rows.length)return ok([]);
      rows.forEach(row=>Object.assign(row,body));
      state.meetingWrites.push(body);
      return req.headers().prefer?.includes('return=representation')?ok(rows):route.fulfill({status:204,body:''});
    }
    if(path==='/rest/v1/app_meetings')return ok((state.meetings||[{id:'library-qa-meeting',workspace_id:'workspace-1',title:'회귀 확인 회의',meeting_name:'회귀 확인 회의',round_no:2,meeting_at:'2026-10-06T12:00:00',created_by:state.user.id}]).filter(m=>(!eq(url,'id')||m.id===eq(url,'id'))&&(!eq(url,'workspace_id')||m.workspace_id===eq(url,'workspace_id'))));
    if(path==='/rest/v1/app_documents'){
      const id=eq(url,'id'),pid=eq(url,'project_id'),mid=eq(url,'meeting_id');
      if(method==='GET')return ok(state.docs.filter(x=>(!id||x.id===id)&&(!pid||x.project_id===pid)&&(!mid||x.meeting_id===mid)));
      if(method==='PATCH'){state.patches.push({id,body});const row=state.docs.find(x=>x.id===id);if(row)Object.assign(row,body||{});return ok([])}
    }
    if(path.startsWith('/rest/v1/'))return ok([]);
    return ok({});
  });
}

async function signIn(page,target=`${appOrigin}/app/`){
  await page.goto(target);
  await enterLogin(page);
  await signInWithSession(page,'owner@example.org');
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
}


export {baseState,mockApp,signIn};
