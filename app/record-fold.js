// UI-기록줄높이통일(S70-66, 사용자 결정 2026-11-26 08:19 "두 줄" — 시안 docs/design/swipe-and-record-mockup.html 시안 B 나안).
// 기록 줄 하나 모양: [날짜 · 요약 두 줄까지(넘치면 '…') · 첨부 수·메모 수 · ›] 같은 높이. 줄을 누르면(Enter/Space도 — 진짜 button)
// 그 자리에서 펼쳐 본문 전체·첨부·메모가 보이고, 다시 누르면 접힌다. 폴드 펼침·PC 폭에서는 분류 칩(기록이 온 곳)이 줄 안에 보인다.
// 쓰는 곳: 조직 관리 기록(workplace-detail.js — 글 기록 줄·연결 기록 줄), 사업 관리 진행 기록(project-system-v3.js).
// - 요약은 이미 있는 글에서만 만든다(AI를 새로 부르지 않는다): 저장된 요약 칸이 있으면 그것, 없으면 본문 앞부분.
// - 펼침 상태는 화면이 가진 Set 하나(createFoldState — 그 화면을 연 동안 메모리만, 서버·기기에 저장하지 않음). 그리기는 화면의 그리기 함수 하나가
//   이 Set을 읽어 펼친 줄을 펼친 채로 그리고, 누름은 Set과 그 줄의 속성(aria-expanded·hidden)만 바꾼다(다시 그리지 않음).
// - 본문에 마크다운 표시가 있으면(data-rec-fold-md) 처음 펼칠 때 공용 마크다운 보기로 정리해 보인다(원문은 바꾸지 않음).
import {partStyles} from './part-styles.js';
await partStyles('record-fold');

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const CLIP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 7l-7 7a2 2 0 003 3l7-7a4 4 0 00-6-6l-7 7a6 6 0 008 8l6-6"/></svg>';
const MEMO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg>';

export const createFoldState = () => new Set();

// 줄 끝 작은 표시: 첨부 n · 메모 n · ›. 0이면 그 표시는 그리지 않는다.
export function foldMetaHtml({files = 0, memos = 0} = {}) {
  const f = Math.max(0, Number(files) || 0), m = Math.max(0, Number(memos) || 0);
  return `<span class="rec-fold-meta">${f ? `<span class="rec-fold-n" data-rec-fold-files="${f}">${CLIP}<span class="rec-fold-sr">첨부 </span>${f}</span>` : ''}${m ? `<span class="rec-fold-n" data-rec-fold-memos="${m}">${MEMO}<span class="rec-fold-sr">메모 </span>${m}</span>` : ''}<span class="rec-fold-cv" aria-hidden="true">›</span></span>`;
}

// 머리 줄(누르는 곳). 공용 ③ 글자 버튼(row-act — UI-버튼6가지)에 줄 모양만 덧씌운다(record-sheet.css, 쪽지 함 머리 줄 nbx-title-btn과 같은 방식). day: 날짜 칸 html(이미 escape된 time 등), summary: 요약 글(escape 전), chip: 분류 칩 html(넓은 폭에서만 글자가 보임),
// attrs: 그 화면이 이 버튼에 붙여 온 속성 글(예: data-basket-link-open — 다른 부품이 초점을 옮길 때 찾는 이름).
export function foldHeadHtml({key, day = '', summary = '', chip = '', files = 0, memos = 0, open = false, cls = '', attrs = '', textAttrs = ''}) {
  return `<button type="button" class="row-act rec-fold-head${cls ? ' ' + cls : ''}" data-rec-fold-toggle="${esc(key)}" aria-expanded="${open ? 'true' : 'false'}"${attrs ? ' ' + attrs : ''}><span class="rec-fold-day">${day}</span><span class="rec-fold-sum">${chip ? `<span class="rec-fold-chip">${chip}</span> ` : ''}<span class="rec-fold-text"${textAttrs ? ' ' + textAttrs : ''}>${esc(summary)}</span></span>${foldMetaHtml({files, memos})}</button>`;
}
export const foldBodyAttrs = open => `class="rec-fold-body" data-rec-fold-body${open ? '' : ' hidden'}`;

// 펼친 본문 글: 줄바꿈 그대로. md가 있으면 처음 펼칠 때 마크다운 보기로 바꾼다.
export function foldFullHtml(text, {md = ''} = {}) {
  return `<div class="rec-fold-full"${md ? ` data-rec-fold-md="${esc(md)}"` : ''}>${esc(text)}</div>`;
}

let mdView = null;
async function showMarkdown(row) {
  for (const el of row.querySelectorAll('[data-rec-fold-md]:not([data-rec-fold-md-done])')) {
    el.dataset.recFoldMdDone = '1';
    try {
      mdView = mdView || await import('./markdown-view.js');
      const res = await mdView.renderMarkdownInto(el, el.dataset.recFoldMd, {isCurrent: () => el.isConnected});
      if (!res.ok) delete el.dataset.recFoldMdDone;
    } catch { delete el.dataset.recFoldMdDone; }
  }
}

// 펼침 상태 하나를 줄에 맞춘다(그리기 뒤 펼친 줄의 마크다운도).
export function setRowOpen(row, open) {
  const head = row?.querySelector?.('[data-rec-fold-toggle]'), body = row?.querySelector?.('[data-rec-fold-body]');
  if (!head) return;
  head.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (body) body.hidden = !open;
  row.toggleAttribute('data-rec-fold-open', !!open);
  if (open) void showMarkdown(row);
}

// 한 화면(host)에 누름 하나. state = createFoldState()의 Set. onOpen(row): 펼친 뒤 그 줄에서 할 일(작은 그림 받기 등).
const bound = new WeakSet();
export function bindRecordFold(host, state, {onOpen = () => {}, canToggle = () => true} = {}) {
  if (!host || bound.has(host)) return;
  bound.add(host);
  host.addEventListener('click', e => {
    const head = e.target.closest?.('[data-rec-fold-toggle]');
    if (!head || !host.contains(head)) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const row = head.closest('[data-rec-fold]');
    if (!row || !canToggle(row)) return;
    e.preventDefault();
    const key = head.dataset.recFoldToggle, open = head.getAttribute('aria-expanded') !== 'true';
    if (open) state.add(key); else state.delete(key);
    setRowOpen(row, open);
    if (open) onOpen(row);
  });
}

// 그리기 뒤 펼친 줄의 마크다운 정리(그리기 함수가 펼친 채로 그린 줄).
export function syncOpenRows(host) {
  host?.querySelectorAll?.('[data-rec-fold][data-rec-fold-open]').forEach(row => void showMarkdown(row));
}
