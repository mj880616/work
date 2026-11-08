// S52-09 UI-요청상자통일(요청함 11/07 10:52, 시안 docs/design/mockups/home-asks-box.html, 명진 'ㅇ'): 홈 '나한테 온 요청'과 '잊지 말기'가 함께 쓰는
// 알림 상자 부품 하나. 상자·머리 줄·줄·버튼 모양은 여기 한 곳이 만들고, 색만 tone('ask' = 톤다운 파랑, 'forget' = 톤다운 노랑)으로 나눈다.
// - 머리 줄: 제목 · 개수(있을 때) · 흐린 글(출처 또는 '새 … 없음') · 오른쪽 [열기 ›](③ 글자 버튼).
// - 줄: 내용 한 줄 + 아래 작은 줄(왼쪽 누가·출처·날짜, 오른쪽 [할 일로][이미 함][일정으로][노트로](③ 글자 버튼 — UI-줄버튼 '줄 안 동작 버튼') ×(⑥ 아이콘)).
// - 줄 아래 흐린 한 줄(foot, 상자마다 있을 때만), 맨 아래 상태 줄(5초 되돌리기 포함).
// 순수 HTML 조각만 만든다(DOM·네트워크 없음). 글은 모두 esc()로 글자로만. 상자를 그리는 쪽(잊지 말기 상자·asks-box.js)이 이 조각만 쓴다.
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
// 줄 버튼 4개 + ×. 순서·이름은 모든 줄이 같다(명진 10:52 '노트로 버튼도 넣어', S52-20 시안 forget-one-list.html: [할 일로][일정으로][노트로][이미 함] ×).
export const NB_ACTS = Object.freeze([['task', '할 일로'], ['event', '일정으로'], ['note', '노트로'], ['done', '이미 함']]);
// FORGET-소식바로잡기(요청함 11/09 01:45, 시안 docs/design/mockups/forget-news-fix.html, 명진 'ㅇ'): 잊지 말기 줄은 원래 다섯(위 넷 + ×) 그대로에
// [조직][사업] 두 개만 더한 일곱 — [할 일로][일정으로][노트로][조직][사업][이미 함] ×. 출처(텔레그램 요청·챙길 것·업데이트·소식)와 상관없이 같은 순서.
// 가족 줄은 보고 길을 막아 두므로 위 NB_ACTS(다섯) 그대로다.
export const NB_REPORT_ACTS = Object.freeze([['task', '할 일로'], ['event', '일정으로'], ['note', '노트로'], ['org', '조직'], ['area', '사업'], ['done', '이미 함']]);
// list = 상자 바탕·테두리 없이 화면 목록으로 쓰는 같은 줄(S52-20 '잊지 말기' 한 목록, 정리함 화면 안).
export const NB_TONES = Object.freeze(['ask', 'forget', 'list']);
export const NB_UNDO_MS = 5000;

// open: {attr: 'data-…', label: '정리함 열기 ›'} — 머리 줄 오른쪽 글자 버튼. faint: 흐린 글(예 '· 텔레그램 ·', '· 새 요청 없음 ·').
// countAttr: 개수 칸에 붙일 data 이름(시험·다른 화면이 읽음, 없으면 생략).
// badge: 빨간 바탕 흰 글자 숫자 동그라미(앱 안 읽은 알림처럼, S52-20 홈 '잊지 말기' 한 줄). 0이면 그리지 않는다. 99를 넘으면 '99+'.
// titleOpen: {attr} — 제목(과 숫자) 자체가 여는 버튼(오른쪽 [열기 ›] 없음). 명진 11/07 22:31 홈 '잊지 말기': "그냥 잊지말기 텍스트 클릭하면 되게, 열기 텍스트는 삭제".
// end: 머리 줄 맨 오른쪽에 더 붙일 HTML(이미 esc된 것, 예 '내일 약속 n ›').
export function headHtml({title, count = 0, faint = '', open = null, countAttr = '', badge = 0, titleOpen = null, end = ''}) {
  const n = Number.isInteger(count) && count > 0 ? `<span class="nbx-n"${countAttr ? ` ${countAttr}` : ''}>${count}</span>`
    : Number.isInteger(badge) && badge > 0 ? `<span class="nbx-badge" data-nbx-badge>${badge > 99 ? '99+' : badge}</span>` : '';
  const btn = open ? `<button type="button" class="row-act nbx-open" ${open.attr}>${esc(open.label)}</button>` : '';
  const lead = titleOpen
    ? `<button type="button" class="row-act nbx-title-btn" ${titleOpen.attr}><span class="nbx-title">${esc(title)}</span>${n}</button>`
    : `<span class="nbx-title">${esc(title)}</span>${n}`;
  return `<div class="nbx-head${n ? '' : ' is-one'}">${lead}${faint ? `<span class="nbx-faint">${esc(faint)}</span>` : ''}${btn}${end}</div>`;
}
// 줄 하나. id는 줄 표시(data-nbx-row), prefix는 내용 앞 작은 꼬리표(HTML, 이미 esc된 것), meta는 아래 작은 줄 왼쪽 글.
// S52-20 HOME-잊지말기한목록(시안 docs/design/mockups/forget-one-list.html): 들어오는 곳이 달라도 같은 줄 하나.
// - src: 아래 작은 줄 맨 앞 흐린 출처 꼬리표('텔레그램'·'가족'·'업데이트'·'챙길 것').
// - report: 버튼을 NB_REPORT_ACTS(조직·사업 포함 여섯 + ×)로(잊지 말기 줄, 가족 줄 빼고).
// - hint: AI가 고른 맞는 버튼 하나(act 이름)를 굵게(누르는 건 사람 — 자동 처리 없음). why: 내용 아래 흐린 이유 한 줄('조직보고 · ○○').
// - done: 처리한 줄(처리 전이 아닌 보기)은 버튼 대신 오른쪽 작은 상태 글('할 일로 보냄 · 11/7' 등).
// - open: {attrs, label} 내용 줄을 누르면 원래 기록을 여는 글자 버튼(업데이트 줄). attrs는 이미 esc된 속성 글.
// - attrs: li에 더 붙일 속성(이미 esc된 글), tail: × 뒤에 붙일 ⑥ 아이콘(⋯) HTML, below: 줄 아래 더 붙일 HTML(연결된 곳 칩).
// - acts: 4개 버튼과 × 대신 쓸 버튼 목록(같은 ③ 글자 버튼, 없앨 수 없는 줄만 — 상대 약속 [원장으로]).
export function rowHtml({id, body, meta = '', prefix = '', busy = false, src = '', report = false, hint = '', why = '', done = '', open = null, attrs = '', tail = '', below = '', acts = null}) {
  const dis = busy ? ' disabled' : '';
  const btn = ([act, label]) => act === hint
    ? `<button type="button" class="row-act nbx-act nbx-hint" data-nbx-act="${act}" data-nbx-hint${dis}>${esc(label)}</button>`
    : `<button type="button" class="row-act nbx-act" data-nbx-act="${act}"${dis}>${esc(label)}</button>`;
  const right = done
    ? `<span class="nbx-done">${esc(done)}</span>${tail}`
    : `<span class="nbx-acts" role="group" aria-label="${esc(body)}">${(acts || (report ? NB_REPORT_ACTS : NB_ACTS)).map(btn).join('')}`
      + `${acts ? '' : `<button type="button" class="icon-btn nbx-x" data-nbx-act="dismissed" aria-label="삭제: ${esc(body)}"${dis}>×</button>`}${tail}</span>`;
  const text = open ? `<button type="button" class="row-act nbx-body-btn" ${open.attrs}>${esc(open.label ?? body)}</button>` : esc(body);
  return `<li class="nbx-item" data-nbx-row="${esc(id)}"${attrs ? ' ' + attrs : ''}><p class="nbx-body">${prefix}${text}</p>${why ? `<p class="nbx-why">${esc(why)}</p>` : ''}`
    + `<div class="nbx-row2"><span class="nbx-meta">${src ? `<span class="nbx-src">${esc(src)}</span>` : ''}${esc(meta)}</span>${right}</div>${below}</li>`;
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
