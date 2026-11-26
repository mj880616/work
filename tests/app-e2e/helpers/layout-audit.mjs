// QA-여백겹침점검(S70-25): 지금 보이는 화면에서 '겹침·붙음·자리 표시 남음'을 숫자로 잰다(사람 눈 대신 같은 자로 반복).
// 쓰는 곳: tests/app-e2e/layout-audit.spec.mjs. 기준 값은 docs/qa/layout-audit-20261125.md 'UI-간격기준' 초안과 같다.
// 잰 결과는 {kind, where, text, gap} 목록이다. kind:
//  overlap   — 보이는 버튼·입력칸·링크가 다른 요소에 가려 그 가운데를 누를 수 없다(하단바·떠 있는 막대가 덮는 것 포함).
//  clipped   — 버튼 글자가 버튼 폭을 넘쳐 잘린다(… 줄임 처리 없음).
//  edge      — 글자 줄이 옆 칸 경계선(세로 테두리)에 MIN_X(4px)보다 가깝다(사진2 '빈 폴더').
//  under     — 머리·탭·도구 줄 아래 테두리(가로 테두리)에 그 줄 안 버튼·탭이 MIN_Y(4px)보다 가깝게 붙었거나,
//              그 선 바로 아래 글자(글자 모양 위끝)가 MIN_Y보다 가깝다(사진1 [저장한 글] 탭 줄).
//  touch     — 테두리·바탕이 있는 버튼끼리 0~1px로 붙어 있다(붙은 [한 칸 | 두 칸] 같은 묶음 버튼은 뺀다).
//  skeleton  — 불러오기가 끝났는데 불러오는 중 자리 표시(회색 띠)가 남아 있다.
export const MIN_X = 4, MIN_Y = 4;
export async function measureLayout(page, root = '#appView') {
  return page.evaluate(({ root, MIN_X, MIN_Y }) => {
    // 떠 있는 창(대화 상자)이 열려 있으면 그 창만 잰다(뒤 화면은 창에 덮이는 것이 정상).
    const modal = [...document.querySelectorAll('[role=dialog],[aria-modal=true],.modal:not(.hidden),[id$="Window"]:not(.hidden),#sidebarAccountPanel:not([hidden]),#mobileMenu:not([hidden])')].filter(el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 40 && r.height > 40 && cs.display !== 'none' && cs.visibility !== 'hidden' && !el.hidden; })
      .filter(el => el.contains(document.elementFromPoint(innerWidth / 2, innerHeight / 2))).pop(); // 화면 가운데를 덮은 창
    const base = modal || document.querySelector(root) || document.body;
    const out = [];
    const vw = innerWidth, vh = innerHeight;
    const shown = el => {
      if (!el.isConnected) return false;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return false;
      const det = el.closest('details:not([open])'); // 접힌 펼침 상자 안(머리 줄 summary 빼고)은 그려지지 않는다
      if (det && det !== el && !el.closest('summary')?.parentElement?.isSameNode(det)) return false;
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1 && r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;
    };
    const name = el => {
      let s = el.tagName.toLowerCase();
      if (el.id) return s + '#' + el.id;
      const cls = [...el.classList].filter(c => !/^(is-|has-)/.test(c)).slice(0, 2);
      if (cls.length) s += '.' + cls.join('.');
      const data = [...el.attributes].find(a => a.name.startsWith('data-'));
      if (data) s += `[${data.name}]`;
      return s;
    };
    const where = el => {
      const parts = []; let e = el;
      while (e && e !== document.body && parts.length < 3) { parts.unshift(name(e)); if (e.id) break; e = e.parentElement; }
      return parts.join(' > ');
    };
    // 화면에 붙어 있는 막대(하단바·상단 줄·폰 빠른 입력 막대 — position:fixed): 굴리는 본문이 그 밑을 지나가는 것은 정상이라
    // 막대와 본문 사이(서로 다른 층)는 겹침·붙음을 재지 않는다. 막대 안끼리, 본문 안끼리만 잰다(S70-57: 홈 머리 줄로 본문이 내려가 드러남).
    const bar = el => { const b = el?.closest?.('.mobile-tabs,.app-topline,[data-home-quick]'); return b && (b.matches('.mobile-tabs,.app-topline') || getComputedStyle(b).position === 'fixed') ? b : null; };
    const text = el => (el.innerText || el.getAttribute('aria-label') || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 30);
    const push = (kind, el, extra = {}) => out.push({ kind, where: where(el), text: text(el), ...extra });
    const all = [...base.querySelectorAll('*')].filter(el => !el.closest('svg') && shown(el));

    // ① overlap: 누를 수 있는 것의 가운데 점 맨 위에 다른 것이 있다.
    for (const el of all) {
      if (!el.matches('button,a[href],input:not([type=hidden]),select,textarea,summary,[role=button],[role=tab]')) continue;
      if (el.closest('[aria-hidden="true"],[inert]')) continue;
      const r = el.getBoundingClientRect();
      const cx = Math.min(Math.max(r.left + r.width / 2, 0), vw - 1), cy = Math.min(Math.max(r.top + r.height / 2, 0), vh - 1);
      if (r.top < 0 || r.bottom > vh || r.left < 0 || r.right > vw) continue; // 화면 밖(굴려서 보는 것)은 재지 않는다
      // 굴리는 상자 안에서 가려진 줄(상자 밖으로 굴러 나간 것)은 재지 않는다: 가장 가까운 굴림 상자 밖이면 넘어간다.
      let clipped = false;
      for (let p = el.parentElement; p && p !== document.body && !clipped; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
        const b = p.getBoundingClientRect();
        clipped = cy < b.top || cy > b.bottom || cx < b.left || cx > b.right;
      }
      if (clipped) continue;
      const top = document.elementFromPoint(cx, cy);
      if (!top || el.contains(top) || top.contains(el)) continue;
      if (top.closest('label')?.contains(el) || el.closest('label')?.contains(top)) continue;
      // 떠 있는 층(계정 창·메뉴 창·줄 메뉴·대화 상자)이 뒤 화면을 덮는 것은 정상이다. 그 층 안끼리 겹침만 센다.
      const FLOAT = '#sidebarAccountPanel,#mobileMenu,#rowMenu,[role=menu],[role=dialog],[aria-modal=true],.modal';
      if (top.closest(FLOAT) && top.closest(FLOAT) !== el.closest(FLOAT)) continue;
      if (bar(top) && bar(top) !== bar(el)) continue; // 굴리는 목록이 하단바·상단 줄·빠른 입력 막대 밑을 지나가는 것은 정상(맨 끝 여백은 따로 본다)
      push('overlap', el, { by: where(top) });
    }
    // ② clipped: 버튼 글자가 넘친다(… 처리 없이).
    for (const el of all) {
      if (!el.matches('button,[role=button],[role=tab]')) continue;
      const cs = getComputedStyle(el);
      if (cs.textOverflow === 'ellipsis') continue;
      if (el.scrollWidth > el.clientWidth + 2 && cs.overflowX !== 'visible') push('clipped', el, { gap: el.scrollWidth - el.clientWidth });
    }
    // ③ 경계선 모으기: 보이는 테두리(굵기>0, 색 투명 아님).
    const lines = [];
    const visibleColor = c => !/rgba\(.*,\s*0\)$/.test(c) && c !== 'transparent';
    const visiblePart = el => { // 굴림 상자에 잘려 안 보이는 부분을 뺀 선의 자리
      let r = el.getBoundingClientRect(); r = { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const cs = getComputedStyle(p); if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
        const b = p.getBoundingClientRect();
        r = { left: Math.max(r.left, b.left), right: Math.min(r.right, b.right), top: Math.max(r.top, b.top), bottom: Math.min(r.bottom, b.bottom) };
      }
      return r;
    };
    for (const el of all) {
      const cs = getComputedStyle(el), full = el.getBoundingClientRect(), vis = visiblePart(el);
      if (vis.right - vis.left < 1 || vis.bottom - vis.top < 1) continue;
      if (el.matches('button,input,select,textarea,summary,[role=button],[role=tab]')) continue; // 버튼 테두리는 버튼 안쪽 글자 여백 문제라 따로 본다
      const side = (w, c) => parseFloat(w) > 0 && visibleColor(c);
      const inX = x => x >= vis.left - 0.5 && x <= vis.right + 0.5, inY = y => y >= vis.top - 0.5 && y <= vis.bottom + 0.5;
      if (side(cs.borderRightWidth, cs.borderRightColor) && inX(full.right)) lines.push({ v: true, x: full.right, a: vis.top, b: vis.bottom, el });
      if (side(cs.borderLeftWidth, cs.borderLeftColor) && inX(full.left)) lines.push({ v: true, x: full.left, a: vis.top, b: vis.bottom, el });
      if (side(cs.borderBottomWidth, cs.borderBottomColor) && inY(full.bottom)) lines.push({ v: false, y: full.bottom, a: vis.left, b: vis.right, el });
      if (side(cs.borderTopWidth, cs.borderTopColor) && inY(full.top)) lines.push({ v: false, y: full.top, a: vis.left, b: vis.right, el });
    }
    const behind = el => { for (let p = el.parentElement; p; p = p.parentElement) { const c = getComputedStyle(p).backgroundColor; if (visibleColor(c)) return c; } return ''; };
    const boxedSelf = el => { const cs = getComputedStyle(el); return (parseFloat(cs.borderBottomWidth) > 0 && visibleColor(cs.borderBottomColor)) || (visibleColor(cs.backgroundColor) && cs.backgroundColor !== behind(el)); };
    // 달력처럼 7칸 넘게 줄지어 붙은 격자(날짜 칸·요일 칸)의 칸 경계선은 일부러 붙인 것이라 뺀다.
    const gridLine = (L, el) => { const g = L.el.parentElement; if (!g || !g.contains(el) || g.children.length < 7) return false; const d = getComputedStyle(g).display; return /grid|flex/.test(d); };
    // 작은 묶음 상자(높이 48px 미만 — [－ ＋] 같은 붙은 단추 묶음)의 테두리는 묶음 모양이라 뺀다.
    const groupLine = L => L.el.getBoundingClientRect().height < 48 && L.el.querySelector('button,[role=button]');
    const boxedOrGroup = el => boxedSelf(el) || (el.parentElement && el.parentElement.getBoundingClientRect().height < 48 && boxedSelf(el.parentElement));
    // ④ 글자 줄(텍스트 노드 줄 상자)과 경계선 사이.
    const walker = document.createTreeWalker(base, NodeFilter.SHOW_TEXT, { acceptNode: n => n.data.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT });
    const seen = new Set();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const host = n.parentElement;
      if (!host || host.closest('svg,button,input,select,textarea,[role=button],[role=tab],summary,.sr-only,[hidden]') || !shown(host)) continue;
      const range = document.createRange(); range.selectNodeContents(n);
      const fs = parseFloat(getComputedStyle(host).fontSize) || 12;
      for (const box of range.getClientRects()) {
        if (box.width < 2 || box.height < 4 || box.bottom < 0 || box.top > vh) continue;
        const lead = Math.max(0, (box.height - fs) / 2); // 줄 높이의 위아래 남는 몫(글자 모양 밖)
        const t = { left: box.left, right: box.right, top: box.top + lead, bottom: box.bottom - lead };
        for (const L of lines) {
          if (gridLine(L, host) || bar(L.el) !== bar(host)) continue;
          if (L.el.contains(host) && L.v) {
            // 자기 상자의 세로 테두리 안쪽 여백(상자 안 글자가 테두리에 붙음)
            const gap = L.x === L.el.getBoundingClientRect().left ? t.left - L.x : L.x - t.right;
            if (gap >= 0 && gap < MIN_X && t.bottom > L.a && t.top < L.b) { const k = 'edge|' + where(host) + '|' + Math.round(gap); if (!seen.has(k)) { seen.add(k); push('edge', host, { gap: Math.round(gap * 10) / 10, line: where(L.el) }); } }
            continue;
          }
          if (L.v) {
            if (t.bottom <= L.a + 1 || t.top >= L.b - 1) continue;
            const gap = Math.min(Math.abs(t.left - L.x), Math.abs(L.x - t.right));
            const outside = t.left >= L.x - 0.5 || t.right <= L.x + 0.5;
            if (outside && gap < MIN_X) { const k = 'edge|' + where(host) + '|' + where(L.el); if (!seen.has(k)) { seen.add(k); push('edge', host, { gap: Math.round(gap * 10) / 10, line: where(L.el) }); } }
          } else if (!L.el.contains(host)) {
            if (t.right <= L.a + 1 || t.left >= L.b - 1) continue;
            const gap = t.top >= L.y - 0.5 ? t.top - L.y : L.y - t.bottom; // 선 아래 글자·선 위 글자
            if (gap >= -0.5 && gap < MIN_Y) { const k = 'under|' + where(host) + '|' + where(L.el); if (!seen.has(k)) { seen.add(k); push('under', host, { gap: Math.round(gap * 10) / 10, line: where(L.el) }); } }
          }
        }
      }
    }
    // 테두리나 바탕이 보이는 것(글자만 있는 단추·그림 단추는 선에 가까워도 붙어 보이지 않는다). 묶음(.ds-seg 등) 안 단추는 묶음 상자로 본다.
    // ④-2 버튼·탭이 자기를 담은 줄(머리·탭·도구 줄)의 아래 선에 붙음, 옆 칸 세로 선에 붙음.
    for (const el of all) {
      if (!el.matches('button,[role=tab],select,input:not([type=hidden]):not([type=checkbox]):not([type=radio])') || el.closest('[aria-hidden="true"]') || !boxedOrGroup(el)) continue;
      const r = el.getBoundingClientRect();
      for (const L of lines) {
        if (L.el === el || el.contains(L.el) || gridLine(L, el) || groupLine(L) || bar(L.el) !== bar(el)) continue;
        if (!L.v) {
          // 줄을 가득 채운 목록 줄(나무·목록의 한 줄 단추)은 줄 자체가 칸이라 뺀다: 작은 버튼·탭·고르기만 본다.
          if (r.height > 40 || r.width > L.el.getBoundingClientRect().width * 0.6) continue;
          if (r.right <= L.a + 1 || r.left >= L.b - 1) continue;
          const own = L.el.contains(el) && L.y === L.el.getBoundingClientRect().bottom;
          const bw = own ? parseFloat(getComputedStyle(L.el).borderBottomWidth) || 0 : 0;
          const gap = Math.abs(L.y - (r.top + r.bottom) / 2) > r.height / 2 ? Math.min(Math.abs(L.y - bw - r.bottom), Math.abs(r.top - L.y)) : -1;
          if (gap >= 0 && gap < MIN_Y) { const k = 'under|' + where(el) + '|' + where(L.el); if (!seen.has(k)) { seen.add(k); push('under', el, { gap: Math.round(gap * 10) / 10, line: where(L.el) }); } }
        } else if (L.v && !L.el.contains(el)) {
          if (r.bottom <= L.a + 1 || r.top >= L.b - 1) continue;
          const gap = Math.min(Math.abs(r.left - L.x), Math.abs(L.x - r.right));
          if (gap < MIN_X && (r.left >= L.x - 0.5 || r.right <= L.x + 0.5)) { const k = 'edge|' + where(el) + '|' + where(L.el); if (!seen.has(k)) { seen.add(k); push('edge', el, { gap: Math.round(gap * 10) / 10, line: where(L.el) }); } }
        }
      }
    }
    // ⑤ touch: 테두리·바탕 있는 버튼끼리 붙음(같은 묶음 .ds-seg·[role=group]·[role=tablist] 안은 붙은 묶음이라 뺀다).
    const btns = all.filter(el => el.matches('button,[role=button]') && !el.closest('.ds-seg,[role=group],[role=tablist],[role=radiogroup],.seg,.ed-pair'));
    const boxed = el => { const cs = getComputedStyle(el); return parseFloat(cs.borderLeftWidth) > 0 && visibleColor(cs.borderLeftColor) || visibleColor(cs.backgroundColor); };
    for (let i = 0; i < btns.length; i++) for (let j = i + 1; j < btns.length; j++) {
      const a = btns[i], b = btns[j];
      if (a.parentElement !== b.parentElement || !boxed(a) || !boxed(b)) continue;
      if (getComputedStyle(a.parentElement).display.includes('grid') && a.parentElement.children.length >= 7) continue; // 달력 칸처럼 붙은 격자는 일부러 붙인 것
      const A = a.getBoundingClientRect(), B = b.getBoundingClientRect();
      const sameRow = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top) > Math.min(A.height, B.height) / 2;
      if (!sameRow) continue;
      const gap = B.left >= A.left ? B.left - A.right : A.left - B.right;
      if (gap >= -0.5 && gap < 2) push('touch', a, { gap: Math.round(gap * 10) / 10, with: text(b) });
    }
    // ⑥ skeleton: 불러오는 중 자리 표시가 남았다.
    for (const el of all) {
      const cls = typeof el.className === 'string' ? el.className : '';
      if (/(^|[-_\s])(skeleton|skel|shimmer|placeholder-bar|loading-bar)([-_\s]|$)/i.test(cls) || el.matches('kptu-wait:not(.wait-inline):not(.wait-only-bar),[aria-busy="true"]')) push('skeleton', el);
    }
    return out;
  }, { root, MIN_X, MIN_Y });
}
// 같은 문제가 한 화면에 여러 줄(목록 줄 수만큼)로 나오면 하나로 센다: 종류 + 위치 + 선.
export function uniqueIssues(list) {
  const map = new Map();
  for (const i of list) { const k = [i.kind, i.where, i.line || i.by || ''].join('|'); if (!map.has(k)) map.set(k, { ...i, count: 0 }); map.get(k).count++; }
  return [...map.values()];
}
