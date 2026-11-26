import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
import {expectProjectDetail} from './helpers/project-detail.mjs';
import {mrdMenu} from './helpers/meeting-open.mjs';
import {openFolds} from './helpers/area-org-picker.mjs';
// S71-73 ORG-사업보고줄메뉴삭제(사용자 결정 2026-11-26, standard-interactions.md L6): 조직·사업영역 상세 '사업 보고' 줄에는 ⋯가 없다
// (연결 해제만 있던 메뉴). 연결을 풀 때는 사업 보고를 열고 [수정] › [연결할 곳]에서 이 조직을 빼고 저장 → 조직 상세에서 사라진다.
// 모든 이름·번호는 합성 값.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const rid=n=>`a0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const report=n=>({id:rid(n),workspace_id:'w',title:'합성 보고 '+n,series_name:'합성 보고 '+n,round_no:null,meeting_at:`2026-09-${String(20-n).padStart(2,'0')}T01:00:00Z`,created_at:'2026-09-01T00:00:00Z',updated_at:'2026-09-01T00:00:00Z',activity_kind:'press',project_id:'p',created_by:'home-test',notes:'합성 기록',decisions:'',transcript_text:''});

async function fixture(page,width){
 await page.setViewportSize({width,height:900});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await openHome(page);
 const reports=[1,2].map(report);
 // 연결 표(출처 회의 줄): 두 보고 모두 조직 o·사업영역 p에 연결.
 let links=reports.flatMap((r,i)=>[{id:'l-o-'+i,source_meeting_id:r.id,organization_id:'o',project_id:null,summary:null},{id:'l-p-'+i,source_meeting_id:r.id,organization_id:null,project_id:'p',summary:null}]);
 const setCalls=[];
 await page.route(SB+'/rest/v1/app_record_links?**',route=>{
  const q=new URL(route.request().url()).searchParams,sel=q.get('select')||'';
  if(sel.includes('report:app_meetings')){
   const org=q.get('organization_id'),prj=q.get('project_id');
   const rows=links.filter(l=>(org&&'eq.'+l.organization_id===org)||(prj&&'eq.'+l.project_id===prj));
   return route.fulfill({json:rows.map(l=>({id:l.id,summary:null,report:reports.find(r=>r.id===l.source_meeting_id)}))});
  }
  const src=q.get('source_meeting_id');
  if(src?.startsWith('eq.'))return route.fulfill({json:links.filter(l=>'eq.'+l.source_meeting_id===src)});
  if(src==='not.is.null')return route.fulfill({json:links});
  return route.fallback();
 });
 await page.route(SB+'/rest/v1/rpc/app_meeting_set_links',route=>{
  const b=route.request().postDataJSON();setCalls.push(b);
  links=links.filter(l=>l.source_meeting_id!==b.p_meeting_id);
  (b.p_targets||[]).forEach((t,i)=>links.push({id:'n-'+setCalls.length+'-'+i,source_meeting_id:b.p_meeting_id,organization_id:t.kind==='organization'?t.target_id:null,project_id:t.kind==='project'?t.target_id:null,summary:null}));
  return route.fulfill({json:{ok:true,updated_at:'2026-09-02T00:00:00Z',created:0,removed:1}});
 });
 await page.route(SB+'/rest/v1/app_meetings?**',route=>{
  const req=route.request(),q=new URL(req.url()).searchParams,id=q.get('id');
  if(req.method()==='PATCH'){const r=reports.find(x=>'eq.'+x.id===id);if(r)Object.assign(r,req.postDataJSON());return route.fulfill({json:r?[r]:[]})}
  if(id?.startsWith('eq.'))return route.fulfill({json:reports.filter(r=>'eq.'+r.id===id)});
  if(q.get('project_id')?.startsWith('eq.'))return route.fulfill({json:[]});
  return route.fallback();
 });
 return {errors,setCalls,links:()=>links};
}

const orgRows=page=>page.locator('#wdReportBody [data-wd-report]');
async function openOrg(page){
 await clickView(page,'team');
 await page.locator('#soOrganizationList [data-so-org="o"]').click();
 await expect(page.locator('#wdTitle')).toHaveText('테스트 조직');
 await expect(orgRows(page)).toHaveCount(2);
}

for(const width of [390,1280])test(`S71-73 조직 상세 ${width}: 사업 보고 줄에 ⋯ 없음 · 열기 → [수정] → 이 조직 빼기 → 조직 상세에서 사라짐`,async({page})=>{
 const {errors,setCalls,links}=await fixture(page,width);
 await openOrg(page);
 // 줄에는 ⋯(메뉴)도 연결 해제 단추도 없다 — 줄 하나가 통째로 '열기' 단추다.
 await expect(page.locator('#wdReportBody details, #wdReportBody summary, #wdReportBody .more-dots')).toHaveCount(0);
 await expect(page.locator('#wdReportBody').getByText('연결 해제')).toHaveCount(0);
 for(const row of await orgRows(page).all())await expect(row.locator('button')).toHaveCount(1);
 // 줄 안 열기 단추가 줄 폭을 다 쓴다(⋯ 자리가 비어 남지 않음).
 const fill=await orgRows(page).first().evaluate(row=>{const r=row.getBoundingClientRect(),b=row.querySelector('[data-wd-report-open]').getBoundingClientRect();return r.right-b.right});
 expect(fill).toBeLessThanOrEqual(2);
 // 사업 보고를 열고 [수정] › [연결할 곳]에서 이 조직을 빼고 저장.
 await page.locator(`#wdReportBody [data-wd-report-open="${rid(1)}"]`).click();
 await expect(page.locator('#meetingRoundDetailModal')).toBeVisible();
 await expect(page.locator('#mrdTitle')).toContainText('합성 보고 1');
 await mrdMenu(page,'edit');
 await expect(page.locator('#mrdEditPlaces')).toContainText('테스트 조직');
 await page.locator('#mrdEditPlaces').click();
 const sheet=page.locator('#reportPlacesSheet');await openFolds(sheet);
 const org=sheet.locator('[data-sheet-value]').filter({hasText:'테스트 조직'}).first();
 await expect(org).toHaveAttribute('aria-pressed','true');
 await org.click();await expect(org).toHaveAttribute('aria-pressed','false');
 await sheet.getByRole('button',{name:'저장',exact:true}).click();
 await expect(page.locator('#mrdEditPlaces')).not.toContainText('테스트 조직');
 await page.locator('#mrdSaveEdit').click();
 await expect(page.locator('#mrdEditor')).toBeHidden();
 // 서버에는 이 보고의 연결을 사업영역 하나로 맞추라고 한 번만 보냈다.
 expect(setCalls).toHaveLength(1);
 expect(setCalls[0].p_meeting_id).toBe(rid(1));
 expect(setCalls[0].p_targets.map(t=>t.kind+':'+t.target_id)).toEqual(['project:p']);
 expect(links().filter(l=>l.organization_id==='o').map(l=>l.source_meeting_id)).toEqual([rid(2)]);
 // 저장 뒤에도 결과 창은 조직 상세 위에 그대로 떠 있다(PC: 안 보이는 사업 보고 화면 칸으로 끌려가지 않음). 닫으면 조직 상세에는 남은 보고 하나만.
 await expect(page.locator('#meetingRoundDetailModal')).toBeVisible();
 await page.locator('#mrdClose').click();
 await expect(orgRows(page)).toHaveCount(1);
 await expect(page.locator(`#wdReportBody [data-wd-report="${rid(2)}"]`)).toBeVisible();
 expect(errors).toEqual([]);
});

for(const width of [390,1280])test(`S71-73 사업영역 상세 ${width}: 사업 보고 줄에도 ⋯ 없음`,async({page})=>{
 const {errors}=await fixture(page,width);
 await clickView(page,'projects');
 await page.locator('#projectGrid .ps3-plist [data-ps3-project="p"]').click();
 await expectProjectDetail(page,'p');
 await expect(page.locator('#ps3-meetings [data-ps3-meeting]')).toHaveCount(2);
 await expect(page.locator('#ps3-meetings .ps3-meeting-row details, #ps3-meetings .ps3-meeting-row .more-dots')).toHaveCount(0);
 await expect(page.locator('#ps3-meetings').getByText('연결 해제')).toHaveCount(0);
 expect(errors).toEqual([]);
});
