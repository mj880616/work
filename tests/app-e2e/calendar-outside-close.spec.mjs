import {test,expect} from '@playwright/test';
import {openEmphasisFixture} from './helpers/calendar-task-emphasis.mjs';
test.use({timezoneId:'Asia/Seoul'});
// S49-6 CAL-날칸누르기·바깥닫기: 날짜 숫자·칸 위쪽·요일 줄이 그 날 창을 열고, 창 바깥(어둡게 가려진 자리)을 한 번 누르면 닫힌다.
for(const [width,height] of [[412,844],[884,900],[1440,900]]){
  test(`date number, weekday row open the day and an outside tap closes it (${width}px)`,async({page})=>{
    await page.setViewportSize({width,height});
    await openEmphasisFixture(page);
    const modal=page.locator('#calendarDayModal');
    await page.locator('.cal-cell[data-date="2026-10-20"] .cal-day').click();
    await expect(modal).toBeVisible();
    await expect(page.locator('#eventModal')).toBeHidden();
    // 창 바깥 한 번 누르기 = 닫기만(아래 달력 칸은 눌리지 않아 일정 추가 창이 뜨지 않는다), 뒤로가기 기록도 남지 않는다.
    await page.mouse.click(width/2,6);
    await expect(modal).toBeHidden();
    await expect(page.locator('#eventModal')).toBeHidden();
    await expect.poll(()=>page.evaluate(()=>history.state?.kptuOverlay)).toBeUndefined();
    // 요일 줄: 이번 주 그 요일의 날 창.
    await page.locator('.cmv-head-row .cal-head[data-weekday="2"]').click();
    await expect(modal).toBeVisible();
    await expect(page.locator('#calendarDayTitle')).toContainText('화요일');
    // 창 안을 누르면 닫히지 않는다.
    await page.locator('#calendarDayModal .modal-head h2').click();
    await expect(modal).toBeVisible();
    await page.mouse.click(width/2,6);
    await expect(modal).toBeHidden();
  });
}
