import {expect} from '@playwright/test';
// UI-칸폭끌기전수(요청함 10/30 10:29): 공용 split-resize.js를 붙인 좌우 칸 화면 하나를 같은 순서로 확인한다.
// 경계 있음(role=separator) → 기본 비율 → 끌기로 절반 → 서버(view_prefs.split_ratio.<name>)에 기억 → 키보드 ← → 새로고침 뒤 유지
// → 두 번 누르면 기본(서버 값 지움). 가로 스크롤이 생기지 않는다. 칸 자리는 화면 안에서 한 번에 읽는다(다시 그리기 사이에 요소가 바뀌어도 안전).
const settle=page=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const measure=(page,s)=>page.evaluate(({container,left,right})=>{
  const c=document.querySelector(container),l=c?.querySelector(left),r=c?.querySelector(right);if(!l||!r)throw new Error('칸 없음: '+container);
  const a=l.getBoundingClientRect(),b=r.getBoundingClientRect();return {left:a.width,right:b.width,ratio:a.width/(a.width+b.width),apart:b.x>=a.x+a.width-1};
},{container:s.container,left:s.left,right:s.right}); // 선택자만 넘긴다(함수·서버 상태는 화면에 못 보냄)
const handleBox=(page,s)=>page.evaluate(sel=>{const h=document.querySelector(sel+'>.split-resize-handle');const b=h.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height}},s.container);
// 왼쪽 몫이 r이 되는 x(두 칸이 나눠 쓰는 폭 = 내용 폭 - 칸 사이 틈).
const xFor=(page,s,r)=>page.evaluate(([sel,r])=>{const c=document.querySelector(sel),st=getComputedStyle(c),g=parseFloat(st.columnGap)||0,b=c.getBoundingClientRect(),pl=parseFloat(st.paddingLeft)||0,w=c.clientWidth-pl-(parseFloat(st.paddingRight)||0)-g;return b.left+pl+r*w+g/2},[s.container,r]);
async function dragTo(page,s,x){
  const b=await handleBox(page,s),y=b.y+Math.min(b.height/2,120);
  await page.mouse.move(b.x+b.width/2,y);await page.mouse.down();
  await page.mouse.move((b.x+b.width/2+x)/2,y,{steps:4});await page.mouse.move(x,y,{steps:4});await page.mouse.up();await settle(page);
}
/**
 * @param {import('@playwright/test').Page} page
 * @param {{container:string,left:string,right:string,name:string,share:number,server:{value:any},reopen:()=>Promise<void>}} s
 *   container: 칸 격자, left/right: 그 안 두 칸(container 기준 선택자), name: 서버 이름, share: 기본 왼쪽 몫, reopen: 새로고침 뒤 다시 그 화면을 여는 법
 */
export async function checkSplit(page,s){
  const stored=()=>s.server.value?.split_ratio?.[s.name]??null;
  const handle=page.locator(`${s.container}>.split-resize-handle`);
  await expect(handle).toBeVisible();await expect(handle).toHaveCount(1);
  await expect(handle).toHaveAttribute('role','separator');await expect(handle).toHaveAttribute('aria-orientation','vertical');
  await settle(page);
  let m=await measure(page,s);expect(m.apart).toBe(true);expect(Math.abs(m.ratio-s.share)).toBeLessThan(0.03);
  expect(stored()).toBeNull();
  // 끌기: 절반으로 → 화면·서버 둘 다.
  await dragTo(page,s,await xFor(page,s,0.5));
  m=await measure(page,s);expect(Math.abs(m.ratio-0.5)).toBeLessThan(0.02);
  await expect(handle).toHaveAttribute('aria-valuenow','50');
  await expect.poll(()=>Math.abs(Number(stored())-0.5)).toBeLessThan(0.02);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  // 키보드: 경계에 초점 → ← 한 번에 2%.
  await handle.focus();await page.keyboard.press('ArrowLeft');await settle(page);
  await expect(handle).toHaveAttribute('aria-valuenow','48');
  await expect.poll(()=>Math.abs(Number(stored())-0.48)).toBeLessThan(0.02);
  // 새로고침(다른 PC도 같은 서버 값을 읽는다) 뒤에도 그대로.
  await page.reload();await s.reopen();await expect(handle).toBeVisible();await settle(page);
  await expect.poll(async()=>Math.abs((await measure(page,s)).ratio-0.48)).toBeLessThan(0.02);
  // 두 번 누르면 기본, 서버 값은 지운다.
  const b=await handleBox(page,s);await page.mouse.dblclick(b.x+b.width/2,b.y+Math.min(b.height/2,120));await settle(page);
  m=await measure(page,s);expect(Math.abs(m.ratio-s.share)).toBeLessThan(0.03);
  await expect.poll(stored).toBeNull();
}
