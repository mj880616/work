// TASK-연결칩한줄 (2026-11-08 명진 제보): 할 일 줄의 연결 칩(조직·사업)은 날짜 옆 같은 줄, 글자 꺾임 없음, 길면 칩 안에서 '…', 연결이 둘이면 첫 칩 + '+1'.
// 폰 390은 묶음 목록(taskMeta), 폴드 펼침 884·PC 1280은 카드(taskCard). 이름은 모두 지어낸 것.
import {test,expect} from '@playwright/test';
import {openEmphasisFixture} from './helpers/calendar-task-emphasis.mjs';

const NOW=Date.parse('2026-10-08T03:00:00Z');
const LONG='가나다라마바사아자차카타파하 아주 긴 연결 프로젝트 이름 시험용';
const task=(id,due)=>({id,title:'할 일 '+id,taskListId:'@default',taskListTitle:'내 할 일',due,status:'needsAction',notes:''});
const PROJECTS=[{id:'p1',name:'시험 프로젝트',workspace_id:'qa-ws',owner_id:'qa-user',metadata:{project_system:'v2'},status:'active'},{id:'p2',name:LONG,workspace_id:'qa-ws',owner_id:'qa-user',metadata:{project_system:'v2'},status:'active'}];
const ORGS=[{id:'o1',name:'시험 조직',active:true}];
const TASKS=[task('first','2026-10-08T00:00:00Z'),task('none','2026-10-08T00:00:00Z'),task('one','2026-10-08T00:00:00Z'),task('long','2026-10-08T00:00:00Z'),task('two','2026-10-08T00:00:00Z')];
const LINKS=[{google_task_id:'one',project_id:'p1',status:'confirmed'},{google_task_id:'long',project_id:'p2',status:'confirmed'},{google_task_id:'two',project_id:'p1',status:'confirmed'},{google_task_id:'two',organization_id:'o1',status:'confirmed'}];

for(const width of [390,884,1280]){
  test(`연결 칩은 날짜 옆 한 줄: 줄 높이 같음·꺾임 없음·긴 이름 '…'·둘이면 +1 (${width})`,async({page})=>{
    await page.setViewportSize({width,height:844});
    await openEmphasisFixture(page,{view:'list',now:NOW,events:[],tasks:TASKS.map(t=>({...t})),projects:PROJECTS,orgs:ORGS,links:LINKS});
    await page.evaluate(()=>window.KPTURouter.go('tasks'));
    await expect(page.locator('[data-gt-count]')).toHaveText('할 일 5개');
    const pc=width>=600;
    const row=id=>page.locator(`#gtTaskBody [data-google-task="${id}"]`);
    await expect(row('none')).toBeVisible();
    // 담당조직 이름은 늦게 와서 다시 그리므로, 연결 둘 줄이 다 그려진 뒤에 잰다.
    await expect(row('two').locator(pc?'.gt-tag':'.gt-project')).toHaveCount(pc?2:1);
    const h=async id=>Math.round((await row(id).boundingBox()).height);
    const base=await h('none');
    for(const id of ['one','long','two'])expect(await h(id),`${id} 줄 높이`).toBe(base);
    const chip=id=>row(id).locator(pc?'.gt-tag':'.gt-project').first();
    for(const id of ['one','long','two']){
      const m=await row(id).evaluate((el,pc)=>{const c=el.querySelector(pc?'.gt-tag':'.gt-project'),d=el.querySelector('.gt-due'),r=el.getBoundingClientRect(),cb=c.getBoundingClientRect(),db=d.getBoundingClientRect(),lh=parseFloat(getComputedStyle(c).lineHeight)||cb.height;return {ws:getComputedStyle(c).whiteSpace,ch:cb.height,lh,sameLine:cb.top<db.bottom&&db.top<cb.bottom,inside:cb.right<=r.right+0.5}},pc);
      expect(m.ws).toBe('nowrap');expect(m.ch).toBeLessThan(m.lh*1.6);expect(m.sameLine).toBe(true);expect(m.inside).toBe(true);
    }
    const lc=chip('long');
    expect(await lc.evaluate(e=>e.scrollWidth>e.clientWidth)).toBe(true);
    expect(await lc.evaluate(e=>getComputedStyle(e).textOverflow)).toBe('ellipsis');
    await expect(lc).toHaveAttribute('title',LONG);
    if(pc){
      expect(await lc.evaluate((e,w)=>e.getBoundingClientRect().width<=w*0.55,width)).toBe(true);
      await expect(row('two').locator('.gt-tag')).toHaveCount(2);
      await expect(row('two').locator('.gt-tag-more')).toHaveText('+1');
      await expect(row('two').locator('.gt-tag').first()).toHaveText('시험 프로젝트');
      await expect(row('two').locator('.gt-tag-more')).toHaveAttribute('title','시험 프로젝트, 시험 조직');
    }
    await expect(row('one').locator('.gt-tag-more,.gt-more')).toHaveCount(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  });
}
