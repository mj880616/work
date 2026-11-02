// OUTSIDE-바깥성명 ④ 화면 1(설계 docs/design/outside-statements.md 2·4절): '바깥 성명' 화면의 계산만(DOM·네트워크 없음).
// 화면(outside-statements.js)이 그리기·서버 읽기/쓰기를 맡고, 여기서는 칩 줄·날짜 묶음·글 한 건의 보이는 모양을 정한다.
import {kstDay, addDays, dayLabel, hhmm} from './feed-model.mjs';

export const ALL = 'all';
// 칩 묶음(카탈로그 group 값과 같은 이름). 단체 이름·묶음은 서버 카탈로그(outside-feed ?action=catalog)에서만 받는다.
// 11/02 00:19 명진 요청: [노동] [정당] [사회운동] [외국]. 민주노총·공공운수노조는 [노동] 안 단체 칩(둘째 줄).
export const GROUPS = Object.freeze([
  {key: 'labor', label: '노동'},
  {key: 'party', label: '정당'},
  {key: 'movement', label: '사회운동'},
  {key: 'foreign', label: '외국'},
]);
const GROUP_KEYS = new Set(GROUPS.map(g => g.key));
// 옛 서버 카탈로그(묶음 kctu·kptu)가 아직 배포돼 있을 때도 [노동]으로 묶는다(Edge 재배포 전후 어느 쪽이든 같은 화면).
const LEGACY_GROUP = Object.freeze({kctu: 'labor', kptu: 'labor'});
// 종류 칸: 성명·논평·보도자료만. article(외국 매체 글·사회운동 글처럼 보도·논설 등을 가릴 수 없는 글)은 종류 칸을 비운다(11/01 요청 5).
export const KIND_LABEL = Object.freeze({statement: '성명', comment: '논평', press: '보도자료', article: ''});
export const PAGE_SIZE = 40;
// 공대위 표시(명진 결정 11/02 16:26 L3): 공대위(양대노총 공공기관 노동조합 공동대책위원회)는 따로 사이트가 없어,
// [노동] 안 민주노총·공공운수노조 글 가운데 제목이나 요약(본문에서 만든 것)에 '공대위'·'공동대책위원회'가 든 글에 표시만 한다.
// 본문 문장은 펼칠 때만 읽으므로 본문에만 있는 글은 표시되지 않는다(서버 저장 칸을 새로 만들지 않음).
export const GONGDAEWI_SOURCES = Object.freeze(['kctu', 'kptu']);
const GONGDAEWI = /공대위|공동\s*대책\s*위원회/;
export function isGongdaewi(p) {
  if (!GONGDAEWI_SOURCES.includes(p?.source_key)) return false;
  return GONGDAEWI.test(String(p?.title || '')) || GONGDAEWI.test(String(p?.summary_ko || ''));
}
const KEY = /^[a-z0-9][a-z0-9-]{1,39}$/;

// 서버 카탈로그 → [{key, name, group, lang}] (모양이 틀린 줄은 버린다).
export function normalizeCatalog(raw) {
  const list = Array.isArray(raw?.sources) ? raw.sources : Array.isArray(raw) ? raw : [];
  const seen = new Set(), out = [];
  for (const s of list) {
    if (!s || typeof s !== 'object' || !KEY.test(String(s.key || '')) || seen.has(s.key)) continue;
    const name = typeof s.name === 'string' && s.name.trim() ? s.name.trim().slice(0, 40) : s.key;
    const group = Object.hasOwn(LEGACY_GROUP, s.group) ? LEGACY_GROUP[s.group] : s.group;
    out.push({key: s.key, name, group: GROUP_KEYS.has(group) ? group : 'movement', lang: s.lang === 'en' ? 'en' : 'ko'});
    seen.add(s.key);
  }
  return out;
}

// 켠 단체(enabled 줄) 열쇠 목록.
export const enabledKeys = rows => (rows || []).filter(r => r && r.enabled === true && KEY.test(String(r.source_key || ''))).map(r => r.source_key);

// 칩 첫 줄: [전체] + 켠 단체가 있는 묶음만(노동·정당·사회운동·외국). 단체 낱개는 둘째 줄(subChipsOf)로(11/01 요청 4).
export function chipsOf(catalog, enabled) {
  const on = new Set(enabled || []);
  const chips = [{id: ALL, label: '전체'}];
  for (const g of GROUPS) {
    if ((catalog || []).some(s => s.group === g.key && on.has(s.key))) chips.push({id: 'g:' + g.key, label: g.label});
  }
  return chips;
}
// 고른 칩이 속한 묶음 열쇠('g:party'이거나 그 묶음 단체 's:kgreens'면 'party'). 없으면 ''.
export function groupOfChip(chip, catalog) {
  if (typeof chip !== 'string') return '';
  if (chip.startsWith('g:')) return GROUP_KEYS.has(chip.slice(2)) ? chip.slice(2) : '';
  if (chip.startsWith('s:')) return (catalog || []).find(s => s.key === chip.slice(2))?.group || '';
  return '';
}
// 칩 둘째 줄: 묶음을 골랐을 때 그 묶음의 켠 단체 낱개(둘 이상일 때만 — 하나뿐이면 묶음 칩이 곧 그 단체). 묶음을 안 골랐으면 [].
export function subChipsOf(catalog, enabled, chip) {
  const g = groupOfChip(chip, catalog);
  if (!g) return [];
  const on = new Set(enabled || []);
  const members = (catalog || []).filter(s => s.group === g && on.has(s.key));
  return members.length > 1 ? members.map(s => ({id: 's:' + s.key, label: s.name})) : [];
}
// 첫 줄 칩이 눌린 모양인가: 그 칩 자체이거나, 고른 단체가 그 묶음에 속할 때.
export const chipPressed = (id, chip, catalog) => id === chip || (id.startsWith('g:') && groupOfChip(chip, catalog) === id.slice(2) && String(chip).startsWith('s:'));

// 고른 칩 → 서버에 물을 단체 열쇠 목록. null = 거르지 않음(전체).
export function keysOf(chip, catalog, enabled) {
  if (!chip || chip === ALL) return null;
  const on = new Set(enabled || []);
  if (chip.startsWith('s:')) { const k = chip.slice(2); return KEY.test(k) ? [k] : null; }
  if (chip.startsWith('g:')) return (catalog || []).filter(s => s.group === chip.slice(2) && on.has(s.key)).map(s => s.key);
  return null;
}
// 칩 줄이 바뀌어 고른 칩이 없어졌으면 [전체]로(chips = 첫 줄 + 둘째 줄).
export const keepChip = (chip, chips) => (chips || []).some(c => c.id === chip) ? chip : ALL;

// 글 시각: 게시 시각만(11/02 00:17). 게시 시각을 모르면 ''(받은 시각을 게시 시각처럼 쓰지 않는다 — 옛 글이 '오늘'로 쏟아지지 않게).
export const NO_DATE = '날짜 모름';
export const postTime = p => p?.published_at || '';
// 시각 칸: 'HH:MM'. 날짜만 아는 글(서울 자정으로 저장된 날짜)은 시각을 비우고, 게시 시각을 모르면 '날짜 모름'.
export function timeText(p) {
  const at = postTime(p);
  if (!at || !Number.isFinite(Date.parse(at))) return NO_DATE;
  const t = hhmm(at);
  return t === '00:00' ? '' : t;
}

// 날짜 머리: 오늘 · 어제 · '10. 29. (목)'(올해가 아니면 '2025. 10. 29. (목)').
export function dayHead(day, today) {
  if (!day) return '';
  if (day === today) return '오늘';
  if (day === addDays(today, -1)) return '어제';
  const label = dayLabel(day);
  return day.slice(0, 4) === String(today).slice(0, 4) ? label : `${day.slice(0, 4)}. ${label}`;
}
// 서버가 준 순서(최신 먼저, 게시 시각 모르는 글은 맨 뒤)를 지키며 날짜로 묶는다. 게시 시각 모르는 글은 '날짜 모름' 묶음.
export function groupPosts(posts, now = Date.now()) {
  const today = kstDay(now), out = [];
  for (const p of posts || []) {
    const at = postTime(p);
    const day = at ? kstDay(at) : '';
    const last = out.at(-1);
    if (last && last.day === day) last.items.push(p);
    else out.push({day, label: day ? dayHead(day, today) : NO_DATE, items: [p]});
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
    kind: Object.hasOwn(KIND_LABEL, p?.kind) ? KIND_LABEL[p.kind] : '',
    tag: isGongdaewi(p) ? '공대위' : '',
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

// OUTSIDE-막힌단체: 서버가 남긴 단계 코드(last_error)를 일상어 한 줄로. 모르는 코드는 '읽기 실패'.
// 모양: '못 읽음 · 이유 한 마디'(11/01 요청 1).
const ERROR_NOTES = Object.freeze({
  robots: '못 읽음 · 사이트가 자동 읽기 막음',
  robots_denied: '못 읽음 · 사이트가 자동 읽기 막음',
  bot_check: '못 읽음 · 사이트가 자동 읽기 막음',
  parse_empty: '못 읽음 · 사이트 구조 바뀜',
  too_large: '못 읽음 · 목록이 너무 큼',
  robots_unreachable: '못 읽음 · 사이트 응답 없음',
  timeout: '못 읽음 · 사이트 응답 없음',
  network: '못 읽음 · 사이트 응답 없음',
  redirect_outside: '못 읽음 · 사이트 주소 바뀜',
  redirect_loop: '못 읽음 · 사이트 주소 바뀜',
});
export function errorNote(code) {
  const c = String(code || '');
  if (!c) return '';
  if (Object.hasOwn(ERROR_NOTES, c)) return ERROR_NOTES[c];
  if (/^http_[45]\d\d$/.test(c)) return '못 읽음 · 사이트 오류';
  return '못 읽음';
}

// 단체 켜고 끄기 줄의 작은 상태 글.
export function sourceState(row) {
  if (!row) return '';
  if (row.last_error) return errorNote(row.last_error);
  if (row.last_ok_at) {
    const day = kstDay(row.last_ok_at);
    return day ? `마지막 ${dayLabel(day)} ${hhmm(row.last_ok_at)}` : '';
  }
  return row.enabled ? '아직 읽지 않음' : '';
}

// OUTSIDE-이름·바로읽기: 목록 위 작은 줄 '마지막으로 읽음 … · 다음 …'(글이 없을 때 언제 뜨는지 알 수 있게).
// 예약 읽기 시각(서울). .github/workflows/outside-feed.yml의 cron '7 23,4,9 * * *'(UTC)와 같아야 한다(시험이 대조).
export const FEED_SLOTS_KST = Object.freeze(['08:07', '13:07', '18:07']);
const slotMs = (day, slot) => Date.parse(`${day}T${slot}:00+09:00`);
// now 이전(같거나 앞)의 가장 늦은 예약 시각, now 뒤의 가장 이른 예약 시각.
export function feedSlots(now = Date.now()) {
  const today = kstDay(now);
  const all = [addDays(today, -1), today, addDays(today, 1)].flatMap(d => FEED_SLOTS_KST.map(s => slotMs(d, s)));
  return {prev: all.filter(t => t <= now).at(-1), next: all.find(t => t > now)};
}
const whenText = (ms, now) => {
  const day = kstDay(ms), today = kstDay(now);
  const head = day === today ? '오늘' : day === addDays(today, -1) ? '어제' : dayLabel(day);
  return `${head} ${hhmm(new Date(ms).toISOString())}`;
};
// 켠 단체 줄(rows: app_outside_sources) → 한 줄 글. 켠 단체가 없으면 ''(빈 화면 안내가 따로 있음).
// 마지막 읽음 = 켠 단체 중 가장 늦은 last_ok_at. 그것이 지난 예약 시각보다 앞이면 예약 실행이 늦어진 것이라 '다음 곧'.
// app_outside_sources는 뉴스 클리핑 매체(news- 키)도 같은 표에 둔다. 사회운동 Now는 자기 단체 줄만 센다
// ('켬 n'·'마지막으로 읽음'·켠 단체 목록). 서버 조회도 news- 키를 빼고 읽지만 화면 계산에서도 한 번 더 거른다.
export const NEWS_KEY_PREFIX = 'news-';
export const ownSourceRows = rows => (Array.isArray(rows) ? rows : []).filter(r => r && typeof r.source_key === 'string' && r.source_key && !r.source_key.startsWith(NEWS_KEY_PREFIX));

export function feedWhen(rows, now = Date.now()) {
  const on = (rows || []).filter(r => r && r.enabled === true);
  if (!on.length) return '';
  const last = Math.max(-Infinity, ...on.map(r => Date.parse(r.last_ok_at || '')).filter(Number.isFinite));
  const {prev, next} = feedSlots(now);
  const lastText = Number.isFinite(last) ? `마지막으로 읽음 ${whenText(last, now)}` : '아직 읽지 않음';
  const late = Number.isFinite(last) ? last < prev : false;
  const nextDay = kstDay(next) === kstDay(now) ? '' : '내일 ';
  const nextText = late ? `다음 곧(${hhmm(new Date(prev).toISOString())} 예정분)` : `다음 ${nextDay}${hhmm(new Date(next).toISOString())}쯤`;
  return `${lastText} · ${nextText}`;
}
