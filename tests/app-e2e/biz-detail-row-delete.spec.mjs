import {test,expect} from '@playwright/test';
import {appOrigin} from './helpers/test-origin.mjs';
import {answerAsk} from './helpers/small-notice.mjs';
// ORG-빠진일2차 3번(S59-3, 명진 결정 11/11 14:55 '가'): 사업 보고 상세 창(app/biz-detail-window.js)의 줄 ⋯.
//  · 사업 기록(한 줄 글) 줄 ⋯ 맨 아래에만 빨간 [삭제] — 한 번 묻고(아니오면 요청 없음), 예면 그 작업공간의 그 기록 한 행 DELETE(기존 owner RLS), 보이는 줄·뺀 줄 모두.
//  · 사업 보고 줄 ⋯에는 [삭제]가 없고 [보고 열기](예전 [기록 열기] 자리)만 있다 — 보고 삭제는 보고 창에서.
// 부품 하나(createBizDetailBox)를 실제 앱 CSS가 걸린 빈 쪽에 붙여 시험한다(서버 응답은 가짜, 이름·글은 모두 합성). 사진: BIZ_ROW_SHOTS 폴더가 있으면 남긴다.
const SHOTS=process.env.BIZ_ROW_SHOTS||'';
const W='2026-11-16';
const CSS=['theme-tokens','base-ui','desktop-ui','ui-standard','journal','weekly-org-lines','biz-summary'];
async function mount(page,width,{deleteEmpty=false}={}){
 await page.setViewportSize({width,height:900});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const blank=`${appOrigin}/__biz-detail-blank__.html`;
 await page.route(blank,route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${CSS.map(n=>`<link rel="stylesheet" href="/app/${n}.css">`).join('')}</head><body><main id="appView" class="view-panel kptu-ui-ready"><section class="biz-detail-test" style="padding:12px"><h2 style="font-size:15px;margin:0 0 8px">주요 사업·회의결과</h2><div id="mount"></div></section></main></body></html>`}));
 await page.goto(blank);
 await page.evaluate(async ({week,deleteEmpty})=>{
  const db={marks:[{id:'mk1',week_start:week,section:'biz_detail',ref_kind:'biz_record',ref_key:'r2',report_body:null,choice:'out',detail:null,updated_at:'2026-11-17T01:00:00Z'}],
   records:[{id:'r1',space_id:'sp1',day:'2026-11-17',end_day:null,body:'합성 사업 기록 하나',source_kind:'user',source_id:null,created_at:'2026-11-17T01:00:00Z'},
    {id:'r2',space_id:'sp1',day:'2026-11-18',end_day:null,body:'합성 사업 기록 둘',source_kind:'user',source_id:null,created_at:'2026-11-18T01:00:00Z'},
    {id:'r3',space_id:'sp1',day:'2026-11-19',end_day:null,body:'합성 사업 기록 셋',source_kind:'user',source_id:null,created_at:'2026-11-19T01:00:00Z'}],
   meetings:[{id:'m1',title:'합성 사업 보고',series_name:'합성 사업 보고',meeting_at:'2026-11-20T01:00:00Z',business_area_id:'sp1',activity_kind:'meeting',transcript_text:'합성 결과 첫째\n합성 결과 둘째'}],
   deletes:[],markWrites:[],events:[]};
  window.__bizDb=db;
  window.addEventListener('kptu:business-now-changed',e=>db.events.push(e.detail));
  const rt={context:{read:()=>({workspace:{id:'w'},user:{id:'u'}})},api:async(path,opts={})=>{
   const m=(opts.method||'GET').toUpperCase(),url=new URL(path,location.origin),id=(url.searchParams.get('id')||'').replace(/^eq\./,'');
   if(url.pathname.endsWith('/app_business_records')){
    if(m==='GET')return db.records;
    if(m==='DELETE'){db.deletes.push({id,workspace:url.searchParams.get('workspace_id'),select:url.searchParams.get('select'),prefer:opts.prefer||''});
     if(deleteEmpty)return [];
     const hit=db.records.filter(r=>r.id===id);db.records=db.records.filter(r=>r.id!==id);return hit.map(r=>({id:r.id}))}
    return [];
   }
   if(url.pathname.endsWith('/app_report_line_marks')){
    if(m==='GET')return db.marks;
    db.markWrites.push({m,id});return [];
   }
   return [];
  }};
  const mod=await import('/app/biz-detail-window.js');
  const box=mod.createBizDetailBox({rt,kinds:false});
  document.querySelector('#mount').append(box.el);
  await box.update({week,meetings:()=>db.meetings,hidden:null,tree:()=>[{project:{id:'sp1',name:'합성 사업 가'},depth:0}]});
 },{week:W,deleteEmpty});
 await expect(page.locator('[data-bd-group]')).toHaveCount(1);
 return errors;
}
const line=(page,text)=>page.locator('.bd-line',{hasText:text});
const menuTexts=row=>row.locator('.row-more-menu button').allTextContents();
const noWide=page=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1);
const db=page=>page.evaluate(()=>({deletes:window.__bizDb.deletes,markWrites:window.__bizDb.markWrites,events:window.__bizDb.events,records:window.__bizDb.records.map(r=>r.id)}));

for(const width of [412,1280])test(`사업 보고 상세 창 줄 ⋯ ${width}px: 사업 기록 줄은 맨 아래 빨간 [삭제], 사업 보고 줄은 [보고 열기]만(삭제 없음)`,async({page})=>{
 const errors=await mount(page,width);
 const rec=line(page,'합성 사업 기록 하나'),rep=line(page,'합성 사업 보고');
 await expect(rec).toHaveCount(1);await expect(rep).toHaveCount(1);
 // 줄마다 ⋯ 하나(두 벌 아님), 큰 단추 없음.
 await expect(rec.locator('> .row-more')).toHaveCount(1);
 await expect(rep.locator('> .row-more')).toHaveCount(1);
 await rep.locator('summary').click();
 if(SHOTS)await page.screenshot({path:`${SHOTS}/biz-row-menu-report-${width}.png`});
 const repMenu=await menuTexts(rep);
 expect(repMenu).toContain('보고 열기');
 expect(repMenu).not.toContain('기록 열기');
 expect(repMenu).not.toContain('삭제');
 expect(repMenu).toContain('이번 보고에서 빼기'); // 보고에서 빼는 일은 그대로
 await page.keyboard.press('Escape');
 await rec.locator('summary').click();
 const recMenu=await menuTexts(rec);
 expect(recMenu.at(-1)).toBe('삭제');
 expect(recMenu).toContain('기록 열기');
 expect(recMenu).not.toContain('보고 열기');
 await expect(rec.locator('.row-more-menu button',{hasText:'삭제'})).toHaveClass(/row-more-danger/);
 if(SHOTS)await page.screenshot({path:`${SHOTS}/biz-row-menu-record-${width}.png`});
 expect(await noWide(page)).toBe(true);
 expect(errors).toEqual([]);
});

for(const width of [412,1280])test(`사업 기록 줄 ⋯ [삭제] ${width}px: 한 번 묻고(아니오면 요청 없음), 예면 그 기록 한 행 DELETE, 사업 보고 줄·다른 기록은 그대로`,async({page})=>{
 const errors=await mount(page,width);
 const rec=line(page,'합성 사업 기록 하나');
 await rec.locator('summary').click();
 await rec.locator('.row-more').getByText('삭제',{exact:true}).click();
 await page.locator('.kptu-ask').waitFor({state:'visible'});
 if(SHOTS)await page.screenshot({path:`${SHOTS}/biz-row-delete-ask-${width}.png`});
 expect(await answerAsk(page,false)).toBe('이 사업 기록을 삭제할까요?');
 expect((await db(page)).deletes).toEqual([]);
 await expect(rec).toHaveCount(1);
 // 예 → DELETE 한 번(그 작업공간 id·select·돌려받기), 줄이 사라지고 알림, 같은 탭 알림(다른 화면이 다시 읽음).
 await rec.locator('summary').click();
 await rec.locator('.row-more').getByText('삭제',{exact:true}).click();
 await answerAsk(page,true);
 await expect(page.locator('[data-bd-status]')).toHaveText('사업 기록을 삭제했어요.');
 const after=await db(page);
 expect(after.deletes).toHaveLength(1);
 expect(after.deletes[0]).toMatchObject({id:'r1',workspace:'eq.w',select:'id'});
 expect(after.deletes[0].prefer).toContain('return=representation');
 expect(after.records).toEqual(['r2','r3']);
 expect(after.markWrites).toEqual([]); // 보고용 표시는 건드리지 않는다
 expect(after.events.some(e=>e?.records)).toBe(true);
 await expect(line(page,'합성 사업 기록 하나')).toHaveCount(0);
 await expect(line(page,'합성 사업 기록 셋')).toHaveCount(1);
 await expect(line(page,'합성 사업 보고')).toHaveCount(1);
 // 초점은 그 사업의 [+ 쓰기]로(줄이 없어졌으니).
 await expect(page.locator('[data-bd-add="sp1"]')).toBeFocused();
 if(SHOTS)await page.screenshot({path:`${SHOTS}/biz-row-deleted-${width}.png`});
 expect(await noWide(page)).toBe(true);
 expect(errors).toEqual([]);
});

test('뺀 줄(이번 보고에서 뺀 사업 기록)도 ⋯ 맨 아래 [삭제] — 뺀 줄 접힘을 열어도 같은 길',async({page})=>{
 const errors=await mount(page,1280);
 await page.locator('[data-bd-fold]').click();
 const out=page.locator('.rw-fold .bd-line',{hasText:'합성 사업 기록 둘'});
 await expect(out).toHaveCount(1);
 await out.locator('summary').click();
 const texts=await menuTexts(out);
 expect(texts[0]).toBe('되돌리기');
 expect(texts.at(-1)).toBe('삭제');
 await out.locator('.row-more').getByText('삭제',{exact:true}).click();
 await answerAsk(page,true);
 await expect(page.locator('[data-bd-status]')).toHaveText('사업 기록을 삭제했어요.');
 expect((await db(page)).deletes.map(d=>d.id)).toEqual(['r2']);
 await expect(page.locator('.rw-fold .bd-line',{hasText:'합성 사업 기록 둘'})).toHaveCount(0);
 expect(errors).toEqual([]);
});

test('삭제가 서버에서 거절되면(돌려받은 줄 없음) 줄을 지우지 않고 다시 눌러 달라고 알린다',async({page})=>{
 const errors=await mount(page,412,{deleteEmpty:true});
 const rec=line(page,'합성 사업 기록 하나');
 await rec.locator('summary').click();
 await rec.locator('.row-more').getByText('삭제',{exact:true}).click();
 await answerAsk(page,true);
 await expect(page.locator('[data-bd-status]')).toHaveText('사업 기록을 삭제하지 못했어요. 다시 눌러 주세요.');
 await expect(page.locator('[data-bd-status]')).toHaveClass(/is-error/);
 await expect(rec).toHaveCount(1);
 expect(errors).toEqual([]);
});
