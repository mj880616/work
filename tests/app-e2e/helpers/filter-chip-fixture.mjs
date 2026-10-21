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
      return ok({ok:true,document:row});
    }
    if(path==='/functions/v1/workspace-drive'){state.downloads.push(body);return ok({url:`${appOrigin}/tests/app-e2e/library-open-fixture.html?download=1`})}
    if(path==='/functions/v1/document-actions'){state.deletes.push(body);state.docs=state.docs.filter(d=>d.id!==body.document_id);return ok({ok:true})}
    if(path.startsWith('/functions/v1/'))return ok({});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:'workspace-1',user_id:state.user.id,role:'owner',workspace:state.workspace,created_at:now()}]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:state.user.id,display_name:'자료실 관리자'}]);
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
