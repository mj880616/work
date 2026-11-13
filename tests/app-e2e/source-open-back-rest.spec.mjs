// S56-14 NAV-원문열기나머지(FORGET-원문열기·뒤로가기 ③ 이어서): 다른 화면에서 연 상세도 뒤로가기 한 번이면 원래 화면·같은 자리.
// 도착 화면이 자료를 읽은 뒤에야 여는 상세(업데이트 겹·조직 창)도 라우터 openFrom의 기록 칸 하나를 같이 쓴다.
// 폰 = 안드로이드 앱과 같은 KPTURouter.back(), PC = 브라우저 뒤로. 서버는 모두 흉내이고 이름·글은 지어낸 것이다.
import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const json=(r,body)=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
const back=(page,width)=>width<761?page.evaluate(()=>window.KPTURouter.back()):page.goBack();
const index=page=>page.evaluate(()=>navigation.currentEntry.index);
const tap=(page,locator,width)=>width<761?locator.tap():locator.click();

// ---------- 연락 없는 조직(홈) → 조직 상세 ----------
const ORGS=[['o1','가지부'],['o2','나지부']];
async function quietRoutes(page){
  await page.route(SB+'/rest/v1/app_suborganizations?**',r=>json(r,ORGS.map(([id,name])=>({id,workspace_id:'w',name,active:true}))));
  await page.route(SB+'/rest/v1/app_suborganization_assignees?**',r=>json(r,ORGS.map(([id])=>({organization_id:id,user_id:'home-test'}))));
  await page.route(SB+'/rest/v1/app_org_key_people?**',r=>json(r,ORGS.map(([id],i)=>({id:'k'+i,workspace_id:'w',organization_id:id,name:'가상인물'+i,match_names:['가상인물'+i],sort_order:i}))));
  await page.route(SB+'/rest/v1/app_tg_senders?**',r=>json(r,[]));
  await page.route(SB+'/rest/v1/app_tg_day_senders?**',r=>json(r,[]));
  await page.route(SB+'/rest/v1/app_feed_items?**',r=>json(r,[]));
}
for(const width of [412,1280]){
  test(`${width}: 홈 '연락 없는 조직' 이름 → 조직 상세, 뒤로가기 한 번 → 홈 같은 자리`,async({page})=>{
    await page.setViewportSize({width,height:700});
    await openHome(page,{beforeLoad:()=>quietRoutes(page),quickRest:true}); // 폰 빠른 입력은 처음 모습(한 줄로 접힘) 그대로 — 이 시험은 스크롤 자리만 본다
    const name=page.locator('#homeView [data-home-quiet] .oq-text [data-oq-org="o1"]');
    await expect(name).toBeVisible();
    await name.scrollIntoViewIfNeeded();
    const y=await page.evaluate(()=>Math.round(scrollY)),at=await index(page);
    await tap(page,name,width);
    await expect.poll(()=>page.evaluate(()=>window.KPTURouter.current)).toBe('team');
    await expect(page.locator('#wdModal')).toBeVisible();
    await expect(page.locator('#wdTitle')).toHaveText('가지부');
    // 화면 이동과 조직 창이 기록 칸 하나.
    expect(await index(page)).toBe(at+1);
    await back(page,width);
    await expect(page.locator('#homeView')).toBeVisible();
    await expect(page.locator('#wdModal')).toBeHidden();
    expect(await index(page)).toBe(at);
    await expect.poll(()=>page.evaluate(()=>Math.round(scrollY))).toBe(y);
    await expect(name).toBeInViewport();
  });
}

// ---------- 전체 검색 → 업데이트(자료를 읽은 뒤 상세를 여는 길) ----------
const NOTE='10000000-0000-4000-8000-000000000005',stamp='2026-10-05T01:00:00.000000+00:00';
const hit={kind:'update',source:'note',id:NOTE,title:'가상 교섭 메모',matched_in:'title',snippet:null,occurred_at:stamp,day:null,state:null,project_id:null,project_name:null,organization_id:null,organization_name:null};
async function searchRoutes(page){
  await page.route(SB+'/rest/v1/rpc/app_search_records',r=>{
    const body=r.request().postDataJSON();
    return json(r,{words:[body.p_query],groups:[{kind:'update',total:1,capped:false,offset:0,items:[hit]}]});
  });
  // 상세를 늦게 읽게 해서(도착 화면이 openFrom이 끝난 뒤 상세를 여는 길) 그 경우도 같은 칸인지 본다.
  await page.route(SB+'/rest/v1/app_notes?**',async r=>{
    await new Promise(resolve=>setTimeout(resolve,300));
    const q=new URL(r.request().url()).searchParams;
    if(q.get('metadata'))return json(r,[]);
    return json(r,Number(q.get('offset')||0)?[]:[{id:NOTE,workspace_id:'w',occurred_at:stamp,updated_at:stamp,raw_text:'가상 교섭 메모\n가상 본문',ai_export_allowed:true,archived_at:null,attachments:[],metadata:{}}]);
  });
  await page.route(SB+'/rest/v1/app_record_links?**',r=>json(r,[]));
}
for(const width of [412,1280]){
  test(`${width}: 전체 검색 결과(업데이트) → 업데이트 상세, 뒤로가기 한 번 → 검색 결과`,async({page})=>{
    await page.setViewportSize({width,height:800});
    await openHome(page,{beforeLoad:()=>searchRoutes(page)});
    let input,row;
    if(width<761){
      await page.locator('#mobileMenuTab').click();
      await page.locator('#mobileMenu .gs-menu-entry').click();
      input=page.locator('#searchView .gs-view-input input');
      row=page.locator('#searchView .gs-row').filter({hasText:'가상 교섭 메모'});
    }else{
      input=page.locator('[data-search-slot] input[type="search"]');
      await input.click();
      row=page.locator('#gsPanel .gs-row').filter({hasText:'가상 교섭 메모'});
    }
    await input.fill('교섭');
    await expect(row).toBeVisible();
    const at=await index(page);
    await tap(page,row,width);
    await expect(page.locator('#basketView')).toBeVisible();
    await expect(page.locator('[data-basket-read-text]')).toBeVisible();
    await back(page,width);
    await expect(page.locator('#basketView')).toBeHidden();
    if(width<761){
      // 폰: 검색 화면 그대로(같은 낱말·같은 결과), 기록 칸도 누르기 전 그 칸.
      await expect(page.locator('#searchView')).toBeVisible();
      await expect(input).toHaveValue('교섭');
      await expect(row).toBeVisible();
      expect(await index(page)).toBe(at);
    }else{
      // PC: 결과 창은 원본을 열 때 닫히고, 뒤로가기 한 번이면 검색을 연 화면(홈).
      await expect(page.locator('#homeView')).toBeVisible();
      expect(await index(page)).toBe(at-1);
    }
  });
}

test('412: 다른 화면에서 연 조직 창의 ×도 한 번에 원래 화면으로',async({page})=>{
  await page.setViewportSize({width:412,height:700});
  await openHome(page,{beforeLoad:()=>quietRoutes(page),quickRest:true}); // 폰 빠른 입력은 처음 모습(한 줄로 접힘) 그대로 — 이 시험은 스크롤 자리만 본다
  const name=page.locator('#homeView [data-home-quiet] .oq-text [data-oq-org="o2"]');
  await expect(name).toBeVisible();
  const at=await index(page);
  await name.tap();
  await expect(page.locator('#wdModal')).toBeVisible();
  await page.locator('#wdModal [data-wd-close="wdModal"]').tap();
  await expect(page.locator('#homeView')).toBeVisible();
  await expect(page.locator('#wdModal')).toBeHidden();
  await expect.poll(()=>index(page)).toBe(at);
});

// ---------- 지킴: 도착 화면에서 사람이 먼저 누른 뒤 열린 겹은 그 칸을 가져가지 않는다 ----------
test('412: openFrom 뒤 사람이 먼저 누르면, 그다음 열린 겹은 제 칸을 따로 쓴다',async({page})=>{
  await page.setViewportSize({width:412,height:800});
  await openHome(page);
  const at=await index(page);
  await page.evaluate(()=>window.KPTURouter.openFrom('basket'));
  await expect(page.locator('#basketView')).toBeVisible();
  expect(await index(page)).toBe(at+1);
  await page.locator('#basketView').dispatchEvent('pointerdown');
  await page.evaluate(()=>{window.__s56Layer=window.KPTURouter.layer.open('s56-test',{close:()=>true})});
  expect(await index(page)).toBe(at+2);
  await page.evaluate(()=>window.KPTURouter.back());
  await expect.poll(()=>index(page)).toBe(at+1);
  await expect(page.locator('#basketView')).toBeVisible();
});
