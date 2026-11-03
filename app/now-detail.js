import {waitHtml, failHtml} from './wait-state.js';
import {createNoteDoc, saveNoteDoc} from './basket-data.js';
import {detailBody, detailView, detailError, itemKey, signalBody, RELATED_LABEL, interestHit, needsRead, hasMaterial, unreadReason} from './now-model.mjs';
// OUTSIDE-글상세·관심환류 ③(설계 docs/design/outside-statements.md 12.3·12.4·12.5·12.6절): 글 상세 공용 부품.
// 사회운동 글·뉴스 기사 두 쪽이 이 부품 하나를 쓴다(두 벌 안 만듦). 상세 칸(box)의 유일한 그리기 주인이다.
// - 위: 꼬리 줄(단체·매체 · 국내/외국 · 종류 · 글쓴이 · 날짜) + 오른쪽 [원문 ↗] / 제목(외국어면 원제 작게)
// - AI 부분(핵심 요약·주요 문장·나와의 연관·시사점·함께 볼 것)은 서버(ai-assist kind now_detail)가 처음 열 때 한 번 만들어 저장한다.
//   화면은 글 id만 보낸다(주소·본문 안 보냄). 다시 열면 서버 저장본. 하루 40번을 넘으면 서버가 요약·문장까지만(level basic).
// - 아래 작은 단추 줄 [☆ 별표] [보관] [메모] [관심 없음]: 사회운동 글은 app_outside_marks(글마다 한 줄), 뉴스는 기존 app_news_items 칸
//   (starred_at·hidden_at, 보관 = 별표 폴더라 목록의 폴더 고르기에서). 메모는 기존 노트(app_notes, metadata.outside_post_id|news_item_id).
//   누를 때마다 환류 기록 한 줄(app_now_signals, 화면은 더하기만, 시각은 서버 시계). [원문 ↗] 열기도 기록한다.
// - 저장은 모두 서버(작업공간 소유자 RLS). 기기 저장 없음. 상세 저장본은 이 탭 메모리에만 다시 쓰려고 둔다.
// 바깥 글자는 모두 esc로 그린다. 로그에 제목·본문을 남기지 않는다.

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const q = v => encodeURIComponent(v);
const rt = () => window.KPTURuntime;
const workspaceOf = () => rt()?.context?.read?.()?.workspace?.id || '';
const MEMO_COLS = 'id,title,raw_text,metadata,updated_at,doc_type:doc->>type';
const saveFailNote = e => (e?.status ? `저장하지 못함 · HTTP ${e.status}` : '저장하지 못함 · 잠시 뒤 다시');

// head: {meta: [글자…], title, origTitle, lang, url}. item: {type:'outside'|'news', id}.
export function createNowDetail({box, topics = () => [], onClose, onChanged, onSignal, onRelated, onRead} = {}) {
  let cur = null; // {item, head, detail, failed, note, marks, memo, memoOpen, memoBusy, memoNote, busy}
  const details = new Map(); // itemKey → 서버 답(이 탭 메모리만)
  let seq = 0;

  // ---------- 서버 ----------
  const askDetail = item => rt().api('/functions/v1/ai-assist', {method: 'POST', body: detailBody(item), singleFlight: false, timeoutMs: 120000});
  async function readMarks(item) {
    const w = workspaceOf();
    if (item.type === 'news') {
      const rows = await rt().api(`/rest/v1/app_news_items?workspace_id=eq.${q(w)}&id=eq.${q(item.id)}&select=starred_at,folder_id,hidden_at&limit=1`, {singleFlight: false});
      const r = Array.isArray(rows) ? rows[0] : null;
      return {star: !!r?.starred_at, archive: !!r?.folder_id, dismiss: !!r?.hidden_at};
    }
    const rows = await rt().api(`/rest/v1/app_outside_marks?workspace_id=eq.${q(w)}&post_id=eq.${q(item.id)}&select=starred_at,archived_at,dismissed_at&limit=1`, {singleFlight: false});
    const r = Array.isArray(rows) ? rows[0] : null;
    return {star: !!r?.starred_at, archive: !!r?.archived_at, dismiss: !!r?.dismissed_at, has: !!r};
  }
  const readMemo = item => rt().api(`/rest/v1/app_notes?workspace_id=eq.${q(workspaceOf())}&kind=eq.note&archived_at=is.null&metadata->>${item.type === 'news' ? 'news_item_id' : 'outside_post_id'}=eq.${q(item.id)}&select=${MEMO_COLS}&order=updated_at.desc&limit=1`, {singleFlight: false}).then(r => (Array.isArray(r) ? r[0] || null : null));
  // 사회운동 글 표시: 줄이 있으면 그 칸만 고치고, 없으면 넣는다(화면 권한: 넣기 post_id·workspace_id·세 시각, 고치기 세 시각·updated_at).
  async function writeMark(item, field, on) {
    const w = workspaceOf(), at = new Date().toISOString(), value = on ? at : null;
    const rows = await rt().api(`/rest/v1/app_outside_marks?workspace_id=eq.${q(w)}&post_id=eq.${q(item.id)}&select=post_id`, {method: 'PATCH', body: {[field]: value, updated_at: at}, prefer: 'return=representation', singleFlight: false});
    if (Array.isArray(rows) && rows.length) return;
    if (!on) return;
    await rt().api('/rest/v1/app_outside_marks', {method: 'POST', body: {post_id: item.id, workspace_id: w, [field]: value}, prefer: 'return=minimal', singleFlight: false});
  }
  async function writeNews(item, body) {
    const rows = await rt().api(`/rest/v1/app_news_items?workspace_id=eq.${q(workspaceOf())}&id=eq.${q(item.id)}&select=id`, {method: 'PATCH', body: {...body, updated_at: new Date().toISOString()}, prefer: 'return=representation', singleFlight: false});
    if (!Array.isArray(rows) || !rows.length) throw new Error('save');
  }
  // 환류 기록 한 줄. 실패해도 누른 일은 그대로(기록은 관심 주제 후보 재료일 뿐).
  function signal(item, action) {
    const w = workspaceOf();
    if (!w) return;
    rt().api('/rest/v1/app_now_signals', {method: 'POST', body: signalBody(w, item, action), prefer: 'return=minimal', singleFlight: false})
      .then(() => onSignal?.(action)).catch(() => {});
  }

  // ---------- 그리기 ----------
  function aiHtml() {
    if (cur.unread) return `<div class="nd-unread" data-nd-unread role="status"><p class="nd-reason">기사를 읽지 못했어요 · ${esc(cur.unread)}</p><p class="nd-unread-acts"><button type="button" class="secondary" data-nd-retry>다시</button>${cur.head.url ? `<a class="nd-link" data-nd-link href="${esc(cur.head.url)}" target="_blank" rel="noopener noreferrer" aria-label="원문 (새 창)">원문 ↗</a>` : ''}</p></div>`;
    if (!cur.detail && cur.reading) return '<div class="nd-wait" data-nd-wait><p class="nd-faint">기사 가져오는 중 · 처음 한 번만</p>' + waitHtml({rows: 3}) + '</div>';
    if (!cur.detail) return cur.failed ? `${failHtml({text: cur.failed, retry: 'data-nd-retry'})}` : `<div class="nd-wait" data-nd-wait><p class="nd-faint">상세를 만드는 중 · 처음 한 번만</p>${waitHtml({rows: 5})}</div>`;
    const v = detailView(cur.detail);
    const sec = (title, inner, attr) => (inner ? `<section class="nd-sec"${attr ? ` ${attr}` : ''}><h4 class="nd-h">${title}</h4>${inner}</section>` : '');
    const sum = v.summary ? `<p class="nd-sum">${esc(v.summary)}</p>` : '';
    const sents = v.sentences.length ? `<ul class="nd-sents">${v.sentences.map(s => `<li><span class="nd-orig-line"${cur.head.lang && cur.head.lang !== 'ko' ? ` lang="${esc(cur.head.lang)}"` : ''}>${esc(s.orig)}</span>${s.ko ? `<span class="nd-ko">${esc(s.ko)}</span>` : ''}</li>`).join('')}</ul>` : '';
    let rel = '';
    if (v.level === 'basic') rel = '<p class="nd-faint">오늘 상세 한도를 넘어 요약·문장까지만 · 내일 열면 채워요</p>';
    else if (v.relevance) rel = `${v.relevance.topics.length ? `<p class="nd-topics">${v.relevance.topics.map(t => `<span class="nd-topic">${esc(t)}</span>`).join('')}</p>` : ''}${v.relevance.reason ? `<p class="nd-reason">${esc(v.relevance.reason)}</p>` : ''}`;
    else rel = `<p class="nd-faint">${topics().length ? '연관 낮음' : '확정한 관심 주제가 없어요 · ⋯ → 관심 주제'}</p>`;
    const imp = v.implications ? `${v.implications.kptu ? `<p class="nd-imp"><b>공공운수노조 운동</b> ${esc(v.implications.kptu)}</p>` : ''}${v.implications.labor ? `<p class="nd-imp"><b>한국 노동운동</b> ${esc(v.implications.labor)}</p>` : ''}` : '';
    const related = v.related.length ? `<ul class="nd-related">${v.related.map((r, i) => `<li><button type="button" class="nd-rel" data-nd-related="${i}"><span class="nd-rel-kind">${esc(RELATED_LABEL[r.kind])}</span>${esc(r.title)}</button></li>`).join('')}</ul>` : '';
    return sec('핵심 요약', sum, 'data-nd-summary') + sec('주요 문장', sents, 'data-nd-sentences') + sec('나와의 연관', rel, 'data-nd-relevance')
      + (v.level === 'basic' ? '' : sec('시사점', imp, 'data-nd-implications')) + sec('함께 볼 것', related, 'data-nd-relatedbox');
  }
  function actsHtml() {
    const m = cur.marks || {};
    const busy = cur.busy ? ' disabled' : '';
    const btn = (act, on, label, onLabel) => `<button type="button" class="nd-act" data-nd-act="${act}" aria-pressed="${!!on}"${busy}>${esc(on ? onLabel : label)}</button>`;
    const archive = cur.item.type === 'outside' ? btn('archive', m.archive, '보관', '보관됨') : '';
    const memo = cur.memoOpen ? '' : `<button type="button" class="nd-act" data-nd-act="memo"${busy}>${cur.memo ? '메모 고치기' : '메모'}</button>`;
    return `<div class="nd-acts" role="group" aria-label="이 글 표시">${btn('star', m.star, '☆ 별표', '★ 별표')}${archive}${memo}${btn('dismiss', m.dismiss, '관심 없음', '관심 없음 ✓')}${cur.note ? `<span class="nd-faint" role="status">${esc(cur.note)}</span>` : ''}</div>`;
  }
  function memoHtml() {
    if (cur.memoOpen) {
      if (cur.memo?.doc_type) return `<div class="nd-memo"><p class="nd-memo-text">${esc(cur.memo.raw_text || '')}</p><p class="nd-faint">서식이 있는 메모는 노트에서 고쳐요</p><button type="button" class="secondary" data-nd-memo-cancel>닫기</button></div>`;
      return `<form class="nd-memo" data-nd-memo-form><textarea data-nd-memo-input rows="3" aria-label="내 메모"${cur.memoBusy ? ' disabled' : ''}>${esc(cur.memo?.raw_text || '')}</textarea><div class="nd-memo-row">${cur.memoNote ? `<span class="nd-faint" role="status">${esc(cur.memoNote)}</span>` : ''}<button type="button" class="secondary" data-nd-memo-cancel>취소</button><button type="submit" class="secondary"${cur.memoBusy ? ' disabled aria-busy="true"' : ''}>저장</button></div></form>`;
    }
    return cur.memo?.raw_text ? `<p class="nd-memo-text" data-nd-memo-text><span class="nd-memo-label">메모</span>${esc(cur.memo.raw_text)}</p>` : '';
  }
  function paint() {
    if (!box) return;
    if (!cur) { box.innerHTML = '<p class="nd-empty" data-nd-empty>글을 누르면 여기에 상세가 열려요</p>'; return; }
    const h = cur.head;
    const hit = interestHit([h.title, h.origTitle], topics());
    const link = h.url ? `<a class="nd-link" data-nd-link href="${esc(h.url)}" target="_blank" rel="noopener noreferrer" aria-label="원문 (새 창)">원문 ↗</a>` : '';
    box.innerHTML = `<article class="nd" data-nd="${esc(itemKey(cur.item))}" aria-label="글 상세">
<div class="nd-top"><button type="button" class="nd-back" data-nd-close aria-label="목록으로"><span aria-hidden="true">‹</span></button><p class="nd-meta">${h.meta.filter(Boolean).map(m => `<span>${esc(m)}</span>`).join('')}${hit ? `<span class="now-hit">${esc(hit)}</span>` : ''}</p>${link}</div>
<h3 class="nd-title" tabindex="-1"${h.titleLang ? ` lang="${esc(h.titleLang)}"` : ''}>${esc(h.title)}</h3>${h.origTitle ? `<p class="nd-orig" lang="${esc(h.lang || 'en')}">${esc(h.origTitle)}</p>` : ''}
<div class="nd-ai" data-nd-ai>${aiHtml()}</div>
${actsHtml()}${memoHtml()}</article>`;
  }

  // ---------- 열기 ----------
  // 뉴스 기사: 본문·요약이 아직 없으면(제목 읽기 전·대기) 상세 전에 그 기사 하나를 먼저 읽는다(news-feed open, 하루 한도는 서버).
  // 읽지 못하면 AI를 부르지 않고 이유와 [다시]·[원문]만 보인다(S48-66, 11/03).
  async function readFirst(item, my) {
    const w = workspaceOf();
    const row0 = (await rt().api(`/rest/v1/app_news_items?workspace_id=eq.${q(w)}&id=eq.${q(item.id)}&select=state,body_kind,summary,title,title_ko,publisher,published_at,url,lang&limit=1`, {singleFlight: false}))?.[0];
    if (!row0) return {ok: true};
    if (!needsRead(row0)) return {ok: true};
    cur.reading = true; paint();
    let status = '';
    try { status = (await rt().api('/functions/v1/news-feed?action=open', {method: 'POST', body: {id: item.id}, singleFlight: false, timeoutMs: 60000}))?.status || ''; } catch (e) { status = e?.status === 429 ? 'daily_limit' : 'error'; }
    if (my !== seq) return {ok: true, stale: true};
    cur.reading = false;
    const row = (await rt().api(`/rest/v1/app_news_items?workspace_id=eq.${q(w)}&id=eq.${q(item.id)}&select=state,body_kind,summary,title,title_ko,publisher,published_at,url,lang&limit=1`, {singleFlight: false}))?.[0] || row0;
    if (my !== seq) return {ok: true, stale: true};
    onRead?.(item, row);
    return hasMaterial(row) ? {ok: true} : {ok: false, why: unreadReason(status, row.state)};
  }
  async function load(item) {
    const my = ++seq, key = itemKey(item);
    const tasks = [readMarks(item), readMemo(item)];
    const have = details.get(key);
    if (have) cur.detail = have;
    const [marks, memo] = await Promise.allSettled(tasks);
    if (my !== seq) return;
    if (marks.status === 'fulfilled') cur.marks = marks.value;
    if (memo.status === 'fulfilled') cur.memo = memo.value;
    paint();
    if (have) return;
    try {
      if (item.type === 'news') {
        const pre = await readFirst(item, my).catch(() => ({ok: true}));
        if (my !== seq || pre.stale) return;
        if (!pre.ok) { cur.unread = pre.why; cur.reading = false; paint(); return; }
        cur.unread = ''; cur.reading = false;
      }
      const r = await askDetail(item);
      if (my !== seq) return;
      if (!r?.detail) throw new Error('shape');
      details.set(key, r.detail);
      cur.detail = r.detail; cur.failed = '';
    } catch (e) {
      if (my !== seq) return;
      cur.reading = false;
      if (e?.status === 422 && String(e?.message || '').includes('no_material')) cur.unread = unreadReason('', 'pending');
      else cur.failed = detailError(e);
    }
    paint();
  }
  function open(item, head) {
    if (!item || !head) return;
    const same = cur && itemKey(cur.item) === itemKey(item);
    if (!same) cur = {item, head, detail: null, failed: '', unread: '', reading: false, note: '', marks: null, memo: null, memoOpen: false, memoBusy: false, memoNote: '', busy: false};
    else cur.head = head;
    paint();
    box?.querySelector('.nd-title')?.focus({preventScroll: true});
    if (!same || cur.failed || cur.unread) { cur.failed = ''; cur.unread = ''; load(item); }
  }
  function close() { seq++; cur = null; paint(); }

  // ---------- 누르기 ----------
  async function toggle(act) {
    if (!cur || cur.busy) return;
    const c = cur, item = c.item, m = c.marks || {}, on = !m[act];
    c.busy = true; c.note = ''; paint();
    try {
      if (item.type === 'news') {
        if (act === 'star') await writeNews(item, on ? {starred_at: new Date().toISOString()} : {starred_at: null, folder_id: null});
        else if (act === 'dismiss') await writeNews(item, {hidden_at: on ? new Date().toISOString() : null});
      } else await writeMark(item, {star: 'starred_at', archive: 'archived_at', dismiss: 'dismissed_at'}[act], on);
      c.marks = {...m, [act]: on, ...(item.type === 'news' && act === 'star' && !on ? {archive: false} : {})};
      signal(item, on ? act : 'un' + act);
      onChanged?.(item, act, on);
    } catch (e) { c.note = saveFailNote(e); }
    c.busy = false;
    if (cur === c) { paint(); box?.querySelector(`[data-nd-act="${act}"]`)?.focus({preventScroll: true}); }
  }
  async function saveMemo(text) {
    const c = cur;
    if (!c || c.memoBusy) return;
    const value = String(text ?? '');
    if (!c.memo && !value.trim()) { c.memoOpen = false; paint(); return; }
    c.memoBusy = true; c.memoNote = ''; paint();
    try {
      const title = String(c.head.title || '메모').slice(0, 80);
      const link = c.item.type === 'news' ? {news_item_id: c.item.id} : {outside_post_id: c.item.id};
      const saved = c.memo ? await saveNoteDoc(c.memo.id, {title: c.memo.title || title, raw_text: value}, rt()) : await createNoteDoc({title, raw_text: value, ...link}, rt());
      c.memo = {...c.memo, ...saved, doc_type: c.memo?.doc_type || null};
      c.memoOpen = false;
      signal(c.item, 'memo');
      onChanged?.(c.item, 'memo', true);
    } catch (e) { c.memoNote = e?.message && !e?.status ? e.message : saveFailNote(e); }
    c.memoBusy = false;
    if (cur === c) { paint(); box?.querySelector(c.memoOpen ? '[data-nd-memo-input]' : '[data-nd-act="memo"]')?.focus({preventScroll: true}); }
  }
  box?.addEventListener('click', event => {
    const a = event.target.closest('a[data-nd-link]');
    if (a && cur) { signal(cur.item, 'open'); return; }
    const b = event.target.closest('button');
    if (!b || !box.contains(b) || !cur) return;
    if (b.matches('[data-nd-close]')) { onClose?.(); return; }
    if (b.matches('[data-nd-retry]')) { cur.failed = ''; cur.unread = ''; paint(); load(cur.item); return; }
    if (b.matches('[data-nd-act="memo"]')) { cur.memoOpen = true; cur.memoNote = ''; paint(); box.querySelector('[data-nd-memo-input],[data-nd-memo-cancel]')?.focus({preventScroll: true}); return; }
    if (b.matches('[data-nd-act]')) { toggle(b.dataset.ndAct); return; }
    if (b.matches('[data-nd-memo-cancel]')) { cur.memoOpen = false; cur.memoNote = ''; paint(); return; }
    if (b.matches('[data-nd-related]')) { const r = detailView(cur.detail).related[Number(b.dataset.ndRelated)]; if (r) onRelated?.(r); }
  });
  box?.addEventListener('submit', event => {
    if (!event.target.matches('[data-nd-memo-form]')) return;
    event.preventDefault();
    saveMemo(event.target.querySelector('[data-nd-memo-input]')?.value);
  });
  paint();
  return {open, close, paint, setHead: head => { if (cur && head) { cur.head = head; paint(); } }, current: () => (cur ? cur.item : null), reset: () => { details.clear(); close(); }};
}
