import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
import {closeOrganizationDetail} from './helpers/organization-detail.mjs';
// ORG-주요인물칸다듬기(S60-21): 조직 창 맨 아래 탭 [주요 인물][기본 정보][소속][이전 요약].
// ① 네 탭 모두 탭 줄 아래 첫 줄까지 간격이 같다(이 창 첫 줄 간격 12px = --kptu-space-3). ② 첫 줄 왼쪽 시작이 탭 줄 왼쪽과 같다.
// ③ 주요 인물 0명: [모두] 칩 없이 '주요 인물 없음 · + 인물' 한 줄(흐린 작은 글 + 글자 단추). 사람이 있을 때만 칩 줄.
// 화면 사진: KPTU_SHOTS=1(고친 뒤) 또는 KPTU_SHOTS=before 이면 docs/design/screens/s60-21/ (PC 1280 · 폰 412). 이름은 모두 합성 값이다.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',stamp='2026-09-15T01:00:00Z',owner='home-test';
const SHOTS=process.env.KPTU_SHOTS;
const orgs=[
 {id:'oa',workspace_id:'w',name:'합성 가 지부',active:true,created_by:owner,updated_at:stamp},
 {id:'ob',workspace_id:'w',name:'합성 나 지부',active:true,created_by:owner,updated_at:stamp}
];
const PEOPLE={ob:[['k1','합성인물 하나'],['k2','합성인물 둘']]};
async function fixture(page,width){
 await page.setViewportSize({width,height:900});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await openHome(page);
 const list=(route,rows)=>{const q=new URL(route.request().url()).searchParams;const o=Number(q.get('offset')||0);return route.fulfill({json:rows.slice(o,o+Number(q.get('limit')||rows.length||1))})};
 await page.route(SB+'/rest/v1/app_suborganizations?**',route=>{const q=new URL(route.request().url()).searchParams,id=q.get('id');return route.fulfill({json:id?orgs.filter(o=>'eq.'+o.id===id):orgs})});
 await page.route(SB+'/rest/v1/app_suborganization_assignees?**',route=>{const q=new URL(route.request().url()).searchParams;return route.fulfill({json:q.get('user_id')?[{user_id:owner}]:orgs.map(o=>({organization_id:o.id,user_id:owner}))})});
 await page.route(SB+'/rest/v1/app_suborganization_updates?**',route=>list(route,[]));
 await page.route(SB+'/rest/v1/app_documents?**',route=>list(route,[]));
 await page.route(SB+'/rest/v1/app_org_key_people_briefs?**',route=>route.fulfill({json:[]}));
 await page.route(SB+'/rest/v1/app_org_key_people?**',route=>{const q=new URL(route.request().url()).searchParams,id=String(q.get('organization_id')||'').replace(/^eq\./,'');return route.fulfill({json:(PEOPLE[id]||[]).map(([pid,name],i)=>({id:pid,workspace_id:'w',organization_id:id,name,match_names:[name],sort_order:i,created_at:stamp}))})});
 return {errors};
}
async function openOrg(page,width,id){
 if(await page.locator('#wdModal').isVisible().catch(()=>false))await closeOrganizationDetail(page);
 else await clickView(page,'team');
 await page.locator(`#soOrganizationList [data-so-org="${id}"]`).click();
 const modal=page.locator('#wdModal');await expect(modal).toBeVisible();
 await expect(page.locator('#wdTitle')).toHaveText(orgs.find(o=>o.id===id).name);
 return modal;
}
// 탭 줄의 보이는 막대(content-box) 아래·왼쪽과 각 탭 칸 첫 줄의 보이는 위·왼쪽.
const firstLine=(modal,key)=>modal.evaluate((m,key)=>{
 const tabs=m.querySelector('.wd-tabs'),cs=getComputedStyle(tabs),r=tabs.getBoundingClientRect();
 const trackBottom=r.bottom-parseFloat(cs.paddingBottom),trackLeft=r.left;
 const panel=m.querySelector(`[data-wd-panel="${key}"]`);
 const first=key==='people'?panel.querySelector('#wdPeople').firstElementChild:panel.querySelector('.wd-sub');
 const target=key==='people'?first:first.firstElementChild;
 const fr=target.getBoundingClientRect(),fs=getComputedStyle(first);
 return {gap:Math.round(fr.top-trackBottom),left:Math.round(fr.left-trackLeft),line:fs.borderTopStyle!=='none'&&parseFloat(fs.borderTopWidth)>0};
},key);
const shot=async(page,modal,name)=>{if(!SHOTS)return;const sec=modal.locator('#wdMoreSec');await sec.scrollIntoViewIfNeeded();await page.waitForTimeout(250);
 await page.screenshot({path:`docs/design/screens/s60-21/${SHOTS==='before'?'before':'after'}-${name}.png`})};

for(const width of [1280,412])test(`${width}: 조직 창 탭 — 네 탭 첫 줄 간격·왼쪽 같음, 주요 인물 0명은 한 줄(모두 칩 없음)`,async({page})=>{
 const {errors}=await fixture(page,width);
 const modal=await openOrg(page,width,'oa');
 const host=modal.locator('#wdPeople');
 await expect(host.locator('[data-wait-empty]')).toHaveText('주요 인물 없음');
 await shot(page,modal,`${width}-0명`);
 if(SHOTS==='before'){const got={};for(const key of ['people','basic','aff','recent']){await modal.locator(`[data-wd-tab="${key}"]`).click();got[key]=await firstLine(modal,key);if(key==='basic')await shot(page,modal,`${width}-기본정보`)}console.log(width,JSON.stringify(got));
  await modal.locator('[data-wd-tab="people"]').click();const m2=await openOrg(page,width,'ob');await expect(m2.locator('#wdPeople .okp-chip')).toHaveCount(3);console.log(width,'2명',JSON.stringify(await firstLine(m2,'people')));await shot(page,m2,`${width}-2명`);return}
 // 0명: [모두] 칩·칩 줄 없음, 같은 줄에 [+ 인물] 글자 단추.
 await expect(host.locator('[data-okp-pick]')).toHaveCount(0);
 await expect(host.locator('.okp-chips')).toHaveCount(0);
 const add=host.locator('[data-okp-add]');await expect(add).toHaveText('+ 인물');await expect(add).toHaveClass(/okp-link/);
 expect(await host.locator('[data-wait-empty]').evaluate(e=>getComputedStyle(e).fontSize),'빈 글은 작은 글').toBe('12px');
 const e=await host.locator('[data-wait-empty]').boundingBox(),a=await add.boundingBox();
 expect(Math.abs((e.y+e.height/2)-(a.y+a.height/2)),'빈 글과 [+ 인물]이 한 줄').toBeLessThanOrEqual(2);
 // 네 탭 첫 줄: 간격·왼쪽 시작이 모두 같고, 첫 줄 위에 따로 선이 없다.
 const got={};
 for(const key of ['people','basic','aff','recent']){await modal.locator(`[data-wd-tab="${key}"]`).click();got[key]=await firstLine(modal,key);if(key==='basic')await shot(page,modal,`${width}-기본정보`)}
 for(const key of Object.keys(got)){expect(got[key].gap,`${key} 간격`).toBe(12);expect(got[key].left,`${key} 왼쪽`).toBe(0);expect(got[key].line,`${key} 첫 줄 위 선`).toBe(false)}
 // 사람이 있으면 칩 줄([모두]·사람·[+ 인물]).
 const modal2=await openOrg(page,width,'ob');
 await modal2.locator('[data-wd-tab="people"]').click();
 await expect(modal2.locator('#wdPeople .okp-chip')).toHaveText(['모두','합성인물 하나','합성인물 둘']);
 await expect(modal2.locator('#wdPeople .okp-chips [data-okp-add]')).toHaveText('+ 인물');
 const p=await firstLine(modal2,'people');expect(p.gap).toBe(12);expect(p.left).toBe(0);
 // 이 칸의 빈 글·작은 머리·'요즘' 줄은 작은 글(12px) — 창 공용 글자 규칙(h4 16px·p 14px)에 덮이지 않는다.
 expect(await modal2.evaluate(m=>[...m.querySelectorAll('#wdPeople :is(.wait-empty,.okp-h,.okp-brief)')].map(e=>getComputedStyle(e).fontSize))).toEqual(Array(5).fill('12px'));
 await shot(page,modal2,`${width}-2명`);
 expect(errors).toEqual([]);
});
