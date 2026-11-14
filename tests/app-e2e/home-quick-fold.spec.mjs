import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
// UI-폰하단고정(#1708 질문 2 안 A): 폰 홈 빠른 입력은 쉬는 동안 한 줄로 접히고, 누르면 지금처럼 펼친다. PC·폴드 펼침(761px~)은 그대로.
const quick=page=>page.locator('#homeView [data-home-quick]');
const shot=process.env.S61_28_SHOTS;
test.describe('phone 412',()=>{
  test.use({viewport:{width:412,height:915}});
  test('rests as one row, opens on press, folds again when empty',async({page})=>{
    await openHome(page,{quickRest:true});const q=quick(page),input=q.locator('[data-quick-input]'),kind=q.locator('[data-quick-kind]');
    await expect(q).toHaveAttribute('data-quick-rest','');
    await expect(kind).toBeVisible();await expect(kind).toHaveText('업데이트 ▾');
    await expect(q.locator('.home-quick-modes')).toBeHidden(); // HOTFIX-홈잊지말기칩: 접혀도 [잊지 말기] 칩은 보이고 입력칸과 같은 줄
    await expect(q.locator('[data-home-forget-open]')).toBeVisible();
    {const c=await q.locator('[data-home-forget-open]').boundingBox(),i=await q.locator('[data-quick-input]').boundingBox();expect(Math.abs((c.y+c.height/2)-(i.y+i.height/2))).toBeLessThan(i.height/2);}await expect(q.locator('[data-quick-save]')).toBeHidden();
    await expect(q.locator('[data-quick-file-picker]')).toBeHidden();
    const rest=await q.boundingBox();expect(rest.height).toBeLessThanOrEqual(50);
    // 하단바 바로 위에 붙고, 화면 끝(하단바)과 겹치지 않는다.
    const tab=await page.evaluate(()=>parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--kptu-mobile-tab-height'))||0);
    expect(Math.round(rest.y+rest.height)).toBe(915-tab);
    if(shot)await page.screenshot({path:shot+'/phone-412-rest.png'});
    await kind.click();
    await expect(q).not.toHaveAttribute('data-quick-rest','');await expect(input).toBeFocused();
    await expect(q.locator('[data-quick-mode="task"]')).toBeVisible();await expect(q.locator('[data-quick-save]')).toBeVisible();await expect(kind).toBeHidden();
    if(shot)await page.screenshot({path:shot+'/phone-412-open.png'});
    // [할 일]로 바꾼 뒤 비운 채 바깥을 누르면 접히고, 종류 글자가 '할 일'.
    await q.locator('[data-quick-mode="task"]').click();
    await page.mouse.click(60,22);
    await expect(q).toHaveAttribute('data-quick-rest','');await expect(kind).toHaveText('할 일 ▾');
    // 칸을 바로 눌러도 펼치고, 글이 있으면 바깥을 눌러도 접지 않는다.
    await input.click();await expect(q).not.toHaveAttribute('data-quick-rest','');
    await input.fill('적어 둔 글');await page.mouse.click(60,22);
    await expect(q).not.toHaveAttribute('data-quick-rest','');await expect(q.locator('[data-quick-save]')).toBeVisible();
    // 글을 지우고 바깥을 누르면 접힌다.
    await input.fill('');await page.mouse.click(60,22);await expect(q).toHaveAttribute('data-quick-rest','');
  });
  test('the place sheet opened from the box does not fold it',async({page})=>{
    await openHome(page,{quickRest:true});const q=quick(page);
    await q.locator('[data-quick-kind]').click();await q.locator('[data-quick-org]').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').getByRole('button',{name:'테스트 조직',exact:true}).first().click();
    await expect(q).not.toHaveAttribute('data-quick-rest','');
    await page.getByRole('dialog').getByRole('button',{name:'저장',exact:true}).click();
    await expect(q.locator('[data-quick-org]')).toBeFocused();await expect(q).not.toHaveAttribute('data-quick-rest','');
  });
});
for(const [name,width,height] of [['fold-open-870',870,1000],['pc-1280',1280,800]]){
  test.describe(name,()=>{
    test.use({viewport:{width,height}});
    test('keeps the full box (no fold on a wide screen)',async({page})=>{
      await openHome(page);const q=quick(page);
      await expect(q.locator('[data-quick-mode="update"]')).toBeVisible();await expect(q.locator('[data-quick-save]')).toBeVisible();
      await expect(q.locator('[data-quick-kind]')).toBeHidden();
      if(shot)await page.screenshot({path:shot+`/${name}.png`});
    });
  });
}
