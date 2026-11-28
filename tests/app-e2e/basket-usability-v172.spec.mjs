import {test,expect} from '@playwright/test';
import {linkAction} from './helpers/basket-link-menu.mjs';
import {openHome} from './helpers/home-entry.mjs';
import {answerAsk} from './helpers/small-notice.mjs';
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',n='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002',p='20000000-0000-4000-8000-000000000001',o='20000000-0000-4000-8000-000000000002',l='30000000-0000-4000-8000-000000000001',stamp='2026-10-06T01:00:00.123456Z';
const answer=()=>({schema_version:1,copied_at:stamp,items:[{note_id:n,note_updated_at:stamp,destinations:[{kind:'project',target_id:p,reason:'새 요약'},{kind:'organization',target_id:o,reason:'조직 요약'},{kind:'google_task',reason:'아직 지원 안 됨'}]}]});
async function fixture(page,width=390){
 await page.setViewportSize({width,height:900});await openHome(page);await page.clock.setFixedTime(new Date('2026-10-06T12:00:00Z'));const errors=[],writes=[],notes=[{id:n,workspace_id:'w',raw_text:' 첫 줄\n둘째 줄 '+ '긴 원문 '.repeat(300),occurred_at:stamp,updated_at:stamp,ai_export_allowed:true,attachments:[]},{id:other,workspace_id:'w',raw_text:'',occurred_at:stamp,updated_at:stamp,ai_export_allowed:true,attachments:[{file_name:'현장 사진.jpg',mime_type:'image/jpeg',drive_file_id:'fixture-photo',size_bytes:42}]}],links=[];
 const project={id:p,workspace_id:'w',owner_id:'home-test',name:'현재 프로젝트',metadata:{project_system:'v2'},status:'active'},org={id:o,workspace_id:'w',name:'현재 조직'};
 let unknown=false,conflict=false;
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.route(SB+'/rest/v1/app_notes**',r=>{const req=r.request(),u=new URL(req.url());if(req.method()==='GET'){const ids=u.searchParams.get('id');return r.fulfill({json:ids?notes.filter(row=>ids.includes(row.id)):notes});}writes.push({path:u.pathname,body:req.postDataJSON()});if(unknown)return r.fulfill({status:200,json:[]});const row={id:'new-note',updated_at:stamp,occurred_at:stamp,ai_export_allowed:true,attachments:[],...req.postDataJSON()};notes.unshift(row);return r.fulfill({json:[row]});});
 await page.route(SB+'/rest/v1/app_record_links?**',r=>r.fulfill({json:links}));
 await page.route(SB+'/rest/v1/app_spaces?**',r=>r.fulfill({json:[project]}));await page.route(SB+'/rest/v1/app_suborganizations?**',r=>r.fulfill({json:[org]}));
 await page.route(SB+'/rest/v1/rpc/app_basket_confirm_links',r=>{const body=r.request().postDataJSON();writes.push({path:'confirm',body});const created=body.p_targets.length;for(const target of body.p_targets)links.push({id:l+target.kind,note_id:n,status:'confirmed',summary:target.summary,[target.kind==='project'?'project_id':'organization_id']:target.target_id});return r.fulfill({json:{ok:true,created,existing:0}});});
 await page.route(SB+'/rest/v1/rpc/app_basket_update_link_summary',r=>{const body=r.request().postDataJSON();writes.push({path:'summary',body});if(unknown)return r.abort('failed');if(conflict)return r.fulfill({json:{ok:false,error:'SUMMARY_CHANGED'}});const link=links.find(row=>row.id===body.p_link_id);link.summary=body.p_summary;return r.fulfill({json:{ok:true}});});
 await page.evaluate(()=>window.KPTURouter.go('basket'));await expect(page.locator('[data-basket-row]')).toHaveCount(2);
 return {errors,writes,notes,links,setUnknown:value=>unknown=value,setConflict:value=>conflict=value};
}
for(const width of [390,1280]){
 }
// RECORD-기록하나로(S71-71): 기록 [수정] 칸에는 원문 보기가 없다(기록 글만 고친다).
for(const kind of ['organization'])test(`${kind} record editor has no original disclosure and keeps input`,async({page})=>{
 const origin=process.env.WEB2_TEST_ORIGIN||'http://127.0.0.1:8123';await page.goto(origin+'/tests/app-e2e/basket-link-detail-fixture.html');await expect.poll(()=>page.evaluate(()=>window.__detailReady)).toBe(true);await page.evaluate(kind=>{const s=window.__detailState;if(kind==='project')for(const row of s.links){row.project_id=s.ids.project;row.organization_id=null}return kind==='organization'?window.KPTUWorkplace.open(s.ids.org):window.KPTUProjects.open(s.ids.project)},kind);const host=page.locator(kind==='organization'?'#wdUpdates':'#ps3BasketLinks');if(kind==='project')await host.locator(':scope > summary').click();const row=host.locator('[data-basket-link]').first();await linkAction(row,'수정');await row.locator('textarea').fill('같은 창 초안');await expect(row.locator('[data-link-summary-form] details,[data-link-summary-original]')).toHaveCount(0);await expect(row.locator('[data-link-summary-form]')).not.toContainText('원문');await expect(row.locator('textarea')).toHaveValue('같은 창 초안');
});
// BIZ-저장먼저닫기 2차(S59-10): 글이 먼저 업데이트로 저장되고 입력칸은 바로 풀린다. 파일은 그 업데이트의 뒤 줄에서 올라가고,
// 못 올린 파일은 하단바 위 한 줄에 남아 [다시 올리기]가 못 올린 것만 같은 업데이트로 다시 보낸다(올라간 파일은 다시 보내지 않음).
