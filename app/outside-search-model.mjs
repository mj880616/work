// S48-18 사회운동 Now [문장 찾기] — 화면 쪽 순수 함수(설계 docs/design/outside-statements.md 3.3·4절 [문장 찾기]).
// 네트워크·저장 없음. 서버 찾기 함수 app_outside_search(INVOKER, owner RLS)·expand(비슷한 말)·app_search_records(내 성명)의 답을 다시 검사한다.
import {KIND_LABEL, safeUrl, NO_DATE} from './outside-statements-model.mjs';

export const SEARCH_PAGE = 30;
export const TERM_MAX = 100;
export const SIMILAR_MAX = 6;
export const MINE_MAX = 10;
export const MINE_CATEGORY = '성명·보도자료';
// 기간: 1달·6달·1년·전체 + 날짜 고르기(달력 두 칸). 기간은 게시 날짜(서울)로만 거른다 — 날짜 모름 글은 [전체]에서만 나온다(DB 20261102150000).
export const PERIODS = Object.freeze([
  {id: '1m', label: '1달', months: 1}, {id: '6m', label: '6달', months: 6}, {id: '1y', label: '1년', months: 12},
  {id: 'all', label: '전체', months: 0}, {id: 'pick', label: '날짜', months: 0},
]);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const seoulDay = ms => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);

// 찾는 말: 한 줄, 앞뒤 빈칸 없이, 100자 안쪽(넘으면 자름). 빈 글이면 ''.
export const cleanTerm = v => [...String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, TERM_MAX).join('');

// 기간 → {from, to}(서울 날짜 'YYYY-MM-DD' 또는 null). 날짜 고르기는 빈 칸이면 그 쪽 끝 없음, 거꾸로 넣으면 바꿔 준다.
export function rangeOf(period, now = Date.now(), pickFrom = '', pickTo = '') {
  const p = PERIODS.find(x => x.id === period) || PERIODS[3];
  if (p.id === 'pick') {
    let from = DAY.test(pickFrom) ? pickFrom : null, to = DAY.test(pickTo) ? pickTo : null;
    if (from && to && from > to) [from, to] = [to, from];
    return {from, to};
  }
  if (!p.months) return {from: null, to: null};
  const today = seoulDay(now);
  const [y, m, d] = today.split('-').map(Number);
  const back = new Date(Date.UTC(y, m - 1 - p.months, 1));
  const last = new Date(Date.UTC(back.getUTCFullYear(), back.getUTCMonth() + 1, 0)).getUTCDate();
  back.setUTCDate(Math.min(d, last));
  return {from: back.toISOString().slice(0, 10), to: null};
}

// 비슷한 말(서버 expand 답): 글자 1~30, 원래 말·서로 겹침 없음, 6개까지.
export function cleanSimilar(terms, query) {
  const seen = new Set([cleanTerm(query).toLowerCase()]), out = [];
  for (const t of Array.isArray(terms) ? terms : []) {
    const s = cleanTerm(t);
    if (!s || [...s].length > 30 || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase()); out.push(s);
    if (out.length >= SIMILAR_MAX) break;
  }
  return out;
}

// 찾기 함수 답 한 줄 → 화면 모양. 모양이 틀린 줄은 버린다.
export function cleanHits(rows) {
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || !UUID.test(String(r.post_id)) || !Number.isSafeInteger(r.idx) || typeof r.sentence !== 'string' || !r.sentence.trim()) continue;
    const s = v => (typeof v === 'string' ? v.trim() : '');
    out.push({
      post_id: String(r.post_id).toLowerCase(), idx: r.idx, source_key: s(r.source_key),
      kind: Object.hasOwn(KIND_LABEL, r.kind) ? KIND_LABEL[r.kind] : '', title: s(r.title) || '(제목 없음)', url: safeUrl(r.url),
      published_at: s(r.published_at) || null, sentence: s(r.sentence), prev: s(r.prev_sentence), next: s(r.next_sentence),
      matched: s(r.matched), similar: r.is_similar === true,
    });
  }
  return out;
}

// 결과 날짜 칸: 게시 날짜(서울) '2026. 10. 28.' 꼴 대신 짧게 '26.10.28'. 모르면 '날짜 모름'.
export function hitDay(at) {
  const t = Date.parse(at || '');
  if (!Number.isFinite(t)) return NO_DATE;
  const d = seoulDay(t);
  return `${d.slice(2, 4)}.${d.slice(5, 7)}.${d.slice(8, 10)}`;
}
// 초안으로 넘길 날짜(서울 'YYYY-MM-DD', 모르면 '').
export const hitIsoDay = at => { const t = Date.parse(at || ''); return Number.isFinite(t) ? seoulDay(t) : ''; };

// 칠하기: 글을 조각으로 나눈다. 원래 말(main)이 먼저, 그다음 비슷한 말(sim). 대소문자 무시, 겹치면 먼저 시작·긴 것.
// 돌려주는 값: [{text, mark: '' | 'main' | 'sim'}]. 화면은 조각마다 글자로만(esc) 그린다.
export function markParts(text, main, similar = []) {
  const src = String(text ?? '');
  const terms = [{t: cleanTerm(main), mark: 'main'}, ...(similar || []).map(t => ({t: cleanTerm(t), mark: 'sim'}))].filter(x => x.t);
  if (!src || !terms.length) return src ? [{text: src, mark: ''}] : [];
  const low = src.toLowerCase(), spans = [];
  for (const {t, mark} of terms) {
    const lt = t.toLowerCase();
    for (let i = low.indexOf(lt); i >= 0; i = low.indexOf(lt, i + lt.length)) spans.push({a: i, b: i + lt.length, mark, main: mark === 'main'});
  }
  spans.sort((x, y) => x.a - y.a || (y.main - x.main) || (y.b - y.a) - (x.b - x.a));
  const out = [];
  let at = 0;
  for (const s of spans) {
    if (s.a < at) continue;
    if (s.a > at) out.push({text: src.slice(at, s.a), mark: ''});
    out.push({text: src.slice(s.a, s.b), mark: s.mark});
    at = s.b;
  }
  if (at < src.length) out.push({text: src.slice(at), mark: ''});
  return out;
}

// 내 성명: 자료실 찾기(app_search_records, 종류 document)의 답 중 분류가 '성명·보도자료'(또는 그 아래 분류)인 것만, 10건까지.
// cats: Map(id → category). 답의 모양은 전체 검색과 같다(groups[].items[]).
export function mineHits(data, cats) {
  const out = [];
  for (const g of Array.isArray(data?.groups) ? data.groups : []) {
    if (g?.kind !== 'document') continue;
    for (const it of Array.isArray(g.items) ? g.items : []) {
      const id = String(it?.id || '').toLowerCase();
      if (!UUID.test(id)) continue;
      const cat = String(cats?.get?.(id) || '');
      if (cat !== MINE_CATEGORY && !cat.startsWith(MINE_CATEGORY + '›')) continue;
      out.push({id, title: String(it.title || '').trim() || '(제목 없음)', snippet: String(it.snippet || '').replace(/\s+/g, ' ').trim(), day: hitDay(it.occurred_at)});
      if (out.length >= MINE_MAX) return out;
    }
  }
  return out;
}
export const mineIds = data => (Array.isArray(data?.groups) ? data.groups : []).filter(g => g?.kind === 'document')
  .flatMap(g => (Array.isArray(g.items) ? g.items : []).map(it => String(it?.id || '').toLowerCase())).filter(id => UUID.test(id));
