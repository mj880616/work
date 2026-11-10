// TASK-제목날짜만 (2026-11-09 명진 결정, 시안 docs/design/mockups/task-row-title-date.html): 할 일 줄은 '○ 제목… 날짜 ⋯' 한 줄.
// 연결 조직·사업 이름은 줄에 쓰지 않고(연결은 그대로 — 상세·담당조직·사업 화면 연결 목록), 날짜는 모든 줄에서 같은 세로줄, 줄 높이는 모두 같다.
// 폰 390은 묶음 목록(taskRow), 폴드 펼침 884·PC 1280은 카드(taskCard). 이름은 모두 지어낸 것.
import {test,expect} from '@playwright/test';
import {openEmphasisFixture} from './helpers/calendar-task-emphasis.mjs';

const NOW=Date.parse('2026-10-08T03:00:00Z');
// TASK-넓게쓰기(2026-11-10): 고르기 전에는 목록이 화면 폭 전부라, PC 1280에서도 한 줄을 넘는 길이로 둔다.
const LONG='가나다라마바사아자차카타파하 아주 긴 할 일 제목 시험용 '.repeat(5).trim();
const task=(id,due,title='할 일 '+id)=>({id,title,taskListId:'@default',taskListTitle:'내 할 일',due,status:'needsAction',notes:''});
const PROJECTS=[{id:'p1',name:'시험 프로젝트',workspace_id:'qa-ws',owner_id:'qa-user',metadata:{project_system:'v2'},status:'active'}];
const ORGS=[{id:'o1',name:'시험 조직',active:true}];
const TASKS=[task('none','2026-10-08T00:00:00Z'),task('one','2026-10-08T00:00:00Z'),task('long','2026-10-08T00:00:00Z',LONG),task('two','2026-10-08T00:00:00Z'),task('other','2026-10-09T00:00:00Z')];
const LINKS=[{google_task_id:'one',project_id:'p1',status:'confirmed'},{google_task_id:'long',project_id:'p1',status:'confirmed'},{google_task_id:'two',project_id:'p1',status:'confirmed'},{google_task_id:'two',organization_id:'o1',status:'confirmed'}];

for(const width of [390,884,1280]){
  test(`할 일 줄은 제목·날짜만: 칩 없음·날짜 같은 세로줄·줄 높이 같음 (${width})`,async({page})=>{
    await page.setViewportSize({width,height:844});
    await openEmphasisFixture(page,{view:'list',now:NOW,events:[],tasks:TASKS.map(t=>({...t})),projects:PROJECTS,orgs:ORGS,links:LINKS});
    await page.evaluate(()=>window.KPTURouter.go('tasks'));
    await expect(page.locator('[data-gt-count]')).toHaveText('할 일 5개');
    const row=id=>page.locator(`#gtTaskBody [data-google-task="${id}"]`);
    await expect(row('none')).toBeVisible();
    // 연결 정보는 늦게 와서 다시 그리므로, 그려진 뒤에도 칩이 없음을 확인한다.
    await page.waitForTimeout(400);
    await expect(page.locator('#gtTaskBody .gt-tag,#gtTaskBody .gt-tag-more,#gtTaskBody .gt-project,#gtTaskBody .gt-more')).toHaveCount(0);
    for(const id of ['none','one','long','two']){
      await expect(row(id).locator('.gt-due')).toHaveCount(1);
      await expect(row(id)).not.toContainText('시험 프로젝트');await expect(row(id)).not.toContainText('시험 조직');
    }
    const h=async id=>Math.round((await row(id).boundingBox()).height);
    // 칸 맨 윗줄은 위 테두리가 없어 1px 낮다(원래 모양). 그 밖에 연결·제목 길이로 높이가 달라지지 않는다.
    const hs=[];for(const id of ['none','one','long','two','other'])hs.push(await h(id));
    expect(Math.max(...hs)-Math.min(...hs),`줄 높이 ${hs}`).toBeLessThanOrEqual(1);
    expect(await h('one')).toBe(await h('long'));expect(await h('one')).toBe(await h('two'));
    // 같은 날짜 묶음 4줄: 날짜 칸의 오른쪽 끝·폭이 같고, 제목과 같은 줄에 있으며, 긴 제목은 한 줄에서 '…'.
    const m=id=>row(id).evaluate(el=>{const t=el.querySelector('.gt-main b'),d=el.querySelector('.gt-due'),k=el.querySelector('[data-gt-menu]'),tb=t.getBoundingClientRect(),db=d.getBoundingClientRect(),kb=k.getBoundingClientRect(),cs=getComputedStyle(t);return {dr:Math.round(db.right*10)/10,dw:Math.round(db.width*10)/10,sameLine:tb.top<db.bottom&&db.top<tb.bottom,beforeMenu:db.right<=kb.left+0.5,tw:cs.whiteSpace,th:tb.height,lh:parseFloat(cs.lineHeight),over:t.scrollWidth>t.clientWidth,ell:cs.textOverflow}});
    const ms={};for(const id of ['none','one','long','two'])ms[id]=await m(id);
    for(const id of ['one','long','two']){expect(ms[id].dr,`${id} 날짜 오른쪽`).toBe(ms.none.dr);}
    for(const id of ['none','one','long','two']){expect(ms[id].sameLine).toBe(true);expect(ms[id].beforeMenu).toBe(true);expect(ms[id].tw).toBe('nowrap');expect(ms[id].th).toBeLessThan(ms[id].lh*1.6);}
    expect(ms.long.over).toBe(true);expect(ms.long.ell).toBe('ellipsis');
    // 날짜가 다른 줄도 같은 세로줄.
    const other=await m('other');expect(other.dr).toBe(ms.none.dr);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  });
}
