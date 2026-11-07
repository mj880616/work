import {waitHtml, failHtml, emptyHtml} from './wait-state.js';
import {sendSignal, setMark} from './now-marks.js';
import {createNoteDoc, saveNoteDoc} from './basket-data.js';
import {plainText} from './news-clipping-model.mjs';
import {viewPrefs} from './view-prefs.js';
import {detailBody, detailView, detailError, itemKey, RELATED_LABEL, interestHit, needsRead, hasMaterial, unreadReason, bodyView, legacyBody, reopenBody, NEWS_FONT_STEPS, keepNewsFont, canTranslate, translatedBlocks, translateError} from './now-model.mjs';
// 글 상세 공용 부품(사회운동 글·뉴스 기사 두 쪽이 이 부품 하나를 쓴다). 상세 칸(box)의 유일한 그리기 주인이다.
// S51-14 NEWS-전면개편 P4c(설계 docs/design/news-overhaul.md 맨 앞 D2′ 메모·6.2절, 시안 docs/design/mockups/news-overhaul.html ②·③):
// - 위에서 아래(S52-12 NEWS-원문먼저번역, 시안 docs/design/mockups/news-detail-translate.html): 꼬리 줄(매체·분류·날짜·글쓴이) → 제목 → [원문 전체]
//   (머리 줄 [번역] — 외국어 뉴스 기사만 · 글자 크기 [가 가 가] 세 단계 — 서버 view_prefs.news_font) → [요약] → [시사점](주요 문장·나와의 연관은 이 칸 안 접기)
//   → '함께 볼 것'(접기) → [☆ 별표][보관][메모][관심 없음] … [원래 사이트 ↗].
// - [번역]: 누르면 news-feed translate(로그인·owner·하루 한도·저장은 서버, 한 번 번역한 글은 저장본을 바로) 뒤 그 기사 줄의 body·body_ko를 읽어
//   글자 블록만 한국어로 바꿔 그린다(문단·소제목·인용·사진·캡션 자리는 그대로, now-model.mjs translatedBlocks). 다시 누르면 원문. 번역 중엔 원문 칸에 기다림 표시.
// - 누르면 원문 전체가 바로: 저장 원문(app_feed_bodies 블록 — 문단·소제목·인용·사진·캡션)을 사용자 로그인으로 읽는다(작업공간 소유자 RLS).
//   동시에 요약·시사점 만들기를 시작한다(ai-assist kind now_detail — 서버가 저장 원문을 재료로 먼저 씀). 기다림 표시는 요약·시사점 칸에만,
//   다 되면 그 칸만 채운다(원문 칸은 다시 그리지 않음). 이미 만든 것(app_now_details)은 서버가 바로 돌려준다. 화면은 글 id만 보낸다.
// - 원문이 없는 글(state failed·lead·image_only): 있는 만큼 + 까닭 한 줄 + [원래 사이트 ↗]. 뉴스 기사 중 저장 원문 줄이 아예 없는 옛 글과
//   잠깐의 오류로 못 읽은 줄(state failed + 늦은 답·사이트 오류, now-model.mjs reopenBody)만 '기사 먼저 읽기'(news-feed open, 하루 한도는 서버)
//   뒤 다시 읽고(S51-17 P5, 설계 7.1), 그래도 없으면 예전 저장 글자(사회운동 문장·뉴스 body)를 문단으로. 막힌 사이트·없는 글은 다시 읽지 않는다.
// - 사진: https 주소만, referrerpolicy="no-referrer"·loading="lazy", 글을 열었을 때만 그린다. 안 뜨면 '사진 ↗' 링크.
// - 아래 작은 단추 줄: 사회운동 글은 app_outside_marks(글마다 한 줄), 뉴스는 기존 app_news_items 칸(starred_at·hidden_at). 메모는 노트
//   (app_notes, metadata.outside_post_id|news_item_id). 누를 때마다 환류 기록 한 줄(app_now_signals). [원래 사이트 ↗] 열기도 기록한다.
// - 저장은 모두 서버. 기기 저장 없음. 상세·원문은 이 탭 메모리에만 다시 쓰려고 둔다. 바깥 글자는 모두 esc로 그린다. 로그에 제목·본문을 남기지 않는다.

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const q = v => encodeURIComponent(v);
const rt = () => window.KPTURuntime;
const workspaceOf = () => rt()?.context?.read?.()?.workspace?.id || '';
const MEMO_COLS = 'id,title,raw_text,metadata,updated_at,doc_type:doc->>type';
const NEWS_ROW_COLS = 'state,body_kind,summary,title,title_ko,publisher,published_at,url,lang';
const ITEM_COL = {outside: 'outside_post_id', news: 'news_item_id'};
const saveFailNote = e => (e?.status ? `저장하지 못함 · HTTP ${e.status}` : '저장하지 못함 · 잠시 뒤 다시');

// head: {meta: [글자…], title, origTitle, titleLang, lang, url}. item: {type:'outside'|'news', id}.
export function createNowDetail({box, topics = () => [], onClose, onChanged, onSignal, onRelated, onRead} = {}) {
  let cur = null; // {item, head, body, detail, failed, unread, making, reading, note, marks, memo, memoOpen, memoBusy, memoNote, busy, tr:{on, busy, note}}
  const details = new Map(); // itemKey → 서버 답(이 탭 메모리만)
  const bodies = new Map(); // itemKey → bodyView 모양(이 탭 메모리만)
  const translations = new Map(); // itemKey → translatedBlocks 답(이 탭 메모리만 — 원본 저장은 서버 body_ko)
  let seq = 0;
  let font = null; // 이번 접속에서 고른 값(서버에 쓰는 중에도 바로 보이게). 처음엔 서버 기억 값.
  const fontNow = () => keepNewsFont(font ?? viewPrefs.get('news_font'));

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
  // 저장 원문 한 줄(없으면 null).
  const readFeedBody = item => rt().api(`/rest/v1/app_feed_bodies?workspace_id=eq.${q(workspaceOf())}&${ITEM_COL[item.type]}=eq.${q(item.id)}&select=blocks,state,reason&limit=1`, {singleFlight: false})
    .then(r => (Array.isArray(r) ? r[0] || null : null));
  // 옛 글: 예전 저장 글자.
  async function readLegacyText(item) {
    const w = workspaceOf();
    if (item.type === 'news') {
      const rows = await rt().api(`/rest/v1/app_news_items?workspace_id=eq.${q(w)}&id=eq.${q(item.id)}&select=body,body_kind&limit=1`, {singleFlight: false});
      const r = Array.isArray(rows) ? rows[0] : null;
      return legacyBody(plainText(r?.body).trim(), {lead: r?.body_kind === 'lead'});
    }
    const rows = await rt().api(`/rest/v1/app_outside_sentences?post_id=eq.${q(item.id)}&workspace_id=eq.${q(w)}&select=idx,text&order=idx.asc&limit=3001`, {singleFlight: false});
    const text = (Array.isArray(rows) ? rows : []).filter(r => r && typeof r.text === 'string').sort((a, b) => a.idx - b.idx).map(r => r.text.trim()).filter(Boolean).join(' ');
    return legacyBody(text);
  }
  const readTranslation = item => rt().api(`/rest/v1/app_news_items?workspace_id=eq.${q(workspaceOf())}&id=eq.${q(item.id)}&select=body,body_ko&limit=1`, {singleFlight: false}).then(r => (Array.isArray(r) ? r[0] || null : null));
  const readNewsRow = item => rt().api(`/rest/v1/app_news_items?workspace_id=eq.${q(workspaceOf())}&id=eq.${q(item.id)}&select=${NEWS_ROW_COLS}&limit=1`, {singleFlight: false}).then(r => (Array.isArray(r) ? r[0] || null : null));
  const signal = (item, action) => sendSignal(item, action, onSignal);

  // ---------- 그리기(칸마다 따로 — 요약이 와도 원문 칸은 그대로) ----------
  const siteLink = (label = '원래 사이트 ↗', cls = 'nd-link') => (cur.head.url ? `<a class="${cls}" data-nd-link href="${esc(cur.head.url)}" target="_blank" rel="noopener noreferrer" aria-label="원래 사이트 (새 창)">${esc(label)}</a>` : '');
  const langAttr = () => (cur.head.lang && cur.head.lang !== 'ko' ? ` lang="${esc(cur.head.lang)}"` : '');
  const boxHead = (title, note = '') => `<p class="nd-bh"><b>${title}</b>${note ? `<span class="nd-bh-note" role="status">${esc(note)}</span>` : ''}</p>`;
  function sumHtml() {
    if (cur.unread) return boxHead('요약') + `<p class="nd-why" data-nd-unread role="status">요약할 재료가 없어요 · ${esc(cur.unread)} <button type="button" class="nd-act" data-nd-retry>다시</button></p>`;
    if (!cur.detail && cur.failed) return boxHead('요약') + failHtml({text: cur.failed, retry: 'data-nd-retry'});
    if (!cur.detail) return boxHead('요약', cur.reading ? '기사 가져오는 중' : '만드는 중') + `<div class="nd-wait" data-nd-wait aria-busy="true">${waitHtml({rows: 2})}</div>`;
    const v = detailView(cur.detail);
    return boxHead('요약') + (v.summary ? `<p class="nd-sum">${esc(v.summary)}</p>` : emptyHtml('요약 없음'));
  }
  function impHtml() {
    if (cur.unread || (!cur.detail && cur.failed)) return '';
    if (!cur.detail) return boxHead('시사점', '만드는 중') + `<div class="nd-wait" aria-busy="true">${waitHtml({rows: 2})}</div>`;
    const v = detailView(cur.detail);
    if (v.level === 'basic') return boxHead('시사점') + '<p class="nd-faint">오늘 상세 한도를 넘어 요약까지만 · 내일 열면 채워요</p>' + moreHtml(v);
    const imp = v.implications ? `${v.implications.kptu ? `<p class="nd-imp"><b>공공운수노조 운동</b> ${esc(v.implications.kptu)}</p>` : ''}${v.implications.labor ? `<p class="nd-imp"><b>한국 노동운동</b> ${esc(v.implications.labor)}</p>` : ''}` : emptyHtml('시사점 없음');
    return boxHead('시사점') + imp + moreHtml(v);
  }
  // 시사점 칸 안 접기: 주요 문장·나와의 연관.
  function moreHtml(v) {
    const sents = v.sentences.length ? `<ul class="nd-sents" data-nd-sentences>${v.sentences.map(s => `<li><span class="nd-orig-line"${langAttr()}>${esc(s.orig)}</span>${s.ko ? `<span class="nd-ko">${esc(s.ko)}</span>` : ''}</li>`).join('')}</ul>` : '';
    let rel = '';
    if (v.relevance) rel = `${v.relevance.topics.length ? `<p class="nd-topics">${v.relevance.topics.map(t => `<span class="nd-topic">${esc(t)}</span>`).join('')}</p>` : ''}${v.relevance.reason ? `<p class="nd-reason">${esc(v.relevance.reason)}</p>` : ''}`;
    else if (v.level !== 'basic') rel = `<p class="nd-faint">${topics().length ? '연관 낮음' : '확정한 관심 주제가 없어요 · ⋯ → 관심 주제'}</p>`;
    if (!sents && !rel) return '';
    return `<details class="nd-fold" data-nd-more><summary>주요 문장 · 나와의 연관</summary>${sents ? `<p class="nd-sub">주요 문장</p>${sents}` : ''}${rel ? `<p class="nd-sub">나와의 연관</p><div data-nd-relevance>${rel}</div>` : ''}</details>`;
  }
  function relatedHtml() {
    if (!cur.detail) return '';
    const v = detailView(cur.detail);
    if (!v.related.length) return '';
    return `<details class="nd-fold nd-relfold" data-nd-relatedbox><summary>함께 볼 것 ${v.related.length}</summary><ul class="nd-related">${v.related.map((r, i) => `<li><button type="button" class="nd-rel" data-nd-related="${i}"><span class="nd-rel-kind">${esc(RELATED_LABEL[r.kind])}</span>${esc(r.title)}</button></li>`).join('')}</ul></details>`;
  }
  function blockHtml(b) {
    if (b.t === 'img') {
      const cap = b.cap ? `<figcaption>${esc(b.cap)}</figcaption>` : '';
      return `<figure class="nd-fig"><img class="nd-img" data-nd-img src="${esc(b.src)}" alt="${esc(b.alt || b.cap || '')}" loading="lazy" decoding="async" referrerpolicy="no-referrer"><a class="nd-img-link" data-nd-img-link href="${esc(b.src)}" target="_blank" rel="noopener noreferrer" hidden>사진 ↗</a>${cap}</figure>`;
    }
    if (b.t === 'h') return `<h4 class="nd-bhd">${esc(b.text)}</h4>`;
    if (b.t === 'quote') return `<blockquote>${esc(b.text)}</blockquote>`;
    return `<p>${esc(b.text)}</p>`;
  }
  function fontHtml() {
    const f = fontNow();
    return `<span class="nd-size" role="group" aria-label="글자 크기">${NEWS_FONT_STEPS.map(s => `<button type="button" class="nd-size-btn" data-nd-font="${s.id}" aria-label="${s.label}" aria-pressed="${s.id === f}">가</button>`).join('')}</span>`;
  }
  // 원문 칸 머리 줄 [번역]: 외국어 뉴스 기사에서 글자 블록이 있을 때만. 누른 상태는 aria-pressed.
  function trHtml(b) {
    if (!canTranslate(cur.item, cur.head) || !b || b.failedLoad || !b.blocks.some(x => x.t !== 'img')) return '';
    const t = cur.tr;
    return `${t.note ? `<span class="nd-tr-note" data-nd-tr-note role="status">${esc(t.note)}</span>` : ''}<button type="button" class="ds-chip nd-tr" data-nd-translate aria-pressed="${!!t.on}"${t.busy ? ' disabled aria-busy="true"' : ''} aria-label="${t.on ? '원문으로 보기' : '한국어로 번역'}">번역</button>`;
  }
  function bodyHtml() {
    const key = itemKey(cur.item), b = bodies.get(key);
    const tv = cur.tr.on ? translations.get(key) : null;
    const src = tv ? '한국어 번역' : cur.head.meta?.[0] || '';
    const tr = trHtml(b);
    const head = `<div class="nd-ob${tr ? ' has-tr' : ''}"><b>원문 전체</b>${src ? `<span class="nd-ob-src">${esc(src)}</span>` : ''}${tr}${fontHtml()}</div>`;
    let inner;
    if (!b) inner = `<div aria-busy="true">${waitHtml({rows: 4})}</div>`;
    else if (cur.tr.busy) inner = `<div class="nd-wait" data-nd-tr-wait aria-busy="true"><p class="nd-faint" role="status">번역하는 중</p>${waitHtml({rows: 4})}</div>`;
    else if (tv) {
      const why = b.reason ? `<p class="nd-why" data-nd-why role="status">${esc(b.reason)}${cur.head.url ? ` · ${siteLink(b.state === 'lead' ? '나머지는 원래 사이트 ↗' : '원래 사이트 ↗')}` : ''}</p>` : '';
      const note = !tv.aligned ? '<p class="nd-faint" data-nd-tr-loose>문단 나눔이 원문과 달라 사진은 아래에 모았어요</p>' : tv.partial ? '<p class="nd-faint" data-nd-tr-rest>번역은 앞부분까지 · 나머지는 원문 그대로</p>' : '';
      inner = `<div class="nd-prose" lang="ko" data-nd-prose data-nd-translated>${tv.blocks.map(blockHtml).join('')}</div>${note}${why}`;
    }
    else if (b.failedLoad) inner = failHtml({text: '원문을 불러오지 못함', retry: 'data-nd-body-retry'});
    else {
      const why = b.reason ? `<p class="nd-why" data-nd-why role="status">${esc(b.reason)}${cur.head.url ? ` · ${siteLink(b.state === 'lead' ? '나머지는 원래 사이트 ↗' : '원래 사이트 ↗')}` : ''}</p>` : '';
      const prose = b.blocks.length ? `<div class="nd-prose"${langAttr()} data-nd-prose>${b.blocks.map(blockHtml).join('')}</div>` : '';
      inner = b.state === 'failed' ? why : prose + why;
    }
    return head + `<div class="nd-ob-body" data-nd-body-inner>${inner}</div>`;
  }
  function actsHtml() {
    const m = cur.marks || {};
    const busy = cur.busy ? ' disabled' : '';
    const btn = (act, on, label, onLabel) => `<button type="button" class="nd-act" data-nd-act="${act}" aria-pressed="${!!on}"${busy}>${esc(on ? onLabel : label)}</button>`;
    const archive = cur.item.type === 'outside' ? btn('archive', m.archive, '보관', '보관됨') : '';
    const memo = cur.memoOpen ? '' : `<button type="button" class="nd-act" data-nd-act="memo"${busy}>${cur.memo ? '메모 고치기' : '메모'}</button>`;
    return `${btn('star', m.star, '☆ 별표', '★ 별표')}${archive}${memo}${btn('dismiss', m.dismiss, '관심 없음', '관심 없음 ✓')}${cur.note ? `<span class="nd-faint" role="status">${esc(cur.note)}</span>` : ''}${siteLink('원래 사이트 ↗', 'nd-link nd-site')}`;
  }
  function memoHtml() {
    if (cur.memoOpen) {
      if (cur.memo?.doc_type) return `<div class="nd-memo"><p class="nd-memo-text">${esc(cur.memo.raw_text || '')}</p><p class="nd-faint">서식이 있는 메모는 노트에서 고쳐요</p><button type="button" class="secondary" data-nd-memo-cancel>닫기</button></div>`;
      return `<form class="nd-memo" data-nd-memo-form><textarea data-nd-memo-input rows="3" aria-label="내 메모"${cur.memoBusy ? ' disabled' : ''}>${esc(cur.memo?.raw_text || '')}</textarea><div class="nd-memo-row">${cur.memoNote ? `<span class="nd-faint" role="status">${esc(cur.memoNote)}</span>` : ''}<button type="button" class="secondary" data-nd-memo-cancel>취소</button><button type="submit" class="secondary"${cur.memoBusy ? ' disabled aria-busy="true"' : ''}>저장</button></div></form>`;
    }
    return cur.memo?.raw_text ? `<p class="nd-memo-text" data-nd-memo-text><span class="nd-memo-label">메모</span>${esc(cur.memo.raw_text)}</p>` : '';
  }
  const part = sel => box?.querySelector(`[data-nd="${CSS.escape(itemKey(cur.item))}"] ${sel}`);
  function paintAi() {
    if (!cur) return;
    const s = part('[data-nd-summary]'), i = part('[data-nd-implications]'), r = part('[data-nd-relslot]');
    if (s) s.innerHTML = sumHtml();
    if (i) { const html = impHtml(); i.innerHTML = html; i.hidden = !html; }
    if (r) r.innerHTML = relatedHtml();
  }
  function paintBody() { const el = cur && part('[data-nd-body]'); if (el) el.innerHTML = bodyHtml(); }
  function paintActs() {
    if (!cur) return;
    const a = part('[data-nd-acts]'), m = part('[data-nd-memo]');
    if (a) a.innerHTML = actsHtml();
    if (m) m.innerHTML = memoHtml();
  }
  function paint() {
    if (!box) return;
    if (!cur) { box.innerHTML = '<p class="nd-empty" data-nd-empty>글을 누르면 여기에 상세가 열려요</p>'; return; }
    const h = cur.head;
    const hit = interestHit([h.title, h.origTitle], topics());
    const imp = impHtml();
    box.innerHTML = `<article class="nd" data-nd="${esc(itemKey(cur.item))}" data-font="${fontNow()}" aria-label="글 상세">
<div class="nd-top"><button type="button" class="nd-back" data-nd-close aria-label="목록으로"><span aria-hidden="true">‹</span></button><p class="nd-meta">${h.meta.filter(Boolean).map(m => `<span>${esc(m)}</span>`).join('')}${hit ? `<span class="now-hit">${esc(hit)}</span>` : ''}</p></div>
<h3 class="nd-title" tabindex="-1"${h.titleLang ? ` lang="${esc(h.titleLang)}"` : ''}>${esc(h.title)}</h3>${h.origTitle ? `<p class="nd-orig" lang="${esc(h.lang || 'en')}">${esc(h.origTitle)}</p>` : ''}
<section class="nd-box nd-orig-box" data-nd-body aria-label="원문 전체">${bodyHtml()}</section>
<section class="nd-box" data-nd-summary aria-label="요약">${sumHtml()}</section>
<section class="nd-box" data-nd-implications aria-label="시사점"${imp ? '' : ' hidden'}>${imp}</section>
<div data-nd-relslot>${relatedHtml()}</div>
<div class="nd-acts" data-nd-acts role="group" aria-label="이 글 표시">${actsHtml()}</div><div data-nd-memo>${memoHtml()}</div></article>`;
  }

  // ---------- 열기 ----------
  // 원문: 저장 원문 → (뉴스 기사에 저장 원문 줄이 없거나 잠깐의 오류로 못 읽은 줄이면 기사 먼저 읽기 뒤 다시) → 예전 저장 글자. 답: {hadRow, pre:{ok,why}}.
  async function loadBody(item, my) {
    const key = itemKey(item);
    // 저장 원문 읽기가 실패하면 줄이 없는 것과 같은 길로(예전 저장 글자). 그것도 못 읽으면 [다시].
    let row = null;
    try { row = await readFeedBody(item); } catch { row = null; }
    if (my !== seq) return {stale: true};
    // 저장 원문 줄이 있으면 그것을 그린다. 뉴스 기사에서 그 줄이 잠깐의 오류(state failed — 늦은 답·사이트 오류)면 아래 '기사 먼저 읽기'로 한 번 다시 읽는다.
    if (row && !(item.type === 'news' && reopenBody(row))) { bodies.set(key, bodyView(row) || legacyBody('')); paintBody(); return {hadRow: true}; }
    let pre = {ok: true};
    if (item.type === 'news') {
      pre = await readFirst(item, my).catch(() => ({ok: true}));
      if (my !== seq || pre.stale) return {stale: true};
      try { row = await readFeedBody(item); } catch { row = null; }
      if (my !== seq) return {stale: true};
      if (row) { bodies.set(key, bodyView(row) || legacyBody('')); paintBody(); return {hadRow: true, pre}; }
    }
    let legacy;
    try { legacy = await readLegacyText(item); } catch { legacy = {failedLoad: true}; }
    if (my !== seq) return {stale: true};
    if (legacy.state === 'failed' && pre && !pre.ok && pre.why) legacy = {...legacy, reason: pre.why};
    bodies.set(key, legacy); paintBody();
    return {hadRow: false, pre};
  }
  // 저장 원문 줄이 없는 옛 뉴스 기사: 본문·요약이 아직 없으면 그 기사 하나를 먼저 읽는다(news-feed open). 읽지 못하면 AI를 부르지 않는다.
  async function readFirst(item, my) {
    const row0 = await readNewsRow(item);
    if (!row0 || !needsRead(row0)) return {ok: true};
    cur.reading = true; paintAi();
    let status = '';
    try { status = (await rt().api('/functions/v1/news-feed?action=open', {method: 'POST', body: {id: item.id}, singleFlight: false, timeoutMs: 60000}))?.status || ''; } catch (e) { status = e?.status === 429 ? 'daily_limit' : 'error'; }
    if (my !== seq) return {ok: true, stale: true};
    cur.reading = false;
    const row = (await readNewsRow(item)) || row0;
    if (my !== seq) return {ok: true, stale: true};
    onRead?.(item, row);
    return hasMaterial(row) ? {ok: true} : {ok: false, why: unreadReason(status, row.state)};
  }
  async function makeDetail(item, my) {
    const key = itemKey(item);
    try {
      const r = await askDetail(item);
      if (my !== seq) return;
      if (!r?.detail) throw new Error('shape');
      details.set(key, r.detail);
      cur.detail = r.detail; cur.failed = '';
    } catch (e) {
      if (my !== seq) return;
      if (e?.status === 422 && String(e?.message || '').includes('no_material')) cur.unread = unreadReason('', 'pending');
      else cur.failed = detailError(e);
    }
    cur.reading = false;
    paintAi();
  }
  async function load(item) {
    const my = ++seq, key = itemKey(item);
    const have = details.get(key);
    if (have) cur.detail = have;
    Promise.allSettled([readMarks(item), readMemo(item)]).then(([marks, memo]) => {
      if (my !== seq) return;
      if (marks.status === 'fulfilled') cur.marks = marks.value;
      if (memo.status === 'fulfilled') cur.memo = memo.value;
      paintActs();
    });
    // 사회운동 글: 원문 읽기와 요약 만들기를 함께 시작. 뉴스 기사: 저장 원문 줄이 있으면 바로, 없는 옛 글만 먼저 읽은 뒤.
    const needBody = !bodies.has(key);
    if (item.type === 'outside' || have) {
      if (!have) makeDetail(item, my);
      if (needBody) loadBody(item, my);
      return;
    }
    if (!needBody) { makeDetail(item, my); return; }
    const got = await loadBody(item, my);
    if (my !== seq || got.stale) return;
    if (got.pre && !got.pre.ok) { cur.unread = got.pre.why; paintAi(); return; }
    makeDetail(item, my);
  }
  function open(item, head) {
    if (!item || !head) return;
    const same = cur && itemKey(cur.item) === itemKey(item);
    if (!same) cur = {item, head, detail: null, failed: '', unread: '', reading: false, note: '', marks: null, memo: null, memoOpen: false, memoBusy: false, memoNote: '', busy: false, tr: {on: false, busy: false, note: ''}};
    else cur.head = head;
    paint();
    box?.querySelector('.nd-title')?.focus({preventScroll: true});
    if (!same || cur.failed || cur.unread) { cur.failed = ''; cur.unread = ''; if (same) paintAi(); load(item); }
  }
  function close() { seq++; cur = null; paint(); }

  // ---------- 누르기 ----------
  async function toggle(act) {
    if (!cur || cur.busy) return;
    const c = cur, item = c.item, m = c.marks || {}, on = !m[act];
    c.busy = true; c.note = ''; paintActs();
    try {
      await setMark(item, act, on);
      c.marks = {...m, [act]: on, ...(item.type === 'news' && act === 'star' && !on ? {archive: false} : {})};
      signal(item, on ? act : 'un' + act);
      onChanged?.(item, act, on);
    } catch (e) { c.note = saveFailNote(e); }
    c.busy = false;
    if (cur === c) { paintActs(); box?.querySelector(`[data-nd-act="${act}"]`)?.focus({preventScroll: true}); }
  }
  async function saveMemo(text) {
    const c = cur;
    if (!c || c.memoBusy) return;
    const value = String(text ?? '');
    if (!c.memo && !value.trim()) { c.memoOpen = false; paintActs(); return; }
    c.memoBusy = true; c.memoNote = ''; paintActs();
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
    if (cur === c) { paintActs(); box?.querySelector(c.memoOpen ? '[data-nd-memo-input]' : '[data-nd-act="memo"]')?.focus({preventScroll: true}); }
  }
  // [번역]: 번역본이 있으면 켜고 끄기만. 없으면 서버 translate(저장본이면 바로 stored) → 줄 읽기 → 블록에 넣기.
  async function toggleTranslate() {
    const c = cur;
    if (!c || c.tr.busy || !canTranslate(c.item, c.head)) return;
    const key = itemKey(c.item);
    if (c.tr.on || translations.has(key)) { c.tr.on = !c.tr.on; c.tr.note = ''; paintBody(); focusTr(); return; }
    c.tr.busy = true; c.tr.note = ''; paintBody();
    try {
      await rt().api('/functions/v1/news-feed?action=translate', {method: 'POST', body: {id: c.item.id}, singleFlight: false, timeoutMs: 130000});
      const row = await readTranslation(c.item);
      const b = bodies.get(key);
      const tv = translatedBlocks(b?.blocks, row?.body, row?.body_ko);
      if (!tv) throw Object.assign(new Error('NOTHING_TO_TRANSLATE'), {status: 0});
      translations.set(key, tv);
      c.tr.on = true;
    } catch (e) { c.tr.note = translateError(e); }
    c.tr.busy = false;
    if (cur === c) { paintBody(); focusTr(); }
  }
  const focusTr = () => box?.querySelector('[data-nd-translate]')?.focus({preventScroll: true});
  function setFont(id) {
    const f = keepNewsFont(id);
    if (f === fontNow()) return;
    font = f;
    const art = box?.querySelector('.nd');
    if (art) art.dataset.font = f;
    box?.querySelectorAll('[data-nd-font]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.ndFont === f)));
    if (viewPrefs.get('news_font') !== f) { viewPrefs.set('news_font', f, {rejectable: true}); void viewPrefs.flush?.(); }
  }
  box?.addEventListener('click', event => {
    const a = event.target.closest('a[data-nd-link]');
    if (a && cur) { signal(cur.item, 'open'); return; }
    const b = event.target.closest('button');
    if (!b || !box.contains(b) || !cur) return;
    if (b.matches('[data-nd-close]')) { onClose?.(); return; }
    if (b.matches('[data-nd-font]')) { setFont(b.dataset.ndFont); return; }
    if (b.matches('[data-nd-translate]')) { toggleTranslate(); return; }
    if (b.matches('[data-nd-body-retry]')) { bodies.delete(itemKey(cur.item)); paintBody(); loadBody(cur.item, seq); return; }
    if (b.matches('[data-nd-retry]')) { cur.failed = ''; cur.unread = ''; paintAi(); load(cur.item); return; }
    if (b.matches('[data-nd-act="memo"]')) { cur.memoOpen = true; cur.memoNote = ''; paintActs(); box.querySelector('[data-nd-memo-input],[data-nd-memo-cancel]')?.focus({preventScroll: true}); return; }
    if (b.matches('[data-nd-act]')) { toggle(b.dataset.ndAct); return; }
    if (b.matches('[data-nd-memo-cancel]')) { cur.memoOpen = false; cur.memoNote = ''; paintActs(); return; }
    if (b.matches('[data-nd-related]')) { const r = detailView(cur.detail).related[Number(b.dataset.ndRelated)]; if (r) onRelated?.(r); }
  });
  // 사진이 안 뜨면(사이트가 막음·사라짐) 그 자리에 '사진 ↗' 링크만.
  box?.addEventListener('error', event => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement) || !img.matches('[data-nd-img]')) return;
    img.hidden = true;
    const link = img.parentElement?.querySelector('[data-nd-img-link]');
    if (link) link.hidden = false;
  }, true);
  box?.addEventListener('submit', event => {
    if (!event.target.matches('[data-nd-memo-form]')) return;
    event.preventDefault();
    saveMemo(event.target.querySelector('[data-nd-memo-input]')?.value);
  });
  // 서버 기억 값이 늦게 오면(첫 로딩) 그 값으로.
  window.addEventListener('kptu:view-prefs-ready', () => { if (font === null && cur) { const art = box?.querySelector('.nd'); if (art) art.dataset.font = fontNow(); box?.querySelectorAll('[data-nd-font]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.ndFont === fontNow()))); } });
  paint();
  return {open, close, paint, setHead: head => { if (cur && head) { cur.head = head; paint(); } }, current: () => (cur ? cur.item : null), reset: () => { details.clear(); bodies.clear(); translations.clear(); close(); }};
}
