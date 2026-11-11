// S57-23 UI-파일줄메뉴비침: 열린 줄 ⋯ 메뉴(panelSelector)가 화면에서 정말 맨 위에 그려지는지 '눈이 보는 그대로' 잰다.
// 메뉴 상자 안 몇 자리(항목 가운데·상자 안쪽 모서리)와, 메뉴와 겹치는 다른 줄 ⋯ 단추(triggerSelector)의 겹침 한가운데에서
// document.elementFromPoint가 메뉴 안의 것을 돌려주는지 본다. 메뉴 밖의 것(예: 아래 줄 ⋯ 단추)이 돌려지면 그 자리가 '비친' 곳이다.
// 화면 밖(스크롤로 안 보이는) 자리는 elementFromPoint가 null이라 건너뛴다. 돌려주는 값은 비친 자리 목록(비면 맨 위).
export async function coveredPoints(page, panelSelector, triggerSelector = '') {
  return page.evaluate(([panelSel, trigSel]) => {
    const panel = document.querySelector(panelSel);
    if (!panel) return {missing: true, bad: [], sampled: 0};
    const r = panel.getBoundingClientRect(), pts = [];
    const add = (x, y, why) => { if (x >= 0 && y >= 0 && x < innerWidth && y < innerHeight) pts.push({x, y, why}); };
    for (const b of panel.querySelectorAll('button,a,[role="menuitem"]')) { const q = b.getBoundingClientRect(); if (q.width && q.height) add(q.left + q.width / 2, q.top + q.height / 2, `항목 ${(b.textContent || '').trim().slice(0, 10)}`); }
    for (const [fx, fy] of [[0.04, 0.05], [0.96, 0.05], [0.04, 0.95], [0.96, 0.95]]) add(r.left + r.width * fx, r.top + r.height * fy, `상자 ${fx}/${fy}`);
    if (trigSel) for (const t of document.querySelectorAll(trigSel)) {
      if (panel.contains(t) || panel.parentElement?.contains(t) && t.closest('details,[data-row-menu-row]') === panel.closest('details,[data-row-menu-row]')) continue;
      const q = t.getBoundingClientRect(), x0 = Math.max(q.left, r.left), x1 = Math.min(q.right, r.right), y0 = Math.max(q.top, r.top), y1 = Math.min(q.bottom, r.bottom);
      if (x1 > x0 && y1 > y0) add((x0 + x1) / 2, (y0 + y1) / 2, `겹친 다른 줄 ⋯ ${(t.getAttribute('aria-label') || t.textContent || '').trim().slice(0, 16)}`);
    }
    const bad = [];
    for (const p of pts) { const el = document.elementFromPoint(p.x, p.y); if (!el || !panel.contains(el)) bad.push(`${p.why} → ${el ? el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : '') : 'null'}`); }
    return {missing: false, bad, sampled: pts.length};
  }, [panelSelector, triggerSelector]);
}
