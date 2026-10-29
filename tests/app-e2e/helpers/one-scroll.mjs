// UI-칸안스크롤하나로(2026-10-30 사용자 결정, 시안 A): PC 화면의 스크롤은 문서 하나다.
// root 안에서 보이는 요소 중 스스로 세로 스크롤 틀(overflow-y auto/scroll)이면서 실제로 넘치는 것을 찾는다(사이드바·창은 root 밖).
export const innerScrollers = (page, root) => page.evaluate(sel => {
  const out = [];
  for (const el of document.querySelectorAll(`${sel}, ${sel} *`)) {
    if (!el.getClientRects().length) continue;
    const oy = getComputedStyle(el).overflowY;
    if (/(auto|scroll)/.test(oy) && el.scrollHeight > el.clientHeight + 4) out.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${[...el.classList].join('.')}`);
  }
  return out;
}, root);
// 문서 세로 스크롤 막대가 하나(문서가 화면보다 김)이고 가로 넘침이 없는지.
export const docScroll = page => page.evaluate(() => ({ over: document.documentElement.scrollHeight - innerHeight, wide: document.documentElement.scrollWidth - innerWidth }));
