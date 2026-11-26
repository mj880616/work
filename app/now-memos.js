import {waitHtml, failHtml, emptyHtml} from './wait-state.js';
import {readMemoNotes, readArticlesByIds, articleOf} from './feed-shared.js';
import {MEMO_PAGE, memoPage, memoEntries, memoHit, memoTarget, tableEntries, mergeEntries, entryLine} from './now-memos-model.mjs';
import {requestNoteDocOpen} from './basket-note-tasks.js';
import {memosNow, memoState, loadMemos, onMemos} from './memo-store.js';
import {requestMemoReveal} from './memo-open.js';
// S69-70(사용자 11/24 20:43~20:44 "읽을 거리 글에 [메모]로 남긴 메모를 저장하지 않았어도 모아 보기", CC 제안 "'메모 있는 글' 거르기" ㅇㅇ):
// 읽을 거리 [메모] 탭. 이 칸(box)의 유일한 그리기 주인.
// S69-94 NOTE-메모통일: 메모는 이제 글 아래 메모 칸(memo-thread.js — 표 app_memos)에 남긴다. 이 탭은 같은 메모 목록(memo-store.js) 중
//   읽을 거리 글(news·outside)에 단 메모 + 예전에 노트로 남긴 글 메모(metadata.news_item_id | outside_post_id — 지우지 않고 그대로)를 합쳐 글마다 한 줄.
// - 줄 = 다른 탭과 같은 글 줄(news-row.mjs, 껍데기 rowOf) + 그 아래 가장 최근 메모 첫 줄(작게). 누르면 그 글 상세(onOpen) + 그 메모로 내려가 칠함.
// - 글이 관심 없음·숨김·오래돼 목록에서 빠졌어도 그 id로 서버에서 다시 읽는다(공용 글 표 · 내 작업공간 노트만, 기존 RLS 그대로). 글이 없으면 메모만 한 줄.
// - 옛 노트 메모는 종류마다 MEMO_PAGE(1000)줄씩, 넘으면 [더 보기]. 위 찾기 칸 글자로 제목·메모를 거른다. 기기 저장 없음. 바깥 글자는 모두 esc로 그린다.
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const NOTE_COLS = 'id,title,raw_text,updated_at,metadata';
const TYPES = ['news', 'outside'];
const feedMemos = () => memosNow().filter(m => TYPES.includes(m.target_type));

// rowOf(type, row, {openAttr, memo}) = 껍데기의 글 줄 HTML. colsOf(type) = 껍데기가 읽는 글 칸. onOpen({type, id}, row) = 글 상세 열기.
export function createNowMemos({box, query = () => '', rowOf, colsOf, onOpen} = {}) {
  let seq = 0, failed = false, loading = false;
  const fresh = () => ({notes: {news: [], outside: []}, end: {news: true, outside: true}, loaded: false, ids: new Map(), rows: new Map()});
  let s = fresh();
  let shown = []; // 지금 그린 줄(누르기에서 찾는다)

  // 글 줄 읽기: 옛 노트 메모(옛 id일 수 있음 → 공용 id로 바꿈)와 새 메모(공용 id)의 글.
  async function readArticles(notes, memos) {
    for (const type of TYPES) {
      const raw = notes.filter(n => memoTarget(n)?.type === type).map(n => memoTarget(n).id).filter(id => !s.ids.has(`${type}:${id}`));
      if (raw.length) {
        const map = await articleOf(type, raw); // 옛 id로 적힌 메모 → 공용 id
        for (const id of raw) s.ids.set(`${type}:${id}`, map.get(id) || id);
      }
      const want = [...new Set([...notes.filter(n => memoTarget(n)?.type === type).map(n => s.ids.get(`${type}:${memoTarget(n).id}`)),
        ...memos.filter(m => m.target_type === type).map(m => m.target_id)])].filter(id => id && !s.rows.has(`${type}:${id}`));
      if (!want.length) continue;
      const got = await readArticlesByIds(type, want, colsOf(type));
      for (const id of want) s.rows.set(`${type}:${id}`, got.get(id) || null);
    }
  }
  async function readPage(append) {
    const my = ++seq;
    loading = true;
    try {
      const [pages] = await Promise.all([Promise.all(TYPES.map(type => (append && s.end[type]) ? null
        : readMemoNotes(type, NOTE_COLS, {limit: MEMO_PAGE + 1, offset: append ? s.notes[type].length : 0}).then(r => memoPage(r)))), loadMemos()]);
      if (my !== seq) return;
      const next = append ? {...s.notes} : {news: [], outside: []};
      TYPES.forEach((type, i) => { const p = pages[i]; if (!p) return; next[type] = [...(append ? s.notes[type] : []), ...p.rows]; s.end[type] = p.end; });
      await readArticles([...next.news, ...next.outside], feedMemos());
      if (my !== seq) return;
      s.notes = next; s.loaded = true; failed = false;
    } catch { if (my === seq && !s.loaded) failed = true; }
    if (my === seq) { loading = false; paint(); }
  }
  const load = () => readPage(false);
  function entries() {
    const article = (t, id) => s.rows.get(`${t}:${id}`) || null;
    const old = memoEntries([...s.notes.news, ...s.notes.outside], {idOf: (t, id) => s.ids.get(`${t}:${id}`) || id, articleOf: article});
    return mergeEntries(old, memoState().ready ? tableEntries(feedMemos(), {articleOf: article}) : []);
  }
  const hidden = e => !!e.note && !!window.KPTUFeatureLock?.noteHidden?.(e.note);
  function rowHtml(e) {
    const line = hidden(e) ? '메모 잠김' : entryLine(e);
    if (e.row) return rowOf(e.type, e.row, {openAttr: 'data-nm-open', day: true, memo: line});
    // 글을 못 찾음(지워짐 등) — 메모만 한 줄. 옛 노트 메모는 누르면 그 노트, 새 메모는 '원래 기록이 없어요'(메모는 노트 [메모]에 그대로).
    const text = hidden(e) ? '<span class="nm-memo-locked">잠김</span>' : esc(line);
    if (e.note) return `<article class="nw-row nm-alone" data-nm-key="${esc(e.key)}"><div class="nw-main"><button type="button" class="ghost now-open nm-note" data-nm-note="${esc(e.note.id)}"><span class="nm-k">메모</span>${text}</button><p class="nw-meta"><span>원래 글을 찾지 못했어요 · 노트로 가기</span></p></div></article>`;
    return `<article class="nw-row nm-alone" data-nm-key="${esc(e.key)}"><div class="nw-main"><p class="now-open nm-note"><span class="nm-k">메모</span>${text}</p><p class="nw-meta"><span>${esc(e.memo?.target_title || '')}${e.memo?.target_title ? ' · ' : ''}원래 기록이 없어요</span></p></div></article>`;
  }
  function paint() {
    if (!box) return;
    if (!s.loaded) { box.innerHTML = failed ? failHtml({retry: 'data-nm-retry'}) : waitHtml({rows: 4, h: 56}); return; }
    const all = entries(), q = query();
    shown = all.filter(e => memoHit(e, q));
    const more = (s.end.news && s.end.outside) ? '' : `<p class="nm-more-line"><button type="button" class="ghost os-text-btn" data-nm-more${loading ? ' disabled aria-busy="true"' : ''}>더 보기</button></p>`;
    if (!shown.length) { box.innerHTML = emptyHtml(q ? '찾은 메모 없음' : '메모 있는 글 없음 · 글 아래 [메모 남기기]', {attrs: 'data-nm-empty'}) + more; return; }
    box.innerHTML = `<div class="nw-card nm-list" data-nm-list>${shown.map(rowHtml).join('')}</div>${more}`;
  }
  // 메모가 바뀌면(이 화면이나 다른 화면에서 남기거나 지움) 새 글 줄만 더 읽고 다시 그린다.
  onMemos(() => {
    if (!s.loaded || !box?.isConnected) return;
    const my = seq;
    void readArticles([], feedMemos()).catch(() => {}).then(() => { if (my === seq) paint(); });
  });
  box?.addEventListener('click', event => {
    const b = event.target.closest?.('button');
    if (!b || !box.contains(b)) return;
    if (b.matches('[data-nm-retry]')) { failed = false; paint(); void load(); return; }
    if (b.matches('[data-nm-more]')) { if (!loading) void readPage(true); return; }
    if (b.matches('[data-nm-note]')) { requestNoteDocOpen(b.dataset.nmNote); window.KPTURouter?.go?.('basket', {source: 'delegated'}); return; }
    if (b.matches('[data-nm-open]')) {
      const key = b.closest('[data-nw-key]')?.dataset.nwKey || '', e = shown.find(x => x.key === key);
      if (!e?.row) return;
      if (e.memo) requestMemoReveal(e.type, e.row.id, e.memo.id);
      onOpen?.({type: e.type, id: e.row.id}, e.row);
    }
  });
  return {
    load, paint,
    loaded: () => s.loaded,
    // 상세에서 메모를 남기거나 지우면 다시 읽는다(보이는 탭일 때만 껍데기가 부른다).
    dirty() { s.loaded && void load(); },
    reset() { seq++; s = fresh(); failed = false; loading = false; shown = []; if (box) box.replaceChildren(); },
  };
}
