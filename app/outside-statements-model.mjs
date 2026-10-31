// OUTSIDE-바깥성명 ④ 화면 1(설계 docs/design/outside-statements.md 2·4절): '바깥 성명' 화면의 계산만(DOM·네트워크 없음).
// 화면(outside-statements.js)이 그리기·서버 읽기/쓰기를 맡고, 여기서는 칩 줄·날짜 묶음·글 한 건의 보이는 모양을 정한다.
import {kstDay, addDays, dayLabel, hhmm} from './feed-model.mjs';

export const ALL = 'all';
// 칩 묶음(카탈로그 group 값과 같은 이름). 단체 이름·묶음은 서버 카탈로그(outside-feed ?action=catalog)에서만 받는다.
export const GROUPS = Object.freeze([
  {key: 'kctu', label: '민주노총'},
  {key: 'kptu', label: '공공운수노조'},
  {key: 'party', label: '정당'},
  {key: 'movement', label: '사회운동'},
  {key: 'foreign', label: '외국'},
]);
const GROUP_KEYS = new Set(GROUPS.map(g => g.key));
export const KIND_LABEL = Object.freeze({statement: '성명', comment: '논평', press: '보도자료', article: '글'});
export const PAGE_SIZE = 40;
const KEY = /^[a-z0-9][a-z0-9-]{1,39}$/;

// 서버 카탈로그 → [{key, name, group, lang}] (모양이 틀린 줄은 버린다).
export function normalizeCatalog(raw) {
  const list = Array.isArray(raw?.sources) ? raw.sources : Array.isArray(raw) ? raw : [];
  const seen = new Set(), out = [];
  for (const s of list) {
    if (!s || typeof s !== 'object' || !KEY.test(String(s.key || '')) || seen.has(s.key)) continue;
    const name = typeof s.name === 'string' && s.name.trim() ? s.name.trim().slice(0, 40) : s.key;
    out.push({key: s.key, name, group: GROUP_KEYS.has(s.group) ? s.group : 'movement', lang: s.lang === 'en' ? 'en' : 'ko'});
    seen.add(s.key);
  }
  return out;
}

// 켠 단체(enabled 줄) 열쇠 목록.
export const enabledKeys = rows => (rows || []).filter(r => r && r.enabled === true && KEY.test(String(r.source_key || ''))).map(r => r.source_key);

// 칩 줄: [전체] + 켠 단체가 있는 묶음 + 단체 낱개(단체가 둘 이상 켜진 묶음만 — 민주노총·공공운수노조처럼 하나뿐이면 묶음 칩이 곧 그 단체).
export function chipsOf(catalog, enabled) {
  const on = new Set(enabled || []);
  const chips = [{id: ALL, label: '전체'}];
  const singles = [];
  for (const g of GROUPS) {
    const members = (catalog || []).filter(s => s.group === g.key && on.has(s.key));
    if (!members.length) continue;
    chips.push({id: 'g:' + g.key, label: g.label});
    if (members.length > 1) for (const s of members) singles.push({id: 's:' + s.key, label: s.name});
  }
  return [...chips, ...singles];
}

// 고른 칩 → 서버에 물을 단체 열쇠 목록. null = 거르지 않음(전체).
export function keysOf(chip, catalog, enabled) {
  if (!chip || chip === ALL) return null;
  const on = new Set(enabled || []);
  if (chip.startsWith('s:')) { const k = chip.slice(2); return KEY.test(k) ? [k] : null; }
  if (chip.startsWith('g:')) return (catalog || []).filter(s => s.group === chip.slice(2) && on.has(s.key)).map(s => s.key);
  return null;
}
// 칩 줄이 바뀌어 고른 칩이 없어졌으면 [전체]로.
export const keepChip = (chip, chips) => (chips || []).some(c => c.id === chip) ? chip : ALL;

// 글 시각: 게시 시각, 없으면 받은 시각.
export const postTime = p => p?.published_at || p?.fetched_at || '';
export const timeText = p => hhmm(postTime(p));

// 날짜 머리: 오늘 · 어제 · '10. 29. (목)'(올해가 아니면 '2025. 10. 29. (목)').
export function dayHead(day, today) {
  if (!day) return '';
  if (day === today) return '오늘';
  if (day === addDays(today, -1)) return '어제';
  const label = dayLabel(day);
  return day.slice(0, 4) === String(today).slice(0, 4) ? label : `${day.slice(0, 4)}. ${label}`;
}
// 서버가 준 순서(최신 먼저)를 지키며 날짜로 묶는다.
export function groupPosts(posts, now = Date.now()) {
  const today = kstDay(now), out = [];
  for (const p of posts || []) {
    const day = kstDay(postTime(p));
    const last = out.at(-1);
    if (last && last.day === day) last.items.push(p);
    else out.push({day, label: dayHead(day, today), items: [p]});
  }
  return out;
}

// 2년 지난 글(Q7 결정): 제목·요약만 보인다(본문 문장은 수집기가 지우고 화면도 펼치지 않는다).
export function isOld(p, now = Date.now()) {
  const t = Date.parse(postTime(p));
  if (!Number.isFinite(t)) return false;
  const limit = new Date(now);
  limit.setUTCFullYear(limit.getUTCFullYear() - 2);
  return t < limit.getTime();
}

// 한 문장 요약: 요약 글의 첫 문장(국내 글은 이미 한 문장, 외국 글은 3~5문장 요약의 첫 문장). 200자까지.
export function firstSentence(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const m = /^.+?(?:[.!?](?=\s|$)|다\.(?=\s|$)|[。！？])/.exec(s);
  const one = (m ? m[0] : s).trim();
  return one.length > 200 ? one.slice(0, 199) + '…' : one;
}
// 외국 글 핵심 문장(원문 + 번역, 3개까지).
export function keySentences(p) {
  const list = Array.isArray(p?.key_sentences) ? p.key_sentences : [];
  return list.filter(k => k && typeof k.orig === 'string' && typeof k.ko === 'string' && k.orig.trim() && k.ko.trim()).slice(0, 3)
    .map(k => ({orig: k.orig.trim(), ko: k.ko.trim()}));
}

// 글 한 건의 보이는 모양. body: 'sentences'(국내 본문, 펼칠 때 서버에서 문장 읽기) | 'foreign'(외국 요약·핵심 문장) | ''(펼칠 것 없음).
export function postView(p, now = Date.now()) {
  const foreign = p?.lang === 'en';
  const old = isOld(p, now);
  const summary = String(p?.summary_ko || '').trim();
  const lead = firstSentence(summary);
  const keys = foreign ? keySentences(p) : [];
  let body = '';
  if (!old) {
    if (!foreign && p?.has_body === true) body = 'sentences';
    else if (foreign && (keys.length || (summary && summary.replace(/\s+/g, ' ') !== lead))) body = 'foreign';
  }
  const title = String((foreign && p?.title_ko) || p?.title || '').trim();
  return {
    title,
    origTitle: foreign && p?.title_ko && p.title_ko.trim() !== String(p?.title || '').trim() ? String(p.title || '').trim() : '',
    kind: KIND_LABEL[p?.kind] || '글',
    time: timeText(p),
    lead, summary, keys, body, old,
    url: safeUrl(p?.url),
  };
}
// [원문] 링크: http(s)만(DB도 같은 검사).
export function safeUrl(raw) {
  const s = String(raw || '').trim();
  if (!/^https?:\/\/[^\s]+$/i.test(s)) return '';
  try { const u = new URL(s); return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : ''; } catch { return ''; }
}
// 본문 문장 → 한 덩어리 글(문장 사이 빈칸).
export const bodyText = rows => (rows || []).filter(r => r && typeof r.text === 'string').sort((a, b) => a.idx - b.idx).map(r => r.text.trim()).filter(Boolean).join(' ');

// 지난번 [새로 온 것]을 본 뒤 들어온 글인가(받은 시각 기준).
export function isFresh(p, seenAt) {
  const s = Date.parse(seenAt || ''), f = Date.parse(p?.fetched_at || '');
  return Number.isFinite(s) && Number.isFinite(f) && f > s;
}

// 단체 켜고 끄기 줄의 작은 상태 글.
export function sourceState(row) {
  if (!row) return '';
  if (row.last_error === 'robots') return '사이트가 자동 읽기를 막음';
  if (row.last_error) return '읽기 실패';
  if (row.last_ok_at) {
    const day = kstDay(row.last_ok_at);
    return day ? `마지막 ${dayLabel(day)} ${hhmm(row.last_ok_at)}` : '';
  }
  return row.enabled ? '아직 읽지 않음' : '';
}
