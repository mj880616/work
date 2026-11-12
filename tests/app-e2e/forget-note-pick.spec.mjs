// FORGET-노트고르기(요청함 11/09 13:34, 시안 docs/design/mockups/forget-note-pick.html, 명진 13:37·13:38 결정):
// 잊지 말기 [노트] 창 제목 줄 앞 [새 노트 ▾][폴더 ▾]. 업무 줄 기본은 새 노트 · 폴더 '01. 업무메모'(없으면 폴더 없음), 기존 노트를 고르면 그 노트 끝에 더한다.
// 가족 줄은 같은 창으로 '가족 › 잊지 말기' 노트가 골라진 채 열려 [저장] 한 번이면 끝나고, 고를 수 있는 노트는 가족 노트(AI가 읽지 않는 노트)뿐이다.
// 서버는 흉내(PATCH는 id·updated_at·ai_export_allowed 조건을 지킴), 글·이름은 모두 지어낸 것(가족 이름·번호·방 이름 없음). 폰 390 · 폴드 884 · PC 1440.
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

async function fixture(page,{width=390,folders=FOLDERS(),rows=NOTES()}={}){
  await page.setViewportSize({width,height:860});
  const cands=[cand()],fams=family(),f={rows,folders,candPatches:[],famPatches:[],notePosts:[],notePatches:[],remindPatches:[],noteLists:[]};
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
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_note_folders',r=>{
      const req=r.request();
      if(req.method()==='POST'){const body=req.postDataJSON(),row={id:'a0000000-0000-4000-8000-000000000009',...body,created_at:'2026-10-06T01:00:00Z'};folders.push(row);return r.fulfill({status:201,json:[row]});}
      return r.fulfill({json:folders});
    });
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',async r=>{
      const req=r.request(),q=new URL(req.url()).searchParams;
      // 서버처럼 조건을 지킨다: kind·id·updated_at·ai_export_allowed·family_list.
      const hit=row=>(!q.get('kind')||row.kind===eqv(q.get('kind')))&&(!q.get('id')||row.id===eqv(q.get('id')))&&(!q.get('updated_at')||row.updated_at===eqv(q.get('updated_at')))
        &&(!q.get('ai_export_allowed')||String(row.ai_export_allowed)===q.get('ai_export_allowed').replace(/^is\./,''))&&(!q.get('metadata->>family_list')||row.metadata?.family_list===true);
      if(req.method()==='POST'){const body=req.postDataJSON(),row={id:N(90+f.notePosts.length),attachments:[],archived_at:null,metadata:{},ai_export_allowed:true,...body,updated_at:'2026-10-06T01:00:00Z'};f.notePosts.push(body);rows.push(row);return r.fulfill({status:201,json:[row]});}
      if(req.method()==='PATCH'){
        const body=req.postDataJSON(),list=rows.filter(hit);
        // FAMILY-기억알림: 맨 위 '가족 · 기억할 것' 칸이 본 기록(metadata.remind)만 쓰는 PATCH는 따로 센다(이 시험이 보는 노트 글 쓰기와 다름).
        if(body.metadata&&!('doc' in body)&&body.metadata.remind)f.remindPatches.push(body);else f.notePatches.push({query:Object.fromEntries(q),body});
        list.forEach(row=>Object.assign(row,body));return r.fulfill({json:list});
      }
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
const win=page=>page.locator('#edWindow');
const pick=page=>page.locator('[data-note-pick]');
const textOf=row=>(row?.doc?.doc?.content||[]).map(p=>p.content?.[0]?.text??'');

for(const width of [390,884,1440])test(`업무 줄 [노트]: [새 노트 ▾][01. 업무메모 ▾] 제목 칸 순서로 열리고, [저장]이면 그 폴더 새 노트 ${width}`,async({page})=>{
  const f=await fixture(page,{width});
  await pressRowAct(page,box(page).locator(`[data-nbx-row="c:${cid(1)}"]`),'note');
  await page.locator("[data-nq-big]").click(); // FORGET-노트작은창: 작은 창에서 [크게 수정 ↗]로 큰 창
  await expect(win(page)).toBeVisible();
  const row=win(page).locator('.edw-title-row');
  await expect(row.locator('[data-edw-target]')).toHaveText('새 노트 ▾');
  await expect(row.locator('[data-edw-folder]')).toHaveText('01. 업무메모 ▾');
  await expect(row.locator('[data-edw-title]')).toBeVisible();
  await expect(row.locator('[data-edw-target-info]')).toBeHidden();
  await expect(win(page).locator('[data-edw-target-tail]')).toBeHidden();
  await expect(win(page).locator('[data-edw-attach]')).toBeVisible();
  // 위치는 그려진 뒤 한 번: 한 줄에 [새 노트 ▾] → [폴더 ▾] → 제목 칸, 창 밖으로 넘치지 않음.
  const at=await row.evaluate(el=>{const r=s=>el.querySelector(s).getBoundingClientRect();const a=r('[data-edw-target]'),b=r('[data-edw-folder]'),c=r('[data-edw-title]');return {a:[a.left,a.right,a.top+a.height/2],b:[b.left,b.right,b.top+b.height/2],c:[c.left,c.top+c.height/2],w:innerWidth,sw:document.documentElement.scrollWidth};});
  expect(at.a[1]).toBeLessThanOrEqual(at.b[0]);expect(at.b[1]).toBeLessThanOrEqual(at.c[0]+1);
  expect(Math.abs(at.a[2]-at.b[2])).toBeLessThanOrEqual(2);expect(Math.abs(at.a[2]-at.c[1])).toBeLessThanOrEqual(2);
  expect(at.sw).toBeLessThanOrEqual(at.w);
  await win(page).locator('[data-edw-save]').click();
  await expect(win(page)).toHaveCount(0);
  await expect.poll(()=>f.notePosts.length).toBe(1);
  expect(f.notePosts[0]).toMatchObject({kind:'note',raw_text:expect.stringContaining('가짜 요청 하나')});
  expect(f.notePosts[0].ai_export_allowed).toBeUndefined();
  await expect.poll(()=>f.rows.find(r=>r.id===N(90))?.metadata?.folder_id).toBe(WORK);
  await expect.poll(()=>f.candPatches.length).toBe(1);
  expect(f.candPatches[0].body).toMatchObject({status:'done'});
  await expect(page.locator('#basketView [data-forget-status]')).toContainText('노트로 저장했어요');
});

for(const width of [390,1440])test(`업무 줄 [새 노트 ▾] → 버튼 아래 작은 창 → 기존 노트를 고르면 그 노트 끝에 한 줄로 더함 ${width}`,async({page})=>{
  const f=await fixture(page,{width});
  await pressRowAct(page,box(page).locator(`[data-nbx-row="c:${cid(1)}"]`),'note');
  await page.locator("[data-nq-big]").click(); // FORGET-노트작은창: 작은 창에서 [크게 수정 ↗]로 큰 창
  const target=win(page).locator('[data-edw-target]');
  await target.click();
  await expect(pick(page)).toBeVisible();
  await expect(pick(page).locator('[data-np-new]')).toHaveText('＋ 새 노트로');
  await expect(pick(page).locator('[data-np-new]')).toHaveAttribute('aria-pressed','true');
  await expect(pick(page).locator('[data-np-list]')).toHaveCount(0);
  await expect(pick(page).locator('[data-np-find]')).toHaveAttribute('placeholder','노트 이름 찾기');
  await expect(pick(page).locator('.note-pick-sec').first()).toHaveText('최근 노트');
  await expect(pick(page).locator('[data-np-note]').first()).toBeVisible();
  // 업무 줄은 서버 읽기에 가족 조건이 없다(기존 규칙: 업무 글은 어느 노트에든 더할 수 있음).
  expect(f.noteLists.at(-1).ai_export_allowed).toBeUndefined();
  const place=await page.evaluate(()=>{const b=document.querySelector('#edWindow [data-edw-target]').getBoundingClientRect(),p=document.querySelector('[data-note-pick]').getBoundingClientRect();return {bb:b.bottom,bl:b.left,pt:p.top,pl:p.left,pr:p.right,w:innerWidth};});
  expect(place.pt).toBeGreaterThanOrEqual(place.bb);expect(place.pt-place.bb).toBeLessThanOrEqual(8);expect(place.pr).toBeLessThanOrEqual(place.w);
  // 폴더를 펴서 노트 고르기(노트 보드 노트 고르기와 같은 줄).
  await pick(page).locator(`[data-np-folder="${WORK}"]`).click();
  await pick(page).locator(`.nbb-pick-list [data-np-note="${N(1)}"]`).last().click();
  await expect(pick(page)).toHaveCount(0);
  await expect(target).toHaveText('가짜 회의 정리 ▾');
  await expect(win(page).locator('[data-edw-target-info]')).toHaveText('01. 업무메모 · 끝에 더함');
  await expect(win(page).locator('[data-edw-target-tail] > div')).toHaveText(['… 예전 둘째 줄','예전 마지막 줄']);
  await expect(win(page).locator('[data-edw-title]')).toBeHidden();
  await expect(win(page).locator('[data-edw-folder]')).toBeHidden();
  await expect(win(page).locator('[data-edw-attach]')).toBeHidden();
  await win(page).locator('[data-edw-save]').click();
  await expect(win(page)).toHaveCount(0);
  await expect.poll(()=>f.notePatches.length).toBe(1);
  expect(f.notePosts).toEqual([]);
  expect(f.notePatches[0].query).toMatchObject({id:`eq.${N(1)}`,kind:'eq.note',updated_at:'eq.2026-10-05T00:00:00Z'});
  expect(f.notePatches[0].query.ai_export_allowed).toBeUndefined();
  expect(textOf(f.notePatches[0].body)).toEqual(['예전 첫 줄','예전 둘째 줄','예전 마지막 줄','가짜 요청 하나','텔레그램 · 10/6']);
  expect(f.notePatches[0].body.title).toBe('가짜 회의 정리');
  await expect.poll(()=>f.candPatches.length).toBe(1);
  await expect(page.locator('#basketView [data-forget-status]')).toContainText('노트로 저장했어요');
});

test('업무 줄: 01. 업무메모 폴더가 없으면 폴더 없음, Esc는 작은 창만 닫는다',async({page})=>{
  await fixture(page,{folders:[{id:FAM,parent_id:null,name:'가족',sort_order:1,created_at:'2026-10-01T00:00:00Z'}]});
  await pressRowAct(page,box(page).locator(`[data-nbx-row="c:${cid(1)}"]`),'note');
  await page.locator("[data-nq-big]").click(); // FORGET-노트작은창: 작은 창에서 [크게 수정 ↗]로 큰 창
  await expect(win(page).locator('[data-edw-folder]')).toHaveText('폴더 없음 ▾');
  await win(page).locator('[data-edw-target]').click();
  await expect(pick(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(pick(page)).toHaveCount(0);
  await expect(win(page)).toBeVisible();
});

for(const width of [390,884,1440])test(`가족 줄 [노트]: 같은 창, '잊지 말기 ▾' '가족 ▾'가 골라진 채 [저장] 한 번으로 가족 노트 끝에 더함 ${width}`,async({page})=>{
  const f=await fixture(page,{width});
  await pressRowAct(page,box(page).locator(`[data-nbx-row="f:${famId}"]`),'note');
  await page.locator("[data-nq-big]").click(); // FORGET-노트작은창: 작은 창에서 [크게 수정 ↗]로 큰 창
  await expect(win(page)).toBeVisible();
  await expect(win(page).locator('[data-edw-target]')).toHaveText('잊지 말기 ▾');
  await expect(win(page).locator('[data-edw-folder]')).toHaveText('가족 ▾');
  await expect(win(page).locator('[data-edw-target-info]')).toHaveText('끝에 더함');
  await expect(win(page).locator('[data-edw-target-tail] > div')).toHaveText(['☐ 지어낸 예전 줄 (통화 10/1)']);
  await expect(win(page).locator('[data-edw-title]')).toBeHidden();
  await expect(win(page).locator('[data-edw-attach]')).toHaveCount(0);
  await win(page).locator('[data-edw-save]').click();
  await expect(win(page)).toHaveCount(0);
  await expect.poll(()=>f.notePatches.length).toBe(1);
  expect(f.notePosts).toEqual([]);
  expect(f.notePatches[0].query).toMatchObject({id:`eq.${N(2)}`,ai_export_allowed:'is.false',updated_at:'eq.2026-10-04T00:00:00Z'});
  expect(textOf(f.notePatches[0].body)).toEqual(['☐ 지어낸 예전 줄 (통화 10/1)','☐ 지어낸 약속 한 줄 (텔레그램 10/5)']);
  await expect.poll(()=>f.famPatches.length).toBe(1);
  expect(f.famPatches[0].body).toMatchObject({status:'kept'});
  await expect(page.locator('#basketView [data-forget-status]')).toContainText("'가족' 폴더 노트에 넣었어요");
});

test('가족 줄: 고르기 창은 가족 노트만(서버 조건), 새 노트도 AI 재료에서 뺀다. 그사이 AI가 읽는 노트로 바뀌면 저장 함수가 거절한다',async({page})=>{
  const f=await fixture(page,{width:1440});
  await pressRowAct(page,box(page).locator(`[data-nbx-row="f:${famId}"]`),'note');
  await page.locator("[data-nq-big]").click(); // FORGET-노트작은창: 작은 창에서 [크게 수정 ↗]로 큰 창
  await win(page).locator('[data-edw-target]').click();
  await expect(pick(page).locator('[data-np-list]')).toHaveText('잊지 말기 노트에 더하기');
  await expect(pick(page).locator('[data-np-list]')).toHaveAttribute('aria-pressed','true');
  await expect(pick(page).locator('.nbb-pick-list [data-np-note]').first()).toBeVisible();
  expect(f.noteLists.at(-1).ai_export_allowed).toBe('is.false');
  await expect(pick(page).locator(`[data-np-note="${N(1)}"]`)).toHaveCount(0);
  await pick(page).locator(`.nbb-pick-list [data-np-note="${N(3)}"]`).first().click();
  await expect(win(page).locator('[data-edw-target]')).toHaveText('가족 장보기 ▾');
  await expect(win(page).locator('[data-edw-target-info]')).toHaveText('가족 · 끝에 더함');
  // 그사이 다른 곳에서 이 노트가 AI가 읽는 노트로 바뀜 → 저장 함수가 읽은 행을 보고 거절, 아무것도 쓰지 않음.
  f.rows.find(r=>r.id===N(3)).ai_export_allowed=true;
  await win(page).locator('[data-edw-save]').click();
  await expect(win(page).locator('.ed-window-status')).toContainText('가족 노트(AI가 읽지 않는 노트)에만 넣을 수 있어요');
  expect(f.notePatches).toEqual([]);expect(f.famPatches).toEqual([]);
  // 새 노트로: 제목 칸이 보이고, 저장하면 AI 재료에서 뺀 새 노트(가족 폴더).
  await win(page).locator('[data-edw-target]').click();
  await pick(page).locator('[data-np-new]').click();
  await expect(win(page).locator('[data-edw-title]')).toBeVisible();
  await expect(win(page).locator('[data-edw-folder]')).toHaveText('가족 ▾');
  await win(page).locator('[data-edw-save]').click();
  await expect(win(page)).toHaveCount(0);
  await expect.poll(()=>f.notePosts.length).toBe(1);
  expect(f.notePosts[0]).toMatchObject({kind:'note',title:'지어낸 약속 한 줄',ai_export_allowed:false,metadata:{folder_id:FAM,folder:'가족'}});
  expect(f.notePosts[0].metadata.family_list).toBeUndefined();
  await expect.poll(()=>f.famPatches.length).toBe(1);
});
