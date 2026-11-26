// S69-18 TASK-메뉴기한(명진 11/24): 할 일 화면 줄의 ⋯·우클릭 메뉴 [수정] 바로 아래 [기한 바꾸기]. 메뉴 자리에 작은 기한 고르기
// ([오늘][내일][모레][다음주][기한 없음] + 달력), 고르면 바로 같은 google-tasks action=update로 저장, 줄은 새 기한 묶음으로, 5초 [되돌리기].
import {test,expect} from '@playwright/test';
import {openEmphasisFixture} from './helpers/calendar-task-emphasis.mjs';

const NOW=Date.parse('2026-10-08T03:00:00Z'); // 한국 시각 10월 8일 정오 → 내일 10월 9일
const task=(id,due=null,extra={})=>({id,title:'할 일 '+id,taskListId:'@default',taskListTitle:'내 할 일',due,status:'needsAction',notes:'메모 '+id,...extra});

async function open(page,width,tasks){
  await page.setViewportSize({width,height:844});
  await openEmphasisFixture(page,{view:'list',now:NOW,events:[],tasks});
  const calls=[];
  await page.route('**/functions/v1/google-tasks**',async route=>{
    const url=new URL(route.request().url()),action=url.searchParams.get('action'),body=route.request().postDataJSON?.()||null;
    calls.push({action,body});
    const ok=json=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(json)});
    if(action==='links')return ok({links:[],meeting_links:[]});
    if(action==='update'){const at=tasks.findIndex(t=>t.id===body.task_id);tasks[at]={...tasks[at],title:body.title,notes:body.notes,due:body.due?body.due+'T00:00:00.000Z':null};return ok({ok:true,task:tasks[at]})}
    return ok({connected:true,authorized:true,needs_reconnect:false,tasks,pending_scope:'all'});
  });
  await page.evaluate(()=>window.KPTURouter.go('tasks'));
  await expect(page.locator('[data-gt-count]')).toHaveText(`할 일 ${tasks.filter(t=>t.status!=='completed').length}개`);
  return calls;
}
// 손가락 밀기(포인터만, row-swipe-more.spec.mjs와 같은 방법).
async function swipe(locator,dx){
  await expect(async()=>{
    await expect(locator).toBeVisible();
    const sent=await locator.evaluate((el,{dx})=>{if(!el.isConnected)return false;const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
      const fire=(type,cx)=>el.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:7,pointerType:'touch',isPrimary:true,clientX:cx,clientY:y}));
      fire('pointerdown',x);for(let i=1;i<=10;i++)fire('pointermove',x+dx*i/10);fire('pointerup',x+dx);return true},{dx});
    expect(sent).toBe(true);
  }).toPass({timeout:10000});
}
const updates=calls=>calls.filter(c=>c.action==='update');
const inTomorrow=(page,id)=>page.locator(`#gtTaskBody [data-gt-tomorrow] [data-google-task="${id}"]`);
const inToday=(page,id)=>page.locator(`#gtTaskBody [data-gt-today] [data-google-task="${id}"]`);

async function pickTomorrowAndUndo(page,calls){
  const menu=page.locator('#gtTaskMenu');
  // [수정] 바로 아래(파일 붙이기는 서버가 답한 뒤에만 그 다음에 붙는다).
  await expect(menu.locator('button').nth(1)).toHaveText('기한 바꾸기');await expect(menu.locator('button').first()).toHaveText('수정');
  await menu.getByRole('button',{name:'기한 바꾸기',exact:true}).click();
  await expect(menu).toBeHidden();
  const box=page.locator('#taskDuePopup');
  await expect(box).toBeVisible();
  await expect(box.locator('[data-task-due-quick]')).toHaveText(['오늘','내일','모레','다음주','기한 없음']);
  await expect(box.locator('input[type="date"]')).toHaveValue('2026-10-08');
  await box.getByRole('button',{name:'내일',exact:true}).click();
  await expect(box).toHaveCount(0);
  // 저장 요청 1번, 제목·메모는 그대로 함께.
  await expect.poll(()=>updates(calls).length).toBe(1);
  expect(updates(calls)[0].body).toMatchObject({action:'update',task_id:'a',title:'할 일 a',notes:'메모 a',due:'2026-10-09'});
  await expect(inTomorrow(page,'a')).toHaveCount(1);await expect(inToday(page,'a')).toHaveCount(0);
  await expect(page.locator('[data-undo-notice] [data-undo-text]')).toHaveText("'할 일 a' 기한을 내일로 옮겼어요.");
  // 수정 창은 열리지 않는다.
  await expect(page.locator('#gtTaskModal')).toBeHidden();
  await page.locator('[data-undo-notice] [data-undo-action]').click();
  await expect.poll(()=>updates(calls).length).toBe(2);
  expect(updates(calls)[1].body).toMatchObject({task_id:'a',due:'2026-10-08'});
  await expect(inToday(page,'a')).toHaveCount(1);await expect(inTomorrow(page,'a')).toHaveCount(0);
  await expect(page.locator('[data-undo-notice] [data-undo-text]')).toHaveText('기한을 되돌려 놨어요.');
}

test('PC 1440: 우클릭 → [기한 바꾸기] → [내일] 저장 1번·내일 묶음·되돌리기',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const calls=await open(page,1440,[task('a','2026-10-08'),task('b','2026-10-10')]);
  const card=page.locator('#gtTaskBody [data-google-task="a"]');
  await expect(inToday(page,'a')).toHaveCount(1);
  await card.locator('.gt-main').click({button:'right'});
  await expect(page.locator('#gtTaskMenu')).toBeVisible();
  await pickTomorrowAndUndo(page,calls);
  expect(errors).toEqual([]);
});

test('폰 412: ⋯ → [기한 바꾸기] → [내일], 줄 밀기 칸은 [완료][수정][삭제](기한은 ⋯로만), 끝낸 할 일 메뉴에는 없음',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const calls=await open(page,412,[task('a','2026-10-08'),task('done',null,{status:'completed',completed:new Date(NOW).toISOString()})]);
  await page.locator('#gtTaskBody [data-google-task="a"] [data-gt-menu]').click();
  await expect(page.locator('#gtTaskMenu')).toBeVisible();
  await pickTomorrowAndUndo(page,calls);
  // S70-65 UI-밀기메뉴통일(명진 11/26 08:16 가안): 줄 밀기 왼쪽 칸은 [완료][수정][삭제] — [기한]은 밀기에서 빠지고 ⋯ [기한 바꾸기](위)로만.
  const line=page.locator('#gtTaskBody [data-google-task="a"]');
  await swipe(line,-90);
  const ends=page.locator('#gtTaskBody .row-swipe-acts [data-row-swipe-act="end"]'); // 칸은 줄 바로 앞 형제(row-swipe.js)
  await expect(ends).toHaveCount(3);
  await expect(ends).toHaveText(['완료','수정','삭제']);
  await expect(page.locator('#gtTaskBody [data-row-swipe-key="due"]')).toHaveCount(0);
  await swipe(line,60); await expect(ends).toHaveCount(0);
  await page.evaluate(()=>document.querySelectorAll('#gtTaskBody details').forEach(d=>{d.open=true}));
  await page.locator('#gtTaskBody [data-google-task="done"] [data-gt-menu]').click();
  await expect(page.locator('#gtTaskMenu button').first()).toHaveText('수정');
  await expect(page.locator('#gtTaskMenu').getByRole('button',{name:'기한 바꾸기',exact:true})).toHaveCount(0);
  expect(errors).toEqual([]);
});
