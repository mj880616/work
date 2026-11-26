// UI-덮어쓰기땜질없애기(S71-74): 화면을 연 순간(최종 보이기 직후 첫 그림)과 1.5초 뒤의 주요 줄 위치를 비교하는 공용 시험 도구.
// 한 화면 영역은 그리는 곳 하나 — 첫 그림부터 최종 모양이면 두 그림 사이에 줄이 움직이지 않는다(AGENTS.md 5절).
// 늦게 지워지는 줄·늦게 끼어드는 줄·나중에 옮겨지는 단추가 있으면 그 아래 줄들이 움직여 여기서 잡힌다.
// 재는 것: 보이는 화면 칸(#<view>View) 안에서 화면 위쪽(창 높이 안)에 보이는 '줄' 요소(블록 상자, 높이 8px 이상)의 위끝·왼끝.
// 두 그림 모두에 있는 요소만 비교한다(늦게 나타난 줄 자체는 이동이 아니지만, 그 줄이 위에 끼어 아래 줄을 밀면 밀린 줄이 잡힌다).

// 화면 칸을 찾는 식(브라우저 안). 노트·잊지 말기는 #basketView 하나를 함께 쓴다.
export const panelSelector = view => (view === 'note' ? '#basketView' : `#${view}View`);

// 누르기(open)를 하고, 화면 칸이 처음 보이는 틀에서 한 번, 그 뒤 settleMs 뒤에 한 번 잰다. 반환: {first, later, moved}
export async function measureSettle(page, view, open, {settleMs = 1500, tolerance = 2} = {}) {
  const sel = panelSelector(view);
  await page.evaluate(({sel, view}) => {
    const measure = () => {
      const panel = document.querySelector(sel);
      if (!panel || panel.classList.contains('hidden') || panel.hidden || !panel.checkVisibility?.()) return null;
      if (view === 'note' && panel.dataset.kind !== 'note') return null;
      if (view === 'basket' && panel.dataset.kind === 'note') return null;
      const out = {}, seen = new Map();
      const walk = (el, depth, path) => {
        if (depth > 5) return;
        let i = 0;
        for (const child of el.children) {
          const key = `${path}/${child.tagName.toLowerCase()}${child.id ? '#' + child.id : ''}${[...child.classList].slice(0, 2).map(c => '.' + c).join('')}`;
          const n = (seen.get(key) || 0) + 1; seen.set(key, n);
          const id = n > 1 ? `${key}[${n}]` : key;
          i++;
          if (!child.checkVisibility?.()) continue;
          const cs = getComputedStyle(child);
          if (cs.position === 'fixed' || cs.position === 'sticky') continue; // 바닥에 붙은 줄은 스크롤과 별개
          const r = child.getBoundingClientRect();
          if (r.height >= 8 && r.width >= 8 && r.top < innerHeight && r.bottom > 0 && cs.display !== 'inline') out[id] = {top: Math.round(r.top), left: Math.round(r.left), text: (child.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 24)};
          walk(child, depth + 1, id);
        }
      };
      walk(panel, 0, sel);
      return out;
    };
    window.__settle = new Promise(resolve => {
      const t0 = performance.now();
      const tick = () => {
        const first = measure();
        if (first && Object.keys(first).length) {
          setTimeout(() => requestAnimationFrame(() => resolve({first, later: measure() || {}, at: Math.round(performance.now() - t0)})), 1500);
          return;
        }
        if (performance.now() - t0 > 15000) { resolve({first: {}, later: {}, at: -1}); return; }
        requestAnimationFrame(tick);
      };
      window.__settleStart = () => requestAnimationFrame(tick);
    });
  }, {sel, view});
  await page.evaluate(() => window.__settleStart());
  await open();
  const {first, later, at} = await page.evaluate(() => window.__settle);
  const moved = [];
  for (const [id, a] of Object.entries(first)) {
    const b = later[id];
    if (!b) continue;
    const dy = b.top - a.top, dx = b.left - a.left;
    if (Math.abs(dy) > tolerance || Math.abs(dx) > tolerance) moved.push({id, dy, dx, text: a.text});
  }
  // 바깥 줄이 움직이면 안쪽 줄도 같이 움직이므로, 가장 바깥(경로가 짧은) 것부터 보이게 정렬한다.
  moved.sort((x, y) => x.id.split('/').length - y.id.split('/').length);
  return {first, later, moved, at, settleMs};
}

// 느린 서버 흉내: 이미 붙인 흉내 서버 응답을 ms만큼 늦게 보낸다(뒤에 붙인 route가 먼저 불리고 fallback으로 앞의 흉내로 넘어간다).
export async function slowServer(page, ms = 700, origin = 'https://xmlkxfjeagycwttklxjw.supabase.co') {
  await page.route(u => u.origin === origin, async route => { await new Promise(r => setTimeout(r, ms)); await route.fallback(); });
}
