import { appOrigin } from './helpers/test-origin.mjs';
import {selectFilter,filterOptions} from './helpers/filter-chips.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
import { test, expect } from '@playwright/test';
import { enterLogin } from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';
import { expectProjectDetail, projectDetailDocked } from './helpers/project-detail.mjs';
import {expandLibraryTree,focusLibraryProject,libraryNode} from './helpers/library-tree.mjs';
import {expectProjectTitle,toplineItem} from './helpers/screen-title.mjs';

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
      if(method==='PATCH'){
        const id=eq(url,'id'),owner=eq(url,'owner_id'),workspace=eq(url,'workspace_id');
        const rows=state.spaces.filter(row=>row.id===id&&(!owner||row.owner_id===owner)&&(!workspace||row.workspace_id===workspace));
        rows.forEach(row=>Object.assign(row,body||{},{updated_at:now()}));return ok(req.headers().prefer?.includes('return=representation')?rows:[]);
      }
    }
    // Synthetic PostgREST representation only; these IDs do not prove DB defaults.
    if(path==='/rest/v1/app_project_modules'){
      const modules=state.projectModules??=[];
      if(method==='GET'){const projectId=eq(url,'project_id');return ok(modules.filter(row=>!projectId||row.project_id===projectId))}
      if(method==='POST'&&Array.isArray(body)){
        if(!body.every(value=>value?.created_by===state.user.id&&state.spaces.some(project=>project.id===value.project_id&&project.owner_id===state.user.id&&project.workspace_id===state.workspace.id)))return ok([]);
        const rows=body.map((value,index)=>({...value,id:`synthetic-module-${modules.length+index+1}`}));modules.push(...rows);
        return ok(req.headers().prefer?.includes('return=representation')?rows:[]);
      }
      return ok([]);
    }
    if(path==='/rest/v1/app_documents'){
      const id=eq(url,'id'),workspace=eq(url,'workspace_id'),pid=eq(url,'project_id');
      if(method==='GET')return ok(state.docs.filter(x=>(!id||x.id===id)&&(!workspace||x.workspace_id===workspace)&&(!pid||x.project_id===pid)));
      if(method==='PATCH'){
        state.patches.push({id,body});
        const rows=state.docs.filter(row=>row.id===id&&(!workspace||row.workspace_id===workspace));
        rows.forEach(row=>Object.assign(row,body||{}));
        return req.headers().prefer?.includes('return=representation')?ok(rows):route.fulfill({status:204,body:''});
      }
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
const optionsOf=filterOptions;
// LIB-토글트리: 자료실이 프로젝트 목록을 다 읽고 트리를 그린 뒤(1단 프로젝트 토글이 보임)에 시작한다.
async function waitLibraryTree(page){await expect(page.locator('#documentList details[data-lu-node="p:top-a"]')).toBeAttached();await expandLibraryTree(page)}
// 트리의 프로젝트 토글 차례(키·이름). 하위 토글은 자료가 있을 때만 보인다.
const treeProjects=page=>page.locator('#documentList details[data-lu-node^="p:"]').evaluateAll(xs=>xs.map(x=>[x.dataset.luNode.slice(2),x.querySelector(':scope > summary .lu-node-name').textContent]));
const EXPECTED=[
  ['top-a','공공기관 기능개혁 대응'],
  ['child-a1','　↳ 국토부 대응'],
  ['child-a2','　↳ 산자부 대응'],
  ['top-b','민자철도 정책 대응'],
  ['child-b1','　↳ 9/29 국회토론회'],
  ['orphan-1','고아 하위 프로젝트']
];
async function gotoLibrary(page){
  await clickView(page,'library');
  await expect(page.locator('#libraryView')).toBeVisible();
  await waitLibraryTree(page);
}

test('library selectors match the canonical project hierarchy on direct entry without visiting projects',async({page})=>{
  const state=baseState();await mockApp(page,state);await page.setViewportSize({width:1440,height:900});
  await signIn(page,`${appOrigin}/app/?view=library`);
  await expect(page.locator('#libraryView')).toBeVisible();
  await waitLibraryTree(page);
  expect(await page.evaluate(()=>!!window.__KPTU_PROJECT_V3_READY__)).toBe(false);
  expect(state.spaceReads.some(q=>q.includes('owner_id=eq.user-1'))).toBe(true);

  await page.locator('#newDocumentBtn').click();
  await expect(page.locator('#documentModal')).toBeVisible();
  const upload=await optionsOf(page,'#docProject');
  expect(upload[0]).toEqual({value:'',text:'프로젝트 없음',stale:false});
  expect(upload.slice(1).map(o=>[o.value,o.text])).toEqual(EXPECTED);
  await expect(page.locator('#docProject')).toHaveValue('');

  // LIB-토글트리: 자료실의 프로젝트 차례는 트리다. 활성 1단 프로젝트(자료가 없어도)와 자료가 있는 하위, 그 뒤 보관·옛 공간·확인 불가 연결, 맨 아래 '프로젝트 없음'.
  expect(await treeProjects(page)).toEqual([
    ['top-a','공공기관 기능개혁 대응'],['child-a1','국토부 대응'],['top-b','민자철도 정책 대응'],['orphan-1','고아 하위 프로젝트'],
    ['top-c','[보관됨] 보관된 상위'],['legacy-1','[이전 공간] 기존 일반 공간'],['gone-1','[확인할 수 없는 프로젝트]'],['none','프로젝트 없음']
  ]);
  for(const hidden of ['child-a3','child-c1','other-owner'])await expect(libraryNode(page,'p:'+hidden)).toHaveCount(0);

  // Project relationships remain in the canonical filter and metadata editor;
  // the approved library row shows only date and category (UI-PC자료실: 분류 꼬리표 칸, 자료 날짜 없으면 올린 날 + 올림: LIB-목록다듬기).
  await expect(page.locator('#documentList .badges')).toHaveCount(0);
  await expect(page.locator('[data-lu-document="doc-a"] .doc-category-tag')).toHaveText('정책');await expect(page.locator('[data-lu-document="doc-a"] .lu-row-date-upload')).toHaveCount(1);
  await expect(page.locator('[data-lu-document="doc-a1"] .doc-category-tag')).toHaveText('정책');await expect(page.locator('[data-lu-document="doc-a1"] .lu-row-date-upload')).toContainText('올림');
});

test('project screen and library expose the same active project set in the same order',async({page})=>{
  const state=baseState();await mockApp(page,state);await page.setViewportSize({width:1440,height:900});
  await signIn(page,`${appOrigin}/app/?view=library`);
  await waitLibraryTree(page);
  await page.evaluate(()=>{window.__spaceEvents=[];window.addEventListener('kptu:project-spaces-updated',e=>window.__spaceEvents.push(e.detail))});
  await clickView(page,'projects');
  await expect(page.locator('#projectGrid[data-ps3-ready="1"] .ps3-prow')).toHaveCount(3);
  // UI-PC프로젝트좌우: the list is the left column (.ps3-plist); the detail pane beside it has its own child rows.
  const grid=await page.locator('#projectGrid .ps3-plist').evaluate(g=>[...g.querySelectorAll('[data-ps3-project]')].map(x=>x.dataset.ps3Project));
  expect(grid).toEqual(EXPECTED.map(([id])=>id));
  // Existing event contract is unchanged: payload.spaces stays the owner-scoped app_spaces rows that team.js consumes.
  const owned=state.spaces.filter(x=>x.owner_id==='user-1').sort((a,b)=>a.sort_order-b.sort_order).map(x=>x.id);
  const event=await page.evaluate(()=>window.__spaceEvents.at(-1));
  expect(Object.keys(event).sort()).toEqual(['spaces','userId','workspaceId']);
  expect(event.spaces.map(x=>x.id)).toEqual(owned);
  expect(await page.evaluate(()=>window.KPTUTeamData.spaces().map(x=>x.id))).toEqual(owned);
  await gotoLibrary(page);
  await page.locator('#newDocumentBtn').click();
  const upload=await optionsOf(page,'#docProject');
  expect(upload.slice(1).map(o=>o.value)).toEqual(grid);
});

test('upload sends the exact selected parent or child project id and rejects stale ids',async({page})=>{
  const state=baseState();await mockApp(page,state);await page.setViewportSize({width:1440,height:900});
  await signIn(page,`${appOrigin}/app/?view=library`);
  await waitLibraryTree(page);
  for(const pid of ['top-a','child-a2']){
    await page.locator('#newDocumentBtn').click();
    await page.locator('#libraryFileInput').setInputFiles({name:`${pid}.pdf`,mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4')});
    await page.locator('#docProject').selectOption(pid);
    await page.locator('#saveDocumentBtn').click();
    await expect(page.locator('#documentModal')).toBeHidden();
  }
  expect(state.uploads.map(x=>x.project_id)).toEqual(['top-a','child-a2']);

  await page.locator('#newDocumentBtn').click();
  await page.locator('#libraryFileInput').setInputFiles({name:'stale.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4')});
  await page.locator('#docProject').evaluate(s=>{s.add(new Option('보관된 상위','top-c'));s.value='top-c'});
  await page.locator('#saveDocumentBtn').click();
  await expect(page.locator('#documentStatus')).toContainText('프로젝트를 다시 선택');
  await expect(page.locator('#docProject')).toHaveValue('');
  expect(state.uploads).toHaveLength(2);
});

test('real runtime maps structured upload failures, keeps completed child uploads and retries only the failure on phones',async({page})=>{
  const state=baseState();
  state.uploadAttempts=[];
  state.uploadFailures=[null,{status:424,body:{error:'Google Drive 토큰 갱신에 실패했습니다. Google Drive 연결이 만료됐으니 다시 연결해 주세요.',message:'Google Drive 토큰 갱신에 실패했습니다. Google Drive 연결이 만료됐으니 다시 연결해 주세요.',code:'drive_auth_expired',stage:'drive_token',retryable:false}}];
  await mockApp(page,state);await page.setViewportSize({width:360,height:780});
  await signIn(page,`${appOrigin}/app/?view=library`);
  await waitLibraryTree(page);
  page.on('dialog',dialog=>dialog.dismiss());
  await page.locator('#newDocumentBtn').click();
  await page.locator('#libraryFileInput').setInputFiles([
    {name:'child-first-'+'공공기관_기능개혁_대응_회의자료_최종본_'.repeat(3)+'.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4')},
    {name:'child-second.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 second')}
  ]);
  await page.locator('#docProject').selectOption('child-a1');
  await page.locator('#saveDocumentBtn').click();
  const status=page.locator('#documentStatus');
  await expect(status).toContainText('1개 완료 · 1개 미완료. Google Drive 연결이 만료됐습니다. 다시 연결한 뒤 시도해 주세요.');
  await expect(status).toHaveAttribute('role','alert');
  await expect(page.locator('#saveDocumentBtn')).toBeEnabled();
  await expect(page.locator('#documentModal')).toBeVisible();
  expect(await page.locator('[data-lu-upload-state]').allTextContents()).toEqual(['완료','실패 · 다시 시도']);
  expect(state.uploads.map(x=>x.project_id)).toEqual(['child-a1']);
  await expect(page.locator('[data-lu-document="upload-1"]')).toHaveCount(1);
  for(const width of [360,390,412,430]){
    await page.setViewportSize({width,height:800});
    await expect(status).toBeInViewport({ratio:0.5});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth),`overflow at ${width}px`).toBeLessThanOrEqual(0);
    const clipped=await page.evaluate(()=>{const list=document.querySelector('#librarySelectedFiles').getBoundingClientRect();return [...document.querySelectorAll('[data-lu-upload-state]')].filter(el=>el.getBoundingClientRect().right>list.right+0.5).length});
    expect(clipped,`file states clipped at ${width}px`).toBe(0);
  }

  await page.locator('#saveDocumentBtn').click();
  await expect(page.locator('#documentModal')).toBeHidden();
  expect(state.uploadAttempts).toEqual(['child-a1','child-a1','child-a1']);
  expect(state.uploads.map(x=>x.project_id)).toEqual(['child-a1','child-a1']);
});

test('server-side missing project maps to the stale project message and refreshes the selector',async({page})=>{
  const state=baseState();
  state.uploadFailures=[{status:404,body:{error:'프로젝트를 찾을 수 없습니다.',message:'프로젝트를 찾을 수 없습니다.',code:'project_not_found',stage:'project',retryable:false}}];
  await mockApp(page,state);await page.setViewportSize({width:1440,height:900});
  await signIn(page,`${appOrigin}/app/?view=library`);
  await waitLibraryTree(page);
  await page.locator('#newDocumentBtn').click();
  await page.locator('#libraryFileInput').setInputFiles({name:'parent.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4')});
  await page.locator('#docProject').selectOption('top-b');
  state.spaces=state.spaces.map(x=>x.id==='top-b'?{...x,status:'archived'}:x);
  await page.locator('#saveDocumentBtn').click();
  await expect(page.locator('#documentStatus')).toHaveText('선택한 프로젝트를 더 이상 사용할 수 없습니다. 프로젝트를 다시 선택해 주세요.');
  await expect(page.locator('#docProject')).toHaveValue('');
  await expect(page.locator('#docProject option[value="top-b"]')).toHaveCount(0);
  await expect(page.locator('#documentModal')).toBeVisible();
  expect(state.uploads).toHaveLength(0);
});

test('metadata edit keeps archived links and moves documents between parent, child and none',async({page})=>{
  const state=baseState();await mockApp(page,state);await page.setViewportSize({width:1440,height:900});
  await signIn(page,`${appOrigin}/app/?view=library`);
  await waitLibraryTree(page);
  const edit=async id=>{await page.locator(`[data-lu-menu="${id}"]`).click();await page.locator(`[data-lu-edit="${id}"]`).click();await expect(page.locator('#libraryEditModal')).toBeVisible()};
  const save=async()=>{await page.locator('#libraryEditSave').click();await expect(page.locator('#libraryEditModal')).toBeHidden()};

  await edit('doc-archived');
  await expect(page.locator('#libraryEditProject')).toHaveValue('top-c');
  const opts=await optionsOf(page,'#libraryEditProject');
  expect(opts[1]).toEqual({value:'top-c',text:'[보관됨] 보관된 상위',stale:true});
  expect(opts.slice(2).map(o=>[o.value,o.text])).toEqual(EXPECTED);
  await page.locator('#libraryEditTitle').fill('보관 프로젝트 자료 수정');
  await save();
  expect(state.patches.at(-1)).toMatchObject({id:'doc-archived',body:{project_id:'top-c',title:'보관 프로젝트 자료 수정'}});

  await edit('doc-legacy');
  await expect(page.locator('#libraryEditProject')).toHaveValue('legacy-1');
  await page.locator('#libraryEditSource').fill('출처만 수정');
  await save();
  expect(state.patches.at(-1).body.project_id).toBe('legacy-1');

  await edit('doc-a');
  await page.locator('#libraryEditProject').selectOption('child-a1');await save();
  expect(state.patches.at(-1)).toMatchObject({id:'doc-a',body:{project_id:'child-a1'}});
  await edit('doc-a1');
  await page.locator('#libraryEditProject').selectOption('top-a');await save();
  expect(state.patches.at(-1)).toMatchObject({id:'doc-a1',body:{project_id:'top-a'}});
  await edit('doc-a');
  await page.locator('#libraryEditProject').selectOption('');await save();
  expect(state.patches.at(-1)).toMatchObject({id:'doc-a',body:{project_id:null}});
});

// PRJ-3단(명진 결정 2, 추천안): 큰 프로젝트로 걸러 열면 그 아래 프로젝트 자료도 함께 보인다(하위로 열면 그 하위만).
// LIB-토글트리: 걸러 여는 길은 다른 화면(프로젝트 상세의 자료 "전체 보기")이고, 자료실 안에서는 트리가 같은 범위를 묶어 보인다.
test('project filter includes the projects under the chosen one and keeps unlinked and stale documents reachable',async({page})=>{
  const state=baseState();await mockApp(page,state);await page.setViewportSize({width:1440,height:900});
  await signIn(page,`${appOrigin}/app/?view=library`);
  await waitLibraryTree(page);
  const shown=()=>page.locator('#documentList [data-lu-document]').evaluateAll(xs=>xs.map(x=>x.dataset.luDocument));
  await expect(page.locator('#documentList [data-lu-document]')).toHaveCount(6);
  await focusLibraryProject(page,'top-a');
  expect((await shown()).sort()).toEqual(['doc-a','doc-a1']);
  await focusLibraryProject(page,'child-a1');
  expect(await shown()).toEqual(['doc-a1']);
  await focusLibraryProject(page,'top-c');
  expect(await shown()).toEqual(['doc-archived']);
  await focusLibraryProject(page,'all');
  expect((await shown()).sort()).toEqual(['doc-a','doc-a1','doc-archived','doc-legacy','doc-missing','doc-none']);
});

test('project create, rename and archive refresh library selectors without reload',async({page})=>{
  const state=baseState();await mockApp(page,state);await page.setViewportSize({width:1440,height:900});
  page.on('dialog',d=>d.accept());
  await signIn(page,`${appOrigin}/app/?view=library`);
  await waitLibraryTree(page);
  await clickView(page,'projects');
  await expect(page.locator('#projectGrid[data-ps3-ready="1"] .ps3-prow')).toHaveCount(3);

  await page.locator('#newProjectBtn').click();
  await page.locator('#ps3CreateName').fill('신규 하위 프로젝트');
  await page.locator('#ps3CreateParent').selectOption('top-b');
  await page.locator('#ps3CreateSave').click();
  await expect.poll(()=>state.spaces.some(x=>x.name==='신규 하위 프로젝트')).toBe(true);
  const created=state.spaces.find(x=>x.name==='신규 하위 프로젝트');
  // UI-PC프로젝트좌우: on a PC the pane already shows a project; wait until the new one is shown (as the dialog opens elsewhere).
  await expectProjectDetail(page,created.id);
  let values=await optionsOf(page,'#docProject');
  expect(values.map(o=>o.value)).toEqual(['','top-a','child-a1','child-a2','top-b','child-b1',created.id,'orphan-1']);
  expect(values.find(o=>o.value===created.id).text).toBe('　↳ 신규 하위 프로젝트');

  await page.locator('#ps3Menu .ps3-more > summary').click();
  await page.locator('[data-ps3-edit-project]').click();
  await page.locator('#ps3CreateName').fill('이름 바뀐 하위 프로젝트');
  await page.locator('#ps3CreateSave').click();
  await expectProjectTitle(page,'이름 바뀐 하위 프로젝트');
  values=await optionsOf(page,'#docProject');
  expect(values.find(o=>o.value===created.id).text).toBe('　↳ 이름 바뀐 하위 프로젝트');

  await page.locator('#ps3Menu .ps3-more > summary').click();
  const docked=await projectDetailDocked(page);
  await page.locator('[data-ps3-archive-project]').click();
  // UI-PC프로젝트좌우: the archived project's detail goes away — PC(≥1024) shows another project in the right pane, the dialog closes elsewhere.
  if(docked){await expect(page.locator('#ps3Body')).not.toHaveAttribute('data-project',created.id);await expect(toplineItem(page)).not.toHaveText('이름 바뀐 하위 프로젝트');await expect(page.locator(`#projectGrid .ps3-plist [data-ps3-project="${created.id}"]`)).toHaveCount(0)}
  else await expect(page.locator('#ps3DetailModal')).toBeHidden();
  await page.waitForFunction(id=>![...document.querySelector('#docProject').options].some(o=>o.value===id),created.id);
  values=await optionsOf(page,'#docProject');
  expect(values.some(o=>o.value===created.id)).toBe(false);
  await gotoLibrary(page);
  await expect(page.locator('#documentList [data-lu-document]')).toHaveCount(6);
});

for(const width of [360,390,412,430]){
  test(`library selectors and modals stay inside a ${width}px viewport`,async({page})=>{
    const state=baseState();await mockApp(page,state);await page.setViewportSize({width,height:844});
    await signIn(page,`${appOrigin}/app/?view=library`);
    await waitLibraryTree(page);
    const overflow=()=>page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
    expect(await overflow()).toBeLessThanOrEqual(1);
    await expect(page.locator('#libraryGroupBy')).toBeVisible();
    await page.locator('#newDocumentBtn').click();
    await expect(page.locator('#docProject')).toBeVisible();
    await page.locator('#docProject').selectOption('child-a2');
    await expect(page.locator('#docProject')).toHaveValue('child-a2');
    expect(await overflow()).toBeLessThanOrEqual(1);
    await page.locator('#documentModal [data-close="documentModal"]').click();
    await page.locator('#manageLibraryBtn').click();
    await expect(page.locator('#libraryManageModal .dce')).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(1);
    await page.locator('#libraryManageClose').click();
    // LIB-분류칸삭제: '자료별 분류' 칸이 없어졌으므로 자료 수정 창은 줄 ⋯ 메뉴의 [수정…]으로 연다.
    await page.locator('[data-lu-menu="doc-archived"]').click();
    await page.locator('[data-lu-edit="doc-archived"]').click();
    await expect(page.locator('#libraryEditProject')).toBeVisible();
    await expect(page.locator('#libraryEditProject')).toHaveValue('top-c');
    expect(await overflow()).toBeLessThanOrEqual(1);
  });
}
