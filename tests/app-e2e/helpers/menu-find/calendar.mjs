import {expect} from '@playwright/test';
import {openEmphasisFixture} from '../calendar-task-emphasis.mjs';
// 일정(S70-57): 맨 위 칸 '일정에서 찾기' = 보이는 보기(여기서는 모든 폭에 같은 [목록] 보기)의 일정·할 일 제목 거르기(calendar-view.js render).
// 흉내 낸 Google 일정 4개(10월 20·21·22·24일). 이름은 지어낸 것.
export default {
  name:'일정',label:'일정에서 찾기',query:'목록',before:4,after:1,match:'목록 시험 일정',
  rows:page=>page.locator('#calendarList .clv-event[data-google-event]'),
  async open(page){
    await openEmphasisFixture(page,{view:'list'});
    await expect(page.locator('#calendarList')).toBeVisible();
  },
};
