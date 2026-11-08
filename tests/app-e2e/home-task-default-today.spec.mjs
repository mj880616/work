import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
// S50-35(2026-11-05 명진 결정): 홈 입력칸 [할 일] 모드에서 새로 넣는 할 일은 기한을 고르지 않으면 오늘(한국 날짜)로 저장해
// 넣자마자 홈 [할 일] 칸에 보인다. 기한을 고르면 그날. 이미 있는 할 일을 고칠 때는 그 할 일의 기한을 그대로 둔다.
// 모의 자료만 쓴다(openHome: 시계는 2026-10-06 10:00 KST). 이름은 모두 합성 값이다.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const quick=page=>page.locator('#homeView [data-home-quick]');
async function taskMode(page){const q=quick(page);await q.locator('[data-quick-mode="task"]').click();await expect(q.locator('[data-quick-mode="task"]')).toHaveAttribute('aria-pressed','true');return q;}
async function watchCreates(page){
 const bodies=[];
 await page.route(SB+'/functions/v1/google-tasks?**',route=>{const req=route.request();if(new URL(req.url()).searchParams.get('action')==='create')bodies.push(req.postDataJSON());return route.fallback();});
 return bodies;
}

for(const width of [390,1280]){
 test(`홈에서 기한 없이 넣은 할 일은 오늘 기한으로 저장돼 홈 할 일 칸에 바로 보임 ${width}`,async({page})=>{
  await page.setViewportSize({width,height:1000});
  await openHome(page);const bodies=await watchCreates(page),q=await taskMode(page),input=q.locator('[data-quick-input]');
  await input.fill('합성 새 할 일');await input.press('Enter');
  await expect.poll(()=>bodies.length).toBe(1);
  expect(bodies[0]).toMatchObject({action:'create',title:'합성 새 할 일',due:'2026-10-06'});
  await expect(input).toHaveValue('');
  const card=page.locator('#homeView [data-journal-group="todo"]');
  await expect(card.locator('li[data-journal-task]').filter({hasText:'합성 새 할 일'})).toBeVisible();
 });
}

test('홈에서 기한을 선택하면 그날로 저장(내일·다음주는 오늘 할 일 칸에 안 섞임)',async({page})=>{
 await openHome(page);const bodies=await watchCreates(page),q=await taskMode(page),input=q.locator('[data-quick-input]');
 await input.fill('합성 내일 할 일');await q.getByRole('button',{name:'내일',exact:true}).click();await input.press('Enter');
 await expect.poll(()=>bodies.length).toBe(1);expect(bodies[0].due).toBe('2026-10-07');
 await expect(input).toHaveValue('');
 // 날짜 칸으로 고른 날
 await input.fill('합성 선택한 날 할 일');await q.locator('[data-quick-date]').evaluate(el=>{el.value='2026-10-20';el.dispatchEvent(new Event('change',{bubbles:true}));});
 await input.press('Enter');await expect.poll(()=>bodies.length).toBe(2);expect(bodies[1].due).toBe('2026-10-20');
 const card=page.locator('#homeView [data-journal-group="todo"]');
 await expect(card.locator('li[data-journal-task]').filter({hasText:'합성 새'})).toHaveCount(0);
 await expect(card.locator('li[data-journal-task]').filter({hasText:'합성 내일 할 일'})).toHaveCount(0);
 // 고른 기한을 다시 눌러 풀면 고르지 않은 것과 같다 → 오늘
 await input.fill('합성 풀린 기한');await q.getByRole('button',{name:'모레',exact:true}).click();await q.getByRole('button',{name:'모레',exact:true}).click();
 await expect(q.getByRole('button',{name:'모레',exact:true})).toHaveAttribute('aria-pressed','false');
 await input.press('Enter');await expect.poll(()=>bodies.length).toBe(3);expect(bodies[2].due).toBe('2026-10-06');
});

test('이미 있는 할 일을 홈에서 수정하면 기한은 그대로(오늘로 바뀌지 않음)',async({page})=>{
 const c=await openHome(page);
 const updates=[];
 await page.route(SB+'/functions/v1/google-tasks?**',route=>{const req=route.request();if(new URL(req.url()).searchParams.get('action')!=='update')return route.fallback();
  const body=req.postDataJSON();updates.push(body);const t=c.tasks.find(x=>x.id===body.task_id);Object.assign(t,{title:body.title,notes:body.notes,due:body.due});
  return route.fulfill({json:{ok:true,task:{...t,due:body.due?body.due+'T00:00:00.000Z':null}}});});
 // 기한 지난 할 일(10.3, 접힌 한 줄 안) ⋯ [고치기] = 할 일 수정 창에서 제목만 고친다.
 const fold=page.locator('#homeView [data-journal-group="todo"] [data-journal-overdue]');
 await expect(fold).toBeVisible();await fold.locator(':scope > summary').click();
 const row=fold.locator('li[data-journal-task="overdue"]');
 await expect(row).toBeVisible();await row.hover();await row.locator('[data-journal-task-menu]').click();
 await page.locator('#journalTaskMenu').getByRole('button',{name:'수정'}).click();
 await expect(page.locator('#gtTaskModal')).toBeVisible();await expect(page.locator('#gtEditDue')).toHaveValue('2026-10-03');
 await page.locator('#gtEditTitle').fill('합성 수정한 제목');await page.locator('#gtSaveBtn').click();
 await expect.poll(()=>updates.length).toBe(1);
 expect(updates[0]).toMatchObject({action:'update',task_id:'overdue',title:'합성 수정한 제목',due:'2026-10-03'});
});
