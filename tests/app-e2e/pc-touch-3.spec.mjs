// UI-PC손맛묶음 셋째 PR(S56-52): 사업 보고 등록 창 [녹음·전사 넣기] 자리, 조직 보고 기록 칸 파일 끌어놓기, 일기 날짜 칸 우클릭.
import {test,expect} from '@playwright/test';
import {baseState,mockApp,signIn} from './helpers/filter-chip-fixture.mjs';
import {testOrigin} from './helpers/test-origin.mjs';

test.use({timezoneId:'Asia/Seoul'});

// #2332 범위 밖 발견 ①: 묶음 제목(legend)이 떠 있고 바로 다음 칸(참석자 줄)이 숨겨져 있으면, 그 뒤 [녹음·전사 넣기] 줄이 제목 옆에 0 폭으로 끼어
// 단추가 창 오른쪽 밖으로 삐져나왔다. 묶음 안의 칸은 모두 제목 아래에서 창 안쪽에 선다.
for(const width of [1280,412])test(`사업 보고 등록 창 ${width}: [녹음·전사 넣기]가 창 안쪽 왼쪽에 다 보인다`,async({page})=>{
  const s=baseState();s.meetingWrites=[];
  await page.setViewportSize({width,height:900});await mockApp(page,s);
  await signIn(page,testOrigin+'/app/?view=meetings');await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
  await page.locator('#newMeetingBtn').click();await expect(page.locator('#meetingModal')).toBeVisible();
  const open=page.locator('#mtdOpen');await expect(open).toBeAttached();
  const box=await page.evaluate(()=>{const b=document.querySelector('#mtdOpen'),bar=document.querySelector('#mtdBar'),f=b.closest('fieldset'),r=b.getBoundingClientRect(),fr=f.getBoundingClientRect(),br=bar.getBoundingClientRect();return {left:r.left-fr.left,right:fr.right-r.right,barWidth:br.width,fieldWidth:fr.width,clipped:b.scrollWidth>b.clientWidth+1}});
  expect(box.left).toBeLessThan(40);expect(box.right).toBeGreaterThan(0);expect(box.barWidth).toBeGreaterThan(box.fieldWidth/2);expect(box.clipped).toBe(false);
  await open.click();await expect(page.locator('#mtdPanel')).toBeVisible();
});
