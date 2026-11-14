// S62-02(11/14·11/15 명진): 사업 보고 — 쓰기 창 '칸' 글자 없음 · 기본 [종류 전체] · [+]는 늘 고르기 창 · 내용 칸(긴 주소 줄바꿈·링크·북마크,
// 오른쪽 [원문] 버튼 없음, 머리 줄 '투쟁 · …'). 폰 412·폴드 펼침 884·PC 1280. 모든 이름·글·주소는 합성 값.
import {test,expect} from '@playwright/test';
import {baseState,mockApp,signIn} from './helpers/filter-chip-fixture.mjs';
import {testOrigin} from './helpers/test-origin.mjs';
import {showAllReportWeeks} from './helpers/report-week.mjs';
import {openMeetingResult} from './helpers/meeting-open.mjs';
import {pickReportKind} from './helpers/report-filter.mjs';

test.use({timezoneId:'Asia/Seoul'});
const LONG='https://news.example.org/article/view/2026111400012345678901234567890?section=society&sub=labor&utm_source=synthetic&utm_medium=test';
const INLINE='https://press.example.com/a/1';
function state(){
  const s=baseState();s.meetingWrites=[];
  const row=(id,name,at,extra={})=>({id,workspace_id:s.workspace.id,title:name,series_name:name,round_no:null,meeting_at:at,created_by:s.user.id,...extra});
  s.meetings=[
    row('m-1','합성 정기 회의','2026-10-08T01:00:00Z',{round_no:2,activity_kind:'meeting',transcript_text:'합성 회의 결과'}),
    row('s-1','합성 총력 결의대회','2026-10-21T01:00:00Z',{activity_kind:'struggle',transcript_text:`합성 결의대회 내용\n${LONG}\n참고 기사는 ${INLINE} 에서 볼 수 있음`})
  ];
  return s;
}
async function open(page,s,width){
  await page.setViewportSize({width,height:900});await mockApp(page,s);
  await signIn(page,testOrigin+'/app/?view=reports');await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
  await expect(page.locator('#meetingsView')).toBeVisible();await showAllReportWeeks(page);
}
const noSideScroll=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);

for(const width of [412,884,1280])test(`${width}: 처음은 [종류 전체], [회의]를 골라도 [+]는 고르기 창(회의 줄 표시), 쓰기 창에 '칸' 글자 없음`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const s=state();await open(page,s,width);
  await expect(page.locator('#reportKindSelect')).toHaveValue('kind:all');
  await pickReportKind(page,'회의');
  await page.locator('#newMeetingBtn').click();
  const sheet=page.locator('#reportKindSheet');await expect(sheet).toBeVisible();
  await expect(sheet.locator('h2')).toHaveText('어느 칸에 남길까요?');
  await expect(sheet.locator('[data-sheet-value="meeting"]')).toHaveAttribute('aria-pressed','true');
  await expect(sheet.locator('[data-sheet-value]')).toHaveText(['회의','정책','교섭','언론','국회','투쟁','교육','기타']);
  await sheet.locator('[data-sheet-value="struggle"]').click();
  const modal=page.locator('#meetingModal');await expect(modal).toBeVisible();
  const pick=page.locator('#meetingKindPick');
  await expect(pick).toHaveAttribute('aria-label','종류');
  await expect(pick.getByRole('radio',{name:'투쟁',exact:true})).toHaveAttribute('aria-checked','true');
  // 칩 줄 앞에 보이는 이름표가 없다: 칩이 줄 왼쪽부터.
  await expect(modal.locator('.report-kind-pick')).toHaveText(/^회의정책교섭언론국회투쟁교육기타$/);
  await expect(page.locator('#meetingTextLabel')).toHaveText('내용');
  await expect(page.locator('#meetingTranscript')).toHaveAttribute('placeholder','내용을 그대로 입력하거나 붙여넣으세요. 줄바꿈을 포함해 그대로 저장됩니다.');
  if(width<1200)expect(await noSideScroll(page)).toBe(true);
  expect(errors).toEqual([]);
});

for(const width of [412,884,1280])test(`${width}: 상세 내용 — 긴 주소는 칸 안에서 줄바꿈, 주소만 있는 줄은 북마크, 줄 안 주소는 링크, [원문] 버튼 없음, 머리 줄 '투쟁 · …'`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const s=state();await open(page,s,width);
  await pickReportKind(page,'투쟁');
  await openMeetingResult(page,'s-1');
  const meta=page.locator('#mrdMeta:visible'),body=page.locator('#mrdResult:visible');
  await expect(meta).toHaveText(/^투쟁 · /);await expect(meta).not.toContainText('칸');
  await expect(page.locator('#mrdTextHead:visible')).toHaveText('내용');
  await expect(page.locator('.record-raw-toggle')).toHaveCount(0);
  const mark=body.locator('a.record-bookmark');await expect(mark).toHaveCount(1);
  await expect(mark).toHaveAttribute('href',LONG);await expect(mark).toHaveAttribute('target','_blank');await expect(mark).toHaveAttribute('rel','noopener noreferrer');
  await expect(mark.locator('.record-bookmark-host')).toHaveText('news.example.org');await expect(mark.locator('.record-bookmark-url')).toHaveText(LONG);
  const inline=body.locator('a.record-link');await expect(inline).toHaveAttribute('href',INLINE);await expect(inline).toHaveAttribute('target','_blank');
  // 가로 넘침 0: 글 칸·북마크가 칸 폭 안, 화면도 옆으로 밀리지 않는다.
  const fit=await body.evaluate(el=>{const r=el.getBoundingClientRect(),b=el.querySelector('a.record-bookmark').getBoundingClientRect();return {over:el.scrollWidth-el.clientWidth,right:b.right-r.right}});
  expect(fit.over).toBeLessThanOrEqual(0);expect(fit.right).toBeLessThanOrEqual(1);
  expect(await noSideScroll(page)).toBe(true);
  // 누르면 새 창으로 열린다(바깥 주소는 가짜 응답).
  await page.context().route('https://news.example.org/**',r=>r.fulfill({status:200,contentType:'text/html',body:'<title>x</title>'}));
  const [popup]=await Promise.all([page.waitForEvent('popup'),mark.click()]);
  expect(popup.url()).toBe(LONG);await popup.close();
  expect(errors).toEqual([]);
});

test('412: 다른 화면에 갔다 메뉴로 다시 오면 [종류 전체]부터',async({page})=>{
  const s=state();await open(page,s,412);
  await pickReportKind(page,'투쟁');await expect(page.locator('#reportKindSelect')).toHaveValue('kind:struggle');
  await page.evaluate(()=>window.KPTURouter.go('home'));await expect(page.locator('#homeView')).toBeVisible();
  await page.evaluate(()=>window.KPTURouter.go('meetings'));await expect(page.locator('#meetingsView')).toBeVisible();
  await expect(page.locator('#reportKindSelect')).toHaveValue('kind:all');
});
