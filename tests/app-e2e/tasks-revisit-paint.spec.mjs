import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
// STAB-분할시험(2026-10-26): PC 할 일 화면에 다시 들어올 때 목록을 연결 표시(프로젝트·조직 이름표) 없이 한 번 그리고 곧 이름표를 붙여 또 그리지 않는다.
// 새로 받은 할 일 목록에는 연결 정보가 없으므로, 이미 보이던 할 일은 새 연결 정보가 올 때까지 보이던 이름표를 그대로 두고 목록은 그대로 둔다.
// (예전에는 새로고침마다 목록이 두 번 통째로 바뀌어 깜박였고, 그 사이에 칸 자리를 재던 시험이 간헐로 실패했다.)
test.use({timezoneId:'Asia/Seoul'});

test('PC 할 일: 다시 들어와도 목록을 이름표 없이 한 번 더 그리지 않고, 이름표는 계속 보인다',async({page})=>{
 await page.setViewportSize({width:1440,height:860});
 await openHome(page);
 await clickView(page,'tasks');
 const tag=page.locator('#gtTaskSection .gt-card[data-google-task="overdue"] .gt-tag-project');
 await expect(tag).toBeVisible();
 await clickView(page,'home');
 await expect(page.locator('#tasksView')).toBeHidden();
 await page.evaluate(()=>{window.__gtBodyChanges=0;new MutationObserver(list=>{window.__gtBodyChanges+=list.filter(m=>m.type==='childList').length}).observe(document.querySelector('#gtTaskBody'),{childList:true})});
 // 다시 들어오면 목록을 새로 받고(할 일 목록 요청) 이어서 연결 정보를 읽는다(app_record_links). 연결 정보 응답이 온 뒤까지 본다.
 const linkRead=page.waitForResponse(r=>/\/rest\/v1\/app_record_links\?google_task_id=in\./.test(r.url()));
 await clickView(page,'tasks');
 await expect(page.locator('#gtTaskSection.gt-pc')).toBeVisible();
 await linkRead;
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 expect(await page.evaluate(()=>window.__gtBodyChanges)).toBe(0);
 await expect(tag).toBeVisible();
});
