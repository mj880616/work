import {test,expect} from '@playwright/test';
import {appOrigin} from './helpers/test-origin.mjs';
// ORG-뺀줄지난줄메뉴 4번(요청함 11/10 23:51): 사업 보고 상세 창(app/biz-detail-window.js, 홈 [주간 정리] 2. 2)·사업 보고 '이번 주 주간보고' 2))의 뺀 줄도
// 큰 [되돌리기] 단추 대신 보이는 줄과 같은 작은 ⋯ 하나. 메뉴 맨 위 [되돌리기], 그 아래 [보고용으로 수정]·[기록 열기](이미 보고에 없는 줄이라 [이번 보고에서 빼기]는 없음).
// 부품 하나(createBizDetailBox)를 실제 앱 CSS가 걸린 빈 쪽에 붙여 시험한다(서버 응답은 가짜, 이름·글은 모두 합성). 사진: BIZ_ROW_SHOTS 폴더가 있으면 남긴다.
const SHOTS=process.env.BIZ_ROW_SHOTS||'';
const W='2026-11-16';
const CSS=['theme-tokens','base-ui','desktop-ui','ui-standard','journal','weekly-org-lines','biz-summary'];
async function mount(page,width){
 await page.setViewportSize({width,height:900});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const blank=`${appOrigin}/__biz-detail-blank__.html`;
 await page.route(blank,route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${CSS.map(n=>`<link rel="stylesheet" href="/app/${n}.css">`).join('')}</head><body><main id="appView" class="view-panel kptu-ui-ready"><section class="biz-detail-test" style="padding:12px"><h2 style="font-size:15px;margin:0 0 8px">주요 사업·회의결과</h2><div id="mount"></div></section></main></body></html>`}));
 await page.goto(blank);
 await page.evaluate(async week=>{
  const db={marks:[{id:'mk1',week_start:week,section:'biz_detail',ref_kind:'biz_record',ref_key:'r2',report_body:null,choice:'out',detail:null,updated_at:'2026-11-17T01:00:00Z'}],
   records:[{id:'r1',space_id:'sp1',day:'2026-11-17',end_day:null,body:'합성 사업 기록 하나',source_kind:'user',source_id:null,created_at:'2026-11-17T01:00:00Z'},
    {id:'r2',space_id:'sp1',day:'2026-11-18',end_day:null,body:'합성 사업 기록 둘',source_kind:'user',source_id:null,created_at:'2026-11-18T01:00:00Z'},
    {id:'r3',space_id:'sp1',day:'2026-11-19',end_day:null,body:'합성 사업 기록 셋',source_kind:'user',source_id:null,created_at:'2026-11-19T01:00:00Z'}],writes:[]};
  window.__bizDb=db;
  const rt={context:{read:()=>({workspace:{id:'w'},user:{id:'u'}})},api:async(path,opts={})=>{
   const m=(opts.method||'GET').toUpperCase(),url=new URL(path,location.origin),id=(url.searchParams.get('id')||'').replace(/^eq\./,'');
   if(url.pathname.endsWith('/app_business_records'))return m==='GET'?db.records:[];
   if(url.pathname.endsWith('/app_report_line_marks')){
    if(m==='GET')return db.marks;
    if(m==='POST'){const row={id:'mk'+(db.marks.length+1),report_body:null,choice:null,detail:null,updated_at:'2026-11-17T02:00:00Z',...opts.body};db.writes.push({m,...opts.body});db.marks.push(row);return [row]}
    if(m==='PATCH'){db.writes.push({m,id,...opts.body});const hit=db.marks.filter(r=>r.id===id);hit.forEach(r=>Object.assign(r,opts.body));return hit}
    if(m==='DELETE'){db.writes.push({m,id});db.marks=db.marks.filter(r=>r.id!==id);return []}
   }
   return [];
  }};
  const mod=await import('/app/biz-detail-window.js');
  const box=mod.createBizDetailBox({rt,kinds:false});
  document.querySelector('#mount').append(box.el);
  await box.update({week,meetings:()=>[],hidden:null,tree:()=>[{project:{id:'sp1',name:'합성 사업 가'},depth:0}]});
 },W);
 await expect(page.locator('[data-bd-group]')).toHaveCount(1);
 return errors;
}
const menuTexts=line=>line.locator('.row-more-menu button').allTextContents();
const noWide=page=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1);
for(const width of [412,1280])test(`사업 보고 상세 창 뺀 줄 ${width}px: 큰 단추 없이 ⋯ 하나, 맨 위 [되돌리기], 누르면 보이는 줄로`,async({page},info)=>{
 const errors=await mount(page,width);
 const shown=page.locator('.bd-group > .bd-line');
 await expect(shown).toHaveCount(2);
 const outBtn=page.locator('[data-bd-fold]');
 await expect(outBtn).toContainText('뺀 줄 1');
 await outBtn.click();
 const out=page.locator('.rw-fold .bd-line');
 await expect(out).toHaveCount(1);
 await expect(out).toContainText('합성 사업 기록 둘');
 await expect(page.locator('.rw-fold .wl-btns')).toHaveCount(0);
 await expect(out.locator('> .row-more')).toHaveCount(1);
 if(SHOTS)await page.screenshot({path:`${SHOTS}/biz-row-more-${width}.png`});
 await page.screenshot({path:info.outputPath(`biz-row-more-${width}.png`)});
 const base=(await menuTexts(shown.first())).filter(t=>t!=='이번 보고에서 빼기'&&t!=='한 줄만'&&t!=='상세 포함');
 await out.locator('summary').click();
 expect(await menuTexts(out)).toEqual(['되돌리기',...base]);
 expect(await menuTexts(out)).not.toContain('이번 보고에서 빼기');
 if(SHOTS)await page.screenshot({path:`${SHOTS}/biz-row-more-menu-${width}.png`});
 expect(await noWide(page)).toBe(true);
 // [되돌리기] = 예전 단추와 같은 길(그 주 표시 지우기 한 번) → 보이는 줄 3개, 뺀 줄 단추 없음.
 await out.locator('.row-more').getByText('되돌리기',{exact:true}).click();
 await expect(page.locator('[data-bd-status]')).toHaveText('보고에 다시 넣었어요.');
 expect(await page.evaluate(()=>window.__bizDb.writes)).toEqual([{m:'DELETE',id:'mk1'}]);
 await expect(page.locator('.bd-group > .bd-line')).toHaveCount(3);
 await expect(page.locator('[data-bd-fold]')).toHaveCount(0);
 expect(errors).toEqual([]);
});
test('사업 보고 상세 창 뺀 줄 ⋯ [보고용으로 수정]: 뺀 줄 그대로 두고 보고용 글만 저장(그 주 표시 한 행 수정)',async({page})=>{
 const errors=await mount(page,1280);
 await page.locator('[data-bd-fold]').click();
 const out=page.locator('.rw-fold .bd-line');
 await out.locator('summary').click();
 await out.locator('.row-more').getByText('보고용으로 수정',{exact:true}).click();
 const body=page.locator('[data-bd-field="body"]');
 await expect(body).toBeFocused();
 await body.fill('합성 사업 기록 둘(보고용)');await body.press('Enter');
 await expect(page.locator('[data-bd-status]')).toHaveText('저장했어요.');
 expect(await page.evaluate(()=>window.__bizDb.writes)).toEqual([{m:'PATCH',id:'mk1',report_body:'합성 사업 기록 둘(보고용)',choice:'out',detail:null}]);
 await expect(page.locator('[data-bd-fold]')).toContainText('뺀 줄 1');
 expect(errors).toEqual([]);
});
