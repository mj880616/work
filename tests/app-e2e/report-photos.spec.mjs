import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
import {expectProjectDetail} from './helpers/project-detail.mjs';
// ACT-사진 5단계(docs/design/activity-photos.md 3.3 ②, 결정 C): 담당조직·프로젝트 상세의 사업 보고 줄 오른쪽에 작은 그림 3장 + '외 n장'.
// 그림이 없는 줄은 그대로, 줄을 누르면 사업 보고 결과 창. 그림 자료는 사업 보고 전체를 한 번(meeting_id=in.(…))에 읽고, 작은 그림은 library-files 의
// 읽기 전용 photo 동작(size=small)으로만 받는다(저장 없음). 모든 이름·번호는 합성 값.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
const uid=(prefix,n)=>`${prefix}0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const rid=n=>uid('a',n),did=(r,k)=>uid('d',r*10+k);
const at=d=>`2026-09-${String(d).padStart(2,'0')}T01:00:00Z`;
// 줄: n=1 그림 5장(외 2장), 2 = 그림 없음(글 자료만), 3 = 그림 1장 + 글 자료, 4 = 자료 없음, 5 = 그림 3장(외 없음), 6 = 그림 2장
const PHOTOS={1:5,2:0,3:1,4:0,5:3,6:2};
const report=(n,kind='press')=>({id:rid(n),title:'합성 보고 '+n,series_name:'합성 보고 '+n,round_no:null,meeting_at:at(30-n),created_at:at(30-n),updated_at:at(30-n),activity_kind:kind,project_id:null});
function docsFor(){
 const out=[];
 for(const [n,count] of Object.entries(PHOTOS)){
  for(let k=1;k<=count;k++)out.push({id:did(Number(n),k),meeting_id:rid(Number(n)),file_name:`현장${k}.jpg`,mime_type:'image/jpeg',created_at:`2026-09-0${k}T00:00:00Z`});
  if(n==='2'||n==='3')out.push({id:did(Number(n),9),meeting_id:rid(Number(n)),file_name:'결과 보고.hwpx',mime_type:'application/x-hwpx',created_at:'2026-09-09T00:00:00Z'});
 }
 return out;
}
async function fixture(page,width,{docsFail=false,photoFail=false}={}){
 await page.setViewportSize({width,height:900});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const f=await openHome(page);
 const log={bulk:[],perRow:[],photos:[],auth:[]};
 const reports=[1,2,3,4,5,6].map(n=>report(n));
 await page.route(SB+'/rest/v1/app_record_links?**',route=>{
  const q=new URL(route.request().url()).searchParams;
  if(!(q.get('select')||'').includes('report:app_meetings'))return route.fallback();
  const org=q.get('organization_id'),prj=q.get('project_id');
  const hit=(org==='eq.o'||prj==='eq.p');
  return route.fulfill({json:hit?reports.map((r,i)=>({id:'link-'+(i+1),summary:null,report:{...r,project_id:prj==='eq.p'?'p':null}})):[]});
 });
 await page.route(SB+'/rest/v1/app_meetings?**',route=>{
  const q=new URL(route.request().url()).searchParams,id=q.get('id');
  if(id?.startsWith('eq.'))return route.fulfill({json:reports.filter(r=>'eq.'+r.id===id).map(r=>({...r,workspace_id:'w',created_by:'home-test',notes:'합성 보고 기록',decisions:'',transcript:''}))});
  if(q.get('project_id')?.startsWith('eq.'))return route.fulfill({json:[]});
  return route.fallback();
 });
 await page.route(SB+'/rest/v1/app_documents?**',route=>{
  const q=new URL(route.request().url()).searchParams,m=q.get('meeting_id')||'';
  if(m.startsWith('in.(')){
   log.bulk.push(m);
   if(docsFail)return route.fulfill({status:500,json:{message:'QA failure'}});
   const ids=m.slice(4,-1).split(',');return route.fulfill({json:docsFor().filter(d=>ids.includes(d.meeting_id))});
  }
  if(m.startsWith('eq.'))log.perRow.push(m);
  return route.fallback();
 });
 await page.route(SB+'/functions/v1/library-files?**',route=>{
  const req=route.request(),q=new URL(req.url()).searchParams;
  if(req.method()!=='GET'||q.get('action')!=='photo')return route.fallback();
  log.photos.push({document_id:q.get('document_id'),size:q.get('size')});log.auth.push(String(req.headers().authorization||'').startsWith('Bearer '));
  if(photoFail)return route.fulfill({status:503,json:{error:'photo_unavailable'}});
  return route.fulfill({status:200,contentType:'image/png',body:PNG});
 });
 return {f,log,errors};
}
const noSideScroll=page=>page.evaluate(()=>document.documentElement.scrollWidth-innerWidth<=1);

async function openOrg(page){
 await clickView(page,'team');
 await page.locator('#soOrganizationList [data-so-org="o"]').click();
 await expect(page.locator('#wdTitle')).toHaveText('테스트 조직');
 await expect(page.locator('#wdReportBody [data-wd-report]')).toHaveCount(6);
}
const orgRow=(page,n)=>page.locator(`#wdReportBody [data-wd-report="${rid(n)}"]`);

for(const width of [390,1280])test(`담당조직 상세 ${width}: 사업 보고 줄에 작은 그림 3장 + 외 n장, 그림 없는 줄은 그대로, 누르면 사업 보고`,async({page})=>{
 const {log,errors}=await fixture(page,width);
 await openOrg(page);
 // 그림 자료는 사업 보고 전체를 한 번에 읽는다(줄마다 따로 읽지 않음).
 expect(log.bulk.length).toBeGreaterThan(0);
 for(const m of log.bulk)for(let n=1;n<=6;n++)expect(m).toContain(rid(n));
 expect(log.perRow).toEqual([]);
 // 줄 1: 5장 → 3장 + 외 2장. 줄 5: 3장 → 외 없음. 줄 3: 1장. 줄 6: 2장.
 await expect(orgRow(page,1).locator('.report-photo-thumb')).toHaveCount(3);
 await expect(orgRow(page,1).locator('[data-report-photo-more]')).toHaveText('외 2장');
 await expect(orgRow(page,5).locator('.report-photo-thumb')).toHaveCount(3);
 await expect(orgRow(page,5).locator('[data-report-photo-more]')).toHaveCount(0);
 await expect(orgRow(page,3).locator('.report-photo-thumb')).toHaveCount(1);
 await expect(orgRow(page,6).locator('.report-photo-thumb')).toHaveCount(2);
 // 그림이 없는 줄(글 자료만 / 자료 없음)은 지금 그대로.
 for(const n of [2,4]){await expect(orgRow(page,n).locator('.report-photo-strip')).toHaveCount(0);await expect(orgRow(page,n).locator('[data-wd-report-open]')).not.toHaveClass(/has-report-photos/)}
 // 작은 그림은 화면에 보이는 줄만 받는다(설계) → 줄을 화면 안으로 가져온 뒤 확인한다.
 await orgRow(page,1).scrollIntoViewIfNeeded();
 // 작은 그림이 실제로 그려진다. 받는 것은 앞 3장뿐(4·5번째는 받지 않음), 크기는 small, 로그인 머리글 포함.
 await expect(orgRow(page,1).locator('.report-photo-thumb[data-state="shown"] img')).toHaveCount(3);
 const asked=log.photos.map(p=>p.document_id);
 for(const k of [1,2,3])expect(asked).toContain(did(1,k));
 for(const k of [4,5])expect(asked).not.toContain(did(1,k));
 expect(log.photos.every(p=>p.size==='small')).toBe(true);expect(log.auth.every(Boolean)).toBe(true);
 // 줄 안에서 오른쪽에 놓이고 화면을 넘치지 않는다.
 const geo=await orgRow(page,1).evaluate(row=>{const s=row.querySelector('.report-photo-strip').getBoundingClientRect(),t=row.querySelector('b').getBoundingClientRect(),r=row.getBoundingClientRect();return {right:s.right<=innerWidth,after:s.left>=t.left,fit:s.right<=r.right+1,h:r.height}});
 expect(geo.right).toBe(true);expect(geo.after).toBe(true);expect(geo.fit).toBe(true);expect(geo.h).toBeGreaterThanOrEqual(44);
 expect(await noSideScroll(page)).toBe(true);
 // 줄(그림 포함)을 누르면 기존 사업 보고 결과 창.
 await orgRow(page,1).locator('.report-photo-strip').click();
 await expect(page.locator('#meetingRoundDetailModal')).toBeVisible();
 await expect(page.locator('#mrdTitle')).toContainText('합성 보고 1');
 expect(errors).toEqual([]);
});

test('담당조직 상세: 그림 자료를 못 읽어도 사업 보고 줄은 그대로 보이고 열린다',async({page})=>{
 const {log,errors}=await fixture(page,390,{docsFail:true});
 await openOrg(page);
 expect(log.bulk.length).toBeGreaterThan(0);
 await expect(page.locator('#wdReportBody .report-photo-strip')).toHaveCount(0);
 await expect(page.locator('#wdReportBody [data-wd-report-retry]')).toHaveCount(0);
 await orgRow(page,1).locator('[data-wd-report-open]').click();
 await expect(page.locator('#meetingRoundDetailModal')).toBeVisible();
 expect(errors).toEqual([]);
});

test('담당조직 상세: 작은 그림을 못 받으면 회색 칸에 작은 ↻만 남고 줄 누르기는 그대로 된다',async({page})=>{
 const {log,errors}=await fixture(page,390,{photoFail:true});
 await openOrg(page);
 await orgRow(page,1).scrollIntoViewIfNeeded();
 await expect(orgRow(page,1).locator('.report-photo-thumb[data-state="empty"]')).toHaveCount(3);
 expect(log.photos.length).toBeGreaterThanOrEqual(3);
 await expect(orgRow(page,1).locator('.report-photo-thumb img')).toHaveCount(0);
 await expect(orgRow(page,1).locator('.report-photo-thumb[data-img-state="failed"] .img-slot-retry')).toHaveCount(3);
 await expect(orgRow(page,1).locator('[data-report-photo-more]')).toHaveText('외 2장');
 await orgRow(page,1).locator('[data-wd-report-open]').click();
 await expect(page.locator('#meetingRoundDetailModal')).toBeVisible();
 expect(errors).toEqual([]);
});

const prjRow=(page,n)=>page.locator(`#ps3-meetings [data-ps3-meeting="${rid(n)}"]`);
async function openProject(page){
 await clickView(page,'projects');
 await page.locator('#projectGrid .ps3-plist [data-ps3-project="p"]').click();
 await expectProjectDetail(page,'p');
 await expect(page.locator('#ps3-meetings .ps3-section-head h3')).toHaveText('사업 보고 6');
}

for(const width of [390,1280])test(`프로젝트 상세 ${width}: 사업 보고 줄에 작은 그림 3장 + 외 n장, 접힌 줄은 펼친 뒤에 받는다`,async({page})=>{
 const {log,errors}=await fixture(page,width);
 await openProject(page);
 expect(log.bulk.length).toBeGreaterThan(0);
 for(const m of log.bulk)for(let n=1;n<=6;n++)expect(m).toContain(rid(n));
 expect(log.perRow).toEqual([]);
 await expect(prjRow(page,1).locator('.report-photo-thumb')).toHaveCount(3);
 await expect(prjRow(page,1).locator('[data-report-photo-more]')).toHaveText('외 2장');
 await expect(prjRow(page,3).locator('.report-photo-thumb')).toHaveCount(1);
 await expect(prjRow(page,5).locator('.report-photo-thumb')).toHaveCount(3);
 await expect(prjRow(page,5).locator('[data-report-photo-more]')).toHaveCount(0);
 for(const n of [2,4]){await expect(prjRow(page,n).locator('.report-photo-strip')).toHaveCount(0)}
 await prjRow(page,1).scrollIntoViewIfNeeded();
 await expect(prjRow(page,1).locator('.report-photo-thumb[data-state="shown"] img')).toHaveCount(3);
 // 줄 6은 "나머지 1개 보기" 안에 접혀 있다 → 펼치기 전에는 그림을 받지 않는다.
 const folded=[did(6,1),did(6,2)];
 expect(log.photos.map(p=>p.document_id).filter(id=>folded.includes(id))).toEqual([]);
 await page.locator('#ps3-meetings .ps3-meetings-more > summary').click();
 await prjRow(page,6).scrollIntoViewIfNeeded();
 await expect(prjRow(page,6).locator('.report-photo-thumb[data-state="shown"] img')).toHaveCount(2);
 expect(log.photos.every(p=>p.size==='small')).toBe(true);
 expect(await noSideScroll(page)).toBe(true);
 const h=await prjRow(page,1).evaluate(el=>el.getBoundingClientRect().height);expect(h).toBeGreaterThanOrEqual(44);
 // 누르면 기존 사업 보고 결과 창이 프로젝트 위에 열린다.
 await prjRow(page,1).click();
 await expect(page.locator('#meetingRoundDetailModal')).toBeVisible();
 await expect(page.locator('#mrdTitle')).toContainText('합성 보고 1');
 expect(errors).toEqual([]);
});

test('프로젝트 상세: 그림 자료를 못 읽어도 사업 보고 줄은 그대로 보인다',async({page})=>{
 const {errors}=await fixture(page,390,{docsFail:true});
 await openProject(page);
 await expect(page.locator('#ps3-meetings .report-photo-strip')).toHaveCount(0);
 await expect(prjRow(page,1)).toBeVisible();
 expect(errors).toEqual([]);
});
