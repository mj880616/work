// S52-09 UI-요청상자통일(요청함 11/07 10:52, 시안 docs/design/mockups/home-asks-box.html, 명진 'ㅇ'): 홈 '나한테 온 요청'과 '잊지 말기'가 함께 쓰는
// 알림 상자 부품 하나. 상자·머리 줄·줄·버튼 모양은 여기 한 곳이 만들고, 색만 tone('ask' = 톤다운 파랑, 'forget' = 톤다운 노랑)으로 나눈다.
// - 머리 줄: 제목 · 개수(있을 때) · 흐린 글(출처 또는 '새 … 없음') · 오른쪽 [열기 ›](③ 글자 버튼).
// - 줄: 내용 한 줄 + 아래 작은 줄(왼쪽 누가·출처·날짜, 오른쪽 [할 일로][이미 함][일정으로][노트로](③ 글자 버튼 — UI-줄버튼 '줄 안 동작 버튼') ×(⑥ 아이콘)).
// - 줄 아래 흐린 한 줄(foot, 상자마다 있을 때만), 맨 아래 상태 줄(5초 되돌리기 포함).
// 순수 HTML 조각만 만든다(DOM·네트워크 없음). 글은 모두 esc()로 글자로만. 상자를 그리는 쪽(잊지 말기 상자·asks-box.js)이 이 조각만 쓴다.
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
// 줄 버튼 4개 + ×. 순서·이름은 두 상자가 같다(명진 10:52 '노트로 버튼도 넣어').
export const NB_ACTS = Object.freeze([['task', '할 일로'], ['done', '이미 함'], ['event', '일정으로'], ['note', '노트로']]);
export const NB_TONES = Object.freeze(['ask', 'forget']);
export const NB_UNDO_MS = 5000;

// open: {attr: 'data-…', label: '정리함 열기 ›'} — 머리 줄 오른쪽 글자 버튼. faint: 흐린 글(예 '· 텔레그램 ·', '· 새 요청 없음 ·').
// countAttr: 개수 칸에 붙일 data 이름(시험·다른 화면이 읽음, 없으면 생략).
export function headHtml({title, count = 0, faint = '', open = null, countAttr = ''}) {
  const n = Number.isInteger(count) && count > 0 ? `<span class="nbx-n"${countAttr ? ` ${countAttr}` : ''}>${count}</span>` : '';
  const btn = open ? `<button type="button" class="row-act nbx-open" ${open.attr}>${esc(open.label)}</button>` : '';
  return `<div class="nbx-head${n ? '' : ' is-one'}"><span class="nbx-title">${esc(title)}</span>${n}${faint ? `<span class="nbx-faint">${esc(faint)}</span>` : ''}${btn}</div>`;
}
// 줄 하나. id는 줄 표시(data-nbx-row), prefix는 내용 앞 작은 꼬리표(HTML, 이미 esc된 것), meta는 아래 작은 줄 왼쪽 글.
export function rowHtml({id, body, meta = '', prefix = '', busy = false}) {
  const dis = busy ? ' disabled' : '';
  const acts = NB_ACTS.map(([act, label]) => `<button type="button" class="row-act nbx-act" data-nbx-act="${act}"${dis}>${label}</button>`).join('');
  return `<li class="nbx-item" data-nbx-row="${esc(id)}"><p class="nbx-body">${prefix}${esc(body)}</p>`
    + `<div class="nbx-row2"><span class="nbx-meta">${esc(meta)}</span>`
    + `<span class="nbx-acts" role="group" aria-label="${esc(body)}">${acts}`
    + `<button type="button" class="icon-btn nbx-x" data-nbx-act="dismissed" aria-label="지우기: ${esc(body)}"${dis}>×</button></span></div></li>`;
}
// 상자 안쪽 전체. rows: rowHtml 조각 목록. status: 상태 글, undo: 되돌리기 버튼을 보일지. foot: 맨 아래 흐린 한 줄(HTML).
export function boxHtml({head, rows = [], status = '', undo = false, foot = ''}) {
  const undoBtn = undo ? ` <button type="button" class="row-act nbx-undo" data-nbx-undo>되돌리기</button>` : '';
  // 상태 줄(되돌리기)은 맨 아래: 흐린 한 줄의 누르는 범위(44px)가 [되돌리기]를 덮지 않게 뒤에 둔다.
  return head + (rows.length ? `<ul class="nbx-list">${rows.join('')}</ul>` : '') + foot
    + `<p class="nbx-status" role="status" aria-live="polite">${esc(status)}${undoBtn}</p>`;
}
// 상자 바탕(host)에 붙일 표시. 모양 규칙은 ui-standard.css 'UI-요청상자통일' 한 곳.
export function markBox(host, tone) {
  host.classList.add('nbx');
  host.dataset.nbxTone = NB_TONES.includes(tone) ? tone : 'ask';
}
