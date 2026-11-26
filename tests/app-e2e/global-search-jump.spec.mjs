import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
// S71-15 SEARCH-띄어쓰기무시·SEARCH-결과원문으로·SEARCH-비슷한말전체검색(명진 11/26 15:34 "야간총회 검색할 때 야간 띄고 총회 이런 식으로 검색해도
// 또는 유사한 의미의 다른 단어를 검색해도 야간 총회가 나왔으면 … 두 번째 결과를 내가 클릭하면은 그 결과에 해당하는 원문으로 가야 되는데 안 가더라고").
// 결정 장부 docs/design/standard-interactions.md SR1~SR3. 폰 390·폴드 펼침 884·PC 1280:
//  ① '야간총회'(붙여 씀)로 '야간 총회'(띄어 쓴) 기록을 찾고 결과 줄에 찾은 곳 칠함. 서버는 흉내(띄어쓰기 무시 규칙은 DB 시험이 본다).
//  ② 조직 기록 결과를 누르면 그 조직의 그 기록 하나로: 접힌 '지난 기록'을 펴고 그 줄이 화면 안에 보이며 찾은 낱말이 칠해짐. 뒤로가기는 검색으로.
//  ③ 결과가 적으면 비슷한 말(서버 AI 찾기 풀이 흉내)로 다시 찾아 합치고 '비슷한 말로도 찾았어요' 한 줄.
// 이름·글은 모두 지어낸 것.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const KINDS=['update','note','work','document','meeting','project','organization','milestone','reading'];
// 조직 기록 12줄: 맨 끝(가장 오래된) 줄이 찾을 기록 → 처음 10줄 밖이라 '지난 기록'에 접혀 있다.
const UPD=Array.from({length:12},(_,i)=>({id:'u'+i,organization_id:'o',raw_text:i===11?'가상 야간 총회 준비 기록 — 참석 인원 확인':'가상 일반 기록 '+i,occurred_at:`2026-10-${String(20-i).padStart(2,'0')}T01:00:00Z`}));
const TIME=[{id:'t1',organization_id:'o',event_year:2026,event_date:'2026-09-03',category:'회의',title:'가상 야간 총회',summary:'가상 정기 모임',occurrence_count:1,sort_order:0}];
const row=(source,id,extra={})=>({kind:'organization',source,id,title:'테스트 조직',matched_in:'body',snippet:'가상 야간 총회 준비 기록',occurred_at:'2026-10-09T01:00:00Z',day:null,state:null,project_id:null,project_name:null,organization_id:'o',organization_name:'테스트 조직',...extra});
const squash=s=>String(s).replace(/\s+/g,'');
// 서버 흉내: 낱말마다 띄어쓰기를 빼고 '야간총회'에 들어 있으면 조직 기록 두 줄(기록·타임라인)을 돌려준다.
async function routeServer(page,calls,{ai=null}={}){
  await page.route(SB+'/rest/v1/rpc/app_search_records',r=>{
    const b=r.request().postDataJSON();calls.push(b);
    const words=String(b.p_query).split(/\s+/).filter(Boolean);
    const hit=words.every(w=>'가상야간총회준비기록'.includes(squash(w)));
    const kinds=b.p_kind?[b.p_kind]:KINDS;
    return r.fulfill({json:{words,groups:kinds.map(kind=>{const items=kind==='organization'&&hit?[row('org_update','u11'),row('org_timeline','t1',{title:'가상 야간 총회',snippet:null,matched_in:'title',occurred_at:'2026-09-03T01:00:00Z'})]:[];return {kind,total:items.length,capped:false,offset:0,items:items.slice(0,b.p_per_kind)}})}});
  });
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_suborganization_updates',r=>r.fulfill({json:UPD}));
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_suborganization_timeline',r=>r.fulfill({json:TIME}));
  if(ai)await page.route(SB+'/functions/v1/ai-assist',r=>{const b=r.request().postDataJSON();if(b?.kind!=='find_expand')return r.fallback();ai.push(b);return r.fulfill({json:{words:['야간총회','집회'],from:'',to:''}})});
}
const found=page=>page.evaluate(()=>{const h=CSS.highlights?.get('kptu-found');return h?[...h].map(r=>r.toString()):[]});
const inView=loc=>loc.evaluate(el=>{const b=el.getBoundingClientRect();return b.top>=0&&b.bottom<=innerHeight&&b.height>0});
async function search(page,width,text){
  if(width>760){const top=page.locator('[data-search-slot] input[type="search"]');await top.click();await top.fill(text);return page.locator('#gsPanel')}
  await page.locator('#appView > .mobile-shell-header .gs-menu-entry').click();
  await page.locator('#gsHeadInput').fill(text);
  return page.locator('#searchView .gs-view-body');
}

for(const [name,width] of [['폰 390',390],['폴드 펼침 884',884],['PC 1280',1280]]){
 test(`${name}: '야간총회'로 띄어 쓴 기록을 찾고, 누르면 그 기록 하나로(접힌 것 펴고·보이고·칠함), 뒤로가기는 검색으로`,async({page})=>{
  await page.setViewportSize({width,height:860});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const calls=[];
  await openHome(page,{beforeLoad:()=>routeServer(page,calls)});
  const box=await search(page,width,'야간총회');
  const rows=box.locator('[data-gs-group="organization"] .gs-row');
  await expect(rows).toHaveCount(2);
  expect(calls.at(-1).p_query).toBe('야간총회');
  // 결과 줄: 글자 그대로는 없지만(띄어 씀) 공용 판정으로 찾은 곳을 칠한다.
  await expect(rows.first().locator('mark')).toHaveText(['야간 총회']);
  // 띄어 써도 같은 결과.
  await (width>760?page.locator('[data-search-slot] input[type="search"]'):page.locator('#gsHeadInput')).fill('야간 총회');
  await expect.poll(()=>calls.at(-1)?.p_query).toBe('야간 총회');
  await expect(rows).toHaveCount(2);
  await rows.first().click();
  // 그 조직의 그 기록: 접힌 '지난 기록'이 펴지고, 줄이 화면 안에 보이며, 펼친 글 안 찾은 낱말이 칠해진다.
  const rec=page.locator('#wdUpdates [data-wd-up="u11"]');
  await expect(rec).toBeVisible();
  await expect(page.locator('#wdUpdates [data-wd-log-older]')).toHaveJSProperty('open',true);
  await expect.poll(()=>inView(rec)).toBe(true);
  await expect.poll(()=>found(page)).toEqual(['야간 총회']);
  expect(await rec.evaluate(el=>[...CSS.highlights.get('kptu-found')].every(r=>el.contains(r.startContainer)))).toBe(true);
  // 뒤로가기: 폰은 검색 화면(같은 검색어), 넓은 화면은 검색을 연 홈(맨 위 칸 글자 그대로 — 결과 창은 칸을 누르면 다시).
  await page.goBack();
  if(width>760){
   await expect(page.locator('#homeView')).toBeVisible();
   await expect(page.locator('[data-search-slot] input[type="search"]')).toHaveValue('야간 총회');
  }else{
   await expect(page.locator('#searchView')).toBeVisible();
   await expect(page.locator('#gsHeadInput')).toHaveValue('야간 총회');
   await expect(page.locator('#searchView .gs-view-body [data-gs-group="organization"] .gs-row')).toHaveCount(2);
  }
  expect(await found(page)).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
 });
}

test('PC 1280: 타임라인 결과를 누르면 접힌 타임라인을 펴고 그 줄을 칠한다',async({page})=>{
  await page.setViewportSize({width:1280,height:860});
  const calls=[];
  await openHome(page,{beforeLoad:()=>routeServer(page,calls)});
  const box=await search(page,1280,'야간총회');
  await box.locator('[data-gs-group="organization"] .gs-row').nth(1).click();
  const t=page.locator('#wdTimeline [data-wd-time="t1"]');
  await expect(page.locator('#wdTime')).toHaveJSProperty('open',true);
  await expect.poll(()=>inView(t)).toBe(true);
  await expect.poll(()=>found(page)).toEqual(['야간 총회']);
});

test('폰 390: 결과가 적으면 비슷한 말로 다시 찾아 합치고 \'비슷한 말로도 찾았어요\' 한 줄',async({page})=>{
  await page.setViewportSize({width:390,height:860});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const calls=[],ai=[];
  await openHome(page,{beforeLoad:()=>routeServer(page,calls,{ai})});
  const box=await search(page,390,'저녁 모임');
  const rows=box.locator('[data-gs-group="organization"] .gs-row');
  await expect(rows).toHaveCount(2);
  await expect(box.locator('[data-gs-also]')).toHaveText('비슷한 말로도 찾았어요: 야간총회 · 집회');
  // AI에는 친 글 하나만 간다.
  expect(ai).toEqual([{kind:'find_expand',text:'저녁 모임'}]);
  // 검색어 + 비슷한 말 둘을 서버에 다시 묻는다(낱말마다 50줄까지).
  expect(calls.filter(c=>c.p_per_kind===50).map(c=>c.p_query).sort()).toEqual(['야간총회','저녁 모임','집회'].sort());
  // 비슷한 말로 찾은 줄도 칠한다.
  await expect(rows.first().locator('mark')).toHaveText(['야간 총회']);
  // 누르면 그 기록으로 가고 비슷한 말 자리를 칠한다.
  await rows.first().click();
  await expect.poll(()=>found(page)).toEqual(['야간 총회']);
  expect(errors).toEqual([]);
});
