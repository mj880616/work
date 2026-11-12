// S61-8 UI-고르기창넣기안보임(요청함 11/13 05:22 ★급★): 폰(폴드 접은 화면 412)에서 잊지 말기 → 업데이트 줄 → [조직] → '담당조직 선택' 창의
// 민자철도 묶음을 펼쳐 공항철도지부를 고르면 창 아래 [넣기]·[취소] 줄이 하단바·시스템 바 밑으로 내려가 저장을 못 했다.
// 원인(재현으로 확인): 버튼 아래 창의 바닥(anchored-popup.js bottomInset)이 하단바 48px만 빼고, 하단바가 실제로 함께 덮는 시스템 바 자리
// (env(safe-area-inset-bottom), 화면 끝까지 그리는 폰의 제스처 줄)를 빼지 않았다. 이 시험은 시스템 바 자리 0·48px 두 경우 모두,
// 묶음을 펼친 뒤에도 [넣기]가 하단바·시스템 바 위(화면 안)에 다 보이고 눌러져 그 조직이 들어가는지 본다. 이름·글은 모두 지어낸 값.
import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {pressRowAct} from './helpers/nbx-act.mjs';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const SHOTS='docs/design/screens/s61-8';
const oid=n=>`d0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const uid=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
// 시험용 묶음 설정(helpers/home-entry.mjs가 넣는 OPERATOR_ORG_ORDER)과 같은 이름 — 공개된 묶음 이름만 쓰고 그 외 글은 지어낸 것.
const NAMES=['전국철도노동조합','서울교통공사노동조합','부산지하철노동조합','대구교통공사노동조합','인천교통공사노동조합','서해선지부','신분당선지부','지티엑스에이운영지부','공항철도지부','메트로9호선노동조합','서울교통공사9호선지부','김포도시철도지부','용인경전철지부'];
const ORGS=NAMES.map((name,i)=>({id:oid(i+1),name,aliases:[],active:true}));
const AIRPORT=oid(NAMES.indexOf('공항철도지부')+1);
const base={workspace_id:'w',kind:'basket',title:null,created_at:'2026-10-06T00:00:00Z',updated_at:'2026-10-06T00:00:00Z',archived_at:null,ai_export_allowed:true,metadata:{},attachments:[]};

async function boot(page,{width,height,safe}){
  // 화면 끝까지 그리는 폰의 시스템 바 자리(제스처 줄)를 흉내 낸다(크롬 개발 도구 기능). 0이면 시스템 바 자리 없음.
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{bottom:safe,bottomMax:safe}});
  await page.setViewportSize({width,height});
  const rows=[{...base,id:uid(1),raw_text:'지어낸 업데이트 하나\n둘째 줄',occurred_at:'2026-10-06T04:00:00Z'}];
  await openHome(page,{beforeLoad:async()=>{
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/rpc/app_my_features',r=>r.fulfill({json:[]}));
    await page.route(u=>u.origin===SB&&['/rest/v1/app_todo_candidates','/rest/v1/app_todo_feedback','/rest/v1/app_feed_items','/rest/v1/app_family_notes','/rest/v1/app_record_links','/rest/v1/app_journal_memorable','/rest/v1/app_suborganization_updates','/rest/v1/app_business_records'].includes(u.pathname),r=>r.fulfill({json:[]}));
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',r=>{
      const req=r.request(),q=new URL(req.url()).searchParams;
      if(req.method()!=='GET'||q.get('metadata'))return r.fulfill({json:[]});
      return r.fulfill({json:rows.filter(row=>(!q.get('kind')||'eq.'+row.kind===q.get('kind'))&&(!q.get('id')||'eq.'+row.id===q.get('id')))});
    });
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_suborganizations',r=>r.fulfill({json:ORGS}));
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_suborganization_assignees',r=>r.fulfill({json:ORGS.map(o=>({organization_id:o.id}))}));
    await page.route(u=>u.origin===SB&&u.pathname==='/functions/v1/ai-assist',r=>r.fulfill({json:{ok:true,skipped:'fresh'}}));
  }});
  await page.evaluate(()=>window.KPTURouter.go('basket'));
  await expect(page.locator('#basketView [data-forget-section]')).toBeVisible();
}

// 창 바닥: 보이는 하단바 위, 그리고 시스템 바 자리 위(둘 중 높은 쪽). [넣기]·[취소]가 그 위에 다 있고 창이 그 위에서 끝나는지.
async function footInside(page,sheet){
  await page.waitForTimeout(120); // followAnchor·place는 다음 화면 그림 때 자리를 다시 맞춘다
  const g=await sheet.evaluate(s=>{
    const probe=document.createElement('div');probe.style.cssText='position:fixed;bottom:0;height:env(safe-area-inset-bottom,0px)';document.body.append(probe);
    const safe=probe.getBoundingClientRect().height;probe.remove();
    const tabs=document.querySelector('nav.mobile-tabs'),tr=tabs&&getComputedStyle(tabs).display!=='none'?tabs.getBoundingClientRect():null;
    const floor=Math.min(innerHeight-safe,tr&&tr.height?tr.top:innerHeight);
    const box=b=>{const r=s.querySelector(b).getBoundingClientRect();return {top:r.top,bottom:r.bottom,h:r.height}};
    const r=s.getBoundingClientRect();
    return {floor,sheet:{top:r.top,bottom:r.bottom},save:box('[data-sheet-save]'),cancel:box('[data-sheet-cancel]')};
  });
  expect(g.sheet.top).toBeGreaterThanOrEqual(0);
  expect(g.sheet.bottom).toBeLessThanOrEqual(g.floor+0.5);
  for(const b of [g.save,g.cancel]){expect(b.h).toBeGreaterThan(20);expect(b.top).toBeGreaterThanOrEqual(g.sheet.top);expect(b.bottom).toBeLessThanOrEqual(g.floor+0.5);}
  return g;
}

for(const [width,height,shot] of [[412,860,'phone-412'],[412,700,''],[760,900,'fold-760'],[1280,800,'pc-1280']])for(const safe of [0,48])
test(`${width}×${height} 시스템 바 ${safe}px: 잊지 말기 업데이트 [조직] → 민자철도 펼쳐 공항철도지부 → [넣기]가 화면 안에 보이고 눌러져 들어감`,async({page})=>{
  await boot(page,{width,height,safe});
  await pressRowAct(page,page.locator(`#basketView [data-nbx-row="u:${uid(1)}"]`),'org');
  const sheet=page.getByRole('dialog',{name:'담당조직 선택'});
  await expect(sheet).toBeVisible();await expect(sheet).toHaveClass(/home-choice-multi/);
  await footInside(page,sheet);
  // 묶음을 펼쳐 줄이 늘어도 창 아래 끝은 그대로 화면 안(자리·높이를 다시 맞춤).
  await sheet.locator('[data-aop-toggle]').filter({hasText:'민자철도'}).first().click();
  const row=sheet.locator(`.aop-list [data-sheet-value="o:${AIRPORT}"]`);
  await row.scrollIntoViewIfNeeded();await row.click();
  await expect(row).toHaveAttribute('aria-pressed','true');
  await footInside(page,sheet);
  if(shot&&safe===48)await page.screenshot({path:`${SHOTS}/${shot}.png`});
  await sheet.locator('[data-sheet-save]').click();
  await expect(sheet).toBeHidden();
  await expect(page.locator(`[data-basket-detail] [data-manual-summary="organization:${AIRPORT}"]`)).toBeVisible();
});
