import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
// EDIT-번호모양보존: 담당조직 기록에 손으로 쓴 "1) 2)"·"(1)"·①·가.와 들여쓰기·빈 줄이 접힌 줄에서도, [더보기]로 펼친 글에서도 쓴 그대로 보인다
// ("1."로 바뀌거나 들여쓰기·빈 줄이 사라지지 않는다). 서식(doc)이 있는 기록은 저장된 번호 모양(1) 등)을 그대로 그린다. 이름은 모두 합성 값이다.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',stamp='2026-09-15T01:00:00Z',owner='home-test';
const org={id:'oa',workspace_id:'w',name:'합성 가 지부',active:true,created_by:owner,updated_at:stamp};
const WRITTEN=[
 '2. 노조 주요 요구안',
 '  1) 임금교섭',
 '  2) 보충교섭',
 '',
 '',
 '3. 경과',
 '  (1) 본교섭',
 '    ① 사측 제시안',
 '    ② 노조 요구안',
 '  가. 별도 안건',
].join('\n');
const item=text=>({type:'list_item',content:[{type:'paragraph',content:[{type:'text',text}]}]});
const DOC={v:'ed1',doc:{type:'doc',content:[{type:'ordered_list',attrs:{order:1,marker:'paren'},content:[item('임금교섭'),item('보충교섭')]}]}};
async function fixture(page){
 await page.setViewportSize({width:1280,height:800});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await openHome(page);
 const updates=[
  {id:'u-doc',organization_id:'oa',raw_text:'1) 임금교섭\n2) 보충교섭',detail_text:null,occurred_at:'2026-09-30T02:00:00Z',doc:DOC},
  {id:'u-old',organization_id:'oa',raw_text:WRITTEN,detail_text:null,occurred_at:'2026-09-29T02:00:00Z',doc:null}];
 await page.route(SB+'/rest/v1/app_suborganizations?**',route=>{const q=new URL(route.request().url()).searchParams,id=q.get('id');return route.fulfill({json:id?[org].filter(o=>'eq.'+o.id===id):[org]})});
 await page.route(SB+'/rest/v1/app_suborganization_assignees?**',route=>route.fulfill({json:[{user_id:owner,organization_id:'oa'}]}));
 await page.route(SB+'/rest/v1/app_notes?**',route=>route.fulfill({json:[]}));
 await page.route(SB+'/rest/v1/app_record_links?**',route=>route.fulfill({json:[]}));
 await page.route(SB+'/rest/v1/app_suborganization_updates?**',route=>{
  const req=route.request(),q=new URL(req.url()).searchParams,id=(q.get('id')||'').replace(/^eq\./,'');
  if(req.method()!=='GET')return route.fallback();
  if(id)return route.fulfill({json:updates.filter(u=>u.id===id)});
  return route.fulfill({json:updates.filter(u=>q.get('organization_id')==='eq.'+u.organization_id)});
 });
 return {errors};
}

test('손으로 쓴 번호·들여쓰기·빈 줄은 접힌 줄에서도 펼친 글에서도 쓴 그대로 보인다',async({page})=>{
 const {errors}=await fixture(page);
 await clickView(page,'team');await expect(page.locator('#wdTitle')).toHaveText('합성 가 지부');
 const rec=page.locator('#wdUpdates [data-wd-up="u-old"]'),text=rec.locator('.wd-log-main p.kptu-clamp').first();
 await expect(text).toBeVisible();
 // Folded: the same letters, only cut to four lines by the clamp (not turned into a marks-removed preview).
 expect(await text.evaluate(el=>el.textContent)).toBe(WRITTEN);
 await rec.locator('.kptu-clamp-more').click();
 await expect(text).toHaveClass(/is-open/);
 // Opened: still the written letters, never read as a markdown list.
 await expect(text.locator('ol,ul,li')).toHaveCount(0);await expect(text).not.toHaveClass(/md-body/);
 expect(await text.evaluate(el=>el.textContent)).toBe(WRITTEN);
 expect(await text.innerText()).toBe(WRITTEN);
 expect(errors).toEqual([]);
});

test('서식이 있는 기록은 저장된 번호 모양(1) 2))으로 그려진다',async({page})=>{
 const {errors}=await fixture(page);
 await clickView(page,'team');await expect(page.locator('#wdTitle')).toHaveText('합성 가 지부');
 const list=page.locator('#wdUpdates [data-wd-up="u-doc"] [data-rec-doc] ol');
 await expect(list).toHaveClass(/ed-ol-paren/);await expect(list.locator('li')).toHaveCount(2);
 await expect.poll(()=>list.locator('li').first().evaluate(el=>getComputedStyle(el).listStyleType)).toBe('ed-o-paren');
 expect(errors).toEqual([]);
});
