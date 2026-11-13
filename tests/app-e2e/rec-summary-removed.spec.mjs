// S61-24 REC-요약단추삭제(명진 11/13 13:16 "빼자. 이제 그 기능을 뺐잖아"): [회의] 입력 창의 [녹음·전사 넣기] → [녹음 요약하기] 길은 화면째 없다.
// - 입력 창(폰 412·PC 1280)에 그 줄·창·단추·글자가 없고, 회의 결과를 손으로 써서 저장하는 길은 그대로(AI 요약 호출 0번).
// - 사업 보고 머리의 [녹음](녹음 파일 저장 길)은 그대로 있다. 녹음 저장 자체는 tests/app-e2e/rec-save-library.spec.mjs가 본다.
// 모든 이름·글은 합성 값. KPTU_SHOTS=1이면 docs/design/screens/s61-24/에 사진을 남긴다(PR 첨부용).
import {test,expect} from '@playwright/test';
import {baseState,mockApp,signIn} from './helpers/filter-chip-fixture.mjs';
import {fillDateTime} from './helpers/date-time.mjs';
import {testOrigin} from './helpers/test-origin.mjs';
import {showAllReportWeeks} from './helpers/report-week.mjs';
import {pickReportKind} from './helpers/report-filter.mjs';

test.use({timezoneId:'Asia/Seoul'});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const SHOTS=process.env.KPTU_SHOTS==='1';
const shot=async(target,name)=>{if(SHOTS)await target.screenshot({path:`docs/design/screens/s61-24/${name}.png`})};

for(const [width,label] of [[1280,'pc-1280'],[412,'phone-412']])test(`${label}: [회의] 입력 창에 [녹음·전사 넣기]·[녹음 요약하기]가 없고, 손으로 쓴 회의 보고는 그대로 저장된다`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const s=baseState();s.meetingWrites=[];let draftCalls=0;
  s.meetings=[{id:'m-1',workspace_id:s.workspace.id,title:'합성 지난 회의',series_name:'합성 지난 회의',round_no:1,meeting_at:'2026-11-06T01:00:00Z',transcript_text:'합성 지난 결과',activity_kind:'meeting',created_by:s.user.id}];
  await page.setViewportSize({width,height:width>760?900:915});await mockApp(page,s);
  await page.route(`${SB}/functions/v1/meeting-ai-draft**`,route=>{draftCalls++;return route.fulfill({json:{ok:false}})});
  await signIn(page,testOrigin+'/app/?view=reports');await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
  await expect(page.locator('#meetingsView')).toBeVisible();await showAllReportWeeks(page);
  // 녹음 파일 저장 길([녹음])은 그대로 있다(PC 머리 줄 — 폰은 녹음 앱 띠가 맡음).
  await expect(page.locator('#reportRecordBtn')).toHaveCount(1);
  await pickReportKind(page,'회의');await page.locator('#newMeetingBtn').click();
  const modal=page.locator('#meetingModal');await expect(modal).toBeVisible();
  // 지운 길: 줄·창·단추·글자 모두 없다(숨김이 아니라 없음).
  await expect(page.locator('#mtdBar, #mtdOpen, #mtdPanel, #mtdRun, #mtdText')).toHaveCount(0);
  await expect(modal.getByText(/녹음·전사 넣기|녹음 요약하기|전사 글/)).toHaveCount(0);
  expect(await page.evaluate(()=>'KPTUMeetingTranscriptDraft' in window)).toBe(false);
  expect(await page.evaluate(()=>typeof window.KPTUMeetingJoin?.askTranscript)).toBe('undefined');
  // 손으로 쓰는 회의 보고는 그대로.
  if(await page.locator('#meetingNameSelect').isVisible())await page.locator('#meetingNameSelect').selectOption('__other__');
  await page.locator('#meetingTitle').fill('합성 운영회의');await fillDateTime(page,'#meetingAt','2026-11-13T10:00');
  await page.locator('#meetingTranscript').fill('합성 결정 하나');
  await page.locator('#meetingTranscript').evaluate(el=>el.scrollIntoView({block:'center'}));
  await shot(page,`${label}-entry`);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator('#saveMeetingBtn').click();
  await expect(modal).toBeHidden();
  await expect.poll(()=>s.meetingWrites.length).toBe(1);
  expect(s.meetingWrites[0]).toMatchObject({activity_kind:'meeting',transcript_text:'합성 결정 하나'});
  expect(draftCalls).toBe(0);
  expect(errors).toEqual([]);
});
