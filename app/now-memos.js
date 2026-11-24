import {waitHtml, failHtml, emptyHtml} from './wait-state.js';
import {readMemoNotes, readArticlesByIds, articleOf} from './feed-shared.js';
import {MEMO_PAGE, memoPage, memoEntries, memoHit, memoLine, memoTarget} from './now-memos-model.mjs';
import {requestNoteDocOpen} from './basket-note-tasks.js';
// S69-70(명진 11/24 20:43~20:44 "읽을 거리 글에 [메모]로 남긴 메모를 저장하지 않았어도 모아 보기", CC 제안 "'메모 있는 글' 거르기" ㅇㅇ):
// 읽을 거리 [메모] 탭. 이 칸(box)의 유일한 그리기 주인.
// - 내 노트 중 metadata.news_item_id | outside_post_id가 있는 것(글 메모 = 노트 하나, now-detail.js saveMemo)만. 최근 고친 메모 먼저, 같은 글은 한 줄.
// - 줄 = 다른 탭과 같은 글 줄(news-row.mjs, 껍데기 rowOf) + 그 아래 메모 첫 줄(작게). 누르면 그 글 상세(onOpen).
// - 글이 관심 없음·숨김·오래돼 목록에서 빠졌어도 그 id로 서버에서 다시 읽는다(공용 글 표 · 내 작업공간 노트만, 기존 RLS 그대로). 글이 없으면 메모만 한 줄 → 노트로.
// - 종류마다 MEMO_PAGE(1000)줄씩, 넘으면 [더 보기]. 위 찾기 칸 글자로 제목·메모를 거른다. 기기 저장 없음. 바깥 글자는 모두 esc로 그린다.
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const NOTE_COLS = 'id,title,raw_text,updated_at,metadata';
const TYPES = ['news', 'outside'];

// rowOf(type, row, {openAttr, memo}) = 껍데기의 글 줄 HTML. colsOf(type) = 껍데기가 읽는 글 칸. onOpen({type, id}, row) = 글 상세 열기.
export function createNowMemos({box, query = () => '', rowOf, colsOf, onOpen} = {}) {
  let seq = 0, failed = false, loading = false;
  const fresh = () => ({notes: {news: [], outside: []}, end: {news: true, outside: true}, loaded: false, ids: new Map(), rows: new Map()});
  let s = fresh();
  let shown = []; // 지금 그린 줄(누르기에서 찾는다)

  async function readArticles(notes) {
    for (const type of TYPES) {
      const raw = notes.filter(n => memoTarget(n)?.type === type).map(n => memoTarget(n).id).filter(id => !s.ids.has(`${type}:${id}`));
      if (!raw.length) continue;
      const map = await articleOf(type, raw); // 옛 id로 적힌 메모 → 공용 id
      for (const id of raw) s.ids.set(`${type}:${id}`, map.get(id) || id);
      const want = [...new Set(raw.map(id => s.ids.get(`${type}:${id}`)))].filter(id => !s.rows.has(`${type}:${id}`));
      const got = await readArticlesByIds(type, want, colsOf(type));
      for (const id of want) s.rows.set(`${type}:${id}`, got.get(id) || null);
    }
  }
  async function readPage(append) {
    const my = ++seq;
    loading = true;
    try {
      const pages = await Promise.all(TYPES.map(type => (append && s.end[type]) ? null
        : readMemoNotes(type, NOTE_COLS, {limit: MEMO_PAGE + 1, offset: append ? s.notes[type].length : 0}).then(r => memoPage(r))));
      if (my !== seq) return;
      const next = append ? {...s.notes} : {news: [], outside: []};
      TYPES.forEach((type, i) => { const p = pages[i]; if (!p) return; next[type] = [...(append ? s.notes[type] : []), ...p.rows]; s.end[type] = p.end; });
      await readArticles([...next.news, ...next.outside]);
      if (my !== seq) return;
      s.notes = next; s.loaded = true; failed = false;
    } catch { if (my === seq && !s.loaded) failed = true; }
    if (my === seq) { loading = false; paint(); }
  }
  const load = () => readPage(false);
  function entries() {
    return memoEntries([...s.notes.news, ...s.notes.outside], {idOf: (t, id) => s.ids.get(`${t}:${id}`) || id, articleOf: (t, id) => s.rows.get(`${t}:${id}`) || null});
  }
  const hidden = note => !!window.KPTUFeatureLock?.noteHidden?.(note);
  const memoHtml = e => (hidden(e.note) ? '<span class="nm-memo-locked">잠김</span>' : esc(memoLine(e.note)));
  function rowHtml(e) {
    if (e.row) return rowOf(e.type, e.row, {openAttr: 'data-nm-open', day: true, memo: hidden(e.note) ? '메모 잠김' : memoLine(e.note)});
    // 글을 못 찾음(지워짐 등) — 메모만 한 줄, 누르면 그 노트.
    return `<article class="nw-row nm-alone" data-nm-key="${esc(e.key)}"><div class="nw-main"><button type="button" class="ghost now-open nm-note" data-nm-note="${esc(e.note.id)}"><span class="nm-k">메모</span>${memoHtml(e)}</button><p class="nw-meta"><span>원래 글을 찾지 못했어요 · 노트로 가기</span></p></div></article>`;
  }
  function paint() {
    if (!box) return;
    if (!s.loaded) { box.innerHTML = failed ? failHtml({retry: 'data-nm-retry'}) : waitHtml({rows: 4, h: 56}); return; }
    const all = entries(), q = query();
    shown = all.filter(e => memoHit(e, q));
    const more = (s.end.news && s.end.outside) ? '' : `<p class="nm-more-line"><button type="button" class="ghost os-text-btn" data-nm-more${loading ? ' disabled aria-busy="true"' : ''}>더 보기</button></p>`;
    if (!shown.length) { box.innerHTML = emptyHtml(q ? '찾은 메모 없음' : '메모 있는 글 없음 · 글 보기에서 [메모]', {attrs: 'data-nm-empty'}) + more; return; }
    box.innerHTML = `<div class="nw-card nm-list" data-nm-list>${shown.map(rowHtml).join('')}</div>${more}`;
  }
  box?.addEventListener('click', event => {
    const b = event.target.closest?.('button');
    if (!b || !box.contains(b)) return;
    if (b.matches('[data-nm-retry]')) { failed = false; paint(); void load(); return; }
    if (b.matches('[data-nm-more]')) { if (!loading) void readPage(true); return; }
    if (b.matches('[data-nm-note]')) { requestNoteDocOpen(b.dataset.nmNote); window.KPTURouter?.go?.('basket', {source: 'delegated'}); return; }
    if (b.matches('[data-nm-open]')) {
      const key = b.closest('[data-nw-key]')?.dataset.nwKey || '', e = shown.find(x => x.key === key);
      if (e?.row) onOpen?.({type: e.type, id: e.row.id}, e.row);
    }
  });
  return {
    load, paint,
    loaded: () => s.loaded,
    // 상세에서 메모를 저장·고치면 다시 읽는다(보이는 탭일 때만 껍데기가 부른다).
    dirty() { s.loaded && void load(); },
    reset() { seq++; s = fresh(); failed = false; loading = false; shown = []; if (box) box.replaceChildren(); },
  };
}
