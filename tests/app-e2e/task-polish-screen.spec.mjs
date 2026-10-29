// TASK-화면다듬기: PC 상세 칸 [기한] 빠른 버튼, 할 일 입력 아이콘(⤢), 칸 늘어남(완료 펼쳐도 위 칸 안 줄어듦), "일주일 안" 이름.
import {test,expect} from '@playwright/test';
import {openEmphasisFixture} from './helpers/calendar-task-emphasis.mjs';

const NOW=Date.parse('2026-10-08T03:00:00Z'); // 한국 10월 8일 정오
const task=(id,due=null,extra={})=>({id,title:'할 일 '+id,taskListId:'@default',taskListTitle:'내 할 일',due,status:'needsAction',notes:'',...extra});

async function open(page,width,tasks,height=800){
  await page.setViewportSize({width,height});
  await openEmphasisFixture(page,{view:'list',now:NOW,events:[],tasks,projects:[],orgs:[],links:[]});
  const calls=[];
  await page.route('**/functions/v1/google-tasks**',async route=>{
    const url=new URL(route.request().url()),action=url.searchParams.get('action'),body=route.request().postDataJSON?.()||null;
    calls.push({action,body});
    const ok=json=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(json)});
    if(action==='links')return ok({links:[]});
    if(action==='update'){const at=tasks.findIndex(t=>t.id===body.task_id);tasks[at]={...tasks[at],title:body.title,notes:body.notes,due:body.due?body.due+'T00:00:00.000Z':null};return ok({ok:true,task:tasks[at]})}
    return ok({connected:true,authorized:true,needs_reconnect:false,tasks,pending_scope:'all'});
  });
  await page.evaluate(()=>window.KPTURouter.go('tasks'));
  await expect(page.locator('[data-gt-count]')).toHaveText(`할 일 ${tasks.filter(t=>t.status!=='completed').length}개`);
  return calls;
}

for(const width of [390,1280]){
  test(`${width}: 입력 칸 아이콘은 ⤢(크게 쓰기 그림), 이름은 "일주일 안"`,async({page})=>{
    await open(page,width,[task('a','2026-10-10')]);
    const btn=page.locator('#tasksView .home-quick [data-quick-detail]');
    await expect(btn).toBeVisible();
    await expect(btn.locator('path')).toHaveAttribute('d','M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9');
    await expect(page.locator('#gtTaskBody')).toContainText('일주일 안');
    await expect(page.locator('#gtTaskBody')).not.toContainText('7일 안');
  });
}

test('1280: 빠른 기한 버튼은 바로 저장(오늘·내일·모레·다음주=오늘+7일·기한 없음, 기한이 있어도 오늘이 맨 앞에 보인다)',async({page})=>{
  const tasks=[task('a','2026-10-08')];
  const calls=await open(page,1280,tasks);
  await page.locator('[data-gt-edit="a"]').click();
  const quick=page.locator('#gtDetailPane .gt-due-quick');
  await expect(quick.locator('button')).toHaveText(['오늘','내일','모레','다음주','기한 없음']);
  // [↵ 저장](UI-버튼기준 ④, UI-저장자리로 아래 줄 오른쪽 36px 주 버튼)이고 [오늘] 맨 앞 줄과 함께 한 줄에 들어간다. 글칸에 초점이 있어야 ↵ 안내가 붙는다.
  await page.locator('#gtEditTitle').focus();
  const save=await page.locator('#gtSaveBtn').boundingBox();
  expect(save.height).toBeLessThanOrEqual(37);
  expect(await quick.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  if(process.env.SHOT_DIR)await page.screenshot({path:`${process.env.SHOT_DIR}/task-today-after-1280.png`});
  const field=await page.locator('#gtEditDue').boundingBox(),first=await quick.locator('button').first().boundingBox();
  expect(field.width).toBeLessThan(200);expect(first.x).toBeGreaterThan(field.x+field.width-1);
  expect(first.height).toBeLessThanOrEqual(34);
  for(const [label,due] of [['내일','2026-10-09'],['모레','2026-10-10'],['다음주','2026-10-15'],['오늘','2026-10-08'],['기한 없음',null],['오늘','2026-10-08']]){
    const before=calls.filter(c=>c.action==='update').length;
    await quick.getByRole('button',{name:label,exact:true}).click();
    await expect.poll(()=>calls.filter(c=>c.action==='update').length).toBe(before+1);
    expect(calls.filter(c=>c.action==='update').at(-1).body.due).toBe(due);
    await expect(page.locator('#gtEditDue')).toHaveValue(due||'');
  }
});

// TASK-날짜칸겹침(2026-10-29): 폰 수정 창에도 빠른 기한 버튼 줄이 보이고, 기한 칸 글자는 앱이 그린 한 가지('10.8 (목)')뿐이다.
for(const width of [390,412]){
  test(`${width}: 폰 수정 창에도 빠른 기한 버튼 줄이 보이고, 기한 칸 글자는 한 번만`,async({page})=>{
    const tasks=[task('a','2026-10-08')];
    const calls=await open(page,width,tasks);
    await page.locator('[data-gt-edit="a"]').click();
    const modal=page.locator('#gtTaskModal');
    await expect(modal).toBeVisible();
    const quick=modal.locator('.gt-due-quick');
    await expect(quick).toBeVisible();
    await expect(quick.locator('button')).toHaveText(['오늘','내일','모레','다음주','기한 없음']);
    for(const b of await quick.locator('button').all()){const box=await b.boundingBox();expect(box.height).toBeLessThanOrEqual(33);expect(box.x+box.width).toBeLessThanOrEqual(width);}
    // 기한 칸: 보이는 글자는 칸(span.date-field)이 그린 '10.8 (목)' 하나, 기기 날짜 칸은 통째로 투명(기기 글자가 보이지 않음).
    const field=modal.locator('.date-field:has(#gtEditDue)');
    await expect(field).toHaveAttribute('data-date-text','10.8 (목)');
    expect(await page.locator('#gtEditDue').evaluate(e=>getComputedStyle(e).opacity)).toBe('0');
    expect(await field.evaluate(e=>getComputedStyle(e,'::after').content)).toBe('"10.8 (목)"');
    await quick.getByRole('button',{name:'내일',exact:true}).click();
    await expect.poll(()=>calls.filter(c=>c.action==='update').length).toBe(1);
    expect(calls.find(c=>c.action==='update').body.due).toBe('2026-10-09');
  });
}

test('390: 새 할 일 추가 창에는 빠른 기한 버튼 줄이 없다',async({page})=>{
  await open(page,390,[task('a','2026-10-08')]);
  await page.evaluate(()=>window.KPTUGoogleTasks.openEditor(null));
  await expect(page.locator('#gtTaskModal')).toBeVisible();
  await expect(page.locator('#gtTaskModal .gt-due-quick')).toBeHidden();
});

test('1280: 완료를 펼쳐도 위 칸이 줄지 않고, 칸 안쪽 스크롤바 없이 화면이 넘어간다',async({page})=>{
  const tasks=[...Array.from({length:12},(_,i)=>task('n'+i,'2026-10-08')),...Array.from({length:12},(_,i)=>task('w'+i,'2026-10-1'+(i%5))),...Array.from({length:6},(_,i)=>task('d'+i,null,{status:'completed',completed:new Date(NOW).toISOString()}))];
  await open(page,1280,tasks);
  const h=id=>page.locator(`[data-gt-col="${id}"]`).evaluate(e=>e.getBoundingClientRect().height);
  const now0=await h('now'),week0=await h('week');
  await page.locator('#gtCompleted summary').click();
  await expect(page.locator('#gtCompleted [data-google-task]').first()).toBeVisible();
  expect(await h('now')).toBeGreaterThanOrEqual(now0-1);expect(await h('week')).toBeGreaterThanOrEqual(week0-1);
  for(const sel of ['[data-gt-col="now"] .gt-col-body','[data-gt-col="week"] .gt-col-body']){
    const sc=await page.locator(sel).evaluate(e=>({d:e.scrollHeight-e.clientHeight,oy:getComputedStyle(e).overflowY}));
    expect(sc.d).toBeLessThanOrEqual(1);expect(sc.oy).toBe('visible');
  }
  const m=await page.evaluate(()=>({sh:document.documentElement.scrollHeight,ih:innerHeight}));expect(m.sh).toBeGreaterThan(m.ih);
});
