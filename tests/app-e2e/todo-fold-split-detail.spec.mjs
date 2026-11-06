// S51-13 TODO-폴드목록상세(2026-11-06 명진 'ㅇ', docs/design/mockups/todo-fold-list-detail.html):
// 폴드 펼침(600~760, 폰 틀)과 PC는 할 일 화면이 '왼쪽 목록 | 오른쪽 상세'. 줄을 누르면 오른쪽에 바로 열리고(고른 줄 표시),
// 오른쪽에서 고치면 바로 서버 저장(제목·기한·연결·메모·첨부, [저장] 없음, 실패는 그 칸 아래에 표시), ✕·Esc·뒤로 키 = 상세 닫기,
// 아무것도 안 골랐을 때 오른쪽은 '오늘 할 일' 요약. 접은 폰(412)은 지금처럼 수정 창([저장]).
import {test,expect} from '@playwright/test';
import {openEmphasisFixture} from './helpers/calendar-task-emphasis.mjs';

const NOW=Date.parse('2026-10-08T03:00:00Z'); // 한국 시각 10월 8일(목) 정오
const task=(id,due=null,extra={})=>({id,title:'할 일 '+id,taskListId:'@default',taskListTitle:'내 할 일',due,status:'needsAction',notes:'',...extra});
const PROJECT={id:'p1',name:'시험 프로젝트',workspace_id:'qa-ws',owner_id:'qa-user',metadata:{project_system:'v2'},status:'active'};
const ORG={id:'o1',name:'시험 조직',active:true};

async function open(page,width,tasks,{height=820,fail=null}={}){
  await page.setViewportSize({width,height});
  await openEmphasisFixture(page,{view:'list',now:NOW,events:[],tasks,projects:[PROJECT],orgs:[ORG],links:[]});
  const calls=[];let taskLinks=[];
  await page.route('**/functions/v1/google-tasks**',async route=>{
    const url=new URL(route.request().url()),action=url.searchParams.get('action'),body=route.request().postDataJSON?.()||null;
    calls.push({action,body});
    const ok=json=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(json)});
    if(fail&&fail===action)return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'시험 오류'})});
    const linksOf=id=>({links:taskLinks.filter(l=>l.google_task_id===id).map(({project_id,organization_id})=>({...(project_id?{project_id}:{organization_id}),status:'confirmed'})),meeting_links:[]});
    if(action==='links')return ok(linksOf(url.searchParams.get('task_id')));
    if(action==='update'){const at=tasks.findIndex(t=>t.id===body.task_id);tasks[at]={...tasks[at],title:body.title,notes:body.notes,due:body.due?body.due+'T00:00:00.000Z':null};return ok({ok:true,task:tasks[at]})}
    if(action==='link'){for(const l of body.links)taskLinks.push({google_task_id:body.task_id,...l});return ok({ok:true,...linksOf(body.task_id)})}
    if(action==='unlink'){taskLinks=taskLinks.filter(l=>!(l.google_task_id===body.task_id&&body.links.some(x=>x.project_id===l.project_id&&x.organization_id===l.organization_id)));return ok({ok:true,...linksOf(body.task_id)})}
    if(action==='toggle'){const at=tasks.findIndex(t=>t.id===body.task_id);tasks[at]={...tasks[at],status:body.completed?'completed':'needsAction',completed:body.completed?new Date(NOW).toISOString():null};return ok({ok:true,task:tasks[at]})}
    return ok({connected:true,authorized:true,needs_reconnect:false,tasks,pending_scope:'all'});
  });
  await page.evaluate(()=>window.KPTURouter.go('tasks'));
  await expect(page.locator('[data-gt-count]')).toHaveText(`할 일 ${tasks.filter(t=>t.status!=='completed').length}개`);
  // 입력창이 늦게 나타나면 칸 자리가 밀리므로 먼저 기다린다.
  await expect(page.locator('#tasksView .home-quick [data-quick-input]')).toBeVisible();
  return calls;
}
const historyLength=page=>page.evaluate(()=>history.length);

for(const width of [690,884,1280]){
  test(`${width}: 왼쪽 목록 | 오른쪽 상세 — 고르면 오른쪽에 열리고, 고치면 바로 저장, ✕·뒤로 키로 닫힘`,async({page})=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const tasks=[task('late','2026-10-06'),task('a','2026-10-08',{notes:'첫 메모'}),task('b','2026-10-08'),task('soon','2026-10-10')];
    const calls=await open(page,width,tasks);
    const pane=page.locator('#gtDetailPane'),editor=pane.locator('#gtTaskModal');
    // 두 칸: 목록 열이 왼쪽, 상세 칸이 오른쪽(가로 넘김 없음).
    await expect(page.locator('#gtTaskBody .gt-cols')).toHaveCount(1);await expect(pane).toBeVisible();
    const [list,box]=[await page.locator('#gtTaskBody [data-gt-col="now"]').boundingBox(),await pane.boundingBox()];
    expect(box.x).toBeGreaterThan(list.x+list.width);expect(Math.abs(box.y-list.y)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    // ④ 아무것도 안 골랐을 때: 오늘 할 일 요약(오늘 기한 둘, 기한 지남 하나).
    const today=pane.locator('#gtPaneToday');
    await expect(today.locator('.gt-pane-today-head')).toContainText('오늘 할 일 2');await expect(today.locator('.gt-pane-today-late')).toHaveText('기한 지남 1');
    await expect(today.locator('[data-gt-today-open]')).toHaveText(['할 일 a','할 일 b']);
    // ① 줄을 누르면 오른쪽에 바로 열리고 고른 줄 표시, 요약은 숨는다. [저장] 버튼은 없다.
    const before=await historyLength(page);
    await page.locator('[data-gt-edit="a"]').click();
    await expect(editor).toBeVisible();await expect(today).toBeHidden();
    await expect(page.locator('[data-google-task="a"]')).toHaveClass(/is-selected/);
    await expect(pane.locator('#gtSaveBtn')).toBeHidden();
    await expect(pane.locator('#gtToggleBtn')).toBeVisible();await expect(pane.locator('#gtDeleteBtn')).toBeVisible();
    expect(await historyLength(page)).toBe(before+1);
    await expect(pane.locator('[data-gt-due-quick="0"]')).toHaveAttribute('aria-pressed','true');
    // ② 기한 빠른 버튼 → 바로 저장, 칸은 열린 채, 고른 버튼 표시.
    await pane.locator('[data-gt-due-quick="1"]').click();
    await expect.poll(()=>calls.filter(c=>c.action==='update').map(c=>c.body.due)).toEqual(['2026-10-09']);
    await expect(editor).toBeVisible();await expect(page.locator('#gtEditDue')).toHaveValue('2026-10-09');
    await expect(pane.locator('[data-gt-due-quick="1"]')).toHaveAttribute('aria-pressed','true');
    await expect(pane.locator('#gtEditStatus')).toHaveText('저장했어요.');
    // 메모: 입력을 멈추면 바로 저장(같은 update 경로).
    await page.locator('#gtEditNotes').fill('고친 메모');
    await expect.poll(()=>calls.filter(c=>c.action==='update').at(-1)?.body.notes).toBe('고친 메모');
    // 제목: Enter로 저장, 칸은 그대로.
    await page.locator('#gtEditTitle').fill('고친 제목');await page.locator('#gtEditTitle').press('Enter');
    await expect.poll(()=>calls.filter(c=>c.action==='update').at(-1)?.body.title).toBe('고친 제목');
    // 연결: 체크하면 바로 link.
    await pane.locator('[data-gt-link][value="o:o1"]').check();
    await expect.poll(()=>calls.filter(c=>c.action==='link').map(c=>c.body.links)).toEqual([[{organization_id:'o1'}]]);
    await expect(editor).toBeVisible();
    expect(calls.some(c=>c.action==='create')).toBe(false);
    // ③ 뒤로 키 = 상세 닫기(한 단계), 화면은 할 일 그대로, 요약이 다시 보인다.
    await page.goBack();
    await expect(editor).toBeHidden();await expect(pane).not.toHaveClass(/has-task/);await expect(today).toBeVisible();
    await expect(page.locator('#gtTaskBody .gt-row.is-selected')).toHaveCount(0);
    await expect(page.locator('#tasksView')).toBeVisible();
    expect(await historyLength(page)).toBe(before+1);
    // ✕도 닫는다. 다시 열었다 다른 줄을 고르면 그 할 일로 바뀌고 뒤로 기록은 하나뿐.
    await page.locator('[data-gt-edit="b"]').click();await expect(editor).toBeVisible();
    await page.locator('[data-gt-edit="soon"]').click();await expect(page.locator('#gtEditTitle')).toHaveValue('할 일 soon');
    await pane.locator('[data-gt-close]').click();
    await expect(editor).toBeHidden();await expect(page.locator('#tasksView')).toBeVisible();
    // 요약 줄을 누르면 그 할 일이 오른쪽에 열린다.
    await today.locator('[data-gt-today-open]').first().click();
    await expect(editor).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('690: 메모를 쓰다 다른 줄을 고르면 쓰던 메모를 먼저 저장하고 넘어간다',async({page})=>{
  const tasks=[task('a','2026-10-08'),task('b','2026-10-08')];
  const calls=await open(page,690,tasks);
  await page.locator('[data-gt-edit="a"]').click();await expect(page.locator('#gtTaskModal')).toBeVisible();
  await expect(page.locator('#gtDetailPane [data-gt-link]')).toHaveCount(2);
  await page.locator('#gtEditNotes').pressSequentially('바로 넘김');
  await page.locator('[data-gt-edit="b"]').click();
  await expect(page.locator('#gtEditTitle')).toHaveValue('할 일 b');
  expect(calls.filter(c=>c.action==='update').at(-1)?.body).toMatchObject({task_id:'a',notes:'바로 넘김'});
});

test('690: 저장이 안 되면 그 칸 아래에 알리고 입력은 그대로',async({page})=>{
  await open(page,690,[task('a','2026-10-08')],{fail:'update'});
  const pane=page.locator('#gtDetailPane');
  await page.locator('[data-gt-edit="a"]').click();await expect(pane.locator('[data-gt-link]')).toHaveCount(2);
  await page.locator('#gtEditNotes').fill('저장 안 될 메모');await page.locator('#gtEditNotes').blur();
  const err=pane.locator('[data-gt-field-error="notes"]');
  await expect(err).toBeVisible();await expect(err).not.toBeEmpty();
  // 메모 칸 바로 아래에 있다.
  const [field,note]=[await page.locator('#gtEditNotes').boundingBox(),await err.boundingBox()];
  expect(note.y).toBeGreaterThanOrEqual(field.y+field.height-1);expect(note.y-(field.y+field.height)).toBeLessThan(40);
  await expect(page.locator('#gtEditNotes')).toHaveValue('저장 안 될 메모');await expect(pane.locator('#gtTaskModal')).toBeVisible();
});

test('690: [완료]는 쓰던 메모를 저장한 뒤 완료하고 칸을 닫는다',async({page})=>{
  const tasks=[task('a','2026-10-08')];
  const calls=await open(page,690,tasks);
  await page.locator('[data-gt-edit="a"]').click();await expect(page.locator('#gtDetailPane [data-gt-link]')).toHaveCount(2);
  await page.locator('#gtEditNotes').pressSequentially('끝내기 전');
  await page.locator('#gtToggleBtn').click();
  await expect(page.locator('#gtTaskModal')).toBeHidden();
  const order=calls.filter(c=>['update','toggle'].includes(c.action)).map(c=>c.action);
  expect(order).toEqual(['update','toggle']);
  expect(calls.find(c=>c.action==='update').body.notes).toBe('끝내기 전');
});

test('폰 412: 지금처럼 묶음 목록과 수정 창([저장]), 상세 칸 없음',async({page})=>{
  await open(page,412,[task('a','2026-10-08')]);
  await expect(page.locator('#gtTaskBody .gt-cols')).toHaveCount(0);await expect(page.locator('#gtDetailPane')).toBeHidden();
  await page.locator('[data-gt-edit="a"]').click();
  const modal=page.locator('#gtTaskModal');await expect(modal).toBeVisible();
  expect(await modal.evaluate(e=>({parent:e.parentElement.tagName,role:e.getAttribute('role')}))).toEqual({parent:'BODY',role:'dialog'});
  await expect(modal.locator('#gtSaveBtn')).toBeVisible();
  await page.goBack();await expect(modal).toBeHidden();
});
