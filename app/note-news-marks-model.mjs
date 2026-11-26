// NOTE-News밑줄보관보기(사용자 11/15 '가'·'추천대로', 시안 docs/design/mockups/note-news-marks.html): 노트 'News에서' 두 줄의 순수 계산.
// 화면·저장소·네트워크 없음(node --test로 시험). 자료는 News와 같은 서버 자료 그대로(밑줄 = app_news_highlights, 보관 = now-saved.js readSavedRows) —
// 여기서는 거르기·세기·줄 값만 만든다. 복사본·기기 저장 없음.
import {hlHit, shortDay} from './text-highlights-model.mjs';
import {titleHit} from './now-model.mjs';
import {itemView} from './news-clipping-model.mjs';
import {postView} from './outside-statements-model.mjs';

// S69-04 MARK-밑줄한목록(사용자 11/24 "노트 밑줄에 있는 것들 저장한 글 밑줄에 없음 두개 동기화"): 내가 그은 밑줄을 보이는 한 규칙.
// 노트 › 밑줄(note-news-marks.js)과 저장한 글 [밑줄] 탭(reading.js)이 같은 원본(text-highlights.js가 들고 있는 app_news_highlights 목록)을
// 이 함수 하나로 걸러 같은 목록·같은 개수를 보인다(복사본 없음). raw가 아직 없으면 null.
// - 잠근 노트 폴더에 든 노트의 밑줄은 뺀다(noteHidden(노트 id)).
// - News 기능 키가 없다는 답이면(newsOn false) 노트·저장한 글·브리핑 밑줄만(News·텔레그램 밑줄은 누르면 News로 가므로). 모르면 다 보인다.
export const marksNewsOn = features => !Array.isArray(features) || features.includes('outside');
export function visibleMarks(raw, {newsOn = true, noteHidden = () => false} = {}) {
  if (!Array.isArray(raw)) return null;
  const all = raw.filter(h => !(h?.source_type === 'note' && noteHidden(h.source_id)));
  return newsOn ? all : all.filter(h => h?.source_type === 'note' || h?.source_type === 'reading' || h?.source_type === 'brief');
}

// 노트 목록 자리 값(at): 폴더 id·'out'(폴더 없음)·'recent'와 겹치지 않는 이름.
export const NEWS_HL = 'news-hl';
export const NEWS_SAVED = 'news-saved';
export const isNewsAt = v => v === NEWS_HL || v === NEWS_SAVED;
// NOTE-News에서글자빼기(11/15 20:42 사용자): 폴더 목록과 두 줄 사이는 글자 없는 얇은 줄만(밑줄이 노트·텔레그램에서도 오므로 'News에서' 이름표를 뺐다).
export const NEWS_NAMES = Object.freeze({[NEWS_HL]: '밑줄', [NEWS_SAVED]: '저장한 글'});

// [보관한 글] 거르기: 전체 | 뉴스 | 사회운동 글.
export const SAVED_KINDS = Object.freeze([
  {id: 'all', label: '전체'},
  {id: 'news', label: '뉴스'},
  {id: 'outside', label: '사회운동 글'},
]);
export const keepSavedKind = v => (SAVED_KINDS.some(k => k.id === v) ? v : 'all');
export const filterSavedKind = (rows, kind) => {
  const k = keepSavedKind(kind);
  return (rows || []).filter(r => k === 'all' || r?.type === k);
};

// 보관한 글 줄 값: 제목 · 매체 · 날짜(MM/DD) · ★(보관 = 별표, S67-09). nameOf(source_key) → 사회운동 매체 이름(모르면 null).
export function savedLine(r, nameOf = () => null) {
  const row = r?.row || {};
  if (r?.type === 'news') {
    const v = itemView(row);
    return {key: `news:${r.id}`, type: 'news', id: r.id, title: v.title, media: v.publisher || '', day: shortDay(row.published_at || row.created_at), star: true};
  }
  const v = postView(row);
  return {key: `outside:${r?.id}`, type: 'outside', id: r?.id, title: v.title || '제목 없음', media: nameOf(row.source_key) || '사회운동', day: shortDay(row.published_at || row.fetched_at), star: !!r?.star};
}

// 노트 검색 칸 글자로 찾기: 밑줄은 고른 글·메모·기사 제목·매체(News [밑줄] 탭과 같은 hlHit), 보관한 글은 제목(News [보관] 탭과 같은 titleHit).
// query는 노트 검색과 같은 글자(소문자로 바꾼 값이어도 그대로 맞는다).
export function newsSearch({highlights, saved, query, nameOf} = {}) {
  const q = String(query ?? '').trim();
  if (!q) return {highlights: [], saved: []};
  return {
    highlights: (highlights || []).filter(h => hlHit(h, q)),
    saved: (saved || []).filter(r => { const l = savedLine(r, nameOf); return titleHit([l.title, r?.row?.title], q); }),
  };
}

// 찾은 것 머리 글: '노트 2 · 밑줄 2 · 보관 1'.
export const searchHead = (notes, hl, sv) => `노트 ${notes} · 밑줄 ${hl} · 저장한 글 ${sv}`;
