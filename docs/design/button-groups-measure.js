// UI-버튼묶음정리(S70-71) 조사 도구: 지금 보이는 화면에서 '버튼 묶음'(같은 부모 아래 늘어선 버튼 3개 이상)을 찾아 잰다.
// 앱 코드가 아니다(앱이 부르지 않음). 조사 때 시험 브라우저에 끼워 넣어(addInitScript) 화면이 바뀔 때마다 재고,
// window.__bg에 묶음마다 한 줄씩 모은다. 쓰는 법은 docs/design/button-groups-decision.md '조사 방법'.
// 재는 것: 버튼 수 · 줄 수 · 높이·글자 크기 · 머리줄(그 화면 맨 위 버튼 줄) 높이보다 큰지 · 줄바꿈 들쭉날쭉 · 빨간 채움 버튼.
// 빼는 것: 보기 탭(⑤)·탭·목록 줄·나무·메뉴 안 항목·서식 줄·달력 칸·아래 탭·왼쪽 메뉴(버튼 묶음이 아니다).
(() => {
  const SKIP = '.ds-seg,[role=tablist],[role=listbox],[role=tree],[role=grid],[role=menu],.mobile-tabs,.app-nav,.ed-toolbar,.ed-tools,.ProseMirror,[contenteditable=true],.kptu-selbar-x';
  const vis = el => { if (!el.isConnected || !el.getClientRects().length) return false; const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || +cs.opacity === 0) return false; if (el.closest('[hidden],.hidden,details:not([open]) > :not(summary)')) return false; const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; };
  const kind = b => b.matches('.primary') ? '①주' : b.matches('.danger') ? '②빨강' : b.matches('.secondary,.ghost') ? '②작은' : b.matches('.row-act') ? '③글자' : b.matches('.ds-chip') ? '④칩' : b.matches('.icon-btn') ? '⑥아이콘' : '그밖';
  const rgb = s => (s.match(/[\d.]+/g) || []).map(Number);
  const redFill = b => { const [r, g, bl, a = 1] = rgb(getComputedStyle(b).backgroundColor); return a > .5 && r > 150 && g < 120 && bl < 120; };
  const label = b => (b.getAttribute('aria-label') || b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 12);
  const name = el => { if (!el || el === document.body) return ''; if (el.id) return '#' + el.id; const c = [...el.classList].filter(x => !/^(is-|has-|on$|open$)/.test(x)).slice(0, 2); return el.tagName.toLowerCase() + (c.length ? '.' + c.join('.') : ''); };
  const path = el => { const out = []; for (let e = el; e && e !== document.body && out.length < 3; e = e.parentElement) { out.unshift(name(e)); if (e.id) break; } return out.join(' > '); };
  const screen = () => { const v = [...document.querySelectorAll('#appView [id$="View"]')].filter(x => !x.classList.contains('hidden') && x.getClientRects().length).sort((a, b) => b.offsetWidth * b.offsetHeight - a.offsetWidth * a.offsetHeight)[0]; return v ? v.id : ''; };
  // 머리줄 높이: 그 화면(또는 창)의 맨 위 56px 안 글자 버튼 중 가장 흔한 높이. PC 맨 위 공용 줄(.app-topline)은 따로.
  const headOf = root => { if (!root) return 0; const top = root.getBoundingClientRect().top; const hs = [...root.querySelectorAll('button')].filter(b => vis(b) && b.getBoundingClientRect().top < top + 56 && !b.closest(SKIP) && label(b).length > 2 && !b.matches('.icon-btn')).map(b => Math.round(b.getBoundingClientRect().height)); if (!hs.length) return 0; const n = {}; hs.forEach(h => n[h] = (n[h] || 0) + 1); return +Object.entries(n).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0]; };
  const unit = c => c.matches('button,a[role=button]') ? c : (c.children.length === 1 && c.firstElementChild.matches('button')) ? c.firstElementChild : null;
  function measure() {
    const out = [];
    const parents = new Set([...document.querySelectorAll('button')].filter(vis).map(b => b.parentElement?.matches('span,div') && b.parentElement.children.length === 1 ? b.parentElement.parentElement : b.parentElement));
    for (const p of parents) {
      if (!p || p.closest(SKIP)) continue;
      const btns = [...p.children].map(unit).filter(b => b && vis(b));
      if (btns.length < 3) continue;
      if (btns.some(b => b.matches('[role=tab],[role=option],[role=menuitem],[role=treeitem],[role=radio],.ds-seg-btn'))) continue;
      const pr = p.getBoundingClientRect(); const rs = btns.map(b => b.getBoundingClientRect());
      if (rs.filter(r => r.width > pr.width * .6).length >= 2 || rs.some(r => r.height > 60)) continue; // 목록 줄·큰 칸
      const ys = []; rs.forEach(r => { const y = r.top + r.height / 2; if (!ys.some(v => Math.abs(v - y) < 6)) ys.push(y); });
      if (ys.length > 4) continue; // 세로 목록
      ys.sort((a, b) => a - b);
      const rows = ys.map(y => rs.filter(r => Math.abs(r.top + r.height / 2 - y) < 6));
      const rights = rows.map(r => Math.max(...r.map(x => x.right))), lefts = rows.map(r => Math.min(...r.map(x => x.left)));
      // 들쭉날쭉: 두 줄 이상인데 버튼 폭이 제각각(격자처럼 칸이 맞지 않음)이거나 줄 끝이 서로 다르다.
      const ws = rs.map(r => r.width), wSpread = Math.max(...ws) - Math.min(...ws);
      const ragged = rows.length > 1 && (wSpread > 4 || Math.max(...lefts) - Math.min(...lefts) > 8);
      const dialog = p.closest('[role=dialog],[aria-modal=true],.modal,[id$="Modal"],[id$="Window"],[id$="Sheet"]');
      const scr = screen(); const root = dialog || document.getElementById(scr);
      const hs = btns.map(b => Math.round(b.getBoundingClientRect().height * 10) / 10);
      const fs = [...new Set(btns.map(b => getComputedStyle(b).fontSize))];
      out.push({
        screen: scr, dialog: dialog ? name(dialog) : '', where: path(p), n: btns.length, rows: rows.length, perRow: rows.map(r => r.length).join('+'), ragged,
        h: [...new Set(hs)].sort((a, b) => a - b), fs, head: headOf(root), topline: headOf(document.querySelector('#appView > .app-topline')),
        redFill: btns.filter(redFill).map(label), kinds: [...new Set(btns.map(kind))], labels: btns.map(label), overflow: p.scrollWidth > p.clientWidth + 1 && getComputedStyle(p).overflowX === 'visible', vw: innerWidth,
      });
    }
    return out;
  }
  window.__bgMeasure = measure;
  window.__bg = window.__bg || {};
  window.__bgRun = () => { try { for (const g of measure()) { const k = g.vw + '|' + g.screen + '|' + g.dialog + '|' + g.where + '|' + g.labels.join(','); window.__bg[k] = g; } } catch (e) { /* 조사 도구 — 화면을 방해하지 않는다 */ } };
  let t = 0;
  const kick = () => { clearTimeout(t); t = setTimeout(window.__bgRun, 350); };
  const start = () => new MutationObserver(kick).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden', 'open'] });
  if (document.documentElement) start(); else addEventListener('DOMContentLoaded', start);
})();
