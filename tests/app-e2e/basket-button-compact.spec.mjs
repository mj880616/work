import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {openHome} from './helpers/home-entry.mjs';

test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const noteId='10000000-0000-4000-8000-000000000001';
const orgId='20000000-0000-4000-8000-000000000002';
const stamp='2026-10-06T00:02:03.123456Z';
const measure=locator=>locator.evaluate(el=>{
  const b=el.getBoundingClientRect(),s=getComputedStyle(el),hit=getComputedStyle(el,'::after');
  return {height:b.height,width:b.width,x:b.x,y:b.y,fontSize:s.fontSize,borderRadius:s.borderRadius,
    borderWidth:s.borderWidth,background:s.backgroundColor,color:s.color,padding:s.padding,
    touchHeight:hit.content==='none'?b.height:Math.max(b.height,parseFloat(hit.height)||0)};
});
async function fixture(page){
  const errors=[],unexpected=[],confirmations=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  // Any request outside the local server must be handled by a fixture.
  await page.route('**/*',route=>{
    if(new URL(route.request().url()).hostname==='127.0.0.1')return route.fallback();
    unexpected.push(route.request().url());return route.abort();
  });
  await openHome(page);
  // Keep openHome's Oct 6 clock for the whole roundtrip. Advancing it after
  // rendering would retire the Oct 7 milestone and change the aside width.
  await page.waitForFunction(()=>window.KPTUHome?.metrics.readyAt>0);
  const notes=[{id:noteId,workspace_id:'w',raw_text:'합성 메모 · 담당조직에 연결할 내용',updated_at:stamp,occurred_at:stamp,ai_export_allowed:true,attachments:[]},
    {id:'archived',raw_text:'보관한 합성 메모',updated_at:stamp,occurred_at:stamp,archived_at:stamp,attachments:[]}];
  const links=[];
  await page.route(SB+'/rest/v1/app_notes?**',r=>r.fulfill({json:notes}));
  await page.route(SB+'/rest/v1/app_record_links?**',r=>r.fulfill({json:links}));
  await page.route(SB+'/rest/v1/app_suborganizations?**',r=>r.fulfill({json:[{id:orgId,workspace_id:'w',name:'합성 담당조직'}]}));
  await page.route(SB+'/rest/v1/rpc/app_basket_confirm_links',r=>{
    confirmations.push(r.request().postDataJSON());
    links.push({note_id:noteId,status:'confirmed',organization_id:orgId,organization:{name:'합성 담당조직'}});
    return r.fulfill({json:{ok:true,created:1,existing:0}});
  });
  await page.evaluate(()=>{
    window.__compactCopies=[];
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.__compactCopies.push(text)}});
  });
  return {errors,unexpected,confirmations};
}
for(const width of [390,1280]){
  }
