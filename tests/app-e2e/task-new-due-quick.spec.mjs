// FIX-잊지말기할일기한(2026-11-18 사용자 "잊지말기에서 할일 추가 화면 내일 눌러도 날짜가 안바뀜"):
// 새 할 일 쓰기 창(잊지 말기 ⋯ → 할 일 추가, 홈 ⤢, 담당조직·프로젝트 [할 일 추가]가 같이 쓰는 창)의 빠른 기한 버튼
// [오늘][내일][모레][다음주][기한 없음]은 기한 칸을 그 날로 바꾸고 누른 버튼을 고른 표시(aria-pressed)로 보이며,
// [저장]하면 그 날로 Google 할 일을 만든다. 기한 칸을 직접 바꾸면 버튼 표시도 따라온다. 모든 이름·글은 합성 값, Google 요청은 가짜.
import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';

async function watchCreates(page){
 const creates=[];
 await page.route(SB+'/functions/v1/google-tasks?**',route=>{const req=route.request(),action=new URL(req.url()).searchParams.get('action');
  if(action==='create'){const b=req.postDataJSON();creates.push(b);return route.fulfill({json:{ok:true,task:{id:'new-'+creates.length,title:b.title,notes:b.notes||'',status:'needsAction',taskListId:'@default',due:b.due?b.due+'T00:00:00.000Z':null},links:[]}});}
  return route.fallback();});
 return creates;
}
// 잊지 말기 ⋯ → 할 일 추가와 같은 부름(forget-list.js: openEditor(null,{title,memo,onCreated})).
async function openNew(page,title){
 await page.evaluate(async()=>{if(!window.KPTUGoogleTasks)await import('/app/google-tasks.js');});
 await page.waitForFunction(()=>!!window.KPTUGoogleTasks?.openEditor);
 await page.evaluate(t=>window.KPTUGoogleTasks.openEditor(null,{title:t,memo:'소식 · 합성',onCreated(){}}),title);
 await expect(page.locator('#gtTaskModal')).toBeVisible();
 await expect(page.locator('#gtTaskHeading')).toHaveText('Google 할 일 추가');
 await expect(page.locator('#gtSaveBtn')).toBeEnabled();
}
const pressedOnly=async(quick,label)=>{for(const name of ['오늘','내일','모레','다음주','기한 없음'])await expect(quick.getByRole('button',{name,exact:true})).toHaveAttribute('aria-pressed',String(name===label));};

// 오늘은 2026-10-06(화, openHome 고정 시각).
for(const [label,due,text] of [['내일','2026-10-07','10.7 (수)'],['모레','2026-10-08','10.8 (목)'],['기한 없음',null,null],['오늘','2026-10-06','10.6 (화)']]){
 test(`412: 새 할 일 창 [${label}] → 기한 칸·고른 표시가 바뀌고 저장하면 그 날`,async({page})=>{
  await page.setViewportSize({width:412,height:900});
  await openHome(page);const creates=await watchCreates(page);
  await openNew(page,'합성 '+label);
  const quick=page.locator('#gtTaskModal .gt-due-quick'),field=page.locator('#gtEditDue');
  await expect(field).toHaveValue('2026-10-06');
  await pressedOnly(quick,'오늘');
  if(label==='오늘'){await quick.getByRole('button',{name:'내일',exact:true}).click();await expect(field).toHaveValue('2026-10-07');}
  await quick.getByRole('button',{name:label,exact:true}).click();
  await expect(field).toHaveValue(due||'');
  if(text)await expect(page.locator('#gtTaskModal .date-field:has(#gtEditDue)')).toHaveAttribute('data-date-text',text);
  await pressedOnly(quick,label);
  await expect(page.locator('#gtTaskModal')).toBeVisible(); // 새 할 일은 버튼만으로 저장하지 않는다
  expect(creates.length).toBe(0);
  if(process.env.SHOT_DIR&&(label==='내일'||label==='모레'))await page.screenshot({path:`${process.env.SHOT_DIR}/task-new-due-${label==='내일'?'tomorrow':'after'}-412.png`});
  await page.locator('#gtSaveBtn').click();
  await expect.poll(()=>creates.length).toBe(1);
  expect(creates[0]).toMatchObject({action:'create',title:'합성 '+label,due});
 });
}

test('412: 새 할 일 창 [다음주] → 요일 목록에서 고른 날이 기한 칸에 들어가고 저장하면 그 날',async({page})=>{
 await page.setViewportSize({width:412,height:900});
 await openHome(page);const creates=await watchCreates(page);
 await openNew(page,'합성 다음주');
 const quick=page.locator('#gtTaskModal .gt-due-quick'),field=page.locator('#gtEditDue');
 await quick.getByRole('button',{name:'다음주',exact:true}).click();
 const week=page.locator('#taskWeekPick');
 await expect(week).toBeVisible();
 await week.getByRole('button',{name:'수 10.14',exact:true}).click();
 await expect(week).toBeHidden();
 await expect(field).toHaveValue('2026-10-14');
 await pressedOnly(quick,'다음주');
 expect(creates.length).toBe(0);
 await page.locator('#gtSaveBtn').click();
 await expect.poll(()=>creates.length).toBe(1);
 expect(creates[0].due).toBe('2026-10-14');
});

test('412: 새 할 일 창에서 기한 칸을 직접 바꾸면 버튼 고른 표시도 따라온다',async({page})=>{
 await page.setViewportSize({width:412,height:900});
 await openHome(page);const creates=await watchCreates(page);
 await openNew(page,'합성 직접');
 const quick=page.locator('#gtTaskModal .gt-due-quick'),field=page.locator('#gtEditDue');
 await field.fill('2026-10-08');await field.dispatchEvent('change');
 await pressedOnly(quick,'모레');
 await field.fill('2026-10-30');await field.dispatchEvent('change');
 await pressedOnly(quick,'');
 await field.fill('');await field.dispatchEvent('change');
 await pressedOnly(quick,'기한 없음');
 await page.locator('#gtSaveBtn').click();
 await expect.poll(()=>creates.length).toBe(1);
 expect(creates[0].due).toBeNull();
});

// 원인 ①: 잊지 말기 화면(정리함)은 할 일 창 모양(google-tasks.css)을 싣지 않아, 그 화면에서 연 창은 모양 없이 그려졌다.
// 이제 창이 자기 모양을 직접 싣는다. 정리함으로 바로 들어와 잊지 말기와 같은 방법(organization-order + google-tasks)으로 연다.
test('412: 잊지 말기 화면에서 바로 연 새 할 일 창도 제 모양이고 [내일]·[모레]가 기한을 바꾼다',async({page})=>{
 await page.setViewportSize({width:412,height:900});
 await openHome(page,{query:'?view=basket'});
 await expect(page.locator('#basketView')).toBeVisible();
 const creates=await watchCreates(page);
 await page.evaluate(async()=>{await Promise.all([import('/app/organization-order.js'),import('/app/google-tasks.js')]);});
 await openNew(page,'합성 잊지 말기');
 expect(await page.evaluate(()=>[...document.querySelectorAll('link[rel="stylesheet"]')].some(l=>/google-tasks\.css/.test(l.getAttribute('href')||'')))).toBe(true);
 const quick=page.locator('#gtTaskModal .gt-due-quick'),field=page.locator('#gtEditDue');
 for(const b of await quick.locator('button').all()){const box=await b.boundingBox();expect(box.height).toBeLessThanOrEqual(33);expect(box.x+box.width).toBeLessThanOrEqual(412);}
 await quick.getByRole('button',{name:'내일',exact:true}).click();
 await expect(field).toHaveValue('2026-10-07');await pressedOnly(quick,'내일');
 if(process.env.SHOT_DIR)await page.screenshot({path:`${process.env.SHOT_DIR}/forget-task-tomorrow-412.png`});
 await quick.getByRole('button',{name:'모레',exact:true}).click();
 await expect(field).toHaveValue('2026-10-08');await pressedOnly(quick,'모레');
 if(process.env.SHOT_DIR)await page.screenshot({path:`${process.env.SHOT_DIR}/forget-task-after-412.png`});
 await page.locator('#gtSaveBtn').click();
 await expect.poll(()=>creates.length).toBe(1);
 expect(creates[0]).toMatchObject({action:'create',title:'합성 잊지 말기',due:'2026-10-08'});
});
