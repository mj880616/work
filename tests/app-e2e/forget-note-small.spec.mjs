// FORGET-노트작은창(요청함 11/09 21:39, 시안 docs/design/mockups/forget-note-small.html, 명진 21:42 'ㅇㅇ'):
// 잊지 말기 [노트로]는 큰 창 대신 누른 줄 아래 작은 창이 먼저 뜬다. [저장] 한 번으로 새 노트 또는 기존 노트 끝에 한 줄, [크게 수정 ↗]로 큰 창(글 그대로).
// 서버는 흉내, 글·이름은 모두 지어낸 것. 폰 390 · 폴드 884 · PC 1440.
import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {pressRowAct} from './helpers/nbx-act.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const cid=n=>`c0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const famId='f0000000-0000-4000-8000-000000000001';
const WORK='a0000000-0000-4000-8000-000000000001',FAM='a0000000-0000-4000-8000-000000000002';
const N=n=>`b0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const P=text=>({type:'paragraph',attrs:{style:'body2'},content:text?[{type:'text',text}]:[]});
const DOC=(...lines)=>({v:'ed1',doc:{type:'doc',content:lines.map(P)}});
const note=(n,over)=>({id:N(n),workspace_id:'w',kind:'note',title:`가짜 노트 ${n}`,attachments:[],created_at:'2026-10-01T00:00:00Z',archived_at:null,...over});
const NOTES=()=>[
  note(1,{title:'가짜 회의 정리',raw_text:'예전 첫 줄\n예전 둘째 줄\n예전 마지막 줄',doc:DOC('예전 첫 줄','예전 둘째 줄','예전 마지막 줄'),updated_at:'2026-10-05T00:00:00Z',ai_export_allowed:true,metadata:{folder_id:WORK,folder:'01. 업무메모'}}),
  note(2,{title:'잊지 말기',raw_text:'☐ 지어낸 예전 줄 (통화 10/1)',doc:DOC('☐ 지어낸 예전 줄 (통화 10/1)'),updated_at:'2026-10-04T00:00:00Z',ai_export_allowed:false,metadata:{family_list:true,folder_id:FAM,folder:'가족'}}),
  note(3,{title:'가족 장보기',raw_text:'지어낸 목록',doc:DOC('지어낸 목록'),updated_at:'2026-10-03T00:00:00Z',ai_export_allowed:false,metadata:{folder_id:FAM,folder:'가족'}}),
];
const FOLDERS=()=>[{id:WORK,parent_id:null,name:'01. 업무메모',sort_order:0,created_at:'2026-10-01T00:00:00Z'},{id:FAM,parent_id:null,name:'가족',sort_order:1,created_at:'2026-10-01T00:00:00Z'}];
const cand=()=>({id:cid(1),kind:'request',summary:'가짜 요청 하나',due:null,source_kind:'telegram',source_id:'d0000000-0000-4000-8000-000000000001',source_day:'2026-10-06',evidence:'근거',project_id:null,organization_id:null,status:'open',task_id:null,task_due:null,created_at:'2026-10-06T01:00:00Z',decided_at:null});
const family=()=>[{id:famId,kind:'plan',body:'지어낸 약속 한 줄',said_when:null,firmness:'planned',origin:'telegram',origin_day:'2026-10-05',status:'new',created_at:'2026-10-06T02:30:00Z'}];
const eqv=v=>v?.replace(/^eq\./,'');

async function fixture(page,{width=390}={}){
  await page.setViewportSize({width,height:860});
  const rows=NOTES(),folders=FOLDERS(),cands=[cand()],fams=family(),f={rows,candPatches:[],famPatches:[],notePosts:[],notePatches:[],remindPatches:[],noteLists:[]};
  await openHome(page,{beforeLoad:async()=>{
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/rpc/app_my_features',r=>r.fulfill({json:['telegram','family']}));
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_todo_candidates',async r=>{
      const req=r.request(),q=new URL(req.url()).searchParams;
      if(req.method()==='PATCH'){const id=eqv(q.get('id')),body=req.postDataJSON(),row=cands.find(c=>c.id===id);f.candPatches.push({id,body});if(!row)return r.fulfill({json:[]});Object.assign(row,body);return r.fulfill({json:[{id,status:row.status,task_id:null,decided_at:row.decided_at}]});}
      const st=q.get('status');return r.fulfill({json:st==='eq.open'?cands.filter(c=>c.status==='open'):cands.filter(c=>c.status!=='open')});
    });
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_todo_feedback',r=>r.request().method()==='POST'?r.fulfill({status:201,json:[{id:'e0000000-0000-4000-8000-000000000001'}]}):r.fulfill({json:[]}));
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_feed_items',r=>r.fulfill({json:[]}));
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_journal_memorable',r=>r.fulfill({json:[]}));
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_record_links',r=>r.fulfill({json:[]}));
    await page.route(u=>u.origin===SB&&u.pathname==='/functions/v1/ai-assist',r=>r.fulfill({json:{ok:true,skipped:'fresh'}}));
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_family_notes',r=>{
      const req=r.request();
      if(req.method()==='PATCH'){const id=eqv(new URL(req.url()).searchParams.get('id')),body=req.postDataJSON();f.famPatches.push({id,body});Object.assign(fams.find(n=>n.id===id)||{},body);return r.fulfill({json:[{id}]});}
      return r.fulfill({json:fams.filter(n=>n.status==='new')});
    });
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_note_folders',r=>r.fulfill({json:folders}));
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',async r=>{
      const req=r.request(),q=new URL(req.url()).searchParams;
      const hit=row=>(!q.get('kind')||row.kind===eqv(q.get('kind')))&&(!q.get('id')||row.id===eqv(q.get('id')))&&(!q.get('updated_at')||row.updated_at===eqv(q.get('updated_at')))
        &&(!q.get('ai_export_allowed')||String(row.ai_export_allowed)===q.get('ai_export_allowed').replace(/^is\./,''))&&(!q.get('metadata->>family_list')||row.metadata?.family_list===true);
      if(req.method()==='POST'){const body=req.postDataJSON(),row={id:N(90+f.notePosts.length),attachments:[],archived_at:null,metadata:{},ai_export_allowed:true,...body,updated_at:'2026-10-06T01:00:00Z'};f.notePosts.push(body);rows.push(row);return r.fulfill({status:201,json:[row]});}
      if(req.method()==='PATCH'){const body=req.postDataJSON(),list=rows.filter(hit);
        // FAMILY-기억알림: 맨 위 '가족 · 기억할 것' 칸이 본 기록(metadata.remind)만 쓰는 PATCH는 따로 센다(이 시험이 보는 노트 글 쓰기와 다름).
        if(body.metadata&&!('doc' in body)&&body.metadata.remind)f.remindPatches.push(body);else f.notePatches.push({query:Object.fromEntries(q),body});list.forEach(row=>Object.assign(row,body));return r.fulfill({json:list});}
      if(q.get('kind')==='eq.note'&&!q.get('id')&&!q.get('metadata->>family_list'))f.noteLists.push(Object.fromEntries(q));
      return r.fulfill({json:rows.filter(hit).sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at)))});
    });
  }});
  await expect(page.locator('#homeView [data-home-summary]')).toBeVisible();
  await page.evaluate(()=>window.KPTURouter.go('basket'));
  await expect(page.locator('#basketView [data-forget-section]')).toBeVisible();
  return f;
}
const box=page=>page.locator('#basketView [data-forget-section]');
const quick=page=>page.locator('[data-note-quick]');
const big=page=>page.locator('#edWindow');
const pick=page=>page.locator('[data-note-pick]');
const textOf=row=>(row?.doc?.doc?.content||[]).map(p=>p.content?.[0]?.text??'');
// UI-잊지말기줄단추: 폰(390)은 [노트로]가 줄 ⋯ 안에 있다 — 줄 버튼 또는 ⋯ 메뉴의 같은 이름 항목(helpers/nbx-act.mjs).
const workRow=(page)=>box(page).locator(`[data-nbx-row="c:${cid(1)}"]`);
const workBtn=(page)=>({click:()=>pressRowAct(page,workRow(page),'note')});

for(const width of [390,884,1440])test(`업무 줄 [노트로]: 줄 아래 작은 창(큰 창 아님), 하단바에 안 가림, [저장] 한 번이면 01. 업무메모 새 노트 ${width}`,async({page})=>{
  const f=await fixture(page,{width});
  await workBtn(page).click();
  await expect(quick(page)).toBeVisible();
  await expect(big(page)).toHaveCount(0);
  await expect(quick(page).locator('[data-edw-target]')).toHaveText('새 노트 ▾');
  await expect(quick(page).locator('[data-edw-folder]')).toHaveText('01. 업무메모 ▾');
  await expect(quick(page).locator('[data-nq-text]')).toHaveValue(/가짜 요청 하나/);
  const at=await page.evaluate(()=>{const row=document.querySelector('[data-nbx-row^="c:"]'),shown=e=>e&&e.getClientRects().length&&getComputedStyle(e).display!=='none'?e:null,b=(shown(row.querySelector('[data-nbx-act="note"]'))||row.querySelector('.nbx-more')).getBoundingClientRect(),q=document.querySelector('[data-note-quick]').getBoundingClientRect();
    const tab=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--kptu-mobile-tab-height'))||0;
    return {bb:b.bottom,bt:b.top,qt:q.top,qb:q.bottom,ql:q.left,qr:q.right,w:innerWidth,h:innerHeight,tab};});
  expect(at.qt>=at.bb-1||at.qb<=at.bt+1).toBeTruthy();
  expect(at.ql).toBeGreaterThanOrEqual(0);expect(at.qr).toBeLessThanOrEqual(at.w);expect(at.qb).toBeLessThanOrEqual(at.h-at.tab+1);
  await quick(page).locator('[data-nq-save]').click();
  await expect(quick(page)).toHaveCount(0);
  await expect.poll(()=>f.notePosts.length).toBe(1);
  expect(f.notePosts[0]).toMatchObject({kind:'note',raw_text:expect.stringContaining('가짜 요청 하나')});
  await expect.poll(()=>f.rows.find(r=>r.id===N(90))?.metadata?.folder_id).toBe(WORK);
  await expect.poll(()=>f.candPatches.length).toBe(1);
  expect(f.candPatches[0].body).toMatchObject({status:'done'});
  await expect(page.locator('#basketView [data-forget-status]')).toContainText('노트로 저장했어요');
});

for(const width of [390,884,1440])test(`기존 노트를 정하면 마지막 두 줄이 흐리게 보이고 [저장]이 끝에 한 줄 더함 ${width}`,async({page})=>{
  const f=await fixture(page,{width});
  await workBtn(page).click();
  await quick(page).locator('[data-edw-target]').click();
  await expect(pick(page)).toBeVisible();
  await pick(page).locator(`[data-np-folder="${WORK}"]`).click();
  await pick(page).locator(`.nbb-pick-list [data-np-note="${N(1)}"]`).last().click();
  await expect(pick(page)).toHaveCount(0);
  await expect(quick(page)).toBeVisible();
  await expect(quick(page).locator('[data-edw-target]')).toHaveText('가짜 회의 정리 ▾');
  await expect(quick(page).locator('[data-edw-target-info]')).toHaveText('01. 업무메모 · 끝에 더함');
  await expect(quick(page).locator('[data-nq-tail] > div')).toHaveText(['… 예전 둘째 줄','예전 마지막 줄']);
  await quick(page).locator('[data-nq-text]').fill('직접 고친 한 줄');
  await quick(page).locator('[data-nq-save]').click();
  await expect(quick(page)).toHaveCount(0);
  await expect.poll(()=>f.notePatches.length).toBe(1);
  expect(f.notePosts).toEqual([]);
  expect(f.notePatches[0].query).toMatchObject({id:`eq.${N(1)}`,updated_at:'eq.2026-10-05T00:00:00Z'});
  expect(textOf(f.notePatches[0].body)).toEqual(['예전 첫 줄','예전 둘째 줄','예전 마지막 줄','직접 고친 한 줄']);
  await expect.poll(()=>f.candPatches.length).toBe(1);
});

for(const width of [390,884,1440])test(`[크게 수정 ↗]: 고른 노트·적은 글 그대로 큰 노트 창, 큰 창 [저장]도 같은 길 ${width}`,async({page})=>{
  const f=await fixture(page,{width});
  await workBtn(page).click();
  await quick(page).locator('[data-edw-target]').click();
  await pick(page).locator(`[data-np-folder="${WORK}"]`).click();
  await pick(page).locator(`.nbb-pick-list [data-np-note="${N(1)}"]`).last().click();
  await quick(page).locator('[data-nq-text]').fill('큰 창으로 넘길 글');
  await quick(page).locator('[data-nq-big]').click();
  await expect(quick(page)).toHaveCount(0);
  await expect(big(page)).toBeVisible();
  await expect(big(page).locator('[data-edw-target]')).toHaveText('가짜 회의 정리 ▾');
  await expect(big(page)).toContainText('큰 창으로 넘길 글');
  await big(page).locator('[data-edw-save]').click();
  await expect(big(page)).toHaveCount(0);
  await expect.poll(()=>f.notePatches.length).toBe(1);
  expect(textOf(f.notePatches[0].body).at(-1)).toBe('큰 창으로 넘길 글');
  await expect.poll(()=>f.candPatches.length).toBe(1);
});

test('[취소]·Esc는 아무것도 쓰지 않고, 쓴 글이 있으면 바깥을 눌러도 닫지 않는다',async({page})=>{
  const f=await fixture(page,{width:1440});
  await workBtn(page).click();
  await expect(quick(page)).toBeVisible();
  await page.mouse.click(5,5);
  await expect(quick(page)).toHaveCount(0);
  await workBtn(page).click();
  await quick(page).locator('[data-nq-text]').fill('쓰던 글');
  await page.mouse.click(5,5);
  await expect(quick(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(quick(page)).toHaveCount(0);
  await workBtn(page).click();
  await quick(page).locator('[data-nq-cancel]').click();
  await expect(quick(page)).toHaveCount(0);
  expect(f.notePosts).toEqual([]);expect(f.notePatches).toEqual([]);expect(f.candPatches).toEqual([]);
});

for(const width of [390,884,1440])test(`가족 줄 [노트로]: 작은 창에 '잊지 말기 ▾' '가족 ▾', [저장] 한 번으로 가족 노트 끝에 더하고 고르기는 가족 노트만 ${width}`,async({page})=>{
  const f=await fixture(page,{width});
  await pressRowAct(page,box(page).locator(`[data-nbx-row="f:${famId}"]`),'note');
  await expect(quick(page)).toBeVisible();
  await expect(big(page)).toHaveCount(0);
  await expect(quick(page).locator('[data-edw-target]')).toHaveText('잊지 말기 ▾');
  await expect(quick(page).locator('[data-edw-folder]')).toHaveText('가족 ▾');
  await expect(quick(page).locator('[data-nq-tail] > div')).toHaveText(['☐ 지어낸 예전 줄 (통화 10/1)']);
  await quick(page).locator('[data-edw-target]').click();
  await expect(pick(page).locator('.nbb-pick-list [data-np-note]').first()).toBeVisible();
  expect(f.noteLists.at(-1).ai_export_allowed).toBe('is.false');
  await expect(pick(page).locator(`[data-np-note="${N(1)}"]`)).toHaveCount(0);
  await pick(page).locator('[data-np-list]').click();
  await quick(page).locator('[data-nq-save]').click();
  await expect(quick(page)).toHaveCount(0);
  await expect.poll(()=>f.notePatches.length).toBe(1);
  expect(f.notePosts).toEqual([]);
  expect(f.notePatches[0].query).toMatchObject({id:`eq.${N(2)}`,ai_export_allowed:'is.false'});
  expect(textOf(f.notePatches[0].body)).toEqual(['☐ 지어낸 예전 줄 (통화 10/1)','☐ 지어낸 약속 한 줄 (텔레그램 10/5)']);
  await expect.poll(()=>f.famPatches.length).toBe(1);
  expect(f.famPatches[0].body).toMatchObject({status:'kept'});
  await expect(page.locator('#basketView [data-forget-status]')).toContainText("'가족' 폴더 노트에 넣었어요");
});
