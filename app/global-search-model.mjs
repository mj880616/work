// SEARCH-전체검색 S-2: 전체 검색의 순수 규칙(DOM·네트워크 없음). 설계 docs/design/global-search.md 4·7절.
// 검색어 나누기·검사(서버 app_search_records와 같은 규칙), 형광 구간, Google 일정·할 일 거르기, 묶음 합치기·정렬,
// 오류 코드 → 안내 글. 화면(global-search.js)과 자료(global-search-data.js)가 함께 쓴다.

export const MIN_WORD = 2, MAX_WORDS = 6, MAX_WORD = 100, MAX_QUERY = 200, CAP = 200, PREVIEW = 3, PAGE = 20, SNIPPET_RADIUS = 40;
// 서버 종류(설계 7절). 일기는 어디에도 없다(서버 허용 목록이 최종 경계).
export const SERVER_KINDS = Object.freeze(['update', 'note', 'work', 'document', 'meeting', 'project', 'organization', 'milestone']);
// 화면 묶음: 서버 종류 + 브라우저가 찾는 할 일(task). 일정(schedule) = 프로젝트 주요 일정(milestone) + Google 일정.
export const GROUPS = Object.freeze([
  {key: 'update', label: '업데이트', icon: 'update', chip: true},
  {key: 'note', label: '노트', icon: 'note', chip: true},
  {key: 'task', label: '할 일', icon: 'task', chip: true},
  {key: 'document', label: '자료실', icon: 'document', chip: true},
  {key: 'meeting', label: '사업 보고', icon: 'meeting', chip: true},
  {key: 'schedule', label: '일정', icon: 'schedule', chip: true},
  // 칩 없이 '전체'에만(결정 1: 업무일지 한 줄. 프로젝트·담당조직도 요청 칩에 없어 같은 규칙).
  {key: 'work', label: '업무일지', icon: 'work', chip: false},
  {key: 'project', label: '프로젝트', icon: 'project', chip: false},
  {key: 'organization', label: '담당조직', icon: 'organization', chip: false}
]);
export const GROUP_KEYS = Object.freeze(GROUPS.map(g => g.key));
export const groupOf = key => GROUPS.find(g => g.key === key) || null;
// 화면 묶음 → 서버에 묻는 종류(없으면 브라우저만).
export const serverKindOf = key => key === 'schedule' ? 'milestone' : SERVER_KINDS.includes(key) ? key : null;
export const groupKeyOfServer = kind => kind === 'milestone' ? 'schedule' : kind;

// 낱말 나누기. 서버와 같은 규칙: 공백으로 나눔, 같은 낱말 한 번(대소문자 무시), 1~6개, 낱말 2~100자, 전체 200자, 제어문자 불가.
// 돌려주는 error: 'short'(빈 검색어·2글자 미만 낱말) · 'many'(7개 이상·100자 넘는 낱말) · 'bad'(200자 초과·제어문자).
export function parseQuery(raw) {
  const text = String(raw ?? '');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(text)) return {words: [], error: 'bad'};
  const trimmed = text.trim();
  if (trimmed.length > MAX_QUERY) return {words: [], error: 'bad'};
  const words = [], seen = new Set();
  for (const w of trimmed.split(/\s+/)) {
    if (!w) continue;
    const k = w.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k); words.push(w);
  }
  if (!words.length) return {words, error: 'short'};
  if (words.length > MAX_WORDS || words.some(w => w.length > MAX_WORD)) return {words, error: 'many'};
  if (words.some(w => w.length < MIN_WORD)) return {words, error: 'short'};
  return {words, error: null, query: words.join(' ')};
}

export const QUERY_MESSAGES = Object.freeze({
  short: '두 글자 이상 입력하면 찾아요.',
  many: '낱말은 6개까지, 낱말마다 100자까지 찾을 수 있어요.',
  bad: '검색어는 200자 안에서 줄바꿈 없이 써 주세요.'
});

// 서버 오류 → 안내 글. 22023 SEARCH_* 는 message로 구분(설계 7절), 42501은 권한 없음.
export function errorMessage(error) {
  const text = String(error?.message || error || '');
  if (/SEARCH_QUERY_TOO_SHORT/.test(text)) return QUERY_MESSAGES.short;
  if (/SEARCH_TOO_MANY_WORDS/.test(text)) return QUERY_MESSAGES.many;
  if (/SEARCH_BAD_QUERY/.test(text)) return QUERY_MESSAGES.bad;
  if (/SEARCH_BAD_KIND|SEARCH_BAD_PAGE/.test(text)) return '검색 조건이 맞지 않아요. 다시 시도해 주세요.';
  if (error?.status === 401 || /로그인이 필요/.test(text)) return '로그인이 필요해요. 다시 로그인한 뒤 찾아 주세요.';
  if (error?.status === 403 || /42501|permission denied/i.test(text)) return '찾을 권한이 없어요.';
  if (error?.status === 404 || /PGRST202|42883|schema cache/i.test(text)) return '검색을 아직 쓸 수 없어요.';
  return '찾지 못했어요. 잠시 뒤 다시 시도해 주세요.';
}

const lower = s => String(s ?? '').toLowerCase();
const includesAll = (text, words) => { const t = lower(text); return words.every(w => t.includes(lower(w))); };

// 형광 구간: text를 [{text, mark}] 조각으로 나눈다(겹치는 구간은 합침, 대소문자 무시). 화면은 조각마다 textContent로 그린다.
export function highlightParts(text, words) {
  const s = String(text ?? '');
  if (!s) return [];
  const t = lower(s), ranges = [];
  for (const w of words || []) {
    const n = lower(w);
    if (!n) continue;
    let at = t.indexOf(n);
    while (at >= 0) { ranges.push([at, at + n.length]); at = t.indexOf(n, at + n.length); }
  }
  if (!ranges.length) return [{text: s, mark: false}];
  ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged = [];
  for (const r of ranges) {
    const last = merged.at(-1);
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else merged.push([...r]);
  }
  const parts = [];
  let pos = 0;
  for (const [a, b] of merged) {
    if (a > pos) parts.push({text: s.slice(pos, a), mark: false});
    parts.push({text: s.slice(a, b), mark: true});
    pos = b;
  }
  if (pos < s.length) parts.push({text: s.slice(pos), mark: false});
  return parts;
}

// 앞뒤 한 줄: 처음 찾은 낱말(입력 순서) 앞뒤 약 40자, 공백 정리(서버 snippet과 같은 모양).
export function snippetAround(text, words, radius = SNIPPET_RADIUS) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const t = lower(s);
  for (const w of words || []) {
    const at = t.indexOf(lower(w));
    if (at < 0) continue;
    const from = Math.max(0, at - radius), to = Math.min(s.length, at + w.length + radius);
    return (from > 0 ? '…' : '') + s.slice(from, to) + (to < s.length ? '…' : '');
  }
  return null;
}

const time = v => { const n = Date.parse(v || ''); return Number.isFinite(n) ? n : -Infinity; };
// 최근 것 먼저(occurred_at 내림차순, 같으면 id). 서버와 같은 순서.
export function byRecent(a, b) {
  const d = time(b.occurred_at) - time(a.occurred_at);
  if (d) return d > 0 ? 1 : -1;
  return String(a.id).localeCompare(String(b.id));
}

// Google 일정 거르기(결정 4): 제목·장소만(설명 제외). 모든 낱말이 제목+장소 어딘가에 있어야 한다.
export function filterEvents(events, words) {
  if (!words?.length) return [];
  const out = [];
  for (const e of events || []) {
    if (!e?.id) continue;
    const title = String(e.title || ''), place = String(e.location || '');
    if (!includesAll(title + '\n' + place, words)) continue;
    const inTitle = includesAll(title, words);
    out.push({
      kind: 'schedule', source: 'google_event', id: String(e.id), calendar_id: e.calendarId || null,
      title: title || '(제목 없음)', matched_in: inTitle ? 'title' : 'body', snippet: inTitle ? null : snippetAround(place, words),
      occurred_at: e.start || null, day: e.allDay ? String(e.start || '').slice(0, 10) : null, state: null,
      place_label: inTitle && place ? place : null
    });
  }
  return out.sort(byRecent);
}

// 할 일 거르기(결정 4): 이 기기 저장본(미완료 + 최근 완료). 제목·메모.
export function filterTasks(tasks, words) {
  if (!words?.length) return [];
  const out = [];
  for (const t of tasks || []) {
    if (!t?.id) continue;
    const title = String(t.title || ''), notes = String(t.notes || '');
    if (!includesAll(title + '\n' + notes, words)) continue;
    const inTitle = includesAll(title, words), done = t.status === 'completed';
    out.push({
      kind: 'task', source: 'google_task', id: String(t.id), title: title || '(제목 없음)',
      matched_in: inTitle ? 'title' : 'body', snippet: inTitle ? null : snippetAround(notes, words),
      occurred_at: (done ? t.completed : null) || t.due || t.updated || null, day: null, state: done ? 'done' : null
    });
  }
  return out.sort(byRecent);
}

// 서버 묶음 하나 검사(모르는 칸은 버리고 화면이 쓰는 칸만 남김).
function cleanItem(raw) {
  if (!raw || typeof raw !== 'object' || !raw.id) return null;
  const s = v => (v == null ? null : String(v));
  return {
    kind: s(raw.kind), source: s(raw.source), id: String(raw.id), title: s(raw.title) || '(제목 없음)',
    matched_in: ['title', 'body', 'attachment'].includes(raw.matched_in) ? raw.matched_in : 'title',
    snippet: s(raw.snippet), occurred_at: s(raw.occurred_at), day: s(raw.day),
    state: ['held', 'done', 'cancelled'].includes(raw.state) ? raw.state : null,
    project_id: s(raw.project_id), project_name: s(raw.project_name),
    organization_id: s(raw.organization_id), organization_name: s(raw.organization_name)
  };
}
export function cleanServer(data) {
  const groups = new Map();
  for (const g of Array.isArray(data?.groups) ? data.groups : []) {
    if (!SERVER_KINDS.includes(g?.kind)) continue;
    groups.set(g.kind, {
      kind: g.kind, total: Math.max(0, Number(g.total) || 0), capped: g.capped === true, offset: Math.max(0, Number(g.offset) || 0),
      items: (Array.isArray(g.items) ? g.items : []).map(cleanItem).filter(Boolean)
    });
  }
  return groups;
}

// 화면 묶음 만들기. server: cleanServer 결과(Map), local: {task:[…], schedule:[…]}(이미 거른 전부), per: 묶음당 줄 수.
export function buildGroups(server, local = {}, per = PREVIEW) {
  const out = [];
  for (const g of GROUPS) {
    const kind = serverKindOf(g.key);
    const s = kind ? server?.get?.(kind) : null;
    const extra = Array.isArray(local[g.key]) ? local[g.key] : [];
    const items = [...(s?.items || []), ...extra].sort(byRecent);
    const total = (s?.total || 0) + extra.length;
    const capped = !!s?.capped || total > CAP;
    out.push({key: g.key, label: g.label, total: Math.min(total, CAP), capped, items: items.slice(0, per)});
  }
  return out;
}

export const countLabel = (total, capped) => capped ? `${CAP}+` : String(total || 0);
// 칩: 전체(합) + 칩 있는 묶음 + 건수.
export function chipOptions(groups) {
  const all = groups.reduce((n, g) => n + (g.total || 0), 0), capped = groups.some(g => g.capped) || all > CAP;
  return [{value: 'all', label: `전체 ${countLabel(Math.min(all, CAP), capped)}`},
    ...GROUPS.filter(g => g.chip).map(g => { const x = groups.find(y => y.key === g.key); return {value: g.key, label: `${g.label} ${countLabel(x?.total, x?.capped)}`}; })];
}

export const STATE_LABEL = Object.freeze({held: '보류', done: '끝남', cancelled: '취소'});

// 날짜 표시(KST): 2026. 10. 3. — 업무일지는 day 그대로.
export function dateLabel(item) {
  const raw = item?.day || item?.occurred_at;
  if (!raw) return '';
  const day = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : (() => {
    const n = Date.parse(raw); if (!Number.isFinite(n)) return '';
    return new Date(n + 9 * 3600 * 1000).toISOString().slice(0, 10);
  })();
  if (!day) return '';
  const [y, m, d] = day.split('-').map(Number);
  return `${y}. ${m}. ${d}.`;
}
// 연결된 곳: 조직 · 프로젝트(있는 것만). 진행 기록·조직 업데이트는 제목이 이미 그 이름이라 같은 이름은 한 번만.
export function placeLabel(item) {
  const names = [item?.organization_name, item?.project_name, item?.place_label].filter(Boolean).map(String);
  return [...new Set(names)].filter(n => n !== item?.title).join(' · ');
}

// 화면이 여는 곳(source 필드 기준). 화면은 이 값으로 기존 여는 함수를 고른다.
export function openTarget(item) {
  switch (item?.source) {
    case 'note': return item.kind === 'note' ? {view: 'basket', note: 'doc', id: item.id} : item.kind === 'work' ? {view: 'journal', day: item.day} : {view: 'basket', note: 'memo', id: item.id};
    case 'document': return {view: 'library', id: item.id};
    case 'meeting': return {view: 'meetings', id: item.id};
    case 'project': return {view: 'projects', id: item.id};
    case 'progress': case 'milestone': return item.project_id ? {view: 'projects', id: item.project_id} : null;
    case 'organization': return {view: 'team', id: item.id};
    case 'org_update': case 'org_timeline': return item.organization_id ? {view: 'team', id: item.organization_id} : null;
    case 'google_task': return {view: 'tasks', id: item.id};
    case 'google_event': return {view: 'calendar', id: item.id, calendarId: item.calendar_id};
    default: return null;
  }
}

// Google 일정 읽는 범위(결정 4): 지난 3개월 ~ 앞 6개월. 9개월을 석 달씩 세 번에 나눠 읽는다(Edge가 캘린더마다 250개까지 돌려줌).
export function eventRanges(now = Date.now()) {
  const d = new Date(now), y = d.getUTCFullYear(), m = d.getUTCMonth();
  const at = k => new Date(Date.UTC(y, m + k, 1)).toISOString();
  return [[at(-3), at(0)], [at(0), at(3)], [at(3), at(7)]];
}
