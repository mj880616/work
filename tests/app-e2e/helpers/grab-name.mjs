// STD-끌기시작(S71-45, docs/design/standard-interactions.md S12): PC 목록 줄 옮기기는 아이콘 + 이름 글자 위에서만 시작한다
// (같은 줄의 나머지 — 이름 오른쪽 빈 곳·날짜·크기·종류 칸·줄 왼쪽 띠 — 에서 끌면 사각형 고르기). 시험의 끌기도 사람처럼 이름 글자를 잡는다.
// 이름 칸이 없는 줄(폴더 나무 줄 등)은 지금처럼 줄 가운데.
export const NAME_SEL = '.fx-name, .lu-row-title, .lu-node-name';

// 줄 상자 안 기준의 '이름 글자 첫머리' 자리(sourcePosition 모양).
export async function nameSpot(row, sel = NAME_SEL) {
  return row.evaluate((el, sel) => {
    const r = el.getBoundingClientRect(), n = el.matches(sel) ? el : el.querySelector(sel);
    if (!n || !n.getClientRects().length) return { x: r.width / 2, y: r.height / 2 };
    const range = document.createRange(); range.selectNodeContents(n);
    const t = range.getBoundingClientRect(), b = n.getBoundingClientRect();
    const left = Math.max(t.left, b.left), right = Math.min(t.right, b.right), top = Math.max(t.top, b.top), bottom = Math.min(t.bottom, b.bottom);
    return { x: left + Math.min(8, Math.max(1, (right - left) / 2)) - r.left, y: (top + bottom) / 2 - r.top };
  }, sel);
}
// 이름 글자를 잡고 끌어 놓기(Playwright dragTo와 같은 꼴, 옵션도 같다).
export async function dragByName(src, dst, opts = {}) {
  await src.dragTo(dst, { ...opts, sourcePosition: await nameSpot(src) });
}
// 화면 좌표로 이름 글자 첫머리(마우스로 직접 끌 때).
export async function namePoint(row, sel = NAME_SEL) {
  const b = await row.boundingBox(), p = await nameSpot(row, sel);
  return { x: b.x + p.x, y: b.y + p.y };
}
