import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
import {expectProjectDetail} from './helpers/project-detail.mjs';
import {expectProjectTitle} from './helpers/screen-title.mjs';
// PRJ-회의표시(2026-10-21 사용자 요청): 프로젝트 상세에 그 프로젝트에 연결된 회의 칸(최근 순, 회의 이름·차수·회의 날짜).
// 줄을 누르면 회의 화면과 같은 회의 결과 창이 프로젝트 화면 위에 열린다. 하위 프로젝트의 회의는 넣지 않는다.
// 이름은 모두 합성 값이다.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const at=d=>`2026-09-${String(d).padStart(2,'0')}T01:00:00Z`;
// Seven meetings of project p (newest first after the server's order), one of its child project, one of no project.
const meetings=[
 {id:'mt-1',project_id:'p',series_name:'합성 정례 회의',title:'합성 정례 회의',round_no:7,meeting_at:at(28)},
 {id:'mt-2',project_id:'p',series_name:'',title:'합성 간담회',round_no:null,meeting_at:at(25)},
 ...[6,5,4,3,2].map((n,i)=>({id:'mt-old-'+n,project_id:'p',series_name:'합성 정례 회의',title:'합성 정례 회의',round_no:n,meeting_at:at(20-i*3)})),
 {id:'mt-child',project_id:'child',series_name:'합성 하위 회의',title:'합성 하위 회의',round_no:1,meeting_at:at(29)},
 {id:'mt-none',project_id:null,series_name:'합성 무소속 회의',title:'합성 무소속 회의',round_no:1,meeting_at:at(29)}
];
async function fixture(page,width){
 await page.setViewportSize({width,height:800});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const f=await openHome(page);
 const reads=[];
 await page.route(SB+'/rest/v1/app_meetings?**',route=>{
  const q=new URL(route.request().url()).searchParams;reads.push(Object.fromEntries(q));
  let rows=meetings;const pid=q.get('project_id'),id=q.get('id');
  if(pid?.startsWith('eq.'))rows=rows.filter(m=>m.project_id===pid.slice(3));
  if(id?.startsWith('eq.'))rows=rows.filter(m=>m.id===id.slice(3));
  rows=[...rows].sort((a,b)=>b.meeting_at.localeCompare(a.meeting_at));
  return route.fulfill({json:rows.map(m=>({...m,workspace_id:'w',created_by:'home-test',notes:'합성 회의 기록',decisions:'',transcript:''}))});
 });
 return {f,reads,errors};
}
async function openProject(page,width){
 await clickView(page,'projects');
 await page.locator('#projectGrid .ps3-plist [data-ps3-project="p"]').click();
 await expectProjectDetail(page,'p');
}
const rows=page=>page.locator('#ps3-meetings [data-ps3-meeting]');

for(const width of [390,1280])test(`project detail lists its own meetings newest first and opens the meeting result over the project ${width}`,async({page})=>{
 const {reads,errors}=await fixture(page,width);
 await openProject(page,width);
 const box=page.locator('#ps3-meetings');
 await expect(box.locator('.ps3-section-head h3')).toHaveText('회의 7');
 // Owner-scoped read of this project only (RLS stays as it is): no child project and no unlinked meeting.
 const q=reads.find(r=>r.project_id==='eq.p');expect(q).toBeTruthy();expect(q.order).toBe('meeting_at.desc.nullslast,created_at.desc');expect(q.select).toBe('id,title,series_name,round_no,meeting_at');
 expect(reads.some(r=>r.project_id?.startsWith('in.'))).toBe(false);
 await expect(box).not.toContainText('합성 하위 회의');await expect(box).not.toContainText('합성 무소속 회의');
 // The newest five are shown; the rest fold under "나머지 2개 보기" (native disclosure).
 await expect(box.locator(':scope > .ps3-lines [data-ps3-meeting]')).toHaveCount(5);
 await expect(rows(page).first()).toContainText('합성 정례 회의');await expect(rows(page).first()).toContainText('7차 · 2026. 9. 28.');
 await expect(rows(page).nth(1).locator('b')).toHaveText('합성 간담회');await expect(rows(page).nth(1).locator('small')).toHaveText('2026. 9. 25.');
 const more=box.locator('.ps3-meetings-more');await expect(more).not.toHaveAttribute('open','');
 await expect(more.locator('summary')).toHaveText('나머지 2개 보기');await more.locator('summary').click();
 await expect(more.locator('[data-ps3-meeting]')).toHaveCount(2);await expect(more.locator('[data-ps3-meeting]').last()).toContainText('2차');
 // The section comes after 자료 and before the folded 주요 일정·메모; rows are 44px buttons inside the page width.
 const order=await page.locator('#ps3Body').evaluate(b=>[...b.children].map(x=>x.id));
 expect(order.indexOf('ps3-meetings')).toBe(order.indexOf('ps3-documents')+1);
 const h=await rows(page).first().evaluate(el=>el.getBoundingClientRect().height);expect(h).toBeGreaterThanOrEqual(44);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
 // A row opens the same meeting result dialog as the meetings screen, over the project.
 const first=rows(page).first();await first.click();
 const dialog=page.locator('#meetingRoundDetailModal');await expect(dialog).toBeVisible();
 await expect(page.locator('#mrdTitle')).toContainText('합성 정례 회의');
 expect(reads.some(r=>r.id==='eq.mt-1')).toBe(true);
 await expect(page.locator('#projectsView')).toBeVisible();
 await page.locator('#mrdClose').click();await expect(dialog).toBeHidden();
 await expect(page.locator('#ps3DetailModal')).toBeVisible();await expectProjectTitle(page,'테스트 프로젝트');
 await expect(first).toBeFocused();
 if(width<1024){
  // Phone: back closes the meeting result and leaves the project detail open.
  await first.click();await expect(dialog).toBeVisible();
  await page.goBack();await expect(dialog).toBeHidden();
  await expect(page.locator('#ps3DetailModal')).toBeVisible();await expectProjectTitle(page,'테스트 프로젝트');
 }
 expect(errors).toEqual([]);
});

test('a project with no meetings shows the section with 0 and no rows; a child project lists only its own',async({page})=>{
 await fixture(page,1280);
 await clickView(page,'projects');
 await page.locator('#projectGrid .ps3-plist [data-ps3-project="child"]').click();await expectProjectDetail(page,'child');
 await expect(page.locator('#ps3-meetings .ps3-section-head h3')).toHaveText('회의 1');
 await expect(rows(page)).toHaveCount(1);await expect(rows(page)).toContainText('합성 하위 회의');
 await page.route(SB+'/rest/v1/app_meetings?**',route=>route.fulfill({json:[]}));
 await page.locator('#projectGrid .ps3-plist [data-ps3-project="p"]').click();await expectProjectDetail(page,'p');
 await expect(page.locator('#ps3-meetings .ps3-section-head h3')).toHaveText('회의 0');await expect(rows(page)).toHaveCount(0);
 await expect(page.locator('#ps3-meetings .ps3-meetings-more')).toHaveCount(0);
});
