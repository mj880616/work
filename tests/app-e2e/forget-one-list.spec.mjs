// S52-20 HOME-잊지말기한목록(요청함 11/07 14:37, 시안 docs/design/mockups/forget-one-list.html, 명진 14:44 '좋은데') ① 한 목록:
// - 정리함 화면 안은 칸 나눔 없이 한 목록, 새 것이 위. 텔레그램 요청·챙길 것·가족(잊지 말기 제안)·업데이트가 같은 줄(공용 notice-box)·같은 버튼
//   [할 일로][일정으로][노트로][이미 함] ×. 출처는 아래 작은 줄 맨 앞 흐린 꼬리표. 업데이트 줄만 맨 앞 [조직][사업].
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

async function fixture(page,{width=390,features=['telegram','family'],cands=[cand(1),cand(3,{source_kind:'basket',summary:'지어낸 챙길 것'}),cand(5,{status:'tasked',decided_at:'2026-10-06T06:00:00Z'})]}={}){
  await page.setViewportSize({width,height:900});
  const patches=[],feedback=[],famPatches=[],notePatches=[],rows=notes();
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
  }});
  await page.evaluate(()=>window.KPTURouter.go('basket'));
  await expect(page.locator('#basketView [data-forget-section]')).toBeVisible();
  return {patches,feedback,famPatches,notePatches,cands};
}
const list=page=>page.locator('#basketView [data-forget-section] .nbx-list');
const line=(page,key)=>page.locator(`#basketView [data-nbx-row="${key}"]`);
const noWide=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
const viewBtn=page=>page.locator('#basketView [data-forget-view-open]');
async function pickView(page,label){
  await viewBtn(page).click();
  await page.locator('#forgetViewMenu').getByRole('menuitemradio',{name:label,exact:true}).click();
}

for(const width of [390,884,1280])test(`${width}px: 칸 나눔 없이 한 목록(새 것이 위), 같은 줄·같은 버튼, 출처 꼬리표, 업데이트 줄만 [조직][사업]`,async({page},info)=>{
  await fixture(page,{width});
  await expect(list(page).locator('[data-nbx-row]')).toHaveCount(4);
  // 새 것이 위: 업데이트(04:00) → 챙길 것(03:00) → 가족(02:30) → 텔레그램(01:00).
  expect(await list(page).locator('[data-nbx-row]').evaluateAll(ls=>ls.map(l=>l.dataset.nbxRow))).toEqual([`u:${uid(1)}`,`c:${cid(3)}`,`f:${famId}`,`c:${cid(1)}`]);
  await expect(list(page).locator('.nbx-src')).toHaveText(['업데이트','챙길 것','가족','텔레그램']);
  await expect(line(page,`c:${cid(1)}`).locator('.nbx-meta')).toHaveText('텔레그램가상 지부방 · 10/6');
  await expect(line(page,`c:${cid(3)}`).locator('.nbx-meta')).toHaveText('챙길 것업데이트에서 · 10/6');
  const same=['할 일로','일정으로','노트로','이미 함','×'];
  for(const key of [`c:${cid(1)}`,`f:${famId}`])await expect(line(page,key).locator('.nbx-acts > button')).toHaveText(same);
  await expect(line(page,`c:${cid(3)}`).locator('.nbx-acts > button')).toHaveText([...same,'⋯']);
  await expect(line(page,`u:${uid(1)}`).locator('.nbx-acts > button')).toHaveText(['조직','사업',...same,'⋯']);
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
