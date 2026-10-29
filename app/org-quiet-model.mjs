// FEAT-1029묶음 ③ 오래 연락 안 한 담당조직: 홈 한 줄의 순수 규칙(입출력 없음). 화면은 org-quiet.js 하나가 그린다.
// 명진 결정(10/29 07:27~07:31): '연락'은 그 조직의 대표자·간부와
//   ① 통화한 것, 또는 ② 텔레그램에서 내가 묻고(질문) 같은 대화에서 그쪽 답을 받은 것만 센다.
//   단체방에 올라온 그 조직 소식, 일방 정보 전달(전달 메시지 포함), 내가 쓴 담당조직 기록·사업 보고·회의는 세지 않는다.
// 대표자·간부 = 담당조직 [주요 인물](app_org_key_people)에 지정한 사람. 사람마다 이름 + '찾을 이름'으로 통화 상대·텔레그램 보낸 사람 이름표를
//   대조한다(org-key-people-model.mjs whoIn 그대로). 주요 인물이 없는 조직은 판단할 수 없어 줄에서 빼고 펼친 목록 끝에 수만 적는다.
import {whoIn} from './org-key-people-model.mjs';

export const DEFAULT_WEEKS = 3, MAX_WEEKS = 12, LOOKBACK_DAYS = 180, NAMES_MAX = 3;
export const WEEK_CHOICES = Object.freeze([2, 3, 4, 6, 0]); // 홈 편집의 고르기 [2주|3주|4주|6주|끄기]
export const VIA_LABEL = Object.freeze({call:'통화', telegram:'텔레그램'});

// 저장된 값 → 주 수(0 = 끔). 모르는 값이면 기본 3주.
export const weeksOf = value => Number.isInteger(value) && value >= 0 && value <= MAX_WEEKS ? value : DEFAULT_WEEKS;

const dayOf = v => /^\d{4}-\d{2}-\d{2}/.test(String(v ?? '')) ? String(v).slice(0, 10) : '';
const ms = d => Date.parse(d + 'T00:00:00Z');
export const addDays = (day, n) => new Date(ms(dayOf(day)) + n * 86400000).toISOString().slice(0, 10);
export const daysBetween = (from, to) => Math.round((ms(dayOf(to)) - ms(dayOf(from))) / 86400000);

// 내 말이 '묻는 말'인가: 물음표가 있거나, 끝(마침표·느낌표·물결·ㅎ·ㅠ·웃음 표시 무시)이 묻는 말끝이거나, '궁금'이 들어 있다.
const Q_END = /(까요|나요|가요|는지요|는지|던가요|던가|인가요|인지요|있나요|없나요|됐나요|되나요|했나요|어때요|어때|어떤가요|어떠세요|어떻습니까|습니까|됩니까|입니까|합니까|십니까|었어요\?|았어요\?|죠\?)$/u;
export function isQuestion(text) {
  const t = String(text ?? '').trim();
  if (!t) return false;
  if (/[?？]/u.test(t) || /궁금/u.test(t)) return true;
  const tail = t.replace(/[\s.!~…ㅎㅋㅠㅜ^]+$/u, '');
  return Q_END.test(tail);
}

// 한 방·한 날의 메시지 줄([{at:'HH:MM', who:라벨, forwarded, text}], 시각 순)에서 '내가 묻고 → 그쪽이 답함'을 찾는다.
// whoOf(라벨) → {self:boolean, people:[주요 인물 id]}. 돌려주는 값: 답한 주요 인물 id 목록(처음 답한 순서, 겹침 없음).
// 규칙: 내 질문(전달 아님) 뒤에, 주요 인물(나 아님)이 보낸 전달 아닌 글이 있으면 그 사람은 답한 것. 질문 앞의 글·전달 글은 세지 않는다.
export function answeredBy(lines, whoOf) {
  const sorted = (lines || []).map((l, i) => ({...l, i})).sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')) || a.i - b.i);
  let asked = false;
  const out = [];
  for (const l of sorted) {
    const w = whoOf(l.who) || {self:false, people:[]};
    if (l.forwarded || !String(l.text ?? '').trim()) continue;
    if (w.self) { if (isQuestion(l.text)) asked = true; continue; }
    if (asked) for (const id of w.people || []) if (!out.includes(id)) out.push(id);
  }
  return out;
}

// 보낸 사람 이름표 → 라벨 판정 표. senders = {senders:[{id,name,auto_name,is_self}], links:[{room_key,day,label,sender_id}]}.
// 돌려주는 값: Map('방\0날' → Map(라벨 → {self, people})). 주요 인물 이름표가 있고 '나'도 있는 방·날만 남긴다(묻고 답할 수 있는 날).
export function talkDays(senders, people, from = '') {
  const out = new Map();
  if (!senders || !Array.isArray(senders.senders) || !people?.length) return out;
  const info = new Map();
  for (const s of senders.senders) {
    if (!s?.id) continue;
    info.set(s.id, s.is_self ? {self:true, people:[]} : {self:false, people:whoIn([s.name, s.auto_name], people)});
  }
  for (const l of senders.links || []) {
    const w = info.get(l?.sender_id), day = dayOf(l?.day);
    if (!w || !l.room_key || !day || (from && day < from)) continue;
    const k = `${l.room_key}\u0000${day}`, m = out.get(k) || new Map();
    m.set(l.label, w); out.set(k, m);
  }
  for (const [k, m] of out) {
    const vals = [...m.values()];
    if (!vals.some(v => v.self) || !vals.some(v => v.people.length)) out.delete(k);
  }
  return out;
}
export const splitKey = k => { const [room_key, day] = String(k).split('\u0000'); return {room_key, day}; };

// 사람 id → 그 사람이 주요 인물인 조직 id들.
export function orgsOfPeople(people) {
  const m = new Map();
  for (const p of people || []) if (p?.id && p.organization_id) m.set(p.id, [...(m.get(p.id) || []), p.organization_id]);
  return m;
}

// 업무 통화(손으로 고친 상대 반영 뒤. 개인 통화함은 읽지 않음) → 조직마다 가장 늦은 통화 날. Map(조직 → day).
export function lastCallDays(calls, people) {
  const orgs = orgsOfPeople(people), out = new Map();
  for (const r of calls || []) {
    if (!r?.id || r.hidden_at) continue;
    const day = dayOf(r.day || r.occurred_at); if (!day) continue;
    for (const pid of whoIn([r.counterpart, r.title], people)) for (const org of orgs.get(pid) || []) {
      if (!out.has(org) || out.get(org) < day) out.set(org, day);
    }
  }
  return out;
}

// 조직마다 마지막 연락 {day, via}를 합친다(늦은 날 우선, 같은 날이면 통화).
export function mergeLast(callDays, tgDays) {
  const out = new Map();
  for (const [org, day] of callDays || []) out.set(org, {day, via:'call'});
  for (const [org, day] of tgDays || []) { const cur = out.get(org); if (!cur || cur.day < day) out.set(org, {day, via:'telegram'}); }
  return out;
}

// 홈 줄에 올릴 조직: 주요 인물이 있는 내 담당조직 중 마지막 연락이 기준(주 수 × 7일) 이상 지난 곳. 기간 안에 하나도 없으면 days=null(180일+).
// unsure: 기준보다 오래된 텔레그램을 다 확인하지 못한 조직(기준 안 연락은 없다고 확인됨) → 날 수는 기준 일수 '이상'으로만 보인다.
// 정렬은 시안대로 덜 오래된 곳부터(같으면 이름).
export function quietList({orgs = [], people = [], last = new Map(), unsure = new Set(), today, weeks = DEFAULT_WEEKS} = {}) {
  if (!weeks) return {rows:[], skipped:0};
  const keyed = new Set((people || []).map(p => p.organization_id));
  const rows = [];
  let skipped = 0;
  for (const o of orgs || []) {
    if (!o?.id) continue;
    if (!keyed.has(o.id)) { skipped++; continue; }
    const l = last.get(o.id), days = l ? daysBetween(l.day, today) : null;
    if (l && days < weeks * 7) continue;
    if (unsure.has(o.id)) { rows.push({id:o.id, name:o.name || '', days:weeks * 7, day:'', via:'', unsure:true}); continue; }
    rows.push({id:o.id, name:o.name || '', days, day:l?.day || '', via:l?.via || '', unsure:false});
  }
  rows.sort((a, b) => (a.days ?? Infinity) - (b.days ?? Infinity) || String(a.name).localeCompare(String(b.name), 'ko'));
  return {rows, skipped};
}

// '25일' / '180일+' 꼴. 확인을 다 못 했으면 기준 일수 뒤에 '+'.
export const daysText = (row, lookback = LOOKBACK_DAYS) => row.days === null ? `${lookback}일+` : `${row.days}일${row.unsure ? '+' : ''}`;
// '10.3' 꼴(올해가 아니면 '25.10.3').
export function shortDay(day, today) {
  const d = dayOf(day); if (!d) return '';
  const [y, m, dd] = d.split('-');
  return (dayOf(today).slice(0, 4) === y ? '' : y.slice(2) + '.') + `${Number(m)}.${Number(dd)}`;
}
// 펼친 줄 가운데 글: '마지막 · 통화 10.3' / '180일 안 연락 없음' / '마지막 날 확인 못함'.
export const lastText = (row, today, lookback = LOOKBACK_DAYS) => row.unsure ? '마지막 날 확인 못함' : row.day ? `마지막 · ${VIA_LABEL[row.via] || ''} ${shortDay(row.day, today)}` : `${lookback}일 안 연락 없음`;
// 접힌 줄: 이름은 NAMES_MAX곳까지, 나머지는 '외 N곳'.
export function headParts(rows, max = NAMES_MAX) {
  return {shown:(rows || []).slice(0, max), more:Math.max(0, (rows || []).length - max)};
}
