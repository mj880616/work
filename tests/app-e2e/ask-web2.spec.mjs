import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
// FEAT-1029묶음 ① Web2에 물어보기(docs/design/ask-web2.md 1절): 검색칸에 문장 → 결과 맨 위 [Web2에 물어보기 ↵] → 답 상자(줄마다 근거 꼬리표),
// 근거를 누르면 원본, 근거 n건 접기, 최근 물어본 것(저장된 답을 AI 없이 다시), Edge 배포 전이면 '준비 중' 한 줄. 서버는 시험 응답, 이름은 합성 값.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const ID=n=>`c0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const Q='가상 사업장 교섭 쟁점 뭐였지?';
const SOURCES=[
  {ref:'s1',kind:'update',source:'note',id:ID(1),date:'2026-10-05',day:null,title:'교섭 결과 정리',sent:true,tag:null,snippet:'3차 교섭 성과급 기준 쟁점'},
  {ref:'s2',kind:'call',source:'call',id:ID(2),date:'2026-10-04',day:'2026-10-04',title:'가상 사업장 통화',sent:true,tag:null,snippet:'성과급 개인 평가 연동 거부'},
  // 명진 결정 변경(10/29): 원장 교섭·전략(S2)도 AI에 보낸다(sent:true). 근거 목록의 '교섭·전략' 꼬리표는 그대로.
  {ref:'s3',kind:'ledger',source:'ledger',id:ID(3),date:'2026-10-03',day:null,title:'교섭 전략 회의',sent:true,tag:'교섭·전략',snippet:'양보선 검토'},
];
const ANSWER={ok:true,kind:'ask_web2',status:'ok',question:Q,words:['가상','사업장','교섭','쟁점'],id:ID(90),created_at:'2026-10-06T00:12:00Z',
  lines:[{text:'3차 교섭에서 성과급 기준이 쟁점임.',refs:['s1']},{text:'회사 안(개인 평가 연동)은 거부함.',refs:['s1','s2']}],sources:SOURCES};
const emptyGroups=body=>({words:String(body.p_query).split(/\s+/),groups:['update','note','work','document','meeting','project','organization','milestone'].map(kind=>({kind,total:0,capped:false,offset:0,items:[]}))});
async function routes(page,{asks,recent=[],aiStatus=200,aiBody=ANSWER,searchHold=null}){
  await page.route(SB+'/rest/v1/rpc/app_search_records',async route=>{
    const body=route.request().postDataJSON();
    if(searchHold)await searchHold(body);
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(emptyGroups(body))});
  });
  await page.route(SB+'/rest/v1/app_ask_answers**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(recent)}));
  await page.route(SB+'/functions/v1/ai-assist',route=>{
    if(route.request().method()!=='POST')return route.fallback();
    const body=route.request().postDataJSON();if(body.kind!=='ask_web2')return route.fallback();
    asks.push(body);
    return route.fulfill({status:aiStatus,contentType:'application/json',body:JSON.stringify(aiBody)});
  });
}
const noSideScroll=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1);

test('PC 1440: a question shows the ask line first; Enter asks once; lines carry evidence tags; tag opens the original; S2 keeps its tag',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const asks=[];
  await openHome(page,{beforeLoad:()=>routes(page,{asks})});
  const top=page.locator('[data-search-slot] input[type="search"]'),panel=page.locator('#gsPanel');
  await top.click();await top.fill('교섭');
  await expect(panel.locator('.gs-ask-line')).toHaveCount(0);
  await top.fill(Q);
  await expect(panel.locator('.gs-ask-line')).toContainText('Web2에 물어보기');
  expect(asks.length).toBe(0); // 글자를 칠 때 AI를 부르지 않음
  await top.press('Enter');
  const box=panel.locator('.gs-ask-box');
  await expect(box.locator('.gs-ask-text')).toHaveCount(2);
  expect(asks).toEqual([{kind:'ask_web2',question:Q}]);
  await expect(box.locator('.gs-ask-text').first()).toContainText('3차 교섭에서 성과급 기준이 쟁점임.');
  await expect(box.locator('.gs-ask-text').nth(1).locator('.gs-ask-tag')).toHaveText(['업데이트 10/5','통화 10/4']);
  await expect(box.locator('.gs-ask-src summary')).toHaveText('근거 3건 — 업데이트 1 · 통화 1 · 원장 1');
  await expect(box.locator('.gs-ask-foot')).toHaveText('AI가 찾은 기록을 요약한 것임. 원본을 눌러 확인할 것.');
  await box.locator('.gs-ask-src summary').click();
  await expect(box.locator('.gs-ask-src')).toHaveAttribute('open','');
  await expect(box.locator('.gs-ask-src-row').nth(2)).toContainText('교섭·전략');
  await expect(box.locator('.gs-ask-src-row').nth(2)).toContainText('양보선 검토');
  // 답 상자는 결과 창 안. 창 높이를 넘으면 창 안에서 스크롤.
  await box.locator('.gs-ask-tag').first().click();
  await expect(page.locator('#basketView')).toBeVisible();
  expect(errors).toEqual([]);
});

test('PC 1440: before the Edge step the ask shows one "준비 중" line; results below stay',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  const asks=[];
  await openHome(page,{beforeLoad:()=>routes(page,{asks,aiStatus:400,aiBody:{ok:false,error:'unsupported_kind',message:'x'}})});
  const top=page.locator('[data-search-slot] input[type="search"]'),panel=page.locator('#gsPanel');
  await top.click();await top.fill(Q);
  await panel.locator('.gs-ask-line').click();
  await expect(panel.locator('.gs-ask-status')).toHaveText('물어보기는 준비 중임.');
  await expect(panel.locator('.gs-ask-again')).toBeVisible();
  await expect(panel.locator('.gs-status')).toHaveText('찾은 기록이 없어요.');
});

for(const width of [412,884]){
  test(`Phone ${width}: full-screen search asks, no side scroll, recent asks reopen the saved answer without AI, back closes search`,async({page})=>{
    await page.setViewportSize({width,height:900});
    const asks=[];
    await openHome(page,{beforeLoad:()=>routes(page,{asks,recent:[{...ANSWER,ai_status:'ok',status:undefined}]})});
    // 폰(412)은 메뉴 창 맨 위 검색칸이 입구. 884(접은 폴드 펼침 폭)는 같은 전체 화면 검색을 화면 이동으로 연다.
    if(await page.locator('#mobileMenuTab').isVisible()){await page.locator('#mobileMenuTab').click();await page.locator('#mobileMenu .gs-menu-entry').click();}
    else await page.evaluate(async()=>{await window.KPTUViewLoader.load('search');window.KPTURouter.go('search',{source:'delegated'});});
    const view=page.locator('#searchView'),input=view.locator('.gs-view-input input');
    await expect(view).toBeVisible();
    // 빈 검색칸: 최근 물어본 것 1줄.
    await expect(view.locator('.gs-recent .gs-row')).toHaveText(['10/6 '+Q]);
    await view.locator('.gs-recent .gs-row').click();
    await expect(view.locator('.gs-ask-box .gs-ask-text')).toHaveCount(2);
    expect(asks.length).toBe(0);
    await expect(input).toHaveValue(Q);
    // 다시 묻기는 AI를 한 번 부른다.
    await view.locator('.gs-ask-again').click();
    await expect.poll(()=>asks.length).toBe(1);
    await expect(view.locator('.gs-ask-box .gs-ask-text')).toHaveCount(2);
    expect(await noSideScroll(page)).toBe(true);
    // 근거 줄(통화) 누르기 → 통화 화면, 뒤로 가기 → 검색 화면.
    await view.locator('.gs-ask-src summary').click();
    await expect(view.locator('.gs-ask-src')).toHaveAttribute('open','');
    await view.locator('.gs-ask-src-row').nth(1).click();
    await expect(page.locator('#callsView')).toBeVisible();
    await page.goBack();
    await expect(view).toBeVisible();
    await view.locator('.gs-back').click();
    await expect(page.locator('#homeView')).toBeVisible();
  });
}

// QA-E2E간헐1029-2: 검색 결과(또는 할 일·일정)가 늦게 와서 화면을 다시 그려도, 펼친 '근거 n건'은 펼친 채로 남고 근거 줄을 누를 수 있다.
// 결과 창 전체를 다시 그리는 구조라 펼침 여부를 화면 상태(state.ask)가 들고 있어야 한다. 늦은 응답을 일부러 붙잡았다가 근거를 편 뒤에 놓아 준다.
test('Phone 884: a late search repaint keeps the opened evidence list open and its rows clickable',async({page})=>{
  await page.setViewportSize({width:884,height:900});
  const asks=[];let release;const held=new Promise(r=>{release=r;});let heldCount=0;
  await openHome(page,{beforeLoad:()=>routes(page,{asks,recent:[{...ANSWER,ai_status:'ok',status:undefined}],searchHold:async body=>{if(body.p_query===Q){heldCount++;await held;}}})});
  await page.evaluate(async()=>{await window.KPTUViewLoader.load('search');window.KPTURouter.go('search',{source:'delegated'});});
  const view=page.locator('#searchView');
  await view.locator('.gs-recent .gs-row').click();
  await expect(view.locator('.gs-ask-box .gs-ask-text')).toHaveCount(2);
  await expect.poll(()=>heldCount).toBe(1); // 검색 요청은 나갔고 답은 아직 안 옴
  await view.locator('.gs-ask-src summary').click();
  await expect(view.locator('.gs-ask-src')).toHaveAttribute('open','');
  release();
  await expect(view.locator('.gs-status')).toHaveText('찾은 기록이 없어요.'); // 늦은 응답으로 다시 그림
  await expect(view.locator('.gs-ask-src')).toHaveAttribute('open','');
  await view.locator('.gs-ask-src-row').nth(1).click();
  await expect(page.locator('#callsView')).toBeVisible();
  expect(asks.length).toBe(0);
});
