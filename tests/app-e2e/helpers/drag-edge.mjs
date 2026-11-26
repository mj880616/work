// S70-75 STD-끌기자동스크롤(D3): 무엇이든 끄는 동안 칸 끝에 대고 있으면 그 칸이 저절로 굴러, 화면 밖에 있던 자리에 놓을 수 있는지 본다.
// 세 가지 끌기 입력을 같은 순서로 흉내 낸다 — mouse(포인터 끌기: 노트·줄 순서), html(PC HTML 끌기: 파일·자료실), touch(손가락 길게 눌러 끌기).
// 1) from을 잡는다 → 2) 칸(box, 없으면 화면) 끝(dir: down = 아래 끝, up = 위 끝)으로 가 손을 멈춘다 → 3) 칸이 그쪽 끝까지 구를 때까지 기다린다
//    (손을 멈춰도 굴러야 한다) → 4) 이제 보이는 to에 놓는다. 칸 끝까지 구른 뒤에 놓으므로 놓는 동안 자리가 흔들리지 않는다.
// 굴러가지 않으면 3)에서 실패한다(고치기 전 실패 확인용). 이름은 지어낸 것.
import { expect } from '@playwright/test';

const center = l => l.evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, bottom: r.bottom }; });
// 칸의 보이는 위·아래(화면 안쪽만)와 스크롤 값. box가 없으면 화면.
// 화면 위·아래에 떠 있는 줄(폰 아래 메뉴 막대 등)은 칸이 아니라서 그 안쪽만 본다(app/drag-edge-scroll.js viewBand와 같은 규칙).
const boxState = (page, box) => (box || page.locator(':root')).evaluate((el, whole) => {
  const H = innerHeight, bar = y => { for (let n = document.elementFromPoint(innerWidth / 2, y); n && n !== document.body && n !== document.documentElement; n = n.parentElement) { const p = getComputedStyle(n).position; if (p === 'fixed' || p === 'sticky') { const r = n.getBoundingClientRect(); return r.height < H / 3 ? r : null; } } return null; };
  const t = bar(1), b = bar(H - 1), top = t && t.top <= 1 ? t.bottom : 0, bottom = b && b.bottom >= H - 1 ? b.top : H;
  if (whole) { const s = document.scrollingElement; return { top, bottom, left: 0, right: innerWidth, pos: s.scrollTop, max: s.scrollHeight - H }; }
  const r = el.getBoundingClientRect();
  return { top: Math.max(top, r.top), bottom: Math.min(bottom, r.bottom), left: r.left, right: r.right, pos: el.scrollTop, max: el.scrollHeight - el.clientHeight };
}, !box);
// 끝에 닿았나(1px 여유).
const atEnd = (s, dir) => dir === 'down' ? s.pos >= s.max - 1 : s.pos <= 0;

export async function dragPastEdge(page, { mode, from, to, box = null, dir = 'down', dy = 0, hold = 650, timeout = 10000 }) {
  // 잡을 줄은 칸 가운데로(폰 아래에 떠 있는 막대에 가리지 않게).
  await from.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  const before = await boxState(page, box);
  expect(atEnd(before, dir), '시작할 때 칸이 이미 끝이면 굴러가는지 볼 수 없다').toBe(false);
  const t0 = await center(to);
  expect(t0.bottom < before.top || t0.top > before.bottom || (dir === 'down' ? t0.bottom > before.bottom : t0.top < before.top), '놓을 곳은 처음에 칸 밖(가려진 자리)').toBe(true);
  const a = await center(from);
  const edge = { x: Math.round(Math.min(Math.max(a.x, before.left + 8), before.right - 8)), y: Math.round(dir === 'down' ? before.bottom - 6 : before.top + 6) };
  let cdp = null;
  const touch = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y, id: 0 }] : [] });
  const glide = async (p0, p1, n) => { for (let i = 1; i <= n; i++) { await touch('touchMove', { x: p0.x + (p1.x - p0.x) * i / n, y: p0.y + (p1.y - p0.y) * i / n }); await page.waitForTimeout(16); } };
  // 1)·2) 잡고 끝으로
  if (mode === 'mouse') {
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    await page.mouse.move(a.x, a.y + (dir === 'down' ? 12 : -12), { steps: 3 });
    await page.mouse.move(edge.x, edge.y, { steps: 8 });
  } else if (mode === 'touch') {
    cdp = await page.context().newCDPSession(page);
    await touch('touchStart', a); await page.waitForTimeout(hold);
    await glide(a, edge, 8);
  } else {
    await from.evaluate(el => { window.__dt = new DataTransfer(); el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: window.__dt })); });
    // 브라우저는 손을 멈춰도 dragover를 계속 보낸다(50ms마다 흉내).
    await page.evaluate(({ x, y }) => { clearInterval(window.__hold); const go = () => document.elementFromPoint(x, y)?.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: window.__dt, clientX: x, clientY: y })); go(); window.__hold = setInterval(go, 50); }, edge);
  }
  // 3) 손을 멈춘 채 칸이 끝까지 구른다.
  await expect.poll(async () => atEnd(await boxState(page, box), dir), { timeout, message: '끝에 대고 있으면 칸이 저절로 굴러 끝에 닿는다' }).toBe(true);
  // 4) 이제 보이는 놓을 곳으로(칸은 끝이라 더 구르지 않는다).
  const end = await boxState(page, box), b = await center(to);
  expect(b.top >= end.top - 1 && b.bottom <= end.bottom + 1, '놓을 곳이 칸 안에 보인다').toBe(true);
  const p = { x: Math.round(b.x), y: Math.round(b.y + dy) };
  if (mode === 'mouse') { await page.mouse.move(p.x, p.y, { steps: 8 }); await page.waitForTimeout(80); await page.mouse.up(); }
  else if (mode === 'touch') { await glide(edge, p, 6); await page.waitForTimeout(120); await touch('touchEnd'); }
  // 손가락 흉내 연결(cdp)은 끊지 않는다: touchEnd 바로 뒤에 끊으면 그 뒤 page.evaluate가 돌아오지 않는 일이 있었다(시험이 끝나면 페이지와 함께 닫힌다).
  else await page.evaluate(({ x, y }) => { clearInterval(window.__hold); const el = document.elementFromPoint(x, y); const o = { bubbles: true, cancelable: true, dataTransfer: window.__dt, clientX: x, clientY: y };
    el.dispatchEvent(new DragEvent('dragover', o)); el.dispatchEvent(new DragEvent('drop', o)); document.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: window.__dt })); }, p);
}
