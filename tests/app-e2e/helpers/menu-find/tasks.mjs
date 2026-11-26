import {expect} from '@playwright/test';
import {openEmphasisFixture} from '../calendar-task-emphasis.mjs';
// 할 일(S70-57): 맨 위 칸 '할 일에서 찾기' = 할 일 제목 거르기(google-tasks.js renderTasks, 서버 검색 없음).
// 흉내 낸 Google 할 일 3개(모두 일주일 안 기한이라 폰 목록·PC 열 어디서나 펼쳐 보인다). 이름은 지어낸 것.
const NOW=Date.parse('2026-10-08T03:00:00Z');
const task=(id,title,due)=>({id,title,taskListId:'@default',taskListTitle:'내 할 일',due:due+'T00:00:00.000Z',status:'needsAction',notes:''});
const TASKS=[task('t1','가상 교섭 자료 정리','2026-10-08'),task('t2','가상 회의실 예약','2026-10-09'),task('t3','가상 안내문 보내기','2026-10-10')];
export default {
  name:'할 일',label:'할 일에서 찾기',query:'회의실',before:3,after:1,match:'가상 회의실 예약',
  rows:page=>page.locator('#gtTaskBody [data-gt-edit]'),
  async open(page){
    await openEmphasisFixture(page,{view:'list',now:NOW,events:[],tasks:TASKS.map(t=>({...t}))});
    await page.evaluate(()=>window.KPTURouter.go('tasks'));
    await expect(page.locator('[data-gt-count]')).toHaveText('할 일 3개');
  },
};
