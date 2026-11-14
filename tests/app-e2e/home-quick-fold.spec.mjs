import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
// HOME-입력칸두모양(S61-44, 명진 11/14 12:44 '한 줄·두 줄·세 줄 왔다 갔다' → 12:50 'ㄱ'): 폰 홈 빠른 입력은 모양이 둘뿐이다.
// (가) 평소 한 줄 [종류 ▾][입력칸][잊지 말기 n] (나) [할 일]에서 글이 있거나 포커스일 때만 날짜 줄 한 줄이 입력칸 위에 붙는다.
// [업데이트 | 할 일] 단추 줄은 폰 홈에 없다. 글을 쓰면 [잊지 말기] 자리에 [추가]가 온다(쓰는 동안 바뀌는 것은 이 한 번뿐).
// 업데이트는 늘 한 줄. PC·폴드 펼침(761px~)은 그대로. (옛 UI-폰하단고정 접힘 시험을 이 규칙으로 바꿈.)
const quick=page=>page.locator('#homeView [data-home-quick]');
const shot=process.env.S61_44_SHOTS;
const rowH=async q=>(await q.boundingBox()).height;
// 박스 높이가 바뀐 횟수를 센다(누를 때 한 번만 바뀌는지 보기). ResizeObserver로 그려진 높이만 적는다.
const watchHeights=page=>page.evaluate(()=>{const box=document.querySelector('#homeView [data-home-quick]');window.__qh=[Math.round(box.getBoundingClientRect().height)];new ResizeObserver(()=>{const h=Math.round(box.getBoundingClientRect().height);if(window.__qh.at(-1)!==h)window.__qh.push(h);}).observe(box);});
const heights=page=>page.evaluate(()=>window.__qh.slice());
async function pickKind(page,name){const q=quick(page);await q.locator('[data-quick-kind]').click();await page.locator('#homeQuickKindMenu').getByRole('button',{name,exact:true}).click();}
test.describe('phone 412',()=>{
  test.use({viewport:{width:412,height:915}});
  test('평소 한 줄: [종류 ▾][입력칸][잊지 말기], 단추 줄 없음, 하단바 바로 위',async({page})=>{
    await openHome(page);const q=quick(page),kind=q.locator('[data-quick-kind]'),input=q.locator('[data-quick-input]');
    await expect(q).toHaveAttribute('data-quick-shape','line');
    await expect(kind).toBeVisible();await expect(kind).toHaveText('업데이트 ▾');
    await expect(q.locator('.home-quick-modes')).toBeHidden();await expect(q.locator('[data-quick-options]')).toBeHidden();
    await expect(q.locator('[data-home-forget-open]')).toBeVisible();await expect(q.locator('[data-quick-save]')).toBeHidden();
    const [k,i,c]=await Promise.all([kind,input,q.locator('[data-home-forget-open]')].map(x=>x.boundingBox()));
    const mid=b=>b.y+b.height/2;expect(Math.abs(mid(k)-mid(i))).toBeLessThan(i.height/2);expect(Math.abs(mid(c)-mid(i))).toBeLessThan(i.height/2);
    expect(k.x+k.width).toBeLessThanOrEqual(i.x+1);expect(i.x+i.width).toBeLessThanOrEqual(c.x+1);
    expect(await rowH(q)).toBeLessThanOrEqual(50);
    const tab=await page.evaluate(()=>parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--kptu-mobile-tab-height'))||0);
    const b=await q.boundingBox();expect(Math.round(b.y+b.height)).toBe(915-tab);
    if(shot)await page.screenshot({path:shot+'/phone-412-rest.png'});
  });
  test('업데이트: 칸을 누르고 써도 늘 한 줄, 쓰는 동안 [잊지 말기] 자리에 [추가] (바뀜은 한 번)',async({page})=>{
    await openHome(page);const q=quick(page),input=q.locator('[data-quick-input]');
    const rest=await rowH(q);await watchHeights(page);
    await input.click();await expect(input).toBeFocused();
    await expect(q).toHaveAttribute('data-quick-shape','line');expect(await rowH(q)).toBe(rest);
    await input.pressSequentially('적어 둔 글');
    await expect(q).toHaveAttribute('data-quick-shape','typing');
    await expect(q.locator('[data-quick-save]')).toBeVisible();await expect(q.locator('[data-home-forget-open]')).toBeHidden();
    await expect(q.locator('[data-quick-options]')).toBeHidden();await expect(q.locator('.home-quick-modes')).toBeHidden();
    expect(await rowH(q)).toBe(rest);expect(await heights(page)).toEqual([rest]);
    if(shot)await page.screenshot({path:shot+'/phone-412-update-typing.png'});
    await input.fill('');await expect(q).toHaveAttribute('data-quick-shape','line');await expect(q.locator('[data-home-forget-open]')).toBeVisible();
  });
  test('할 일: 누르면 날짜 줄이 한 번에 붙고, 날짜를 눌러도 그대로, 비우고 밖을 누르면 한 줄',async({page})=>{
    await openHome(page);const q=quick(page),input=q.locator('[data-quick-input]');
    await pickKind(page,'할 일');await expect(q.locator('[data-quick-kind]')).toHaveText('할 일 ▾');
    // 종류를 고르면 입력칸으로 바로 간다(포커스) → 날짜 줄.
    await expect(input).toBeFocused();await expect(q).toHaveAttribute('data-quick-shape','dates');
    await input.blur();await page.mouse.click(200,300);await expect(q).toHaveAttribute('data-quick-shape','line');
    const rest=await rowH(q);await watchHeights(page);
    await input.click();await expect(q).toHaveAttribute('data-quick-shape','dates');await expect(q.locator('[data-quick-options]')).toBeVisible();
    await expect(q.locator('.home-quick-modes')).toBeHidden();
    // 날짜 줄은 입력칸 위.
    const [o,i]=await Promise.all([q.locator('[data-quick-options]'),input].map(x=>x.boundingBox()));expect(o.y+o.height).toBeLessThanOrEqual(i.y+1);
    const open=await rowH(q);expect(open).toBeGreaterThan(rest);expect(await heights(page)).toEqual([rest,open]);
    // 날짜 줄은 한 줄(단추가 다음 줄로 넘어가지 않음).
    expect((await q.locator('[data-quick-task-options]').boundingBox()).height).toBeLessThanOrEqual(44);
    await q.locator('[data-quick-day="tomorrow"]').click();await expect(q.locator('[data-quick-day="tomorrow"]')).toHaveAttribute('aria-pressed','true');
    await expect(q).toHaveAttribute('data-quick-shape','dates');
    await input.click();await input.pressSequentially('내일 할 일');await expect(q).toHaveAttribute('data-quick-shape','dates typing');
    await expect(q.locator('[data-quick-save]')).toBeVisible();await expect(q.locator('[data-home-forget-open]')).toBeHidden();
    expect(await heights(page)).toEqual([rest,open]);
    if(shot)await page.screenshot({path:shot+'/phone-412-task-typing.png'});
    // 글이 있으면 밖을 눌러도 날짜 줄은 남고, 비우고 밖을 누르면 한 줄.
    await page.mouse.click(200,300);await expect(q).toHaveAttribute('data-quick-shape','dates typing');
    await input.fill('');await page.mouse.click(200,300);await expect(q).toHaveAttribute('data-quick-shape','line');
    expect(await rowH(q)).toBe(rest);
  });
  test('[종류 ▾] → 기록할 곳 선택: 고르기 창, 고르고 저장해도 한 줄',async({page})=>{
    await openHome(page);const q=quick(page);
    await pickKind(page,'기록할 곳 선택…');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').getByRole('button',{name:'테스트 조직',exact:true}).first().click();
    await page.getByRole('dialog').getByRole('button',{name:'저장',exact:true}).click();
    await expect(q.locator('[data-quick-input]')).toHaveAttribute('placeholder',/테스트 조직/);
    await expect(q).toHaveAttribute('data-quick-shape','line');await expect(q.locator('[data-quick-kind]')).toHaveText('업데이트 ▾');
  });
});
// 폴드 덮개 화면 폭(344px)에서도 날짜 줄은 한 줄이고 평소 한 줄에 가로 넘침이 없다.
test.describe('phone 344',()=>{
  test.use({viewport:{width:344,height:800}});
  test('날짜 줄 한 줄, 가로 넘침 없음',async({page})=>{
    await openHome(page);const q=quick(page);
    await expect(q).toHaveAttribute('data-quick-shape','line');expect(await rowH(q)).toBeLessThanOrEqual(50);
    await pickKind(page,'할 일');await expect(q).toHaveAttribute('data-quick-shape','dates');
    expect((await q.locator('[data-quick-task-options]').boundingBox()).height).toBeLessThanOrEqual(44);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(await q.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  });
});
for(const [name,width,height] of [['fold-open-870',870,1000],['pc-1280',1280,800]]){
  test.describe(name,()=>{
    test.use({viewport:{width,height}});
    test('keeps the full box (no shape, no kind button on a wide screen)',async({page})=>{
      await openHome(page);const q=quick(page);
      await expect(q.locator('[data-quick-mode="update"]')).toBeVisible();await expect(q.locator('[data-quick-save]')).toBeVisible();
      await expect(q.locator('[data-quick-kind]')).toBeHidden();await expect(q).not.toHaveAttribute('data-quick-shape',/.*/);
      if(shot)await page.screenshot({path:shot+`/${name}.png`});
    });
  });
}
