// LAYOUT-폭별검사: 지금 보이는 화면이 '이 폭에서 깨졌는지'를 숫자로 잰다(폭 표 × 화면 표 시험: tests/app-e2e/width-layout.spec.mjs).
// 사람이 폴드 펼침에서 본 깨짐(노트 목록 제목 칸이 한 글자 폭, 밀어 연 줄이 화면 밖으로 넘침)을 같은 자로 모든 화면·폭에서 반복해 잰다.
// 잰 결과는 {kind, where, text, w?, by?} 목록이다. kind:
//  overflow — 문서가 가로로 넘친다(가로 굴림이 생김), 또는 보이는 요소가 굴림 상자 없이 화면 오른쪽·왼쪽 밖으로 나간다.
//  narrow   — 글 칸(제목·본문·이름)이 너무 좁다: 칸 폭이 NARROW_PX보다 좁은데 글자가 잘려 4글자도 안 보이거나 3줄 넘게 접힘, 한 줄에 2글자 이하로 접힘,
//             또는 글이 있는 칸이 0폭으로 눌림.
//  pane0    — 두 칸(목록 | 상세 등) 화면에서 내용이 있는 칸 하나가 PANE_MIN_PX보다 좁게 눌림(0폭 칸).
//  textover — 서로 다른 글 칸의 글자가 같은 자리에 포개진다(목록 머리 '제목'과 '폴더'가 겹침).
//  overlap  — 누를 수 있는 것의 가운데를 같은 층(본문끼리·한 창 안끼리)의 다른 것이 덮는다.
//  covered  — 떠 있는 창(메뉴·팝업·대화 상자) 안 단추를 하단바·상단 줄 같은 화면 막대가 덮거나 화면 아래로 잘린다.

// 폭 표: 폰·폴드·태블릿·PC와, 미디어 쿼리 구간 경계(599|600, 760|761, 1023|1024) 양쪽. 앱 CSS 구간은 app/*.css의 @media 값과 같다.
// height는 그 기기 모양(세로·가로)에 가까운 값. 새 기기 폭은 줄 하나만 더한다.
export const WIDTHS = Object.freeze([
  { w: 344, h: 882, name: '폴드 접힘' },
  { w: 360, h: 780, name: '폰 작은' },
  { w: 412, h: 915, name: '폰' },
  { w: 599, h: 900, name: '경계 599' },
  { w: 600, h: 900, name: '경계 600' },
  { w: 673, h: 841, name: '폴드 펼침 세로' },
  { w: 760, h: 900, name: '경계 760' },
  { w: 761, h: 900, name: '경계 761' },
  { w: 768, h: 1024, name: '폴드 펼침·태블릿 세로' },
  { w: 884, h: 673, name: '폴드 펼침 가로' },
  { w: 1023, h: 768, name: '경계 1023' },
  { w: 1024, h: 768, name: '태블릿 가로' },
  { w: 1280, h: 800, name: 'PC' },
]);
export const NARROW_PX = 80, PANE_MIN_PX = 40;

export async function measureWidth(page) {
  const own = await page.evaluate(({ NARROW_PX, PANE_MIN_PX }) => {
    const out = [], vw = document.documentElement.clientWidth, vh = innerHeight;
    const name = el => {
      let s = el.tagName.toLowerCase();
      if (el.id) return s + '#' + el.id;
      const cls = [...el.classList].filter(c => !/^(is-|has-)/.test(c)).slice(0, 2);
      if (cls.length) s += '.' + cls.join('.');
      const data = [...el.attributes].find(a => a.name.startsWith('data-'));
      if (data) s += `[${data.name}]`;
      return s;
    };
    const where = el => { const parts = []; let e = el; while (e && e !== document.body && parts.length < 3) { parts.unshift(name(e)); if (e.id) break; e = e.parentElement; } return parts.join(' > '); };
    const text = el => (el.innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 30);
    const push = (kind, el, extra = {}) => out.push({ kind, where: where(el), text: text(el), ...extra });
    const hiddenLayer = el => el.closest('[hidden],[inert],[aria-hidden="true"],.hidden,.sr-only,dialog:not([open]),template');
    // 그려지는 것(크기와 상관없이): 숨김·접힌 상자 안·화면 읽기 전용 글(a11y-only 등, 1px로 잘라 숨김)이 아님.
    const drawn = el => {
      if (!el.isConnected || hiddenLayer(el)) return false;
      for (let e = el; e && e !== document.body; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.display === 'none' || +cs.opacity === 0 || cs.clipPath !== 'none' || (cs.clip && cs.clip !== 'auto')) return false;
      }
      if (getComputedStyle(el).visibility === 'hidden') return false;
      const d = el.closest('details:not([open])');
      if (d && d !== el && !el.closest('summary')) return false;
      return true;
    };
    const shown = el => { if (!drawn(el)) return false; const r = el.getBoundingClientRect(); return r.width > 1.5 && r.height > 1.5; };
    // 자기 또는 조상이 옮겨져(transform) 그려진 것: 줄 밀기로 일부러 옆으로 민 줄, 화면 밖에 대기 중인 서랍 등. 가로 넘침은 옮기기 전 자리로 잰다.
    const moved = el => { for (let e = el; e && e !== document.body; e = e.parentElement) { const t = getComputedStyle(e).transform; if (t && t !== 'none' && !/^matrix\(1, 0, 0, 1, 0, 0\)$/.test(t)) return e; } return null; };
    // 굴림·잘림 상자 안이면 그 상자 폭까지가 보이는 자리다(상자 밖 내용은 굴리거나 잘려 보이지 않는 게 정상).
    const clipBox = el => { for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) if (getComputedStyle(p).overflowX !== 'visible') return p; return null; };
    // 굴림·잘림 상자들에 잘려 실제로 보이는 부분.
    const visiblePart = el => {
      const f = el.getBoundingClientRect(); let r = { left: f.left, right: f.right, top: f.top, bottom: f.bottom };
      for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
        const cs = getComputedStyle(p); if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
        const b = p.getBoundingClientRect();
        r = { left: Math.max(r.left, b.left), right: Math.min(r.right, b.right), top: Math.max(r.top, b.top), bottom: Math.min(r.bottom, b.bottom) };
      }
      const cs = getComputedStyle(el);
      if (cs.overflowX !== 'visible') { r.left = Math.max(r.left, f.left); r.right = Math.min(r.right, f.right); }
      return r;
    };
    // ① 문서 가로 넘침.
    const docW = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    if (docW > vw + 1) out.push({ kind: 'overflow', where: 'document', text: '', w: docW - vw });
    const all = [...document.querySelectorAll('body *')].filter(el => !el.closest('svg') && !['SCRIPT', 'STYLE', 'BR', 'TEMPLATE', 'OPTION'].includes(el.tagName) && shown(el));
    // ② 보이는 요소가 굴림 상자 없이 화면 밖으로 나간다(가장 바깥 하나만 센다).
    const off = new Set();
    for (const el of all) {
      const r = el.getBoundingClientRect();
      if (r.top >= vh || r.bottom <= 0) continue; // 세로로 굴려 볼 자리는 가로만 따진다 — 그래도 위아래 화면 밖 요소는 건너뛴다(늦게 그려진 아래쪽도 가로 넘침은 문서 넘침으로 잡힌다)
      const box = clipBox(el);
      const b = box ? box.getBoundingClientRect() : { left: 0, right: vw };
      const L = Math.max(r.left, b.left), R = Math.min(r.right, b.right);
      if (R - L < 1) continue;
      if (R <= vw + 1 && L >= -1) continue;
      if (moved(el)) continue;
      if (getComputedStyle(el).position === 'fixed' && (r.left >= vw - 1 || r.right <= 1)) continue; // 화면 밖에서 기다리는 붙은 막대
      if ([...off].some(o => o.contains(el))) continue;
      off.add(el);
      push('overflow', el, { w: Math.round(Math.max(R - vw, -L)) });
    }
    // ③ 글 칸 너무 좁음: 글자를 직접 가진 칸(버튼·입력칸·그림 단추 빼고).
    // 단추 글자 자체(버튼 이름 잘림은 layout-audit 'clipped'가 본다)와 입력·편집 칸은 뺀다. 목록 줄 단추 안의 제목·날짜 칸은 본다.
    const CTRL = 'button,[role=button],[role=tab],[role=menuitem],input,select,textarea,summary,a';
    const SKIP = 'input,select,textarea,svg,kbd,code,pre,.sr-only,[contenteditable],.ProseMirror,table,[role=grid]';
    const seen = new Set();
    const r0 = el => el.getBoundingClientRect();
    const ownText = el => [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.data).join('').replace(/\s+/g, ' ').trim();
    // 글 칸은 0폭으로 눌린 것도 본다(크기 거르기 없이 '그려지는 것' 전부). 굴림·잘림 상자에 가려 안 보이는 칸(상자 밖)은 뺀다.
    const holders = [...document.querySelectorAll('body *')].filter(el => !el.closest('svg') && [...ownText(el)].length >= 2 && drawn(el));
    for (const el of holders) {
      if (el.matches(CTRL) || el.closest(SKIP)) continue;
      // 폴더 줄 개수·표시 글자는 이름에 자리를 내주고 '…'로 줄어드는 것이 정한 모양이다(app/folder-tree.css LAYOUT-폭별검사). 이름 칸만 본다.
      if (el.matches('.ft-num,.ft-tag,.ft-offtag') && r0(el).width > 1.5) continue;
      const own = ownText(el);
      const r = el.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) continue;
      const box = clipBox(el);
      if (box) { const b = box.getBoundingClientRect(); if (r.left >= b.right || r.right <= b.left || r.top >= b.bottom || r.bottom <= b.top) continue; }
      if (r.width <= 1.5) { const k = where(el); if (!seen.has(k)) { seen.add(k); push('narrow', el, { w: Math.round(r.width), lines: 0, text: own.slice(0, 30) }); } continue; }
      if ([...own].length < 4) continue;
      const cs = getComputedStyle(el);
      const fs = parseFloat(cs.fontSize) || 12, lh = parseFloat(cs.lineHeight) || fs * 1.4;
      // 줄 수는 이 칸이 직접 가진 글자 줄만 센다(안쪽 작은 글자 칸의 줄 상자는 위치가 달라 줄을 더 세게 된다).
      const tops = [];
      for (const n of el.childNodes) { if (n.nodeType !== 3 || !n.data.trim()) continue; const rg = document.createRange(); rg.selectNodeContents(n); for (const b of rg.getClientRects()) if (b.width > 0.5) tops.push(b.top + b.height / 2); }
      tops.sort((a, b) => a - b);
      const lines = tops.length ? tops.reduce((n, t, i) => n + (i && t - tops[i - 1] > lh * 0.6 ? 1 : 0), 1) : Math.round(r.height / lh);
      const cut = el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'visible';
      const chars = [...own].length;
      const perLine = chars / Math.max(lines, 1);
      const bad = (r.width < NARROW_PX && ((cut && r.width / fs < 4) || lines >= 3)) || (lines >= 2 && perLine <= 2) || (r.width < fs * 1.6 && chars >= 4);
      if (!bad) continue;
      const k = where(el); if (seen.has(k)) continue; seen.add(k);
      push('narrow', el, { w: Math.round(r.width), lines });
    }
    // ③-2 글자 겹침: 서로 다른 글 칸의 글자 줄이 같은 자리에 포개진다(목록 머리 '제목'과 '폴더'가 겹쳐 '제목폴더'로 보임).
    const boxes = [];
    for (const el of holders) {
      if (!shown(el)) continue;
      const range = document.createRange(); range.selectNodeContents(el);
      const clip = visiblePart(el);
      for (const raw of range.getClientRects()) {
        const b = { left: Math.max(raw.left, clip.left), right: Math.min(raw.right, clip.right), top: Math.max(raw.top, clip.top), bottom: Math.min(raw.bottom, clip.bottom) };
        b.width = b.right - b.left; b.height = b.bottom - b.top;
        if (b.width > 2 && b.height > 4 && b.bottom > 0 && b.top < vh && b.right > 0 && b.left < vw) boxes.push({ el, b });
      }
    }
    const textSeen = new Set();
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const A = boxes[i], B = boxes[j];
      if (A.el === B.el || A.el.contains(B.el) || B.el.contains(A.el)) continue;
      const w = Math.min(A.b.right, B.b.right) - Math.max(A.b.left, B.b.left), h = Math.min(A.b.bottom, B.b.bottom) - Math.max(A.b.top, B.b.top);
      if (w < 3 || h < Math.min(A.b.height, B.b.height) * 0.5) continue;
      // 서로 다른 층(떠 있는 창·붙은 막대가 본문 위)은 덮는 것이 정상이다 — 같은 층끼리만.
      const layer = e => { for (let p = e; p && p !== document.body; p = p.parentElement) { const cs = getComputedStyle(p); if (cs.position === 'fixed' || cs.position === 'sticky' || (cs.position === 'absolute' && cs.zIndex !== 'auto') || p.tagName === 'DIALOG' || p.hasAttribute('popover')) return p; } return null; };
      if (layer(A.el) !== layer(B.el)) continue;
      const pa = document.elementFromPoint(Math.max(A.b.left, B.b.left) + w / 2, Math.max(A.b.top, B.b.top) + h / 2);
      if (pa && !(A.el.contains(pa) || B.el.contains(pa) || pa.contains(A.el) || pa.contains(B.el))) continue; // 둘 다 다른 것에 덮여 안 보임
      const k = where(A.el) + '|' + where(B.el); if (textSeen.has(k)) continue; textSeen.add(k);
      push('textover', A.el, { with: ownText(B.el).slice(0, 20), by: where(B.el) });
    }
    // ④ 두 칸 화면의 0폭 칸: 가로로 나란한 칸(flex 가로·grid 여러 열) 가운데 내용이 있는 칸이 눌림.
    for (const el of all) {
      const cs = getComputedStyle(el), r = el.getBoundingClientRect();
      if (r.width < 300 || r.height < 120) continue;
      const row = (cs.display.includes('flex') && !cs.flexDirection.startsWith('column')) || (cs.display.includes('grid') && cs.gridTemplateColumns.split(' ').length >= 2);
      if (!row) continue;
      const kids = [...el.children].filter(c => { const s = getComputedStyle(c); return s.display !== 'none' && s.visibility !== 'hidden' && !c.hidden && !hiddenLayer(c) && s.position !== 'absolute' && s.position !== 'fixed'; });
      if (kids.length < 2) continue;
      for (const c of kids) {
        const b = c.getBoundingClientRect();
        if (b.width >= PANE_MIN_PX || b.height < 120) continue;
        if ((c.innerText || '').replace(/\s+/g, '').length < 10) continue;
        push('pane0', c, { w: Math.round(b.width) });
      }
    }
    // ⑤ 겹침·막대가 창을 덮음: 누를 수 있는 것의 가운데 점 맨 위에 다른 것이 있다.
    // 같은 층(본문끼리, 한 창 안끼리)에서 덮이면 overlap. 다른 층이 덮는 것(떠 있는 메뉴·창이 본문 위, 굴리는 본문이 붙은 막대 밑을 지나감)은 정상이다.
    // 다만 떠 있는 창(메뉴·팝업·대화 상자) 안 단추를 하단바·상단 줄 같은 화면 막대가 덮으면 covered(팝업이 하단바에 가림).
    const layer = e => { for (let p = e; p && p !== document.body; p = p.parentElement) { const cs = getComputedStyle(p); if (cs.position === 'fixed' || cs.position === 'sticky' || (cs.position === 'absolute' && cs.zIndex !== 'auto' && +cs.zIndex > 0) || p.tagName === 'DIALOG' || p.hasAttribute('popover')) return p; } return null; };
    const BAR = '.mobile-tabs,.app-topline,[data-home-quick],.app-nav';
    for (const el of all) {
      if (!el.matches('button,a[href],input:not([type=hidden]),select,textarea,summary,[role=button],[role=tab],[role=menuitem]')) continue;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const mine = layer(el), floating = mine && !mine.closest(BAR) && !mine.matches(BAR) && getComputedStyle(mine).position !== 'sticky'; // 붙어 따라오는 머리(sticky)는 본문이라 막대 밑을 지나가는 게 정상
      // 창 안을 굴려 닿을 수 있으면(창 안 굴림 상자) 화면 아래로 잘려도 정상이다.
      const scrolls = () => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const cs = getComputedStyle(p); if (/(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 1) return true; if (p === mine) break; } return false; };
      if (cx < 0 || cy < 0 || cx >= vw || cy >= vh) { if (floating && getComputedStyle(mine).position === 'fixed' && r.top < vh && r.bottom > vh && !scrolls()) push('covered', el, { by: 'screen-bottom' }); continue; }
      // 굴리는 상자 밖으로 굴러 나간 단추는 재지 않는다.
      const vis = visiblePart(el);
      if (cx < vis.left || cx > vis.right || cy < vis.top || cy > vis.bottom) continue;
      const top = document.elementFromPoint(cx, cy);
      if (!top || el.contains(top) || top.contains(el)) continue;
      if (top.closest('label')?.contains(el) || el.closest('label')?.contains(top)) continue;
      const theirs = layer(top);
      if (theirs === mine) { push('overlap', el, { by: where(top) }); continue; }
      if (floating && theirs && (theirs.closest(BAR) || theirs.matches(BAR)) && !mine.contains(theirs)) push('covered', el, { by: where(theirs) });
    }
    return out;
  }, { NARROW_PX, PANE_MIN_PX });
  return own;
}

// 같은 문제가 목록 줄 수만큼 나오면 하나로 센다: 종류 + 위치.
export function uniqueWidthIssues(list) {
  const map = new Map();
  for (const i of list) { const k = i.kind + '|' + i.where; if (!map.has(k)) map.set(k, { ...i, count: 0 }); map.get(k).count++; }
  return [...map.values()];
}
