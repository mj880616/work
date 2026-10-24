// REF-참고묶음 AI (docs/design/ref-bundle.md 5절, 9절 질문 5): the AI request lists the reference bundles; in [분류 결과 입력]
// a reference suggestion is shown unchecked, the bundles are choices in 연결할 곳, and only a tap and [선택 확정] saves it
// through app_basket_confirm_links (kind 'reference').
import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {openClassification} from './helpers/basket-more.mjs';
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',n='10000000-0000-4000-8000-000000000001',p='20000000-0000-4000-8000-000000000001',o='20000000-0000-4000-8000-000000000002';
const b='50000000-0000-4000-8000-000000000001',b2='50000000-0000-4000-8000-000000000002',stamp='2026-10-11T01:02:03.123456Z';
const answer=()=>({schema_version:1,copied_at:stamp,items:[{note_id:n,note_updated_at:stamp,destinations:[{kind:'organization',target_id:o,reason:'조직 요약'},{kind:'reference',target_id:b,reason:'공공운수노조 대의원대회 10/30 예정'}]}]});
async function fixture(page){
 await openHome(page);const errors=[],rpc=[],links=[];page.on('pageerror',e=>errors.push(e.message));
 const note={id:n,workspace_id:'w',raw_text:'노조 전체 소식\n둘째 줄',updated_at:stamp,occurred_at:stamp,ai_export_allowed:true,attachments:[]};
 await page.route(SB+'/rest/v1/app_notes?**',r=>r.fulfill({json:[note]}));
 await page.route(SB+'/rest/v1/app_record_links?**',r=>r.fulfill({json:links}));
 await page.route(SB+'/rest/v1/app_spaces?**',r=>r.fulfill({json:[{id:p,workspace_id:'w',owner_id:'home-test',name:'현재 프로젝트',metadata:{project_system:'v2'},status:'active'}]}));
 await page.route(SB+'/rest/v1/app_suborganizations?**',r=>r.fulfill({json:[{id:o,workspace_id:'w',name:'현재 조직',active:true}]}));
 await page.route(SB+'/rest/v1/app_reference_bundles?**',r=>r.fulfill({json:[{id:b,workspace_id:'w',name:'공공운수노조',sort_order:10,created_at:stamp},{id:b2,workspace_id:'w',name:'기타 조직',sort_order:30,created_at:stamp}]}));
 await page.route(SB+'/rest/v1/rpc/app_basket_confirm_links',r=>{const body=r.request().postDataJSON();rpc.push(body);
  for(const t of body.p_targets){const key=t.kind==='project'?'project_id':t.kind==='reference'?'bundle_id':'organization_id';links.push({id:'4000000'+links.length+'-0000-4000-8000-000000000001',note_id:n,status:'confirmed',summary:t.summary??null,[key]:t.target_id});}
  return r.fulfill({json:{ok:true,created:body.p_targets.length,existing:0}});});
 await page.evaluate(()=>window.KPTURouter.go('basket'));await expect(page.locator('[data-basket-row]')).toHaveCount(1);
 return {rpc,errors};
}
for(const width of [390,1280])test(`참고 제안은 체크 꺼진 채 보이고, 체크하고 [선택 확정]해야 저장된다 ${width}`,async({page})=>{
 await page.setViewportSize({width,height:1000});const f=await fixture(page);
 await page.clock.setFixedTime(new Date('2026-10-11T12:00:00Z'));
 // Capture the copied request text (writeText path, as basket-classification.spec.mjs does).
 await page.evaluate(()=>{window.__handoffWrites=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.__handoffWrites.push(text)}});});
 await openClassification(page);
 const copied=await page.evaluate(()=>window.__handoffWrites.at(-1)||'');
 expect(copied).toContain('참고 묶음 목록 (ID · 이름)');expect(copied).toContain(`reference · ${b} · 공공운수노조`);
 expect(copied.indexOf('참고 묶음 목록')).toBeGreaterThan(copied.indexOf('프로젝트 목록'));
 await page.locator('[data-classification-input]').fill('```json\n'+JSON.stringify(answer(),null,2)+'\n```');
 await page.locator('[data-classification-preview]').click();await expect(page.locator('[data-classification-note]')).toHaveCount(1);
 const org=page.locator('[data-classification-choice="0:0"]'),ref=page.locator('[data-classification-choice="0:1"]');
 await expect(org).toBeChecked();await expect(ref).not.toBeChecked();await expect(ref).toBeEnabled();
 await expect(page.locator('[data-classification-rows]')).toContainText('참고 · 공공운수노조');
 // The bundles are choices in 연결할 곳 too.
 await expect(page.locator('[data-classification-target-select="0:0"] option',{hasText:'참고 · 기타 조직'})).toHaveCount(1);
 // Confirm with only the organization: the reference is not sent.
 await page.locator('[data-classification-confirm]').click();await expect(page.locator('[data-classification-status]')).toContainText('1개 연결했어요');
 expect(f.rpc).toHaveLength(1);expect(f.rpc[0].p_targets.map(t=>t.kind)).toEqual(['organization']);
 // Tap the reference, then [선택 확정]: now it is saved as kind 'reference'.
 await ref.check();await page.locator('[data-classification-confirm]').click();
 await expect.poll(()=>f.rpc.length).toBe(2);
 expect(f.rpc[1].p_targets).toEqual([{kind:'reference',target_id:b,reason:'공공운수노조 대의원대회 10/30 예정',summary:'공공운수노조 대의원대회 10/30 예정'}]);
 expect(f.errors).toEqual([]);
});
