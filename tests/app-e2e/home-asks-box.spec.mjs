// S52-09 UI-요청상자통일(요청함 11/07 10:52, 시안 docs/design/mockups/home-asks-box.html, 명진 'ㅇ'):
// - 홈 [하루] 카드 맨 위 '나한테 온 요청' 상자 → '잊지 말기' 상자. 둘은 같은 공용 부품(notice-box.mjs) — 색만 다르다(요청 파랑, 잊지 말기 노랑).
// - 요청 줄: 내용 한 줄 + 아래 작은 줄(방 이름·날짜, [할 일로][이미 함][일정으로][노트로] ×). 없으면 '· 새 요청 없음 ·'. 맨 아래 흐린 한 줄 '챙길 것 n · 정리 안 된 것 n ›'.
// - 날짜 밑 옛 요약 줄은 없다. 정리함 '나한테 온 요청'도 같은 상자·같은 줄·같은 버튼.
// - 텔레그램 요청 상자는 운영자 기능 telegram(서버 app_my_features)일 때만. 서버는 흉내, 글·이름은 모두 지어낸 것.
import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {edWinText} from './helpers/note-editor.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const cid=n=>`c0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const fid=n=>`a0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const cand=(n,over={})=>({id:cid(n),kind:'request',summary:`가짜 요청 ${n}`,due:null,source_kind:'telegram',source_id:fid(n),source_day:'2026-10-06',evidence:'근거',project_id:null,organization_id:null,status:'open',task_id:null,task_due:null,created_at:`2026-10-06T00:0${n}:00Z`,decided_at:null,...over});
const FAMILY=[{id:'f0000000-0000-4000-8000-000000000001',kind:'plan',body:'지어낸 약속 한 줄',said_when:null,firmness:'planned',origin:'telegram',origin_day:'2026-10-05',status:'new',created_at:'2026-10-06T00:10:00Z'}];

async function fixture(page,{width=390,features=['telegram','family'],cands=[cand(1),cand(2),cand(3,{source_kind:'basket'})]}={}){
  await page.setViewportSize({width,height:900});
  const patches=[],feedback=[],drops=[];
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
      if(req.method()==='POST'){const body=req.postDataJSON();feedback.push(body);return r.fulfill({status:201,json:[{id:`e0000000-0000-4000-8000-00000000000${feedback.length}`}]});}
      if(req.method()==='DELETE'){drops.push(new URL(req.url()).searchParams.get('id'));return r.fulfill({status:204,body:''});}
      return r.fulfill({json:[]});
    });
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_feed_items',r=>r.fulfill({json:[{id:fid(1),room_key:'room-a',room_label:'가상 지부방'}]}));
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_family_notes',r=>r.fulfill({json:r.request().method()==='GET'?FAMILY:[]}));
  }});
  await expect(page.locator('#homeView [data-home-summary]')).toBeVisible();
  return {patches,feedback,drops,cands};
}
const asks=page=>page.locator('#homeView [data-home-summary]');
const fam=page=>page.locator('#homeView [data-home-family]');
const row=(box,n)=>box.locator(`[data-nbx-row="${cid(n)}"]`);
const noWide=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
// 두 상자가 같은 부품인지: 모양 값(둥글기·선·글자 크기·줄 간격·버튼 모양)을 비교하고, 바탕색만 다르다.
const look=box=>box.evaluate(el=>{
  const cs=(sel,props)=>{const n=el.querySelector(sel);if(!n)return null;const s=getComputedStyle(n);return props.map(p=>s[p]).join('|');};
  return {box:cs(':scope',['borderTopLeftRadius','borderTopWidth','borderTopStyle','paddingLeft','fontSize']),bg:getComputedStyle(el).backgroundColor,
    head:cs('.nbx-head',['display','fontSize','minHeight']),title:cs('.nbx-title',['fontWeight','fontSize']),open:cs('.nbx-open',['fontSize','borderTopWidth','backgroundColor']),
    body:cs('.nbx-body',['fontSize','lineHeight']),meta:cs('.nbx-meta',['fontSize']),act:cs('.nbx-act',['fontSize','height','borderTopWidth','backgroundColor','paddingLeft']),
    x:cs('.nbx-x',['fontSize','borderTopWidth','backgroundColor']),cls:el.className.includes('nbx')};
});

for(const width of [344,390,884,1280])test(`${width}px: 요청 상자 → 잊지 말기 상자, 같은 부품(색만 다름), 날짜 밑 요약 줄 없음, 가로 넘침 없음`,async({page},info)=>{
  await fixture(page,{width});
  await expect(row(asks(page),2)).toBeVisible();await expect(fam(page).locator('[data-nbx-row]')).toHaveCount(1);
  await expect(asks(page).locator('.nbx-head')).toHaveText('나한테 온 요청2· 텔레그램 ·정리함 열기 ›');
  await expect(row(asks(page),1).locator('.nbx-body')).toHaveText('가짜 요청 1');
  await expect(row(asks(page),1).locator('.nbx-meta')).toHaveText('가상 지부방 · 10/6');
  await expect(row(asks(page),2).locator('.nbx-meta')).toHaveText('텔레그램 · 10/6');
  await expect(row(asks(page),1).locator('.nbx-acts button')).toHaveText(['할 일로','이미 함','일정으로','노트로','×']);
  await expect(fam(page).locator('[data-nbx-row] .nbx-acts button')).toHaveText(['할 일로','이미 함','일정으로','노트로','×']);
  await expect(asks(page).locator('.nbx-foot')).toHaveText('챙길 것 1 · 정리 안 된 것 0 ›');
  // 자리: [하루] 카드 맨 위에 요청 → 잊지 말기 → 그날 일정. 날짜 줄 밑 옛 요약 줄은 없다.
  const [a,f,s]=await Promise.all([asks(page),fam(page),page.locator('#homeView [data-journal-schedule]')].map(l=>l.boundingBox()));
  expect(f.y).toBeGreaterThanOrEqual(a.y+a.height-1);expect(s.y).toBeGreaterThanOrEqual(f.y+f.height-1);
  await expect(page.locator('#homeView .home-summary,#homeView .home-summary-open')).toHaveCount(0);
  // 같은 부품: 바탕색만 다르다.
  const [la,lf]=[await look(asks(page)),await look(fam(page))];
  expect(la.cls&&lf.cls).toBe(true);
  expect(la.bg).not.toBe(lf.bg);
  for(const k of ['box','head','title','open','body','meta','act','x'])expect(la[k],k).toBe(lf[k]);
  // 줄 버튼 다섯 개는 한 줄(가운데 높이가 같음).
  const mids=await row(asks(page),1).locator('.nbx-acts button').evaluateAll(bs=>bs.map(b=>{const r=b.getBoundingClientRect();return r.top+r.height/2;}));
  expect(Math.max(...mids)-Math.min(...mids)).toBeLessThanOrEqual(2);
  expect(await noWide(page)).toBe(true);
  await page.screenshot({path:info.outputPath(`home-asks-box-${width}.png`)});
});

test('요청이 없으면 한 줄 · 새 요청 없음 · + 흐린 한 줄. 운영자 기능 telegram이 없으면 상자 없이 흐린 한 줄만',async({page})=>{
  await fixture(page,{cands:[cand(3,{source_kind:'basket'})]});
  await expect(asks(page).locator('.nbx-head')).toHaveText('나한테 온 요청· 새 요청 없음 ·정리함 열기 ›');
  await expect(asks(page).locator('[data-nbx-row]')).toHaveCount(0);
  await expect(asks(page).locator('.nbx-foot')).toHaveText('챙길 것 1 · 정리 안 된 것 0 ›');
});
test('운영자 기능 telegram이 없으면 상자 없이 흐린 한 줄만(요청도 챙길 것 수에 든다)',async({page})=>{
  await fixture(page,{features:[]});
  await expect(asks(page)).toHaveText('챙길 것 3 · 정리 안 된 것 0 ›');
  await expect(asks(page)).not.toHaveClass(/(^|\s)nbx(\s|$)/);
  await expect(asks(page).locator('.nbx-head,[data-nbx-row]')).toHaveCount(0);
  await asks(page).locator('[data-goto="basket"]').click();
  await expect(page.locator('#basketView [data-inbox-asks-host]')).toBeHidden();
  await expect(page.locator('#basketView [data-inbox-todo-row]')).toHaveCount(3);
});

test('[×]: 바로 빠지고 5초 되돌리기(챙길 것 상태 칸만, 결과 기록도 지움)',async({page})=>{
  const {patches,feedback,drops}=await fixture(page);
  await row(asks(page),1).locator('[data-nbx-act="dismissed"]').click();
  await expect(row(asks(page),1)).toHaveCount(0);
  expect(patches[0]).toMatchObject({id:cid(1),from:'open',body:{status:'dismissed'}});
  await expect.poll(()=>feedback.length).toBe(1);expect(feedback[0]).toMatchObject({candidate_id:cid(1),outcome:'dismissed'});
  await expect(asks(page).locator('.nbx-status')).toContainText('지웠어요');
  await asks(page).locator('[data-nbx-undo]').click();
  await expect.poll(()=>patches.length).toBe(2);
  expect(patches[1]).toMatchObject({id:cid(1),from:'dismissed',body:{status:'open',decided_at:null}});
  await expect.poll(()=>drops.length).toBe(1);
  await expect(row(asks(page),1)).toBeVisible();
  await expect(asks(page).locator('.nbx-status')).toContainText('되돌렸어요');
});

test('[이미 함]: 창 없이 이미 함으로 빼고(결과 기록 done), 되돌리기',async({page})=>{
  const {patches,feedback}=await fixture(page);
  await row(asks(page),2).locator('[data-nbx-act="done"]').click();
  await expect(row(asks(page),2)).toHaveCount(0);
  expect(patches[0]).toMatchObject({id:cid(2),from:'open',body:{status:'done'}});
  await expect.poll(()=>feedback.length).toBe(1);expect(feedback[0]).toMatchObject({outcome:'done'});
  await expect(page.locator('#gtTaskModal')).toBeHidden();
  await asks(page).locator('[data-nbx-undo]').click();
  await expect.poll(()=>patches.length).toBe(2);expect(patches[1]).toMatchObject({from:'done',body:{status:'open'}});
  await expect(row(asks(page),2)).toBeVisible();
});

test('[할 일로]·[일정으로]·[노트로]: 그 창을 내용으로 채워 열고, 저장 전에는 상태를 바꾸지 않는다',async({page})=>{
  const {patches}=await fixture(page,{width:1280});
  await row(asks(page),1).locator('[data-nbx-act="task"]').click();
  await expect(page.locator('#gtTaskModal')).toBeVisible();
  await expect(page.locator('#gtEditTitle')).toHaveValue('가짜 요청 1');
  await expect(page.locator('#gtEditNotes')).toHaveValue('텔레그램 · 가상 지부방 · 10/6');
  await page.keyboard.press('Escape');await expect(page.locator('#gtTaskModal')).toBeHidden();
  await row(asks(page),1).locator('[data-nbx-act="note"]').click();
  await expect(edWinText(page)).toContainText('가짜 요청 1');
  await expect(edWinText(page)).toContainText('텔레그램 · 가상 지부방 · 10/6');
  await page.waitForTimeout(200);
  expect(patches).toEqual([]);
  await expect(row(asks(page),1)).toBeVisible();
});

for(const width of [390,1280])test(`${width}px 정리함: 나한테 온 요청은 홈과 같은 상자·같은 줄·같은 버튼(아래 챙길 것 목록에서 빠짐)`,async({page},info)=>{
  const {patches}=await fixture(page,{width});
  await asks(page).locator('.nbx-head [data-goto="basket"]').click();
  await expect(page.locator('#basketView')).toBeVisible();
  const box=page.locator('#basketView [data-inbox-asks-host]');
  await expect(box.locator('.nbx-head')).toHaveText('나한테 온 요청2· 텔레그램 ·');
  await expect(row(box,1).locator('.nbx-acts button')).toHaveText(['할 일로','이미 함','일정으로','노트로','×']);
  await expect(page.locator('#basketView [data-inbox-todo-row]')).toHaveCount(1);
  await expect(page.locator(`#basketView [data-inbox-todo-row="${cid(1)}"]`)).toHaveCount(0);
  // 홈 상자와 같은 모양(같은 부품).
  await page.evaluate(()=>window.KPTURouter.go('home'));
  const home=await look(asks(page));
  await page.evaluate(()=>window.KPTURouter.go('basket'));
  const inbox=await look(box);
  for(const k of ['box','bg','head','title','body','meta','act','x'])expect(inbox[k],k).toBe(home[k]);
  await page.screenshot({path:info.outputPath(`inbox-asks-box-${width}.png`)});
  // 같은 처리: [이미 함]이면 상자에서 빠지고 [이미 함] 칩에 보인다.
  await row(box,1).locator('[data-nbx-act="done"]').click();
  await expect(row(box,1)).toHaveCount(0);
  expect(patches[0]).toMatchObject({id:cid(1),body:{status:'done'}});
  expect(await noWide(page)).toBe(true);
});
