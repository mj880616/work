import {tagLabel, tagStyle} from './news-colors.mjs';
import {chevHtml} from './fold-chevron.mjs';
// S51-8 NEWS-전면개편 P4b(시안 news-overhaul.html ①): News 목록 줄 하나와 날짜 묶음의 글자(HTML)를 만드는 순수 함수. DOM·네트워크 없음.
// 목록([전체]·[사회운동]은 outside-statements.js, [언론]은 news-clipping.js)이 같은 줄 모양을 쓴다(그리기는 각 칸 주인).
// 줄: 왼쪽 매체 색 띠 · 제목(안 읽은 글 굵게, 읽은 글 흐리게) / 매체 이름(같은 색) · 분류 꼬리표 · 시각 | 오른쪽 끝 별표(줄 세로 가운데). 요약 줄은 목록에 없다(상세에서).
// 바깥 글자는 모두 esc로만 넣는다. 색은 var(--ds-news-*) 토큰 이름만(news-colors.mjs).

// r: {key:'outside:<id>'|'news:<id>', openAttr:'data-…', openId, rowAttr?:'data-…', rowId?, title, titleLang?, src, badge?, color(이름 글자), bar?(막대, 없으면 color), tag, time, star, hit?, read:true|false|null, open, cls?, acts?}
// memo = [메모] 탭 줄의 메모 첫 줄(꼬리 줄 아래 작게, S69-70). badge = 매체 이름 바로 뒤 작은 표시(공대위, 명진 결정 11/02 L3). hit = 확정 관심 주제에 걸린 주제 이름(줄 끝 작은 표시, 설계 outside-statements.md 12.2 결정 ②).
export function rowHtml(r, esc) {
  const state = r.read === true ? ' is-read' : r.read === false ? ' is-new' : '';
  const row = r.rowAttr ? ` ${r.rowAttr}="${esc(r.rowId ?? r.openId)}"` : '';
  const tag = r.tag && tagLabel(r.tag) ? `<span class="nw-tag" style="${tagStyle(r.tag)}">${esc(tagLabel(r.tag))}</span>` : '';
  // S67-11 NEWS-보관빼기: 별표한 줄의 ★은 단추 — 누르면 보관에서 빼기(now-row-acts.js dropSaved, 5초 [되돌리기]). 줄 열기 단추와 따로(겹친 누르기 면 위, CSS).
  // READ-별표가운데(11/28): ★은 꼬리 줄 안이 아니라 줄의 오른쪽 끝 칸(.nw-main 다음)에 둔다 — 줄 전체 높이의 세로 가운데(제목이 두 줄이어도, now.css align-self).
  const star = r.star ? '<button type="button" class="icon-btn nw-star" data-now-act="unstar" aria-label="저장한 글에서 삭제" title="저장한 글에서 삭제"><span aria-hidden="true">★</span></button>' : '';
  return `<article class="nw-row now-row${state}${r.open ? ' is-open' : ''}${r.cls ? ' ' + r.cls : ''}" data-nw-key="${esc(r.key)}"${row} style="--nw-c:${r.color}${r.bar && r.bar !== r.color ? `;--nw-bar:${r.bar}` : ''}">`
    + '<span class="nw-bar" aria-hidden="true"></span><div class="nw-main">'
    + `<h4 class="nw-title"${r.titleLang ? ` lang="${esc(r.titleLang)}"` : ''}><button type="button" class="now-open" ${r.openAttr}="${esc(r.openId)}"${r.read === false ? ' data-unread' : ''}>${esc(r.title)}</button></h4>`
    + `<p class="nw-meta">${r.src ? `<span class="nw-src">${esc(r.src)}</span>` : ''}${r.badge ? `<span class="nw-badge">${esc(r.badge)}</span>` : ''}${tag}${r.time ? `<span class="nw-time">${esc(r.time)}</span>` : ''}${r.hit ? `<span class="now-hit">${esc(r.hit)}</span>` : ''}</p>`
    + (r.memo ? `<p class="nw-memo"><span class="nm-k">메모</span>${esc(r.memo)}</p>` : '')
    + `</div>${star}${r.acts || ''}</article>`;
}
// 날짜 묶음 머리 + 흰 상자 안 줄들. 새 글(안 읽은 글)이 있으면 '오늘 · 새 글 6'.
export function dayHtml(label, rowsHtml, unread, esc) {
  const head = `${esc(label)}${unread > 0 ? ` · 새 글 ${unread}` : ''}`;
  return `<section class="nw-day" aria-label="${esc(label)}"><h3 class="nw-day-head">${head}</h3><div class="nw-card">${rowsHtml}</div></section>`;
}
// S71-27 NEWS-머리한줄(명진 11/26 "오늘 새글 이것도 위로 밀어넣으면 될듯"): 목록 맨 위 묶음이 '오늘'이면 그 머리 줄('오늘 · 새 글 N')은 그리지 않고
// 새 글 수는 화면 첫 줄(읽을 거리 · 새 글 N, screen-find.js noteBox)이 보인다. 아래 '어제'·날짜 묶음 머리는 그대로 둔다.
// 맨 위가 다른 묶음(관심 주제·어제·날짜)이거나 lead=false(국제 접기 안쪽 등 목록 맨 위가 아닌 곳)면 모든 머리를 그대로 그린다.
// groups = [{label, rows(줄 HTML), unread}] → {html, lead: 머리를 뺀 '오늘' 묶음의 새 글 수 | null(뺀 머리 없음)}
export const TODAY_LABEL = '오늘';
export function daysListHtml(groups, esc, {lead = true} = {}) {
  const list = Array.isArray(groups) ? groups : [];
  const top = lead && list[0]?.label === TODAY_LABEL ? list[0] : null;
  const html = list.map((g, i) => (top && i === 0
    ? `<section class="nw-day nw-day-lead" aria-label="${esc(g.label)}"><div class="nw-card">${g.rows}</div></section>`
    : dayHtml(g.label, g.rows, g.unread, esc))).join('');
  return {html, lead: top ? Math.max(0, Number(top.unread) || 0) : null};
}
// 화면 첫 줄 글자: 새 글이 있을 때만 '새 글 N'(없으면 빈 글자 — 자리째 없다).
export const leadText = n => (Number(n) > 0 ? `새 글 ${Number(n)}` : '');
// NEWS-도배막기 A(news-fold.mjs foldRuns): 같은 매체가 연달아 나온 기사 묶음. 첫 기사 줄 + 작게 '○○ 외 N건'(누르면 그 자리에서 펼침·다시 누르면 접힘).
// 펼침은 브라우저 기본 <details>(키보드·터치 그대로). 열림 여부는 그리는 칸 주인이 화면 메모리로 들고 open으로 넘긴다(다시 그려도 그대로).
// runs = foldRuns 결과, o = {rowOf(entry)→줄 HTML, keyOf(entry)→줄 키, nameOf(entry)→매체 이름, isOpen(foldKey, entries)→bool}.
export function runsHtml(runs, o, esc) {
  return (runs || []).map(r => {
    const lead = o.rowOf(r.lead);
    if (!r.more.length) return lead;
    const key = 'fold:' + o.keyOf(r.lead);
    const open = !!o.isOpen?.(key, [r.lead, ...r.more]);
    const name = o.nameOf(r.lead) || '같은 매체';
    return lead + `<details class="nw-fold" data-nw-fold="${esc(key)}"${open ? ' open' : ''}><summary class="nw-fold-sum">${esc(name)} 외 ${r.more.length}건${chevHtml(false)}</summary>${r.more.map(e => o.rowOf(e)).join('')}</details>`;
  }).join('');
}
