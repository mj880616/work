import {test,expect} from '@playwright/test';
import {openSeoulApp} from './helpers/seoul-time-fixture.mjs';

// UI-일정시간입력: pressing a time cell selects the whole time, so typing overwrites it.
// Synthetic fixture data only; every request is answered by the fixture.
for(const width of [390,1280])test.describe(`시간칸 전체 선택 ${width}px`,()=>{
  test.use({timezoneId:'Europe/Rome',viewport:{width,height:900}});
  const selected=cell=>cell.evaluate(el=>({s:el.selectionStart,e:el.selectionEnd,n:el.value.length}));

  test('일정 만들기: 시간칸을 누르면 값이 전부 선택되고 바로 치면 덮어쓴다',async({page})=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
    await openSeoulApp(page);await page.locator('#newEventBtn').click();
    const start=page.locator('#eventStartTime'),end=page.locator('#eventEndTime');
    await page.locator('#eventTitle').fill('선택 확인');await start.fill('0900');await expect(end).toHaveValue('11:00');
    for(const cell of [start,end]){
      await page.locator('#eventTitle').click();
      await cell.click();
      expect(await selected(cell)).toEqual({s:0,e:5,n:5});
    }
    await start.click();await page.keyboard.type('1430');
    await expect(start).toHaveValue('14:30');await expect(end).toHaveValue('16:30');
    // Keyboard focus (Tab) selects it too.
    await page.locator('#eventStartDate').focus();await page.keyboard.press('Tab');
    await expect(start).toBeFocused();expect(await selected(start)).toEqual({s:0,e:5,n:5});
    await page.keyboard.type('0815');await expect(start).toHaveValue('08:15');
    expect(errors).toEqual([]);
  });

  test('일정 수정: 시간칸을 누르면 값이 전부 선택되고 바로 치면 덮어쓴다',async({page})=>{
    const s=await openSeoulApp(page);
    await page.locator('#prevMonthBtn').click();await page.locator('#calendarGrid [data-google-event="exec"]').first().click();
    const start=page.locator('#ciGoogleStartTime');await expect(start).toHaveValue('10:00');
    await start.click();expect(await selected(start)).toEqual({s:0,e:5,n:5});
    await page.keyboard.type('1330');await expect(start).toHaveValue('13:30');await expect(page.locator('#ciGoogleEndTime')).toHaveValue('14:30');
    expect(s.writes).toEqual([]);
  });
});
