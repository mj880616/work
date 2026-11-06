import {tagLabel, tagStyle} from './news-colors.mjs';
// S51-8 NEWS-전면개편 P4b(시안 news-overhaul.html ①): News 목록 줄 하나와 날짜 묶음의 글자(HTML)를 만드는 순수 함수. DOM·네트워크 없음.
// 세 목록([전체]·[사회운동]은 outside-statements.js, [언론]은 news-clipping.js, [보관]은 now-saved.js)이 같은 줄 모양을 쓴다(그리기는 각 칸 주인).
// 줄: 왼쪽 매체 색 띠 · 제목(안 읽은 글 굵게, 읽은 글 흐리게) / 매체 이름(같은 색) · 분류 꼬리표 · 시각 · 별표. 요약 줄은 목록에 없다(상세에서).
// 바깥 글자는 모두 esc로만 넣는다. 색은 var(--ds-news-*) 토큰 이름만(news-colors.mjs).

// r: {key:'outside:<id>'|'news:<id>', openAttr:'data-…', openId, rowAttr?:'data-…', rowId?, title, titleLang?, src, badge?, color, tag, time, star, hit?, read:true|false|null, open, cls?, acts?}
// badge = 매체 이름 바로 뒤 작은 표시(공대위, 명진 결정 11/02 L3). hit = 확정 관심 주제에 걸린 주제 이름(줄 끝 작은 표시, 설계 outside-statements.md 12.2 결정 ②).
export function rowHtml(r, esc) {
  const state = r.read === true ? ' is-read' : r.read === false ? ' is-new' : '';
  const row = r.rowAttr ? ` ${r.rowAttr}="${esc(r.rowId ?? r.openId)}"` : '';
  const tag = r.tag && tagLabel(r.tag) ? `<span class="nw-tag" style="${tagStyle(r.tag)}">${esc(tagLabel(r.tag))}</span>` : '';
  const star = r.star ? '<span class="nw-star" aria-label="별표">★</span>' : '';
  return `<article class="nw-row now-row${state}${r.open ? ' is-open' : ''}${r.cls ? ' ' + r.cls : ''}" data-nw-key="${esc(r.key)}"${row} style="--nw-c:${r.color}">`
    + '<span class="nw-bar" aria-hidden="true"></span><div class="nw-main">'
    + `<h4 class="nw-title"${r.titleLang ? ` lang="${esc(r.titleLang)}"` : ''}><button type="button" class="now-open" ${r.openAttr}="${esc(r.openId)}"${r.read === false ? ' data-unread' : ''}>${esc(r.title)}</button></h4>`
    + `<p class="nw-meta">${r.src ? `<span class="nw-src">${esc(r.src)}</span>` : ''}${r.badge ? `<span class="nw-badge">${esc(r.badge)}</span>` : ''}${tag}${r.time ? `<span class="nw-time">${esc(r.time)}</span>` : ''}${r.hit ? `<span class="now-hit">${esc(r.hit)}</span>` : ''}${star}</p>`
    + `</div>${r.acts || ''}</article>`;
}
// 날짜 묶음 머리 + 흰 상자 안 줄들. 새 글(안 읽은 글)이 있으면 '오늘 · 새 글 6'.
export function dayHtml(label, rowsHtml, unread, esc) {
  const head = `${esc(label)}${unread > 0 ? ` · 새 글 ${unread}` : ''}`;
  return `<section class="nw-day" aria-label="${esc(label)}"><h3 class="nw-day-head">${head}</h3><div class="nw-card">${rowsHtml}</div></section>`;
}
