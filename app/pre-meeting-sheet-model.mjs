// FEAT-1029묶음 ② 교섭·회의 전 한 장 — 화면 쪽 순수 규칙(설계 docs/design/pre-meeting-sheet.md, 명진 결정 10/29 '모두 추천대로').
// - 대상(결정 1): 담당조직이 연결된 일정 중 제목에 교섭·회의·간담회·협의·면담이 있는 것. 연결이 없으면 제목에 조직 이름이 정확히 하나 맞을 때만.
// - 때(결정 2): 전날 18시(서울) 뒤 업무일지·홈을 열면 내일 대상마다 한 번(서버도 같은 규칙을 다시 본다) + 언제든 [지금 만들기](7일 안).
// - 모양: 다음 주 준비 한 장과 같은 공용 그리기(prep-sheet-view.js)에 넘길 view를 만든다. 줄은 한 번 더 검사한다(믿지 않는 입력).
// 기기 저장 없음.
export const KEYWORDS = Object.freeze(['교섭', '회의', '간담회', '협의', '면담']);
export const AUTO_HOUR = 18;
export const SHOW_DAYS = 7; // 여는 줄은 앞으로 7일 안 일정에만.
export const GROUPS = Object.freeze([
  ['meetings', '① 지난 교섭·회의 결과'], ['issues', '② 남은 쟁점'], ['counterpart', '③ 상대'], ['commitments', '④ 우리 약속'],
  ['feed', '⑤ 최근 통화·텔레그램'], ['people', '⑥ 주요 인물'], ['docs', '⑦ 관련 자료'],
]);
const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9_.:@#-]{3,600}$/;
const seoul = ms => new Date(ms + 9 * 3600 * 1000);
export const seoulDay = ms => seoul(ms).toISOString().slice(0, 10);
export const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
export const slashDay = day => DAY.test(day || '') ? `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}(${WEEKDAY[new Date(`${day}T00:00:00Z`).getUTCDay()]})` : '';
const hm = ms => { const d = seoul(ms); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
const clip = (s, n) => { const a = [...String(s ?? '')]; return a.length > n ? a.slice(0, n - 1).join('') + '…' : a.join(''); };
const clean = s => String(s ?? '').replace(/[\s·.,()[\]]/g, '');

export const isMeetingTitle = title => KEYWORDS.some(k => String(title || '').includes(k));
// 일정 키: 캘린더 id + 일정 id(서버 표의 한 행). 맞지 않으면 ''.
export function eventKey(event) {
  const key = `${event?.calendarId || 'primary'}:${event?.id || ''}`;
  return event?.id && KEY.test(key) ? key : '';
}
// 일정의 시작 시각(ms). 종일 일정은 그날 0시(서울).
export const startMs = event => {
  const s = String(event?.start || '');
  return DAY.test(s) ? Date.parse(`${s}T00:00:00+09:00`) : Date.parse(s);
};
const isoOf = (v, allDay) => {
  const s = String(v || '');
  if (DAY.test(s)) return `${s}T00:00:00+09:00`;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

// 이 일정의 담당조직(결정 1). 연결이 있으면 내 조직 목록에 있는 첫 연결, 없으면 제목에 이름이 정확히 하나 맞는 조직. 없으면 null.
export function eventOrg(event, orgs) {
  const list = (Array.isArray(orgs) ? orgs : []).filter(o => UUID.test(String(o?.id || '')));
  const linked = (Array.isArray(event?.organizationIds) ? event.organizationIds : []).map(id => String(id).toLowerCase());
  for (const id of linked) { const hit = list.find(o => String(o.id).toLowerCase() === id); if (hit) return hit; }
  if (linked.length) return null;
  const title = clean(event?.title);
  if (!title) return null;
  const hits = list.filter(o => [o.name, ...(Array.isArray(o.aliases) ? o.aliases : [])].some(n => clean(n).length >= 2 && title.includes(clean(n))));
  return hits.length === 1 ? hits[0] : null;
}
// 한 장 대상인가: 담당조직이 있고, 제목 낱말이 있고, 취소·개인 일정이 아님.
export function target(event, orgs) {
  if (!event || event.status === 'cancelled' || !isMeetingTitle(event.title)) return null;
  const key = eventKey(event), org = eventOrg(event, orgs), at = startMs(event);
  if (!key || !org || !Number.isFinite(at)) return null;
  return {key, org, at, event};
}
// 서버에 보낼 일정 값({event_key,title,start,end,location}).
export function eventBody(event) {
  const title = clip(String(event?.title || '').replace(/\s+/g, ' ').trim(), 300) || '(제목 없음)';
  const location = clip(String(event?.location || '').replace(/\s+/g, ' ').trim(), 300) || null;
  const start = isoOf(event?.start), endRaw = isoOf(event?.end);
  const end = endRaw && start && Date.parse(endRaw) >= Date.parse(start) ? endRaw : null;
  return {event_key:eventKey(event), title, start, end, location};
}
// 18시 뒤 자동으로 만들 내일 대상들(이미 물어본 일정·이미 있는 장은 뺀다). now: ms.
export function autoTargets({events, orgs, now = Date.now(), have = new Set(), asked = new Set()}) {
  if (seoul(now).getUTCHours() < AUTO_HOUR) return [];
  const tomorrow = addDays(seoulDay(now), 1), out = [], seen = new Set();
  for (const e of Array.isArray(events) ? events : []) {
    const t = target(e, orgs);
    if (!t || seoulDay(t.at) !== tomorrow || seen.has(t.key) || have.has(t.key) || asked.has(t.key)) continue;
    seen.add(t.key); out.push(t);
  }
  return out.slice(0, 10);
}
// 여는 줄을 보일까: 대상이고 지금부터 7일 안(막 시작한 6시간까지).
export function showLine(event, orgs, now = Date.now()) {
  const t = target(event, orgs);
  return !!t && t.at >= now - 6 * 3600 * 1000 && t.at <= now + SHOW_DAYS * 86400000 ? t : null;
}

const madeText = at => { const t = Date.parse(at || ''); return Number.isFinite(t) ? `${slashDay(seoulDay(t))} ${hm(t)} 만듦` : ''; };
// 일정 머리 줄: '내일 11/3(화) 14:00 · 본사 회의실'.
export function whenText(row, now = Date.now()) {
  const at = Date.parse(row?.event_start || '');
  if (!Number.isFinite(at)) return '';
  const day = seoulDay(at), today = seoulDay(now);
  const rel = day === today ? '오늘 ' : day === addDays(today, 1) ? '내일 ' : '';
  return `${rel}${slashDay(day)} ${hm(at)}${row?.event_location ? ` · ${row.event_location}` : ''}`;
}
// 묶음 한 줄 요약(접혀 있어도 보임).
export function groupSummary(key, items) {
  const n = items.length, first = items[0];
  if (key === 'meetings') return `${n}건 — 최근 ${first.title}${first.day ? `(${slashDay(first.day)})` : ''}`;
  if (key === 'issues' || key === 'counterpart') return `${n}건 — ${items.slice(0, 2).map(it => it.title).join(' · ')}`;
  if (key === 'commitments') { const d = items.map(it => it.day).filter(Boolean).sort()[0]; return `${n}건${d ? ` — 가장 이른 것 ${slashDay(d)}` : ''}`; }
  if (key === 'feed') { const c = items.filter(it => it.source_kind === 'call').length; return `${n}건 — 통화 ${c} · 텔레그램 ${n - c} (최근 30일)`; }
  if (key === 'people') { const names = items.filter(it => it.source_kind === 'person'); const brief = items.find(it => it.source_kind === 'people_brief'); return `${names.length}명${brief ? ` — ${brief.title}` : ''}`; }
  return `${n}건`;
}
// 저장된 장(서버 행) → 공용 그리기의 view. event: 지금 화면이 아는 일정(있으면 바뀜 표시).
export function sheetView(row, event = null) {
  const raw = Array.isArray(row?.groups) ? row.groups : [];
  const items = raw.map((g, index) => ({...g, index}))
    .filter(g => typeof g?.title === 'string' && g.title.trim() && (g.group === 'stage' || GROUPS.some(([key]) => key === g.group)));
  const valid = new Set(items.filter(it => it.source_kind !== 'ai').map(it => it.index));
  const refsOf = list => (Array.isArray(list) ? list : []).filter(n => valid.has(n));
  const shown = it => ({index:it.index, day:it.day ? slashDay(it.day) : '', title:clip(it.title, 120), ai:it.source_kind === 'ai', refs:refsOf(it.refs),
    open:!['people_brief', 'stage', 'ai'].includes(it.source_kind), org:it.s2 ? '교섭·전략' : '', source_kind:it.source_kind, rawDay:it.day});
  const groups = GROUPS.map(([key, label]) => {
    const mine = items.filter(it => it.group === key).sort((a, b) => (a.source_kind === 'ai' ? 0 : 1) - (b.source_kind === 'ai' ? 0 : 1)).map(shown);
    return mine.length ? {key, label, items:mine, summary:groupSummary(key, mine.map(it => ({...it, day:it.rawDay})))} : null;
  }).filter(Boolean);
  const top = (Array.isArray(row?.top_lines) ? row.top_lines : []).slice(0, 3)
    .filter(t => typeof t?.text === 'string' && t.text.trim()).map(t => ({text:clip(t.text, 80), refs:refsOf(t.refs)}));
  const stage = items.find(it => it.group === 'stage');
  const aiNote = row?.ai_status === 'limit' ? '핵심 세 가지는 AI 한도로 만들지 못함.'
    : row?.ai_status === 'failed' ? '핵심 세 가지는 AI가 답하지 않아 만들지 못함.' : '';
  let changed = '';
  if (event) {
    const body = eventBody(event);
    if ((body.start && Date.parse(body.start) !== Date.parse(row?.event_start || '')) || (body.title && body.title !== row?.event_title)) changed = '일정 시간·제목이 바뀜. [다시 만들기]로 새로 만들 수 있음.';
  }
  return {made:madeText(row?.updated_at || row?.created_at), top, groups, aiNote, empty:!groups.length, changed, stage:stage ? stage.title : ''};
}
// 줄 → 원래 기록. 회의 → 사업 보고, 원장 → 원장, 통화 → 통화 상세, 텔레그램 → 그 방 그날, 주요 인물 → 담당조직 [주요 인물], 자료 → 자료실.
export function openTarget(it) {
  if (!it || typeof it.source_id !== 'string') return null;
  if (it.source_kind === 'meeting') return {type:'meeting', id:it.source_id};
  if (it.source_kind === 'ledger') return {type:'ledger', id:it.source_id};
  if (it.source_kind === 'call' || it.source_kind === 'telegram') return {type:'feed', id:it.source_id, kind:it.source_kind, day:it.day || null};
  if (it.source_kind === 'person') return {type:'people'};
  if (it.source_kind === 'document') return {type:'document', id:it.source_id};
  return null;
}
// 담당조직 상세의 두 줄: 다가오는 교섭(7일 안, 가장 이른 것 — 장 또는 일정)과 지난 한 장 n.
export function orgLines({sheets, events = [], orgs = [], orgId, now = Date.now()}) {
  const id = String(orgId || '').toLowerCase();
  const rows = (Array.isArray(sheets) ? sheets : []).filter(r => String(r?.organization_id || '').toLowerCase() === id && Number.isFinite(Date.parse(r?.event_start || '')));
  const upcoming = [];
  for (const r of rows) { const at = Date.parse(r.event_start); if (at >= now - 6 * 3600 * 1000 && at <= now + SHOW_DAYS * 86400000) upcoming.push({key:r.event_key, at, title:r.event_title, row:r, event:null}); }
  for (const e of Array.isArray(events) ? events : []) {
    const t = showLine(e, orgs, now);
    if (!t || String(t.org.id).toLowerCase() !== id) continue;
    const have = upcoming.find(u => u.key === t.key);
    if (have) have.event = e; else upcoming.push({key:t.key, at:t.at, title:e.title, row:null, event:e});
  }
  upcoming.sort((a, b) => a.at - b.at);
  const past = rows.filter(r => Date.parse(r.event_start) < now - 6 * 3600 * 1000).sort((a, b) => Date.parse(b.event_start) - Date.parse(a.event_start));
  return {next:upcoming[0] || null, past};
}
export const lineText = next => next ? `다가오는 교섭 ${slashDay(seoulDay(next.at))} ${hm(next.at)} — 한 장 ›` : '';
