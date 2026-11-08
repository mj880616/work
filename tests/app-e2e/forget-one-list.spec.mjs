// S52-20 HOME-잊지말기한목록(요청함 11/07 14:37, 시안 docs/design/mockups/forget-one-list.html, 명진 14:44 '좋은데') ① 한 목록:
// - 정리함 화면 안은 칸 나눔 없이 한 목록, 새 것이 위. 텔레그램 요청·챙길 것·가족(잊지 말기 제안)·업데이트가 같은 줄(공용 notice-box)·같은 버튼
//   [할 일로][일정으로][노트로][이미 함] ×. 출처는 아래 작은 줄 맨 앞 흐린 꼬리표.
// FORGET-소식바로잡기(요청함 11/09 01:45, 시안 docs/design/mockups/forget-news-fix.html): 모든 줄(가족 빼고) 같은 일곱
//   [할 일로][일정으로][노트로][조직][사업][이미 함] × — 원래 다섯 + [조직][사업]. 폰·폴드·PC에서 버튼 줄은 한 줄.
// - 위 오른쪽 [처리 전 ▾] 하나: 처리 전·보냄·이미 함·무시·연결 완료, 아래쪽 출처 거르기.
// - 각 버튼 동작은 기존 길 그대로(후보 상태 칸·가족 상태 칸·업데이트 보류 칸). 서버는 흉내, 글·이름은 모두 지어낸 것(가족 이름·번호·방 이름 없음).
import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const cid=n=>`c0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const fid=n=>`a0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const uid=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const famId='f0000000-0000-4000-8000-000000000001';
const cand=(n,over={})=>({id:cid(n),kind:'request',summary:`가짜 요청 ${n}`,due:null,source_kind:'telegram',source_id:fid(n),source_day:'2026-10-06',evidence:'근거',project_id:null,organization_id:null,status:'open',task_id:null,task_due:null,created_at:`2026-10-06T0${n}:00:00Z`,decided_at:null,...over});
const family=()=>[{id:famId,kind:'plan',body:'지어낸 약속 한 줄',said_when:null,firmness:'planned',origin:'telegram',origin_day:'2026-10-05',status:'new',created_at:'2026-10-06T02:30:00Z'}];
const base={workspace_id:'w',kind:'basket',title:null,created_at:'2026-10-06T00:00:00Z',updated_at:'2026-10-06T00:00:00Z',archived_at:null,ai_export_allowed:true,metadata:{},attachments:[]};
const notes=()=>[{...base,id:uid(1),raw_text:'지어낸 업데이트 하나\n둘째 줄',occurred_at:'2026-10-06T04:00:00Z'},{...base,id:uid(2),raw_text:'지어낸 보류 업데이트',occurred_at:'2026-10-06T00:30:00Z',archived_at:'2026-10-06T01:00:00Z'}];

// FORGET-소식합치기: AI가 고른 그날 업무 통화·텔레그램 소식(서버 표 app_journal_memorable) — 지어낸 글·지어낸 조직 이름.
const nid=n=>`b0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const newsRow=(n,over={})=>({id:nid(n),day:'2026-10-06',source:'telegram',feed_item_id:fid(n),org_name:null,line:`가상 소식 ${n}`,status:'suggested',final_line:null,picked_at:`2026-10-06T0${n}:10:00Z`,decided_at:null,...over});
async function fixture(page,{width=390,features=['telegram','family'],news=[],cands=[cand(1),cand(3,{source_kind:'basket',summary:'지어낸 챙길 것'}),cand(5,{status:'tasked',decided_at:'2026-10-06T06:00:00Z'})]}={}){
  await page.setViewportSize({width,height:900});
  const patches=[],feedback=[],famPatches=[],notePatches=[],rows=notes(),newsPatches=[],orgPosts=[],asked=[];
  await openHome(page,{beforeLoad:async()=>{
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/rpc/app_my_features',r=>r.fulfill({json:features}));
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_todo_candidates',async r=>{
      const req=r.request(),q=new URL(req.url()).searchParams;
      if(req.method()==='PATCH'){
        const id=q.get('id').replace(/^eq\./,''),from=q.get('status').replace(/^eq\./,''),body=req.postDataJSON(),row=cands.find(c=>c.id===id&&c.status===from);
        patches.push({id,from,body});if(!row)return r.fulfill({json:[]});
        Object.assign(row,body);return r.fulfill({json:[{id,status:row.status,task_id:row.task_id,decided_at:row.decided_at}]});
      }
      let out=cands;const st=q.get('status');
      if(st==='eq.open')out=out.filter(c=>c.status==='open');else if(st?.startsWith('in.'))out=out.filter(c=>c.status!=='open');
      if(q.get('source_kind')==='eq.telegram')out=out.filter(c=>c.source_kind==='telegram');
      return r.fulfill({json:out});
    });
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_todo_feedback',async r=>{
      const req=r.request();
      if(req.method()==='POST'){feedback.push(req.postDataJSON());return r.fulfill({status:201,json:[{id:`e0000000-0000-4000-8000-00000000000${feedback.length}`}]});}
      if(req.method()==='DELETE')return r.fulfill({status:204,body:''});
      return r.fulfill({json:[]});
    });
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_feed_items',r=>r.fulfill({json:[{id:fid(1),room_key:'room-a',room_label:'가상 지부방'}]}));
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_family_notes',r=>{
      const req=r.request();
      if(req.method()==='PATCH'){famPatches.push(req.postDataJSON());return r.fulfill({json:[{id:famId}]});}
      return r.fulfill({json:family()});
    });
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',async r=>{
      const req=r.request(),q=new URL(req.url()).searchParams;
      const pick=row=>(!q.get('kind')||'eq.'+row.kind===q.get('kind'))&&(!q.get('id')||'eq.'+row.id===q.get('id'));
      if(req.method()==='GET'){if(q.get('metadata'))return r.fulfill({json:[]});return r.fulfill({json:rows.filter(pick)});}
      if(req.method()==='PATCH'){const body=req.postDataJSON();notePatches.push({id:q.get('id'),body});const hit=rows.filter(pick);hit.forEach(row=>Object.assign(row,body));return r.fulfill({json:hit});}
      return r.fulfill({status:500,json:{}});
    });
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_record_links',r=>r.fulfill({json:[]}));
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_journal_memorable',async r=>{
      const req=r.request(),q=new URL(req.url()).searchParams;
      if(req.method()==='PATCH'){const id=q.get('id').replace(/^eq\./,''),body=req.postDataJSON(),row=news.find(x=>x.id===id);newsPatches.push({id,body});if(!row)return r.fulfill({json:[]});Object.assign(row,body);return r.fulfill({json:[{id,status:row.status}]});}
      return r.fulfill({json:news});
    });
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_suborganizations',r=>r.fulfill({json:[{id:'d0000000-0000-4000-8000-000000000001',name:'가상 지부',aliases:['가상지부'],active:true}]}));
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_suborganization_assignees',r=>r.fulfill({json:[]}));
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_suborganization_updates',r=>{
      const req=r.request();if(req.method()!=='POST')return r.fulfill({json:[]});
      const body=req.postDataJSON();orgPosts.push(body);return r.fulfill({status:201,json:[{id:'e1000000-0000-4000-8000-000000000001',...body,occurred_at:'2026-10-06T09:00:00Z'}]});
    });
    await page.route(u=>u.origin===SB&&u.pathname==='/functions/v1/ai-assist',r=>{
      let body=null;try{body=r.request().postDataJSON();}catch{body=null;}
      if(body?.kind==='journal_memorable'){asked.push(body);return r.fulfill({json:{ok:true,kind:'journal_memorable',day:body.day,skipped:'fresh'}});}
      return r.fallback();
    });
  }});
  await page.evaluate(()=>window.KPTURouter.go('basket'));
  await expect(page.locator('#basketView [data-forget-section]')).toBeVisible();
  return {patches,feedback,famPatches,notePatches,cands,newsPatches,orgPosts,asked};
}
const list=page=>page.locator('#basketView [data-forget-section] .nbx-list');
const line=(page,key)=>page.locator(`#basketView [data-nbx-row="${key}"]`);
const noWide=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
// 버튼 줄이 한 줄인가: 모든 버튼의 세로 범위가 겹친다(가장 아래 버튼의 위가 가장 위 버튼의 아래보다 위). right = 가장 오른쪽 끝.
const oneLine=gs=>gs.map(g=>{const bs=[...g.children].map(b=>b.getBoundingClientRect());return {one:Math.max(...bs.map(b=>b.top))<Math.min(...bs.map(b=>b.bottom)),right:Math.max(...bs.map(b=>b.right))};});
const viewBtn=page=>page.locator('#basketView [data-forget-view-open]');
async function pickView(page,label){
  await viewBtn(page).click();
  await page.locator('#forgetViewMenu').getByRole('menuitemradio',{name:label,exact:true}).click();
}

for(const width of [390,884,1280])test(`${width}px: 칸 나눔 없이 한 목록(새 것이 위), 같은 줄·같은 버튼 일곱, 출처 꼬리표, 가족만 [조직][사업] 없음`,async({page},info)=>{
  await fixture(page,{width});
  await expect(list(page).locator('[data-nbx-row]')).toHaveCount(4);
  // 새 것이 위: 업데이트(04:00) → 챙길 것(03:00) → 가족(02:30) → 텔레그램(01:00).
  expect(await list(page).locator('[data-nbx-row]').evaluateAll(ls=>ls.map(l=>l.dataset.nbxRow))).toEqual([`u:${uid(1)}`,`c:${cid(3)}`,`f:${famId}`,`c:${cid(1)}`]);
  await expect(list(page).locator('.nbx-src')).toHaveText(['업데이트','챙길 것','가족','텔레그램']);
  await expect(line(page,`c:${cid(1)}`).locator('.nbx-meta')).toHaveText('텔레그램가상 지부방 · 10/6');
  await expect(line(page,`c:${cid(3)}`).locator('.nbx-meta')).toHaveText('챙길 것업데이트에서 · 10/6');
  const seven=['할 일로','일정으로','노트로','조직','사업','이미 함','×'];
  await expect(line(page,`c:${cid(1)}`).locator('.nbx-acts > button')).toHaveText(seven);
  await expect(line(page,`f:${famId}`).locator('.nbx-acts > button')).toHaveText(['할 일로','일정으로','노트로','이미 함','×']);
  await expect(line(page,`c:${cid(3)}`).locator('.nbx-acts > button')).toHaveText([...seven,'⋯']);
  await expect(line(page,`u:${uid(1)}`).locator('.nbx-acts > button')).toHaveText([...seven,'⋯']);
  // 버튼 줄은 줄마다 한 줄(두 줄로 꺾이지 않음)이고 화면 밖으로 나가지 않는다.
  const rows=await list(page).locator('[data-nbx-row] .nbx-acts').evaluateAll(oneLine);
  for(const r of rows){expect(r.one).toBe(true);expect(r.right).toBeLessThanOrEqual(width);}
  // '분류' 글자·옛 칸 제목(나한테 온 요청·챙길 것·업데이트 칸)·옛 칩 줄은 없다.
  await expect(page.locator('#basketView')).not.toContainText('분류');
  await expect(page.locator('#basketView [data-inbox-todo-section],#basketView [data-inbox-asks-host],#basketView [data-update-filters],#basketView [data-basket-filter]')).toHaveCount(0);
  // 같은 줄 모양: 출처마다 내용·작은 줄·버튼의 글자 크기·높이가 같다.
  const look=await list(page).locator('[data-nbx-row]').evaluateAll(ls=>ls.map(l=>{const s=(sel,p)=>getComputedStyle(l.querySelector(sel))[p];return [s('.nbx-body','fontSize'),s('.nbx-meta','fontSize'),s('[data-nbx-act="task"]','fontSize'),s('[data-nbx-act="task"]','height')].join('|');}));
  expect(new Set(look).size).toBe(1);
  expect(await noWide(page)).toBe(true);
  await page.screenshot({path:info.outputPath(`forget-one-list-${width}.png`)});
});

test('[처리 전 ▾]: 보냄·무시·연결 완료로 보기를 바꾸고, 출처로 거른다',async({page})=>{
  await fixture(page,{width:1280});
  await expect(viewBtn(page)).toHaveText('처리 전 ▾');
  await pickView(page,'보냄');
  await expect(viewBtn(page)).toHaveText('보냄 ▾');
  await expect(list(page).locator('[data-nbx-row]')).toHaveCount(1);
  await expect(line(page,`c:${cid(5)}`).locator('.nbx-done')).toHaveText(/^할 일로 보냄/);
  await expect(line(page,`c:${cid(5)}`).locator('[data-nbx-act]')).toHaveCount(0);
  await pickView(page,'무시');
  await expect(line(page,`u:${uid(2)}`).locator('.nbx-done')).toHaveText('보류');
  await pickView(page,'처리 전');
  await pickView(page,'가족');
  await expect(viewBtn(page)).toHaveText('처리 전 · 가족 ▾');
  await expect(list(page).locator('[data-nbx-row]')).toHaveCount(1);
  await expect(line(page,`f:${famId}`)).toBeVisible();
  await pickView(page,'모든 출처');
  await expect(list(page).locator('[data-nbx-row]')).toHaveCount(4);
});

test('버튼 동작은 기존 길 그대로: 후보 [이미 함]·[×], 가족 [×], 업데이트 [×](보류) — 모두 되돌리기',async({page})=>{
  const {patches,feedback,famPatches,notePatches}=await fixture(page,{width:1280});
  await line(page,`c:${cid(1)}`).locator('[data-nbx-act="done"]').click();
  await expect(line(page,`c:${cid(1)}`)).toHaveCount(0);
  expect(patches[0]).toMatchObject({id:cid(1),from:'open',body:{status:'done'}});
  await expect.poll(()=>feedback.length).toBe(1);expect(feedback[0]).toMatchObject({candidate_id:cid(1),outcome:'done'});
  await page.locator('[data-undo-action]').click();
  await expect.poll(()=>patches.length).toBe(2);expect(patches[1]).toMatchObject({id:cid(1),from:'done',body:{status:'open'}});
  await expect(line(page,`c:${cid(1)}`)).toBeVisible();

  await line(page,`f:${famId}`).locator('[data-nbx-act="dismissed"]').click();
  await expect(line(page,`f:${famId}`)).toHaveCount(0);
  await expect.poll(()=>famPatches.length).toBe(1);expect(famPatches[0]).toMatchObject({status:'dismissed'});
  await page.locator('[data-undo-action]').click();
  await expect.poll(()=>famPatches.length).toBe(2);expect(famPatches[1]).toMatchObject({status:'new'});
  await expect(line(page,`f:${famId}`)).toBeVisible();

  await line(page,`u:${uid(1)}`).locator('[data-nbx-act="dismissed"]').click();
  await expect(line(page,`u:${uid(1)}`)).toHaveCount(0);
  await expect.poll(()=>notePatches.length).toBe(1);expect(notePatches[0].body.archived_at).toBeTruthy();
  await page.locator('[data-undo-action]').click();
  await expect.poll(()=>notePatches.length).toBe(2);expect(notePatches[1].body).toMatchObject({archived_at:null});
  await expect(line(page,`u:${uid(1)}`)).toBeVisible();
});

test('업데이트 줄: 내용을 누르면 그 업데이트가 열리고, [조직]은 연결하기와 조직 선택 창을 연다',async({page})=>{
  await fixture(page,{width:1280});
  await line(page,`u:${uid(1)}`).locator('[data-basket-row]').click();
  await expect(page.locator('[data-basket-detail]')).toBeVisible();
  await page.goBack();
  await expect(line(page,`u:${uid(1)}`)).toBeVisible();
  await line(page,`u:${uid(1)}`).locator('[data-nbx-act="org"]').click();
  await expect(page.locator('[data-basket-detail] [data-manual-pick="organization"]')).toBeVisible();
  await expect(page.getByRole('dialog',{name:'담당조직 선택'})).toBeVisible();
});

test('가족 기능이 없는 작업공간은 가족 줄이 없고(서버 기능 목록), 나머지는 같은 한 목록',async({page})=>{
  await fixture(page,{features:[]});
  await expect(list(page).locator('[data-nbx-row]')).toHaveCount(3);
  await expect(list(page).locator('[data-forget-src="family"]')).toHaveCount(0);
  await expect(line(page,`c:${cid(1)}`)).toBeVisible();
});

// FORGET-소식합치기(요청함 11/08 21:02~21:19, 시안 docs/design/mockups/forget-news-link.html): 업무일지 '기억할 통화·텔레그램' 줄이
// 잊지 말기 한 목록에 출처 '소식'으로 들어온다. → 소식바로잡기: 버튼은 다른 줄과 같은 일곱(옛 ⋯·[무시] 없음), '조직 › ○○에 넣기'는 [조직] 창 맨 위.
for(const width of [390,884,1280])test(`소식 줄: '소식 · 텔레그램/통화' 꼬리표·같은 버튼 일곱(한 줄), 처리 전 소식도 빨간 숫자에 셈 ${width}`,async({page})=>{
  const news=[newsRow(2,{org_name:'가상 지부'}),newsRow(4,{source:'call',line:'가상 통화 소식'}),newsRow(6,{status:'kept',final_line:'가상 넣은 소식',decided_at:'2026-10-06T07:00:00Z'})];
  const {asked}=await fixture(page,{width,news});
  await expect(list(page).locator('[data-forget-src="news"]')).toHaveCount(2);
  await expect(line(page,`n:${nid(2)}`).locator('.nbx-src')).toHaveText('소식 · 텔레그램');
  await expect(line(page,`n:${nid(4)}`).locator('.nbx-src')).toHaveText('소식 · 통화');
  await expect(line(page,`n:${nid(2)}`).locator('.nbx-body')).toHaveText('가상 지부 · 가상 소식 2');
  for(const n of [2,4])await expect(line(page,`n:${nid(n)}`).locator('.nbx-acts > button')).toHaveText(['할 일로','일정으로','노트로','조직','사업','이미 함','×']);
  await expect(list(page).locator('[data-forget-news-more]')).toHaveCount(0);
  for(const r of await list(page).locator('[data-forget-src="news"] .nbx-acts').evaluateAll(oneLine)){expect(r.one).toBe(true);expect(r.right).toBeLessThanOrEqual(width);}
  // 처리 전 수: 업데이트 1 + 챙길 것 1 + 텔레그램 요청 1 + 가족 1 + 소식 2 = 6 (메뉴 '홈' 표시와 같은 숫자).
  await expect(page.locator('#appView')).toHaveAttribute('data-home-asks','6');
  expect(asked).toEqual([{kind:'journal_memorable',day:'2026-10-06'}]);
  // 넣은 소식은 '연결 완료' 보기에.
  await pickView(page,'연결 완료');
  await expect(line(page,`n:${nid(6)}`).locator('.nbx-done')).toHaveText(/^처리함/);
  await pickView(page,'처리 전');
  await pickView(page,'소식');
  await expect(list(page).locator('[data-nbx-row]')).toHaveCount(2);
  expect(await noWide(page)).toBe(true);
});
test('소식 줄 [조직]: 창 맨 위 \'조직 › 가상 지부에 넣기\'로 담당조직 기록(이번 주 조직보고 제안 길), 맞는 조직 없으면 그 줄 없음, ×는 무시·되돌리기',async({page})=>{
  const news=[newsRow(2,{org_name:'가상지부'}),newsRow(4,{org_name:'모르는 팀'})];
  const {newsPatches,orgPosts}=await fixture(page,{width:1280,news});
  await line(page,`n:${nid(2)}`).locator('[data-nbx-act="org"]').click();
  const sheet=page.locator('#areaOrgPickSheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.aop-list [data-sheet-value]').first()).toHaveText('조직 › 가상 지부에 넣기');
  await sheet.locator('[data-forget-org-match] [data-sheet-value]').click();
  await expect.poll(()=>orgPosts.length).toBe(1);
  expect(orgPosts[0]).toMatchObject({organization_id:'d0000000-0000-4000-8000-000000000001',raw_text:'가상 소식 2'});
  await expect.poll(()=>newsPatches.length).toBe(1);
  expect(newsPatches[0]).toMatchObject({id:nid(2),body:{status:'kept',final_line:'가상 소식 2',drop_reason:null}});
  await expect(line(page,`n:${nid(2)}`)).toHaveCount(0);
  // 담당조직과 이름이 안 맞으면 맨 위 한 번에 넣기 줄은 없다(목록에서 직접 선택).
  await line(page,`n:${nid(4)}`).locator('[data-nbx-act="org"]').click();
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('[data-forget-org-match]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await line(page,`n:${nid(4)}`).locator('[data-nbx-act="dismissed"]').click();
  await expect.poll(()=>newsPatches.length).toBe(2);
  expect(newsPatches[1]).toMatchObject({id:nid(4),body:{status:'dropped'}});
  await expect(line(page,`n:${nid(4)}`)).toHaveCount(0);
  await page.locator('[data-undo-action]').click();
  await expect.poll(()=>newsPatches.length).toBe(3);
  expect(newsPatches[2]).toMatchObject({id:nid(4),body:{status:'suggested',decided_at:null}});
  await expect(line(page,`n:${nid(4)}`)).toBeVisible();
  // [이미 함]: 처리함(kept)으로 빼고 되돌리기.
  await line(page,`n:${nid(4)}`).locator('[data-nbx-act="done"]').click();
  await expect.poll(()=>newsPatches.length).toBe(4);
  expect(newsPatches[3]).toMatchObject({id:nid(4),body:{status:'kept',final_line:'가상 소식 4'}});
  await expect(line(page,`n:${nid(4)}`)).toHaveCount(0);
});
test('텔레그램 요청 [조직]: 고른 담당조직 기록으로 넣고 후보는 이미 함(done)으로 뺀다',async({page})=>{
  const {patches,orgPosts}=await fixture(page,{width:390});
  await line(page,`c:${cid(1)}`).locator('[data-nbx-act="org"]').click();
  const sheet=page.locator('#areaOrgPickSheet');
  await expect(sheet).toBeVisible();
  await sheet.locator('.aop-list [data-sheet-value="o:d0000000-0000-4000-8000-000000000001"]').click();
  await expect.poll(()=>orgPosts.length).toBe(1);
  expect(orgPosts[0]).toMatchObject({organization_id:'d0000000-0000-4000-8000-000000000001',raw_text:'가짜 요청 1'});
  await expect.poll(()=>patches.length).toBe(1);
  expect(patches[0]).toMatchObject({id:cid(1),from:'open',body:{status:'done'}});
  await expect(line(page,`c:${cid(1)}`)).toHaveCount(0);
});
test('운영자 기능(통화·텔레그램)이 없는 작업공간은 소식 줄도 소식 읽기·AI 요청도 없다',async({page})=>{
  const {asked}=await fixture(page,{features:[],news:[newsRow(2)]});
  await expect(list(page).locator('[data-nbx-row]')).toHaveCount(3);
  await expect(list(page).locator('[data-forget-src="news"]')).toHaveCount(0);
  expect(asked).toEqual([]);
});
