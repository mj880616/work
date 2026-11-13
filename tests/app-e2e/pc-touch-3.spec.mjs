// UI-PC손맛묶음 셋째 PR(S56-52): 사업 보고 등록 창 원문 칸 자리(옛 [녹음·전사 넣기] 줄은 S61-24에서 뺌), 조직 보고 기록 칸 파일 끌어놓기, 일기 날짜 칸 우클릭.
import {test,expect} from '@playwright/test';
import {baseState,mockApp,signIn} from './helpers/filter-chip-fixture.mjs';
import {testOrigin} from './helpers/test-origin.mjs';

test.use({timezoneId:'Asia/Seoul'});

// #2332 범위 밖 발견 ①: 묶음 제목(legend) 옆에 0 폭으로 끼던 [녹음·전사 넣기] 줄은 S61-24(REC-요약단추삭제)에서 화면째 뺐다.
// 지금은 그 줄이 없고, 그 자리의 회의 결과 원문 칸이 제목 아래에서 창 안쪽에 선다.
for(const width of [1280,412])test(`사업 보고 등록 창 ${width}: [녹음·전사 넣기] 줄이 없고 결과 원문 칸이 창 안쪽에 다 보인다`,async({page})=>{
  const s=baseState();s.meetingWrites=[];
  await page.setViewportSize({width,height:900});await mockApp(page,s);
  await signIn(page,testOrigin+'/app/?view=meetings');await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
  await page.locator('#newMeetingBtn').click();await expect(page.locator('#meetingModal')).toBeVisible();
  await expect(page.locator('#mtdBar, #mtdOpen, #mtdPanel')).toHaveCount(0);
  await expect(page.locator('#meetingModal').getByText(/녹음·전사 넣기|녹음 요약하기/)).toHaveCount(0);
  const box=await page.evaluate(()=>{const l=document.querySelector('#meetingTranscript').closest('label'),f=l.closest('fieldset')||l.parentElement,r=l.getBoundingClientRect(),fr=f.getBoundingClientRect();return {left:r.left-fr.left,right:fr.right-r.right,width:r.width,fieldWidth:fr.width}});
  expect(box.left).toBeLessThan(40);expect(box.right).toBeGreaterThanOrEqual(0);expect(box.width).toBeGreaterThan(box.fieldWidth/2);
});
