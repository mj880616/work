import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { openHome } from './helpers/home-entry.mjs';
import { clickView } from './helpers/shell-navigation.mjs';

// PRJ-기록입력: project detail redesign. The real app runs in Chromium; only the Supabase REST and Google Tasks boundaries are synthetic.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const dir='docs/review/prj-record-input';
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
  await expect(page.locator('#ps3Title')).toHaveText('민자철도 대응');
  return state;
}
const capture=async(page,name)=>{if(process.env.PRJ_RECORD_CAPTURE!=='1')return;mkdirSync(dir,{recursive:true});await page.screenshot({path:`${dir}/${name}.png`,fullPage:true})};
const lines=page=>page.locator('#ps3-progress [data-ps3-records] > *');

test('PRJ-기록입력 header: color dot + name, one summary line, no child-name listing',async({page})=>{
  await fixture(page);
  await expect(page.locator('#ps3Title .ps3-color-dot')).toHaveAttribute('data-color','green');
  // Summary: children · open tasks (Google answer) · D-n of the next milestone. No "진행 N", no stored description text.
  await expect(page.locator('#ps3Summary')).toHaveText('하위 2 · 할 일 2 · D-5');
  await expect(page.locator('.ps3-modal-head')).not.toContainText('- 하위 하나');
  await expect(page.locator('#ps3Summary')).not.toContainText('진행');
  // Child project: no "하위", and no D-n without an upcoming milestone.
  await page.locator('#ps3-children [data-ps3-project="kid-a"]').click();
  await expect(page.locator('#ps3Title')).toHaveText('국회 토론회');
  await expect(page.locator('#ps3Summary')).toHaveText('할 일 0');
  await expect(page.locator('#ps3Hierarchy .ps3-parent-link')).toContainText('민자철도 대응');
});

test('PRJ-기록입력 top input writes a project record that belongs to no progress item',async({page})=>{
  const state=await fixture(page);
  const form=page.locator('#ps3-progress [data-ps3-record-input]');
  await expect(form.locator('input')).toHaveCount(1);await expect(form.locator('select')).toHaveCount(0);
  await expect(form.getByRole('button',{name:'기록',exact:true})).toBeVisible();
  // The record input is the first thing in the detail body; per-item inputs, [저장], item creation and kind labels are gone.
  expect(await page.locator('#ps3Body > :first-child').getAttribute('id')).toBe('ps3-progress');
  await expect(page.locator('#ps3Body [data-ps3-quick-progress],#ps3Body [data-ps3-add-ws],#ps3Body .ps3-phase')).toHaveCount(0);
  await expect(page.locator('#ps3-progress')).not.toContainText('후속조치');
  await form.locator('input').fill('  국토부 2차 협의 일정 잡음  ');
  await form.getByRole('button',{name:'기록',exact:true}).click();
  await expect(lines(page).first()).toContainText('국토부 2차 협의 일정 잡음');
  await expect(lines(page).first().locator('time')).toHaveText(shortDay(seoulKey()));
  await expect(form.locator('input')).toHaveValue('');
  const posts=state.calls('app_project_progress_updates','POST');expect(posts).toHaveLength(1);
  expect(posts[0].body).toEqual({project_id:'main',workstream_id:null,author_id:owner,status_label:null,summary:'국토부 2차 협의 일정 잡음',next_step:null,effective_on:seoulKey(),metadata:{}});
  expect(state.calls('app_project_workstreams','POST')).toHaveLength(0);expect(state.calls('app_project_workstreams','PATCH')).toHaveLength(0);
  // Empty input does not save.
  await form.getByRole('button',{name:'기록',exact:true}).click();
  expect(state.calls('app_project_progress_updates','POST')).toHaveLength(1);
});

test('PRJ-기록입력 one list: new, old item records, items and 🧺 basket links by date, newest first',async({page})=>{
  const state=await fixture(page);
  await expect(page.locator('#ps3-progress [data-ps3-record-count]')).toHaveText('4');
  await expect(lines(page)).toHaveCount(4);
  const texts=await lines(page).evaluateAll(xs=>xs.map(x=>x.innerText.replace(/\s+/g,' ').trim()));
  expect(texts).toEqual(['10.3 토론회 발제자 확정','9.20 🧺 현장 간부 면담 결과 정리 ⋯','9.10 정책 대응 국토부 협의 시작 다음: 자료 요청','9.5 빈 옛 항목']);
  // 🧺 line: opens the original basket memo; its ⋯ holds only [메모 열기]·[연결 해제] (BUG-바구니연결해제), nothing to edit or delete.
  const basket=lines(page).nth(1).locator('a');
  await expect(basket).toHaveAttribute('href','./?view=basket&note=note-1');
  await expect(basket.getByRole('img',{name:'바구니 업데이트'})).toBeVisible();
  await expect(lines(page).nth(1).locator('button')).toHaveCount(1);await expect(lines(page).nth(1).getByRole('button',{name:'바구니 기록 메뉴'})).toBeVisible();
  await expect(page.locator('#ps3Body [data-link-summary-edit],#ps3Body [data-link-disconnect],#ps3Body [data-link-note-delete],#ps3BasketLinks')).toHaveCount(0);
  await basket.click();
  await expect(page.locator('#ps3DetailModal')).toBeHidden();
  await expect.poll(()=>page.evaluate(()=>window.KPTURouter.current)).toBe('basket');
  expect(state.calls('app_record_links','PATCH').length+state.calls('app_record_links','DELETE').length).toBe(0);
});

test('PRJ-기록입력 tapping a record line edits or deletes it; old items edit without a kind',async({page})=>{
  const state=await fixture(page);
  page.on('dialog',d=>d.accept());
  const newest=lines(page).first();
  await newest.getByRole('button').click();
  const menu=page.locator('#ps3RecordMenu');await expect(menu).toBeVisible();
  await menu.getByRole('button',{name:'수정'}).click();
  const editor=page.locator('[data-ps3-edit-record="pu-new"]');await editor.locator('input').fill('발제자 3명 확정');
  await editor.getByRole('button',{name:'저장'}).click();
  await expect(lines(page).first()).toContainText('발제자 3명 확정');
  expect(state.calls('app_project_progress_updates','PATCH').at(-1).body).toEqual({summary:'발제자 3명 확정'});
  // Old record with an item: delete through the same menu.
  await page.locator('[data-ps3-record="pu-old"] button').click();await menu.getByRole('button',{name:'삭제'}).click();
  await expect(page.locator('[data-ps3-record="pu-old"]')).toHaveCount(0);
  expect(state.calls('app_project_progress_updates','DELETE')).toHaveLength(1);
  // The item that lost its last record now shows as a line of its own; editing it keeps its stored phase.
  await page.locator('[data-ps3-record="ws-old"] button').click();await menu.getByRole('button',{name:'수정'}).click();
  await expect(page.locator('#ps3WorkstreamModal')).toBeVisible();
  await expect(page.locator('#ps3WsPhase')).toBeHidden();
  await page.locator('#ps3WsTitle').fill('정책 대응(정리)');await page.locator('#ps3WsSave').click();
  await expect(page.locator('#ps3WorkstreamModal')).toBeHidden();
  expect(state.calls('app_project_workstreams','PATCH').at(-1).body).toEqual({title:'정책 대응(정리)',phase:'follow_up'});
  await expect(page.locator('[data-ps3-record="ws-old"]')).toContainText('정책 대응(정리)');
});

test('PRJ-기록입력 groups: same line lists, small + beside the title, documents open on tap',async({page})=>{
  await fixture(page);
  for(const [section,label] of [['#ps3-children','하위 프로젝트 추가'],['#ps3-tasks','할 일 추가'],['#ps3-documents','자료 올리기']]){
    const plus=page.locator(`${section} .ps3-section-head`).getByRole('button',{name:label});
    await expect(plus).toHaveText('+');const box=await plus.boundingBox();expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);
  }
  // Child creation stays inside the child list (AGENTS.md §5).
  await page.locator('#ps3-children').getByRole('button',{name:'하위 프로젝트 추가'}).click();
  await expect(page.locator('#ps3CreateHeading')).toHaveText('하위 프로젝트 만들기');await page.locator('[data-ps3-close="ps3CreateModal"]').click();
  const doc=page.locator('#ps3-documents .ps3-doc-row');
  await expect(doc.locator('a.ps3-line-main')).toHaveAttribute('href','https://example.org/doc-1');
  await expect(doc.locator('a.ps3-line-main')).toHaveAttribute('target','_blank');
  await expect(doc.getByRole('button',{name:'수정'})).toBeHidden();
  await doc.locator('.ps3-line-more > summary').click();
  await expect(doc.getByRole('button',{name:'수정'})).toBeVisible();
  await page.keyboard.press('Escape');await expect(doc.locator('.ps3-line-more')).not.toHaveAttribute('open','');
  // Milestones no longer show a kind label; the stored milestone_type is untouched.
  await page.locator('#ps3-milestones > summary').click();
  await expect(page.locator('#ps3-milestones .ps3-row')).toHaveText(/국회 토론회/);
  await expect(page.locator('#ps3-milestones .ps3-phase')).toHaveCount(0);
  await expect(page.locator('#ps3-milestones')).not.toContainText('행동·사업');
  // The ⋯ project menu and hierarchy keep their places.
  await expect(page.locator('#ps3Menu details.ps3-more')).toHaveCount(1);
});

for(const scheme of ['light','dark'])for(const records of [false,true])test(`PRJ-기록입력 390 ${scheme} ${records?'mixed records':'no records'} fits the phone`,async({page})=>{
  await fixture(page,{scheme,records});
  if(!records){await expect(page.locator('#ps3-progress .ps3-rec-empty')).toHaveText('아직 기록이 없어요');await expect(page.locator('#ps3-progress [data-ps3-record-count]')).toHaveText('0')}
  else{await page.locator('#ps3-progress [data-ps3-record-input] input').fill('오늘 새 기록');await page.locator('#ps3-progress [data-ps3-record-input] button[type=submit]').click();await expect(lines(page)).toHaveCount(5)}
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const input=await page.locator('#ps3-progress [data-ps3-record-input] input').boundingBox(),button=await page.locator('#ps3-progress [data-ps3-record-input] button[type=submit]').boundingBox(),big=await page.locator('#ps3-progress [data-ps3-record-big]').boundingBox();
  // UI-크게첨부: [크게] sits between the input and [기록], all one height on one line.
  expect(Math.abs(input.height-button.height)).toBeLessThanOrEqual(1);expect(Math.abs(big.height-button.height)).toBeLessThanOrEqual(1);expect(Math.abs(big.y-button.y)).toBeLessThanOrEqual(1);
  for(const row of await lines(page).all()){const box=await row.boundingBox();expect(box.height).toBeGreaterThanOrEqual(44)}
  await capture(page,`detail-390-${scheme}-${records?'mixed':'empty'}`);
});
