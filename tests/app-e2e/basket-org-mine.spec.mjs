import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const stamp='2026-10-11T01:02:03.123456Z',noteId='10000000-0000-4000-8000-000000000001';
const orgs=[
 {id:'30000000-0000-4000-8000-000000000001',workspace_id:'w',name:'합성 담당 A',active:true},
 {id:'30000000-0000-4000-8000-000000000002',workspace_id:'w',name:'합성 담당 B',active:null},
 {id:'30000000-0000-4000-8000-000000000003',workspace_id:'w',name:'합성 다른 조직',active:true,default_assignee_name:'합성 소유자'},
 {id:'30000000-0000-4000-8000-000000000004',workspace_id:'w',name:'합성 비활성',active:false},
];
const notice='담당조직이 지정되지 않아 전체 조직을 싣습니다';
for(const width of [390,1280]){
 for(const mode of ['two','zero','inactive-only','failure']){
  test(`basket handoff owner organizations ${mode} ${width}`,async({page},info)=>{
   const errors=[],confirms=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
   await page.setViewportSize({width,height:1000});await openHome(page);await page.clock.setFixedTime(new Date('2026-10-11T12:00:00Z'));
   // Organization copy tests need a valid synthetic session at this fixed date.
   await page.evaluate(()=>{const rt=window.KPTURuntime;rt.session.write({...rt.session.read(),expires_at:Math.floor(Date.now()/1000)+3600});});
   const note={id:noteId,workspace_id:'w',raw_text:'합성 정리 대상 메모',occurred_at:stamp,updated_at:stamp,ai_export_allowed:true,attachments:[]};
   await page.route(SB+'/rest/v1/app_notes?**',r=>r.fulfill({json:[note]}));
   await page.route(SB+'/rest/v1/app_record_links?**',r=>r.fulfill({json:[]}));
   await page.route(SB+'/rest/v1/app_suborganizations?**',r=>r.fulfill({json:orgs}));
   await page.route(SB+'/rest/v1/app_suborganization_assignees?**',r=>{
    expect(new URL(r.request().url()).searchParams.get('user_id')).toBe('eq.home-test');
    const ids=mode==='two'?[orgs[0].id,orgs[1].id,orgs[3].id]:mode==='inactive-only'?[orgs[3].id]:[];
    return r.fulfill({json:ids.map(organization_id=>({organization_id}))});
   });
   if(mode==='failure')await page.evaluate(()=>{const rt=window.KPTURuntime,api=rt.api;rt.api=async(path,...args)=>{if(path.includes('app_suborganization_assignees'))throw Error('synthetic assignment read failure');return api(path,...args);};});
   await page.context().grantPermissions(['clipboard-read','clipboard-write']);
   await page.evaluate(()=>window.KPTURouter.go('basket'));await expect(page.locator('[data-basket-row]')).toHaveCount(1);
   await page.locator('[data-handoff-copy]').click();await expect(page.locator('[data-handoff-status]')).toContainText('복사했어요');
   const copied=await page.evaluate(()=>navigator.clipboard.readText());
   for(const row of mode==='two'?orgs.slice(0,2):orgs.slice(0,3))expect(copied).toContain(`organization · ${row.id} · ${row.name}`);
   expect(copied).not.toContain(orgs[3].name);
   if(mode==='two'){expect(copied).not.toContain(orgs[2].name);expect(copied).not.toContain(notice);}
   else{expect(copied).toContain(notice);expect(copied.indexOf(notice)).toBeLessThan(copied.indexOf('담당조직 목록'));}
   // Verify the visible manual-copy fallback has the exact same full prompt.
   await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('synthetic denied clipboard');}}}));
   await page.locator('[data-handoff-copy]').click();await expect(page.locator('[data-handoff-text]')).toHaveValue(copied);
   await page.locator('[data-handoff-text]').evaluate(el=>{el.scrollTop=el.scrollHeight;});
   await page.screenshot({path:info.outputPath(`orgs-${mode}-${width}.png`),fullPage:true});
   if(mode==='two'){
    // Guidance is not an allowlist: an active organization outside it still resolves and reaches the existing RPC.
    await page.route(SB+'/rest/v1/rpc/app_basket_confirm_links',r=>{confirms.push(r.request().postDataJSON());return r.fulfill({json:{ok:true,created:1,existing:0}});});
    await page.locator('[data-classification-open]').click();
    const answer={schema_version:1,copied_at:'2026-10-11T12:00:00Z',items:[{note_id:noteId,note_updated_at:stamp,destinations:[{kind:'organization',target_id:orgs[2].id,reason:'합성 근거'}]}]};
    await page.locator('[data-classification-input]').fill(JSON.stringify(answer));await page.locator('[data-classification-preview]').click();
    await expect(page.locator('[data-classification-choice]:enabled')).toHaveCount(1);await expect(page.locator('[data-classification-note]')).toContainText(orgs[2].name);
    await page.locator('[data-classification-choice]:enabled').check();await page.locator('[data-classification-confirm]').click();await expect(page.locator('[data-classification-status]')).toContainText('1개 연결했어요');
    expect(confirms).toHaveLength(1);expect(confirms[0].p_targets[0].target_id).toBe(orgs[2].id);
   }
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
  });
 }
}
