// UI-고르기줄(S48-54): 공용 고르기 줄(.kptu-actbar)을 재는 도우미. @playwright/test에 의존하지 않는다(검사는 부르는 쪽).
// 잰 값: 보이는 버튼 칸(.kptu-act)의 폭·줄(같은 세로 가운데끼리. 칸은 세로 가운데 맞춤이라, 한 칸 이름만 두 줄이면 위쪽 끝이 달라도 같은 줄이다)·칸 사이 간격·줄 양 끝 여백·글자 잘림·지우기 색.
export async function measureActBar(page, selector) {
  return page.evaluate(sel => {
    const bar = document.querySelector(sel); if (!bar) return null;
    const br = bar.getBoundingClientRect(), cs = getComputedStyle(bar);
    const inner = {left: br.left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth), right: br.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth)};
    const buttons = [...bar.querySelectorAll(':scope > .kptu-act')].filter(b => b.getClientRects().length);
    const cells = buttons.map(b => { const r = b.getBoundingClientRect(); return {label: b.textContent.trim(), x: r.left, right: r.right, y: Math.round(r.top + r.height / 2), w: r.width, h: r.height, clipped: b.scrollWidth > b.clientWidth + 1}; });
    const rows = {}; for (const c of cells) (rows[c.y] ||= []).push(c);
    const rowList = Object.values(rows).map(r => r.sort((a, b) => a.x - b.x));
    const spread = list => list.length ? Math.max(...list) - Math.min(...list) : 0;
    const gaps = rowList.flatMap(r => r.slice(1).map((c, i) => c.x - r[i].right));
    const first = rowList[0] || [];
    const danger = bar.querySelector(':scope > .kptu-act-danger');
    const dangerText = danger && getComputedStyle(danger.querySelector('.kptu-act-tx') || danger).color;
    const dangerIcon = danger?.querySelector('.kptu-act-ic') ? getComputedStyle(danger.querySelector('.kptu-act-ic')).color : null;
    const icons = [...bar.querySelectorAll(':scope > .kptu-act:not([hidden]) .kptu-act-ic')].map(i => getComputedStyle(i).color);
    return {
      n: cells.length, rows: rowList.length, barWidth: Math.round(br.width),
      widths: cells.map(c => Math.round(c.w * 10) / 10), widthSpread: Math.max(0, ...rowList.map(r => spread(r.map(c => c.w)))),
      maxWidth: Math.max(0, ...cells.map(c => c.w)), minHeight: Math.min(...cells.map(c => c.h)),
      gapSpread: spread(gaps), leftGap: first.length ? first[0].x - inner.left : 0, rightGap: first.length ? inner.right - first.at(-1).right : 0,
      clipped: cells.filter(c => c.clipped).map(c => c.label), overflow: bar.scrollWidth > bar.clientWidth + 1,
      dangerText, dangerIcon, iconColors: [...new Set(icons)], svgCount: bar.querySelectorAll(':scope > .kptu-act:not([hidden]) .kptu-act-ic svg').length,
      emoji: /[\u{1F4C1}\u{1F5D1}]/u.test(bar.textContent),
    };
  }, selector);
}

// 공용 기대값: 칸은 같은 너비(줄마다), 120px 넘지 않음, 간격 같음, 잘림·가로 넘침 없음. 칸이 120px보다 좁으면(폭을 꽉 씀) 양 끝 여백이 줄 안쪽 여백뿐.
export function checkActBar(m, check, label) {
  check(m && m.n > 0, true, `${label}: 보이는 버튼`);
  check(m.widthSpread <= 1.5, true, `${label}: 칸 폭 같음 ${JSON.stringify(m.widths)}`);
  check(m.maxWidth <= 120.5, true, `${label}: 칸 최대 120px (${m.maxWidth})`);
  check(m.gapSpread <= 1.5, true, `${label}: 칸 사이 간격 같음`);
  check(m.clipped, [], `${label}: 글자 잘림`);
  check(m.overflow, false, `${label}: 가로 넘침`);
  check(m.emoji, false, `${label}: 색 그림 이모지(📁·🗑) 없음`);
}

// S69(사용자 11/24 "양쪽 정렬이라 이상함. 왼쪽 정렬"): 글자 줄(.kptu-actbar-text)은 왼쪽부터 촘촘히 — 첫 칸이 줄 왼쪽 끝에 붙고,
// 칸 사이 간격이 같고 작다(12px 이하, 줄 폭에 퍼뜨리지 않음). 잘림·가로 넘침 없음. 줄바꿈된 다음 줄도 왼쪽 끝부터.
export async function textBarRows(page, selector) {
  return page.evaluate(sel => {
    const bar = document.querySelector(sel); if (!bar) return [];
    const left = bar.getBoundingClientRect().left + parseFloat(getComputedStyle(bar).paddingLeft);
    const rows = {};
    for (const b of bar.querySelectorAll(':scope > .kptu-act')) { if (!b.getClientRects().length) continue; const r = b.getBoundingClientRect(); (rows[Math.round(r.top + r.height / 2)] ||= []).push(r); }
    return Object.values(rows).map(r => r.sort((a, b) => a.left - b.left)).map(r => ({lead: r[0].left - left, gaps: r.slice(1).map((c, i) => c.left - r[i].right)}));
  }, selector);
}
export function checkTextBar(m, rows, check, label) {
  check(m && m.n > 0, true, `${label}: 보이는 버튼`);
  check(m.clipped, [], `${label}: 글자 잘림`);
  check(m.overflow, false, `${label}: 가로 넘침`);
  check(m.emoji, false, `${label}: 색 그림 이모지(📁·🗑) 없음`);
  check(m.gapSpread <= 1.5, true, `${label}: 칸 사이 간격 같음`);
  check(rows.every(r => r.lead <= 1), true, `${label}: 줄마다 왼쪽 끝부터 ${JSON.stringify(rows)}`);
  check(rows.every(r => r.gaps.every(g => g <= 12)), true, `${label}: 칸 사이 작은 간격(퍼뜨리지 않음) ${JSON.stringify(rows)}`);
}
