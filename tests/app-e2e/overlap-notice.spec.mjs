import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { clickView } from './helpers/shell-navigation.mjs';
import {expectProjectTitle} from './helpers/screen-title.mjs';

// PRJ-기록입력: project detail redesign. The real app runs in Chromium; only the Supabase REST and Google Tasks boundaries are synthetic.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const owner='home-test',workspace='w',stamp='2026-09-01T01:00:00Z';
// openHome fixes the browser clock at 2026-10-06T01:00:00Z (10.6 in Seoul).
const NOW=Date.parse('2026-10-06T01:00:00Z');
const seoulKey=(ms=NOW)=>new Date(ms+9*3600000).toISOString().slice(0,10);
const shortDay=key=>{const [y,m,d]=key.split('-').map(Number);return (y===Number(seoulKey().slice(0,4))?'':y+'.')+m+'.'+d};
const project=(id,name,extra={},metadata={})=>({id,name,workspace_id:workspace,owner_id:owner,created_by:owner,parent_id:null,status:'active',visibility:'private',sort_order:10,created_at:stamp,updated_at:stamp,description:'- 하위 하나 - 하위 둘',...extra,metadata:{project_system:'v2',objective:'- 하위 하나 - 하위 둘',color:'green',...metadata}});
const matching=(rows,query)=>rows.filter(row=>[...query].every(([key,value])=>key.includes('.')||(value.startsWith('eq.')?String(row[key]??'')===value.slice(3):value.startsWith('in.(')?value.slice(4,-1).split(',').includes(String(row[key])):value==='is.null'?row[key]==null:true)));
function seed({records=true}={}){
  const tables={
    app_spaces:[project('main','민자철도 대응'),project('kid-a','국회 토론회',{parent_id:'main',sort_order:11}),project('kid-b','현장 조직',{parent_id:'main',sort_order:12})],
    app_project_modules:[],app_project_workstreams:[],app_project_progress_updates:[],app_project_comments:[],app_project_milestones:[],
    app_documents:[{id:'doc-1',project_id:'main',title:'국토부 답변서',category:'정부자료',document_date:'2026-09-14',drive_url:'https://example.org/doc-1'}],
    app_record_links:[{google_task_id:'g1',project_id:'main',status:'confirmed',task_completed:false},{google_task_id:'g2',project_id:'main',status:'confirmed',task_completed:false}],
    app_suborganizations:[],app_suborganization_assignees:[],app_profiles:[{user_id:owner,display_name:'테스트 사용자'}],
  };
  const soon=new Date(Date.parse(seoulKey()+'T03:00:00Z')+5*86400000).toISOString();
  tables.app_project_milestones.push({id:'mile-1',project_id:'main',title:'국회 토론회',milestone_type:'action',status:'planned',start_at:soon,created_by:owner});
  const basket=[];
  if(records){
    tables.app_project_workstreams.push(
      {id:'ws-old',project_id:'main',title:'정책 대응',phase:'follow_up',sort_order:10,created_at:'2026-09-02T01:00:00Z'},
      {id:'ws-empty',project_id:'main',title:'빈 옛 항목',phase:'done',sort_order:20,created_at:'2026-09-05T01:00:00Z'});
    tables.app_project_progress_updates.push(
      {id:'pu-old',project_id:'main',workstream_id:'ws-old',author_id:owner,status_label:'후속조치',summary:'국토부 협의 시작',next_step:'자료 요청',effective_on:'2026-09-10',created_at:'2026-09-10T01:00:00Z',metadata:{}},
      {id:'pu-new',project_id:'main',workstream_id:null,author_id:owner,status_label:null,summary:'토론회 발제자 확정',next_step:null,effective_on:'2026-10-03',created_at:'2026-10-03T01:00:00Z',metadata:{}});
    basket.push({id:'bl-1',workspace_id:workspace,summary:'현장 간부 면담 결과 정리',note_id:'note-1',organization_id:null,project_id:'main',status:'confirmed',note:{id:'note-1',workspace_id:workspace,occurred_at:'2026-09-20T05:00:00Z',raw_text:'면담 원문'}});
  }
  return {tables,basket};
}

async function fixture(page,{width=390,records=true,scheme='light'}={}){
  await page.setViewportSize({width,height:900});
  await page.emulateMedia({colorScheme:scheme});
  await openHome(page);
  const {tables,basket}=seed({records});
  const state={requests:[],serial:0,tables,basket};
  state.calls=(table,method)=>state.requests.filter(r=>r.table===table&&r.method===method);
  await page.route(SB+'/functions/v1/google-tasks**',route=>{const q=new URL(route.request().url()).searchParams;if(q.get('action')!=='linked')return route.fallback();return route.fulfill({status:200,json:{tasks:q.get('project_id')==='main'?[{id:'g1',title:'자료 요청',status:'needsAction'},{id:'g2',title:'발제 섭외',status:'needsAction'}]:[],removed:0}})});
  await page.route(SB+'/rest/v1/**',async route=>{
    const req=route.request(),url=new URL(req.url()),table=url.pathname.split('/').pop(),method=req.method();
    if(!Object.hasOwn(state.tables,table))return route.fallback();
    const body=method==='GET'?null:req.postDataJSON(),prefer=req.headers().prefer||'';
    state.requests.push({table,method,query:Object.fromEntries(url.searchParams),body:structuredClone(body)});
    if(table==='app_record_links'&&url.searchParams.get('select')?.includes('note:app_notes')){
      const ids=(url.searchParams.get('project_id')||'').replace(/^in\.\(|\)$/g,'').split(',');
      return route.fulfill({status:200,json:Number(url.searchParams.get('offset')||0)?[]:state.basket.filter(row=>ids.includes(row.project_id))});
    }
    const rows=state.tables[table];let result;
    if(method==='GET'){
      result=matching(rows,url.searchParams);
      if(table==='app_spaces'&&url.searchParams.get('select')?.includes('milestones:'))result=result.map(row=>({id:row.id,milestones:tables.app_project_milestones.filter(m=>m.project_id===row.id)}));
    }else if(method==='POST'){
      result=(Array.isArray(body)?body:[body]).map(row=>({...row,id:row.id||'new-'+(++state.serial),created_at:new Date().toISOString(),updated_at:new Date().toISOString()}));rows.push(...result);
    }else if(method==='PATCH'){
      result=matching(rows,url.searchParams);result.forEach(row=>Object.assign(row,body));
    }else if(method==='DELETE'){
      result=matching(rows,url.searchParams);state.tables[table]=rows.filter(row=>!result.includes(row));
    }else throw new Error('Unexpected synthetic method: '+method);
    await route.fulfill({status:200,json:method==='GET'||prefer.includes('return=representation')?result:null});
  });
  await clickView(page,'projects');
  await page.evaluate(()=>window.__KPTU_PROJECT_V3_READY__);
  await expect(page.locator('#projectGrid[data-ps3-ready="1"]')).toBeVisible();
  await page.locator('[data-ps3-project="main"]').first().click();
  await expectProjectTitle(page,'민자철도 대응');
  return state;
}

// MTG-기록겹침거르기 3단계: 저장 직후 "비슷한 기록이 있어요" 알림. ai-assist·판정 저장·연결 저장은 모의, 나머지는 실제 앱.
const MID='f0000000-0000-4000-8000-000000000001',UID='f0000000-0000-4000-8000-000000000002',TITLE='철도 파업 출정 기자회견';
async function withOverlap(page,{ai='same'}={}){
  const calls={ai:[],verdicts:[],setLinks:[]};
  await page.route(SB+'/functions/v1/ai-assist',async route=>{
    const body=route.request().postDataJSON();calls.ai.push(body);
    if(ai==='fail')return route.fulfill({status:503,json:{ok:false,error:'overlap_not_ready'}});
    return route.fulfill({status:200,json:{ok:true,kind:'overlap_check',saved:1,kept_user:0,results:body.pairs.map(p=>({...p,state:'judged',verdict:ai}))}});
  });
  await page.route(SB+'/rest/v1/app_meetings**',route=>{
    const q=new URL(route.request().url()).searchParams;
    if(route.request().method()!=='GET')return route.fallback();
    if(q.has('meeting_at'))return route.fulfill({status:200,json:[{id:MID,title:TITLE,series_name:TITLE,meeting_at:'2026-10-05T05:00:00Z',activity_kind:'press',project_id:null}]});
    if(q.get('id')===`eq.${MID}`)return route.fulfill({status:200,json:[{id:MID,updated_at:'2026-10-05T06:00:00Z'}]});
    return route.fulfill({status:200,json:[]});
  });
  await page.route(SB+'/rest/v1/app_record_links**',route=>{
    const q=new URL(route.request().url()).searchParams;
    if(route.request().method()==='GET'&&(q.has('source_meeting_id')||(q.get('select')||'').includes('source_meeting_id')))return route.fulfill({status:200,json:[]});
    return route.fallback();
  });
  await page.route(SB+'/rest/v1/rpc/app_record_overlap_set',route=>{calls.verdicts.push(route.request().postDataJSON());return route.fulfill({status:200,json:{saved:1,kept_user:0}});});
  await page.route(SB+'/rest/v1/rpc/app_meeting_set_links',route=>{calls.setLinks.push(route.request().postDataJSON());return route.fulfill({status:200,json:{ok:true,updated_at:'2026-10-06T01:00:01Z',created:1,removed:0}});});
  return calls;
}
async function writeRecord(page,state,text='출정 기자회견 진행함'){
  // 저장된 기록의 id는 서버가 정한다(모의: 올바른 모양의 UUID).
  await page.route(SB+'/rest/v1/app_project_progress_updates**',route=>{
    if(route.request().method()!=='POST')return route.fallback();
    const body=route.request().postDataJSON(),row={...body,id:UID,created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
    state.tables.app_project_progress_updates.push(row);return route.fulfill({status:200,json:[row]});
  });
  const form=page.locator('#ps3-progress [data-ps3-record-input]');
  await form.locator('input').fill(text);
  await form.getByRole('button',{name:'기록',exact:true}).click();
}
const notice=page=>page.locator('[data-overlap-notice]');

test('MTG-겹침 저장 직후 같은 일이 있으면 알림이 뜨고 [그대로 두기]는 다른 일(사용자 판정)로 남긴다',async({page})=>{
  const state=await fixture(page);const calls=await withOverlap(page);
  await writeRecord(page,state);
  await expect(notice(page)).toBeVisible();
  await expect(notice(page)).toContainText('비슷한 기록이 있어요');await expect(notice(page)).toContainText(TITLE);
  expect(calls.ai).toHaveLength(1);
  expect(calls.ai[0].kind).toBe('overlap_check');expect(calls.ai[0].pairs).toEqual([{a:`meeting:${MID}`,b:`project_update:${UID}`}]);
  // 기록은 이미 저장돼 있다(알림이 저장을 막지 않는다).
  expect(state.tables.app_project_progress_updates.filter(r=>r.id===UID)).toHaveLength(1);
  await notice(page).getByRole('button',{name:'그대로 두기'}).click();
  await expect(notice(page)).toContainText('그대로 두었어요');
  expect(calls.verdicts).toHaveLength(1);
  expect(calls.verdicts[0].p_pairs).toEqual([{a_ref:`meeting:${MID}`,b_ref:`project_update:${UID}`,verdict:'different',decided_by:'user'}]);
  expect(calls.setLinks).toHaveLength(0);
  await expect(notice(page)).toHaveCount(0);
});

test('MTG-겹침 [연결로 바꾸기]는 사업 보고에 이 프로젝트를 잇고 쓴 글을 연결 메모로 붙이며 같은 일로 표시한다',async({page})=>{
  const state=await fixture(page);const calls=await withOverlap(page);
  await writeRecord(page,state,'출정 기자회견 진행함');
  await expect(notice(page)).toBeVisible();
  await notice(page).getByRole('button',{name:'연결로 바꾸기'}).click();
  await expect(notice(page)).toContainText('연결했어요. 쓴 글은 연결 메모로 붙였어요.');
  expect(calls.setLinks).toHaveLength(1);
  expect(calls.setLinks[0]).toEqual({p_meeting_id:MID,p_meeting_updated_at:'2026-10-05T06:00:00Z',p_targets:[{kind:'project',target_id:'main',summary:'출정 기자회견 진행함'}]});
  expect(calls.verdicts[0].p_pairs[0]).toMatchObject({verdict:'same',decided_by:'user'});
  // 기록은 지우지 않는다.
  expect(state.calls('app_project_progress_updates','DELETE')).toHaveLength(0);
  expect(state.tables.app_project_progress_updates.some(r=>r.id===UID)).toBe(true);
});

for(const ai of ['fail','different'])test(`MTG-겹침 확인 결과가 ${ai==='fail'?'서버 꺼짐':'다른 일'}이면 아무것도 보이지 않고 저장은 그대로다`,async({page})=>{
  const state=await fixture(page);const calls=await withOverlap(page,{ai});
  await writeRecord(page,state,'기록 '+ai);
  await expect.poll(()=>calls.ai.length).toBe(1);
  await expect(page.locator('#ps3-progress [data-ps3-records] > *').first()).toContainText('기록 '+ai);
  await expect(notice(page)).toHaveCount(0);
  expect(state.tables.app_project_progress_updates.filter(r=>r.id===UID)).toHaveLength(1);
});
