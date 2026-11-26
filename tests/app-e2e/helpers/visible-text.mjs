// 눈에 보이는 글만 모은다(S70-64b): 화면 읽기에만 남긴 글(1px로 잘라 둔 상태 글·아이콘만일 때 단추 이름)과 숨긴 칸은 빼고,
// 실제로 그려진 글자 칸(폭·높이 2px 넘음, visibility 보임)만 이어 붙인다. innerText는 잘라 둔 글도 돌려주므로 쓰지 않는다.
export function visibleText(locator) {
  return locator.evaluate(root => {
    const out = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n.textContent.trim(); if (!t) continue;
      const el = n.parentElement; if (!el || getComputedStyle(el).visibility === 'hidden') continue;
      let ok = true;
      for (let a = el; a && ok; a = a === root ? null : a.parentElement) { const r = a.getBoundingClientRect(); ok = r.width > 2 && r.height > 2; }
      if (ok) out.push(t);
    }
    return out.join(' ');
  });
}
