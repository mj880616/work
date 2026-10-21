import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
// UI-빈입력안내: 홈·바구니 업데이트 입력에서 글 없이 [추가]를 누르면 입력칸 바로 아래 작은 안내 한 줄만 — 글자 크기는 목록 빈 안내
// ("아직 업데이트가 없어요")와 같고, 빨간 글자·테두리 색 변화 없음. 화면 읽기 도구용 role=status 유지. 글을 쓰기 시작하면 사라짐. PC·폰 공통.
const borders=(page,root)=>page.evaluate(root=>[document.querySelector(root+' .home-quick'),...document.querySelectorAll(root+' .home-quick *')].map(el=>{const c=getComputedStyle(el);return [c.borderTopColor,c.borderRightColor,c.borderBottomColor,c.borderLeftColor,c.outlineStyle,c.outlineColor,c.boxShadow].join(' ');}),root);
const color=(page,value)=>page.evaluate(value=>{const p=document.createElement('span');p.style.color=value;document.body.append(p);const c=getComputedStyle(p).color;p.remove();return c;},value);
for(const [view,width] of [['basket',1280],['basket',390],['home',1280],['home',390]])test(`빈 [추가]: 입력칸 아래 작은 안내만, 글 쓰면 사라짐 — ${view} ${width}`,async({page})=>{
 await page.setViewportSize({width,height:844});await openHome(page,{query:view==='basket'?'?view=basket':''});
 const root=view==='basket'?'#basketView [data-basket-list]':'#homeView',q=page.locator(root+' [data-home-quick]');
 if(view==='home')await q.locator('[data-quick-mode="update"]').click();
 const before=await borders(page,root);
 await q.locator('[data-quick-save]').click();
 const hint=q.getByRole('status').filter({hasText:'글을 입력해 주세요.'});await expect(hint).toBeVisible();await expect(hint).toHaveCount(1);
 // Nothing was saved and no other status line says it.
 await expect(q.locator('[data-quick-status]')).toHaveText('');
 // No border or outline changed anywhere in the input group.
 expect(await borders(page,root)).toEqual(before);
 // Same size as the list's empty notice (the basket list status), and not the danger red.
 // The basket screen measures its own empty notice; the home (no list there) uses the size that notice is drawn with.
 const emptySize=view==='basket'?await page.locator('#basketView [data-basket-list-status]').evaluate(el=>getComputedStyle(el).fontSize):await page.evaluate(()=>{const p=document.createElement('span');p.style.fontSize='var(--ds-text-section)';document.body.append(p);const s=getComputedStyle(p).fontSize;p.remove();return s;});
 expect(await hint.evaluate(el=>getComputedStyle(el).fontSize)).toBe(emptySize);
 expect(await hint.evaluate(el=>getComputedStyle(el).color)).not.toBe(await color(page,'var(--kptu-danger)'));
 // Right under the input row.
 const entry=await q.locator('.home-quick-entry').boundingBox(),b=await hint.boundingBox();
 expect(b.y).toBeGreaterThanOrEqual(entry.y+entry.height-1);expect(b.y-(entry.y+entry.height)).toBeLessThanOrEqual(16);
 // Typing removes it.
 await q.locator('[data-quick-input]').pressSequentially('가');await expect(hint).toBeHidden();
 await expect(q.locator('[data-quick-hint]')).toHaveText('');
});
