// S52-20 HOME-잊지말기한목록 ②(요청함 11/07 14:37, 시안 docs/design/mockups/forget-one-list.html ①, 명진 14:44 '좋은데'):
// - 홈 [하루] 맨 위는 '잊지 말기' 한 줄 + 빨간 바탕 흰 글자 숫자 동그라미(처리 안 한 수, 0이면 숫자 없음, '놓친 것' 글자 없음), 누르면 정리함 한 목록.
// - 옛 '나한테 온 요청' 상자·'잊지 말기' 상자·'챙길 것 n · 정리 안 된 것 n' 줄은 없다.
// - 숫자 = 미분류 업데이트 + 처리 전 후보(텔레그램 요청 포함) + 가족 제안(운영자 기능 family). 메뉴 '홈' 표시(UI-앱안알림)도 같은 숫자.
// 서버는 흉내, 글·이름은 모두 지어낸 것.
import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const cid=n=>`c0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const fid=n=>`a0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const cand=(n,over={})=>({id:cid(n),kind:'request',summary:`가짜 요청 ${n}`,due:null,source_kind:'telegram',source_id:fid(n),source_day:'2026-10-06',evidence:'근거',project_id:null,organization_id:null,status:'open',task_id:null,task_due:null,created_at:`2026-10-06T00:0${n}:00Z`,decided_at:null,...over});
const FAMILY=[{id:'f0000000-0000-4000-8000-000000000001',kind:'plan',body:'지어낸 약속 한 줄',said_when:null,firmness:'planned',origin:'telegram',origin_day:'2026-10-05',status:'new',created_at:'2026-10-06T00:10:00Z'}];

async function fixture(page,{width=390,features=['telegram','family'],cands=[cand(1),cand(2),cand(3,{source_kind:'basket'})]}={}){
  await page.setViewportSize({width,height:900});
  const patches=[];
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
      return r.fulfill({json:out});
    });
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_todo_feedback',r=>r.request().method()==='POST'?r.fulfill({status:201,json:[{id:'e0000000-0000-4000-8000-000000000001'}]}):r.fulfill({json:[]}));
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_feed_items',r=>r.fulfill({json:[{id:fid(1),room_key:'room-a',room_label:'가상 지부방'}]}));
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_family_notes',r=>r.fulfill({json:r.request().method()==='GET'?FAMILY:[]}));
  }});
  await expect(page.locator('#homeView [data-home-summary]')).toBeVisible();
  return {patches,cands};
}
const line=page=>page.locator('#homeView [data-home-summary]');
const noWide=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);

for(const width of [344,390,884,1280])test(`${width}px: [하루] 맨 위 '잊지 말기' 한 줄 + 빨간 숫자, 옛 상자 없음, 가로 넘침 없음`,async({page},info)=>{
  await fixture(page,{width});
  // 요청 2 + 챙길 것 1 + 가족 1 + 미분류 업데이트 0 = 4.
  await expect(line(page).locator('[data-nbx-badge]')).toHaveText('4');
  await expect(line(page).locator('.nbx-head')).toHaveText('잊지 말기4열기 ›');
  await expect(line(page)).not.toContainText(/놓친|챙길 것|정리 안 된|나한테 온 요청/);
  await expect(line(page).locator('[data-nbx-row]')).toHaveCount(0);
  await expect(page.locator('#homeView [data-home-family],#homeView .nbx-foot')).toHaveCount(0);
  // 빨간 바탕 흰 글자 동그라미.
  const look=await line(page).locator('[data-nbx-badge]').evaluate(el=>{const s=getComputedStyle(el),p=document.createElement('i');p.style.color='var(--kptu-danger)';document.body.append(p);const red=getComputedStyle(p).color;p.style.color='var(--kptu-on-primary)';const white=getComputedStyle(p).color;p.remove();return {bg:s.backgroundColor,fg:s.color,red,white,round:parseFloat(s.borderTopLeftRadius)>=8};});
  expect(look.bg).toBe(look.red);expect(look.fg).toBe(look.white);expect(look.round).toBe(true);
  // 자리: [하루] 카드 맨 위(그날 일정 위), 한 줄 높이.
  const [l,s]=await Promise.all([line(page),page.locator('#homeView [data-journal-schedule]')].map(x=>x.boundingBox()));
  expect(s.y).toBeGreaterThanOrEqual(l.y+l.height-1);expect(l.height).toBeLessThan(48);
  expect(await noWide(page)).toBe(true);
  await page.screenshot({path:info.outputPath(`home-forget-line-${width}.png`)});
});

test('누르면 정리함 한 목록이 열리고, 같은 숫자의 줄이 있다',async({page})=>{
  await fixture(page);
  await line(page).locator('[data-home-forget-open]').click();
  await expect.poll(()=>page.evaluate(()=>window.KPTURouter.current)).toBe('basket');
  await expect(page.locator('#basketView [data-forget-section] [data-forget-src="telegram"],#basketView [data-forget-section] [data-forget-src="todo"],#basketView [data-forget-section] [data-forget-src="family"]')).toHaveCount(4);
});

test('처리할 것이 없으면 숫자 없이 "잊지 말기 열기 ›"만',async({page})=>{
  await fixture(page,{features:[],cands:[]});
  await expect(line(page).locator('.nbx-head')).toHaveText('잊지 말기열기 ›');
  await expect(line(page).locator('[data-nbx-badge]')).toHaveCount(0);
});

test('가족 기능이 없으면 가족 제안은 세지 않는다(서버 기능 목록)',async({page})=>{
  await fixture(page,{features:['telegram']});
  await expect(line(page).locator('[data-nbx-badge]')).toHaveText('3');
});

test('메뉴 홈 표시도 같은 숫자: 정리함에서 하나 처리하면 바로 줄어든다(새 세기 없음)',async({page})=>{
  const {patches}=await fixture(page,{width:1280});
  await expect(line(page).locator('[data-nbx-badge]')).toHaveText('4');
  await expect(page.locator('#appView')).toHaveAttribute('data-home-asks','4');
  await line(page).locator('[data-home-forget-open]').click();
  const row=page.locator(`#basketView [data-nbx-row="c:${cid(1)}"]`);
  await row.locator('[data-nbx-act="done"]').click();
  await expect(row).toHaveCount(0);
  expect(patches[0]).toMatchObject({id:cid(1),body:{status:'done'}});
  await expect(page.locator('#appView')).toHaveAttribute('data-home-asks','3');
});
