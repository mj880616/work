// UI-고른것접기(PROFILE-담당사업장접기, 2026-10-29 명진 결정): 긴 체크 목록의 한 가지 모양.
// '고른 것'은 늘 보이고, 나머지는 접힌 '그 외 n' 안에 둔다. '그 외'를 펼치면 맨 위에 찾기 칸(초성 찾기 포함)이 있다.
// 제목(title)을 주면 전체가 '제목 n' 한 줄로 접힌 채 시작한다. 접힘·펼침·찾기 글은 기억하지 않는다(다시 그릴 때만 이어 간다).
// 줄 모양(체크 칸·이름·버튼)과 저장은 부르는 화면이 맡는다. 이 부품은 묶음·접기·찾기만 맡는다.

const CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const CHO_SET = new Set(CHO);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const norm = v => String(v ?? '').toLowerCase().replace(/\s+/g, '');

// 한글 음절은 첫 자음으로, 나머지 글자는 그대로 둔다. '철도노조' → 'ㅊㄷㄴㅈ'.
export function chosung(text) {
  let out = '';
  for (const ch of String(text ?? '')) {
    const code = ch.charCodeAt(0);
    out += code >= 0xAC00 && code <= 0xD7A3 ? CHO[Math.floor((code - 0xAC00) / 588)] : ch;
  }
  return out;
}

// 찾기 글이 이름 안에 이어서 들어 있으면 맞다. 찾기 글의 자음 한 글자(ㄱ~ㅎ)는 그 자리 음절의 첫 자음과 맞으면 된다.
// 그래서 '철도', 'ㅊㄷ', '철ㄷ' 모두 '전국철도노동조합'에 맞는다. 띄어쓰기·대소문자는 보지 않는다.
export function pickMatch(name, query) {
  const q = [...norm(query)];
  if (!q.length) return true;
  const n = [...norm(name)], c = [...chosung(n.join(''))];
  for (let i = 0; i + q.length <= n.length; i++) {
    let ok = true;
    for (let j = 0; j < q.length && ok; j++) ok = n[i + j] === q[j] || (CHO_SET.has(q[j]) && c[i + j] === q[j]);
    if (ok) return true;
  }
  return false;
}

// 화면이 다시 그리기 전에 지금 접힘·찾기 상태를 읽는다. 열쇠(key)마다 {open, othersOpen, query}.
export function readPickState(root) {
  const out = {};
  root?.querySelectorAll?.('[data-pick-key]').forEach(el => {
    const key = el.dataset.pickKey, fold = el.matches('[data-pick-fold]') ? el : null, others = el.querySelector('[data-pick-others]');
    out[key] = {open: fold ? fold.open : true, othersOpen: !!others?.open, query: others?.querySelector('[data-pick-search]')?.value || ''};
  });
  return out;
}

// picked: 고른 줄 HTML(이미 순서대로). others: [{label, items:[{name, html}]}] 묶음 목록(빈 label은 묶음 제목 없음).
// state: readPickState()가 준 그 열쇠의 상태(없으면 접힌 채 시작).
export function pickFoldHtml({key, title = '', count = 0, picked = '', others = [], state = null, othersLabel = '그 외', noneText = '고른 것 없음', extra = ''}) {
  const st = state || {open: false, othersOpen: false, query: ''};
  const groups = others.map(g => ({label: g.label || '', items: (g.items || []).filter(Boolean)})).filter(g => g.items.length);
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  let shown = 0;
  const list = groups.map(g => {
    const rows = g.items.map(it => {
      const hit = pickMatch(it.name, st.query);
      if (hit) shown++;
      return `<div class="pick-item" data-pick-name="${esc(it.name)}"${hit ? '' : ' hidden'}>${it.html}</div>`;
    }).join('');
    const any = g.items.some(it => pickMatch(it.name, st.query));
    return `<div class="pick-group" data-pick-group${any ? '' : ' hidden'}>${g.label ? `<p class="pick-group-name">${esc(g.label)}</p>` : ''}${rows}</div>`;
  }).join('');
  const othersHtml = total ? `<details class="pick-others" data-pick-others${st.othersOpen ? ' open' : ''}><summary class="pick-others-head">${esc(othersLabel)} <span class="pick-n">${total}</span></summary><input type="search" class="pick-search" data-pick-search value="${esc(st.query)}" placeholder="찾기 (초성도 됨)" aria-label="${esc(othersLabel)}에서 찾기" autocomplete="off" spellcheck="false"><div class="pick-others-list">${list}</div><p class="pick-empty" data-pick-empty${shown ? ' hidden' : ''}>맞는 항목이 없어요.</p></details>` : '';
  const body = `<div class="pick-picked">${picked || `<p class="pick-none">${esc(noneText)}</p>`}</div>${othersHtml}${extra}`;
  if (!title) return `<div class="pick-fold-plain" data-pick-key="${esc(key)}">${body}</div>`;
  return `<details class="pick-fold" data-pick-fold data-pick-key="${esc(key)}"${st.open ? ' open' : ''}><summary class="pick-fold-head"><span class="pick-fold-title">${esc(title)}</span> <span class="pick-n" data-pick-count>${count}</span></summary><div class="pick-fold-body">${body}</div></details>`;
}

// 찾기 칸에 글을 넣으면 그 '그 외' 안에서 맞는 줄만 남긴다. 그리기는 pickFoldHtml 하나이고, 여기서는 같은 규칙(pickMatch)으로 줄만 가린다.
export function filterPickOthers(others) {
  const q = others?.querySelector('[data-pick-search]')?.value || '';
  let shown = 0;
  others?.querySelectorAll('[data-pick-group]').forEach(g => {
    let any = false;
    g.querySelectorAll('[data-pick-name]').forEach(it => { const hit = pickMatch(it.dataset.pickName, q); it.hidden = !hit; if (hit) { any = true; shown++; } });
    g.hidden = !any;
  });
  const empty = others?.querySelector('[data-pick-empty]');
  if (empty) empty.hidden = !!shown;
}

// 화면 칸(root)에 한 번만 붙인다. 찾기 칸에서 Enter는 저장·제출로 번지지 않게 막는다.
export function bindPickFold(root) {
  if (!root || root.dataset.pickBound === '1') return;
  root.dataset.pickBound = '1';
  root.addEventListener('input', e => { const box = e.target.closest?.('[data-pick-search]'); if (box) filterPickOthers(box.closest('[data-pick-others]')); });
  root.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.closest?.('[data-pick-search]')) { e.preventDefault(); e.stopPropagation(); } }, true);
}
