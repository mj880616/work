// S61-53 ORG-주요인물기록열기: 조직 상세 [주요 인물] 지난 기록의 통화·텔레그램 줄 → 그 원문, 뒤로가기 한 번 → 이 조직 상세 그 자리.
// 폰(412)에서는 조직 상세가 창(.modal, 뒤로가기 기록 한 칸)이라, 예전에는 화면을 옮기는 순간 창이 닫히며 그 창의 뒤로가기가
// 방금 연 통화 화면까지 되돌려 '조직 보고 목록'만 남았다. 폰 = 안드로이드 앱과 같은 KPTURouter.back(), 폴드·PC = 브라우저 뒤로.
// 서버는 모두 흉내이고 이름·글은 지어낸 것이다. 화면 사진: KPTU_SHOTS=1 이면 docs/design/screens/s61-53/.
import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {installTgServer,telegramRows} from './helpers/tg-room-day-server.mjs';
import {organizationDetailDocked} from './helpers/organization-detail.mjs';
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',stamp='2026-09-15T01:00:00Z',owner='home-test';
const SHOTS=process.env.KPTU_SHOTS?'docs/design/screens/s61-53/':'';
const CALL='60000000-0000-4000-8000-0000000000a1';
const orgs=[{id:'oa',workspace_id:'w',name:'합성 가 지부',active:true,created_by:owner,updated_at:stamp},{id:'ob',workspace_id:'w',name:'합성 나 지부',active:true,created_by:owner,updated_at:stamp}];
const callRow={workspace_id:'w',source:'call',id:CALL,day:'2026-10-05',occurred_at:'2026-10-05T03:00:00Z',room_key:null,room_label:null,title:'가상 교섭 일정 통화',summary:'다음 주 교섭 일정과 자료 준비를 이야기함. 아주 긴 요약이 화면 오른쪽 끝을 넘지 않는지 보려고 길게 적은 지어낸 글입니다.',
  points:['가상 내용'],counterpart:'합성인물 하나',speaker_split:false,raw_count:0,organization_id:null,project_id:null,drive_url:null,pinned_at:null,hidden_at:null,archived_at:null,updated_at:'2026-10-06T00:00:00Z',raw_text:'가상 전문'};
// 텔레그램: 보낸 사람 이름표(수집기 이름)가 그 사람이면 그 방·날이 잡힌다.
const senders={senders:[{id:'s1',workspace_id:'w',name:null,auto_name:'합성인물 하나',is_self:false,sender_key:'k'}],links:[{workspace_id:'w',room_key:'room-b',day:'2026-10-06',label:'A',sender_id:'s1'}]};
const brief={organization_id:'ob',day:'2026-10-06',brief:'요즘 합성인물 하나와 교섭 일정·자료 준비를 자주 이야기했고, 다음 주 화요일 교섭을 앞두고 자료집 원고 마감을 챙기는 중이라는 아주 긴 한 문장입니다.',detail:null,people_ids:['k1'],updated_at:stamp};

async function fixture(page,width){
  await page.setViewportSize({width,height:860});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const items=[...telegramRows(),callRow];
  await openHome(page,{beforeLoad:async()=>{
    await installTgServer(page,{items});
    const route=(t,fn)=>page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/'+t,fn);
    await route('app_suborganizations',r=>{const id=new URL(r.request().url()).searchParams.get('id');return r.fulfill({json:id?orgs.filter(o=>'eq.'+o.id===id):orgs})});
    await route('app_suborganization_assignees',r=>{const q=new URL(r.request().url()).searchParams;return r.fulfill({json:q.get('user_id')?[{user_id:owner}]:orgs.map(o=>({organization_id:o.id,user_id:owner}))})});
    await route('app_org_key_people',r=>{const id=String(new URL(r.request().url()).searchParams.get('organization_id')||'').replace(/^eq\./,'');return r.fulfill({json:id==='ob'?[{id:'k1',workspace_id:'w',organization_id:'ob',name:'합성인물 하나',match_names:['합성인물 하나'],sort_order:0,created_at:stamp}]:[]})});
    await route('app_org_key_people_briefs',r=>r.fulfill({json:String(new URL(r.request().url()).searchParams.get('organization_id'))==='eq.ob'?[brief]:[]}));
    await route('app_tg_senders',r=>r.fulfill({json:Number(new URL(r.request().url()).searchParams.get('offset')||0)?[]:senders.senders}));
    await route('app_tg_day_senders',r=>r.fulfill({json:Number(new URL(r.request().url()).searchParams.get('offset')||0)?[]:senders.links}));
    for(const t of ['app_call_personal','app_call_edits','app_meetings','app_suborganization_updates','app_documents'])await route(t,r=>r.fulfill({json:[]}));
  }});
  return {errors};
}
const back=(page,width)=>width<761?page.evaluate(()=>window.KPTURouter.back()):page.goBack();
const tap=(page,loc,width)=>width<761?loc.tap():loc.click();
async function openOrg(page){
  await page.evaluate(()=>window.KPTURouter.go('team',{source:'delegated'}));
  // 폴드·PC 칸은 들어가면 첫 조직을 스스로 연다: 그 조직이 다 열린 뒤 고른다.
  if(await organizationDetailDocked(page))await expect(page.locator('#wdTitle')).toHaveText('합성 가 지부');
  await page.locator('#soOrganizationList [data-so-org="ob"]').click();
  await expect(page.locator('#wdModal')).toBeVisible();
  await expect(page.locator('#wdTitle')).toHaveText('합성 나 지부');
  await page.locator('#wdModal [data-wd-tab="people"]').click();
  await expect(page.locator('#wdPeople .okp-row').first()).toBeVisible();
}
const rowOf=(page,kind)=>page.locator('#wdPeople .okp-row').filter({has:page.locator(`.okp-tag.${kind}`)}).first();
// 누른 줄의 화면 높이(돌아오면 같은 높이).
const topOf=loc=>loc.evaluate(e=>Math.round(e.getBoundingClientRect().top));

for(const width of [412,720,1280]){
  test(`${width}: 주요 인물 통화 줄 → 통화 원문, 뒤로가기 한 번 → 이 조직 상세 그 자리`,async({page})=>{
    const {errors}=await fixture(page,width);
    await openOrg(page);
    const row=rowOf(page,'call');
    await expect(row).toContainText('다음 주 교섭 일정');
    await row.scrollIntoViewIfNeeded();
    const y=await topOf(row);
    if(SHOTS&&width!==720)await page.screenshot({path:`${SHOTS}people-${width}.png`});
    await tap(page,row,width);
    await expect(page.locator('#callsView')).toBeVisible();
    await expect(page.locator(`#cfDetail [data-cf-detail="${CALL}"]`)).toBeVisible();
    await back(page,width);
    await expect(page.locator('#teamView')).toBeVisible();
    await expect(page.locator('#callsView')).toBeHidden();
    await expect(page.locator('#wdModal')).toBeVisible();
    await expect(page.locator('#wdTitle')).toHaveText('합성 나 지부');
    await expect(rowOf(page,'call')).toBeInViewport();
    await expect.poll(async()=>Math.abs(await topOf(rowOf(page,'call'))-y)).toBeLessThanOrEqual(1);
    // 한 번 더 뒤로가기: 창으로 뜬 조직 상세(폰)는 창을 닫는다(조직 목록).
    if(!(await organizationDetailDocked(page))){await back(page,width);await expect(page.locator('#wdModal')).toBeHidden();await expect(page.locator('#teamView')).toBeVisible()}
    expect(errors).toEqual([]);
  });
  test(`${width}: 주요 인물 텔레그램 줄(보낸 사람 이름표) → 그 방 그날, 뒤로가기 한 번 → 이 조직 상세`,async({page})=>{
    const {errors}=await fixture(page,width);
    await openOrg(page);
    const row=rowOf(page,'telegram');
    await expect(row).toContainText('예시 간부방');
    await tap(page,row,width);
    await expect(page.locator('#telegramView')).toBeVisible();
    await expect(page.locator('#tgDetail')).toBeVisible();
    await back(page,width);
    await expect(page.locator('#teamView')).toBeVisible();
    await expect(page.locator('#wdModal')).toBeVisible();
    await expect(page.locator('#wdTitle')).toHaveText('합성 나 지부');
    await expect(rowOf(page,'telegram')).toBeInViewport();
    expect(errors).toEqual([]);
  });
}

// ORG-주요인물여백: 주요 인물 칸이 창 폭 안(가로 넘침 0), '요즘'은 줄바꿈, 지난 기록 글은 끝을 …로. 네 탭 모두 같은 왼쪽.
for(const width of [412,720,1280])test(`${width}: 주요 인물 칸 — 가로 넘침 없음, '요즘' 줄바꿈, 지난 기록 …, 칩↔'요즘' 8px`,async({page})=>{
  const {errors}=await fixture(page,width);
  await openOrg(page);
  const m=page.locator('#wdModal');
  const wide=()=>m.evaluate(m=>{const c=m.querySelector('.modal-card');return {card:c.scrollWidth-c.clientWidth,people:m.querySelector('#wdPeople').scrollWidth-m.querySelector('#wdPeople').clientWidth,page:document.documentElement.scrollWidth-innerWidth}});
  expect(await wide()).toEqual({card:0,people:0,page:0});
  const got=await m.evaluate(m=>{
    const host=m.querySelector('#wdPeople'),hr=host.getBoundingClientRect(),t=m.querySelector('.okp-brief-t'),tr=t.getBoundingClientRect(),lh=parseFloat(getComputedStyle(t).lineHeight)||16;
    const chips=m.querySelector('.okp-chips').getBoundingClientRect(),brief=m.querySelector('.okp-brief').getBoundingClientRect();
    const texts=[...m.querySelectorAll('.okp-row .okp-text')];
    return {inside:[...host.querySelectorAll('.okp-row,.okp-brief,.okp-chips')].every(e=>{const r=e.getBoundingClientRect();return r.left>=hr.left-0.5&&r.right<=hr.right+0.5}),
      lines:Math.round(tr.height/lh),gap:Math.round(brief.top-chips.bottom),cut:texts.some(e=>e.scrollWidth>e.clientWidth&&getComputedStyle(e).textOverflow==='ellipsis')};
  });
  expect(got.inside,'칩·요즘·지난 기록 줄이 칸 안').toBe(true);
  expect(got.gap,'칩 줄 ↔ 요즘').toBe(8);
  if(width<761){expect(got.lines,"'요즘' 줄바꿈").toBeGreaterThan(1);expect(got.cut,'긴 지난 기록 글은 …').toBe(true)}
  for(const key of ['basic','aff','recent']){await m.locator(`[data-wd-tab="${key}"]`).click();expect(await wide(),key).toEqual({card:0,people:0,page:0})}
  expect(errors).toEqual([]);
});
