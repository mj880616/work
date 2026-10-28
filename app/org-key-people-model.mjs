// ORG-주요인물: 담당조직 [주요 인물] 탭의 순수 규칙(입출력 없음). 화면은 org-key-people.js 하나가 그린다.
// - 사람마다 '찾을 이름'(이름 + 통화·텔레그램에 찍히는 이름)으로 기록을 고른다. 지정하지 않은 사람은 모으지 않는다(결정 5).
// - 통화: 상대(counterpart, 손으로 고친 값 우선)·제목. 업무·개인 통화함 모두(10/29 01:29 결정: 개인 통화 구분 없이 다 모음).
// - 텔레그램: 보낸 사람 이름표(손 이름·수집기 이름)가 찾을 이름이면 그 방·날 전부, 그리고 제목·요약에 이름이 나온 소식.
// - 회의(사업 보고): 제목·내용 글에 이름이 나오면. 챙길 것: 요약·근거 글. 원장 약속: 상대·제목.
// DB 규칙(20261029014700_org_key_people)과 같은 숫자: 이름 1~40자, 찾을 이름 2~40자·20개·중복 없음.

export const NAME_MAX = 40, MATCH_MIN = 2, MATCH_MAX = 40, MATCHES_MAX = 20, PEOPLE_MAX = 40;
export const RECORD_LIMIT = 80, OPEN_LIMIT = 30;
export const KIND_LABEL = Object.freeze({call:'통화', personal:'통화', telegram:'텔레그램', meeting:'회의', todo:'챙길 것', promise:'약속'});

const CTRL = /[\u0000-\u001f\u007f]/;
// 비교용: 호환 문자 정리, 공백·가운뎃점 제거, 영문 소문자.
export const normName = value => String(value ?? '').normalize('NFKC').replace(/[\s·ㆍ.]+/gu, '').toLowerCase();
const clean = value => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
const chars = s => [...s].length;

// [+ 인물] 창 입력 → 저장할 값 또는 오류 한 줄. 이름은 늘 첫 찾을 이름(2자 이상일 때)으로도 쓴다.
export function personDraft({name, matches = []} = {}) {
  const n = clean(name);
  if (!n) return {ok:false, error:'이름을 적어 주세요.'};
  if (chars(n) > NAME_MAX) return {ok:false, error:`이름은 ${NAME_MAX}자까지예요.`};
  const seen = new Set(), list = [];
  for (const raw of [n, ...matches]) {
    const m = clean(raw); if (!m || CTRL.test(m)) continue;
    if (chars(m) < MATCH_MIN) { if (raw === n) continue; return {ok:false, error:`찾을 이름은 ${MATCH_MIN}자 이상이에요.`}; }
    if (chars(m) > MATCH_MAX) return {ok:false, error:`찾을 이름은 ${MATCH_MAX}자까지예요.`};
    if (seen.has(m)) continue;
    seen.add(m); list.push(m);
  }
  if (list.length > MATCHES_MAX) return {ok:false, error:`찾을 이름은 ${MATCHES_MAX}개까지예요.`};
  return {ok:true, name:n, match_names:list};
}

// 사람마다 비교할 이름(정리한 글자, 2자 이상).
export function needlesOf(person) {
  const out = new Set();
  for (const v of [person?.name, ...(Array.isArray(person?.match_names) ? person.match_names : [])]) {
    const k = normName(v); if (chars(k) >= MATCH_MIN) out.add(k);
  }
  return [...out];
}
// 글들 중 하나라도 그 사람의 이름을 품으면 그 사람 id. 여러 사람이면 지정 순서대로.
export function whoIn(texts, people) {
  const hay = (Array.isArray(texts) ? texts : [texts]).map(normName).filter(Boolean);
  if (!hay.length) return [];
  return (people || []).filter(p => needlesOf(p).some(n => hay.some(h => h.includes(n)))).map(p => p.id);
}

const dayOf = v => /^\d{4}-\d{2}-\d{2}/.test(String(v ?? '')) ? String(v).slice(0, 10) : '';
const byNewest = (a, b) => String(b.day).localeCompare(String(a.day)) || String(b.at || '').localeCompare(String(a.at || '')) || String(a.id).localeCompare(String(b.id));

// 지난 기록(통화·텔레그램·회의) 한 목록, 최신순. 줄: {key, kind, id, day, at, text, people:[id], open:{…}}.
export function collectRecords({people = [], calls = [], personal = [], telegram = [], senders = null, meetings = []} = {}, limit = RECORD_LIMIT) {
  if (!people.length) return [];
  const out = [];
  for (const [rows, kind] of [[calls, 'call'], [personal, 'personal']]) {
    for (const r of rows || []) {
      if (!r?.id || r.hidden_at) continue;
      const ids = whoIn([r.counterpart, r.title], people); if (!ids.length) continue;
      out.push({key:`${kind}:${r.id}`, kind, id:r.id, day:dayOf(r.day || r.occurred_at), at:r.occurred_at || '', text:clean(r.summary || r.title) || '(내용 없음)', people:ids, open:{view:'calls', id:r.id}});
    }
  }
  // 텔레그램: 이름표가 그 사람인 방·날 → 그 방·날의 소식은 한 줄로 묶는다.
  const roomDayPeople = new Map();
  if (senders && Array.isArray(senders.senders)) {
    const sid = new Map();
    for (const s of senders.senders) { const ids = whoIn([s.name, s.auto_name], people); if (ids.length && !s.is_self) sid.set(s.id, ids); }
    for (const l of senders.links || []) {
      const ids = sid.get(l.sender_id); if (!ids) continue;
      const k = `${l.room_key}\u0000${l.day}`, cur = roomDayPeople.get(k) || new Set();
      ids.forEach(i => cur.add(i)); roomDayPeople.set(k, cur);
    }
  }
  const tg = new Map();
  for (const r of telegram || []) {
    if (!r?.id || r.hidden_at || !r.room_key) continue;
    const day = dayOf(r.day || r.occurred_at), k = `${r.room_key}\u0000${day}`;
    const ids = new Set([...(roomDayPeople.get(k) || []), ...whoIn([r.title, r.summary], people)]);
    if (!ids.size) continue;
    const cur = tg.get(k) || {key:`telegram:${k}`, kind:'telegram', id:r.id, day, at:r.occurred_at || '', room:r.room_label || '', texts:[], people:new Set(), open:{view:'telegram', room:r.room_key, day, item:r.id}};
    ids.forEach(i => cur.people.add(i));
    const t = clean(r.title || r.summary); if (t && !cur.texts.includes(t)) cur.texts.push(t);
    if (String(r.occurred_at || '') > String(cur.at)) { cur.at = r.occurred_at; cur.id = r.id; cur.open = {...cur.open, item:r.id}; }
    tg.set(k, cur);
  }
  for (const v of tg.values()) {
    const order = (people || []).map(p => p.id).filter(i => v.people.has(i));
    out.push({key:v.key, kind:'telegram', id:v.id, day:v.day, at:v.at, text:[v.room, v.texts.slice(0, 2).join(' / ')].filter(Boolean).join(' · ') || '(내용 없음)', people:order, open:v.open});
  }
  for (const m of meetings || []) {
    if (!m?.id || m.deleted_at) continue;
    const ids = whoIn([m.title, m.series_name, m.notes], people); if (!ids.length) continue;
    const title = clean(m.title || m.series_name) || '사업 보고';
    out.push({key:`meeting:${m.id}`, kind:'meeting', id:m.id, day:dayOf(m.meeting_at), at:m.meeting_at || '', text:m.round_no ? `${title} ${m.round_no}차` : title, people:ids, open:{view:'meetings', id:m.id}});
  }
  return out.sort(byNewest).slice(0, limit);
}

// 열린 것(약속·챙길 것), 마감 가까운 순(마감 없는 것은 뒤). 줄: {key, kind, id, text, due, people, open}.
export function collectOpen({people = [], todos = [], promises = []} = {}, limit = OPEN_LIMIT) {
  if (!people.length) return [];
  const out = [];
  for (const c of todos || []) {
    if (!c?.id || (c.status && c.status !== 'open')) continue;
    const ids = whoIn([c.summary, c.evidence], people); if (!ids.length) continue;
    out.push({key:`todo:${c.id}`, kind:'todo', id:c.id, text:clean(c.summary) || '(내용 없음)', due:dayOf(c.due), people:ids, open:{view:'basket', id:c.id}});
  }
  for (const p of promises || []) {
    if (!p?.id || (p.commitment_status && p.commitment_status !== 'waiting')) continue;
    const ids = whoIn([p.counterparty, p.title], people); if (!ids.length) continue;
    out.push({key:`promise:${p.id}`, kind:'promise', id:p.id, text:clean(p.title || p.summary) || '(내용 없음)', due:dayOf(p.follow_up_on || p.date_end || p.date_start), people:ids, open:{view:'ledger', id:p.id}});
  }
  return out.sort((a, b) => (a.due ? 0 : 1) - (b.due ? 0 : 1) || String(a.due).localeCompare(String(b.due)) || String(a.key).localeCompare(String(b.key))).slice(0, limit);
}

// 칩으로 거르기: null이면 모두.
export const onlyPerson = (rows, personId) => personId ? (rows || []).filter(r => (r.people || []).includes(personId)) : (rows || []);

// 'D-3' / 'D-day' / 'D+2'(지남). 날짜가 아니면 빈 글자.
export function dday(due, today) {
  if (!dayOf(due) || !dayOf(today)) return '';
  const diff = Math.round((Date.parse(dayOf(due) + 'T00:00:00Z') - Date.parse(dayOf(today) + 'T00:00:00Z')) / 86400000);
  return diff === 0 ? 'D-day' : diff > 0 ? `D-${diff}` : `D+${-diff}`;
}
// '10.29' 꼴(올해가 아니면 '25.10.29').
export function shortDay(day, today) {
  const d = dayOf(day); if (!d) return '';
  const [y, m, dd] = d.split('-');
  return (dayOf(today).slice(0, 4) === y ? '' : y.slice(2) + '.') + `${Number(m)}.${Number(dd)}`;
}

// '요즘' 한 문장을 새로 받아야 하나: 없거나, 오늘 것이 아니거나, 만들 때의 주요 인물이 지금과 다르면.
export function briefStale(brief, people, today) {
  if (!people?.length) return false;
  if (!brief || dayOf(brief.day) !== dayOf(today)) return true;
  const was = new Set(Array.isArray(brief.people_ids) ? brief.people_ids : []), now = people.map(p => p.id);
  return was.size !== now.length || now.some(i => !was.has(i));
}
