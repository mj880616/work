// S52-20 HOME-잊지말기한목록 ②(요청함 11/07 14:37, 시안 docs/design/mockups/forget-one-list.html ①, 명진 14:44 '좋은데')
// → S53-13 HOME-잊지말기칩(요청함 11/08 13:54, 시안 docs/design/mockups/home-forget-slim.html, 명진 13:55 'A'):
// - 홈 '잊지 말기'는 따로 한 줄이 아니라 입력 칸 머리 줄 오른쪽 칩 하나 + 빨간 바탕 흰 글자 숫자(처리 안 한 수, 0이면 숫자 없이 칩만 흐리게), 누르면 정리함 한 목록.
// - 옛 띠 줄·옛 [잊지 말기 전체 보기 ›] 글자 링크는 없다.
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

for(const width of [344,390,884,1280])test(`${width}px: '잊지 말기' 띠 줄 없음, 입력 칸 머리 줄 오른쪽 칩 + 빨간 숫자, 옛 상자 없음, 가로 넘침 없음`,async({page},info)=>{
  await fixture(page,{width});
  const chip=line(page).locator('[data-home-forget-open]');
  // 요청 2 + 챙길 것 1 + 가족 1 + 미분류 업데이트 0 = 4.
  await expect(line(page).locator('[data-nbx-badge]')).toHaveText('4');
  await expect(chip).toHaveText('잊지 말기4');
  await expect(chip).toHaveClass(/\bds-chip\b/);
  await expect(chip).not.toHaveAttribute('data-chip-empty','');
  await expect(line(page)).not.toContainText(/놓친|챙길 것|정리 안 된|나한테 온 요청/);
  await expect(line(page).locator('[data-nbx-row]')).toHaveCount(0);
  await expect(page.locator('#homeView [data-home-family],#homeView .nbx-foot,#homeView .home-forget,#homeView [data-journal-day] .nbx,#homeView .home-basket-link')).toHaveCount(0);
  await expect(page.locator('#homeView')).not.toContainText('잊지 말기 전체 보기');
  // 칩 색: 공용 칩 + 톤다운 노랑(forget), 숫자는 빨간 바탕 흰 글자 동그라미.
  const look=await line(page).locator('[data-nbx-badge]').evaluate(el=>{const s=getComputedStyle(el),c=getComputedStyle(el.closest('button')),p=document.createElement('i');document.body.append(p);const tok=v=>{p.style.color=`var(${v})`;return getComputedStyle(p).color;};const out={bg:s.backgroundColor,fg:s.color,red:tok('--kptu-danger'),white:tok('--kptu-on-primary'),round:parseFloat(s.borderTopLeftRadius)>=8,chipInk:c.color,warn:tok('--kptu-warning')};p.remove();return out;});
  expect(look.bg).toBe(look.red);expect(look.fg).toBe(look.white);expect(look.round).toBe(true);expect(look.chipInk).toBe(look.warn);
  // 자리: 입력 칸 머리 줄([업데이트 ▾ | 할 일])과 같은 줄 오른쪽, 입력 칸 위. 칩 높이는 한 줄.
  const quick=page.locator('#homeView .home-quick[data-home-quick]');
  const [c,m,e,q]=await Promise.all([chip,quick.locator('.home-quick-modes'),quick.locator('.home-quick-entry'),quick].map(x=>x.boundingBox()));
  expect(c.height).toBeLessThanOrEqual(40);
  expect(Math.abs((c.y+c.height/2)-(m.y+m.height/2))).toBeLessThanOrEqual(4);
  expect(c.x).toBeGreaterThan(m.x+m.width);
  expect(c.y+c.height).toBeLessThanOrEqual(e.y+1);
  expect(c.x+c.width).toBeLessThanOrEqual(q.x+q.width+1);
  expect(await noWide(page)).toBe(true);
  await page.screenshot({path:info.outputPath(`home-forget-chip-${width}.png`)});
});

test('누르면 정리함 한 목록이 열리고, 같은 숫자의 줄이 있다',async({page})=>{
  await fixture(page);
  await line(page).locator('[data-home-forget-open]').click();
  await expect.poll(()=>page.evaluate(()=>window.KPTURouter.current)).toBe('basket');
  await expect(page.locator('#basketView [data-forget-section] [data-forget-src="telegram"],#basketView [data-forget-section] [data-forget-src="todo"],#basketView [data-forget-section] [data-forget-src="family"]')).toHaveCount(4);
});

test('처리할 것이 없으면 숫자 없이 흐린 칩 "잊지 말기"만, 눌러도 정리함',async({page})=>{
  await fixture(page,{features:[],cands:[]});
  // 처음 칩(모름)과 다 센 칩(0)은 겉이 같다. 다 센 상태(data-home-forget-count="0")를 기다린 뒤 본다(STAB-main화면시험흔들림).
  await expect(line(page)).toHaveAttribute('data-home-forget-count','0');
  const chip=line(page).locator('[data-home-forget-open]');
  await expect(chip).toHaveText('잊지 말기');
  await expect(chip).toHaveAttribute('data-chip-empty','');
  await expect(line(page).locator('[data-nbx-badge]')).toHaveCount(0);
  await expect.poll(()=>chip.evaluate(el=>{const p=document.createElement('i');p.style.color='var(--kptu-faint)';document.body.append(p);const f=getComputedStyle(p).color;p.remove();return el.isConnected&&getComputedStyle(el).color===f;})).toBe(true);
  await chip.click();
  await expect.poll(()=>page.evaluate(()=>window.KPTURouter.current)).toBe('basket');
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
