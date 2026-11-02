// 공유 페이지 AI 초안(원장 빠짐32) — 화면 쪽 순수 함수. 서버(ai-assist kind=share_draft)에 보낼 몸통을 만들고, 답을 다시 검사하고,
// [넣기]로 본문에 들어갈 편집기 문서 조각(ed1 블록)을 만든다. 네트워크·저장 없음.
// 근거 번호·'확인할 것'은 미리보기에만 보이고 본문에는 들어가지 않는다(공유 페이지는 바깥 사람이 읽는다).
import {cleanDoc} from './ed-schema.mjs';

export const SHARE_AI_MAX_PICK = 6;
export const SHARE_AI_FOCUS_MAX = 80;
export const SHARE_AI_SECTIONS = Object.freeze([
  {key:'summary', label:'한 줄 현황', max:2},
  {key:'steps', label:'진행 단계', max:8},
  {key:'schedule', label:'일정', max:8},
  {key:'issues', label:'쟁점·요구', max:8},
  {key:'updates', label:'업데이트 기록', max:8},
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TYPES = ['meeting', 'note'];
const str = (v, max) => typeof v === 'string' && v.trim() && [...v].length <= max ? v.trim() : '';
export const shortDay = day => { const m = String(day || '').match(/^\d{4}-(\d{2})-(\d{2})$/); return m ? `${Number(m[1])}.${Number(m[2])}` : ''; };
const kstDay = iso => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? new Date(t + 9 * 3600e3).toISOString().slice(0, 10) : ''; };

// 고른 기록 열쇠: 'meeting:<id>' | 'note:<id>'.
export const pickKey = (type, id) => `${type}:${String(id || '').toLowerCase()}`;
export function splitKey(key) {
  const s = String(key || ''), i = s.indexOf(':');
  const type = s.slice(0, i), id = s.slice(i + 1).toLowerCase();
  return TYPES.includes(type) && UUID.test(id) ? {type, id} : null;
}

// 요청 몸통: 고른 기록(종류+ID, 1~6, 고른 순서)·한 줄 초점(빈 글이면 보내지 않음). 기록 글은 보내지 않는다.
export function shareDraftRequest(keys, focus) {
  const seen = new Set(), sources = [];
  for (const k of keys || []) { const p = splitKey(k); if (!p) continue; const kk = pickKey(p.type, p.id); if (seen.has(kk)) continue; seen.add(kk); sources.push(p); }
  const f = String(focus ?? '').replace(/\s+/g, ' ').trim().slice(0, SHARE_AI_FOCUS_MAX);
  return {kind:'share_draft', sources:sources.slice(0, SHARE_AI_MAX_PICK), ...(f ? {focus:f} : {})};
}

// 서버 답 검사. 모양이 틀리거나 근거 있는 줄이 하나도 없으면 null. 근거 번호는 돌려받은 근거 목록 안의 것만 남긴다.
export function parseShareDraftAnswer(data) {
  if (!data || typeof data !== 'object' || data.kind !== 'share_draft' || !data.sections || typeof data.sections !== 'object') return null;
  const sources = (Array.isArray(data.sources) ? data.sources : []).filter(s => s && Number.isSafeInteger(s.ref) && s.ref >= 1 && s.ref <= SHARE_AI_MAX_PICK
    && TYPES.includes(s.type) && UUID.test(String(s.id)) && (s.day === '' || DAY.test(String(s.day))))
    .map(s => ({ref:s.ref, type:s.type, id:String(s.id).toLowerCase(), label:str(s.label, 20) || (s.type === 'meeting' ? '사업 보고' : '노트'), title:str(s.title, 120) || '', day:s.day}));
  const known = new Set(sources.map(s => s.ref));
  const sections = {};
  let total = 0;
  for (const sec of SHARE_AI_SECTIONS) {
    const list = Array.isArray(data.sections[sec.key]) ? data.sections[sec.key] : [];
    sections[sec.key] = list.map(l => ({text:str(l?.text, 300), refs:[...new Set((Array.isArray(l?.refs) ? l.refs : []).filter(r => known.has(r)))]}))
      .filter(l => l.text && l.refs.length).slice(0, sec.max);
    total += sections[sec.key].length;
  }
  if (!total || !sources.length) return null;
  const checks = (Array.isArray(data.checks) ? data.checks : []).map(c => str(c, 120)).filter(Boolean).slice(0, 8);
  const skipped = Number.isSafeInteger(data.skipped) && data.skipped > 0 ? data.skipped : 0;
  return {sections, checks, sources, partial:data.partial === true, skipped};
}

// 처음에 고른 칸: 줄이 있는 칸 모두.
export const filledKeys = draft => SHARE_AI_SECTIONS.filter(s => draft?.sections?.[s.key]?.length).map(s => s.key);

const text = t => [{type:'text', text:t}];
const para = t => ({type:'paragraph', attrs:{style:'body2'}, content:text(t)});
// [넣기]로 들어갈 블록: 고른 칸마다 제목(제목 2) + 한 줄 현황은 문단, 나머지는 글머리 목록. 근거 번호·확인할 것은 넣지 않는다.
export function draftNodes(draft, keys) {
  const want = new Set(keys || []), content = [];
  for (const sec of SHARE_AI_SECTIONS) {
    const lines = want.has(sec.key) ? draft?.sections?.[sec.key] || [] : [];
    if (!lines.length) continue;
    content.push({type:'heading', attrs:{level:2}, content:text(sec.label)});
    if (sec.key === 'summary') lines.forEach(l => content.push(para(l.text)));
    else content.push({type:'bullet_list', content:lines.map(l => ({type:'list_item', content:[para(l.text)]}))});
  }
  if (!content.length) return [];
  return cleanDoc({type:'doc', content}).doc.content;
}

// 고르기 목록 한 줄. 사업 보고: 제목(회차) · 칸 · 날짜. 노트·업데이트: 제목(없으면 본문 첫 줄) · 종류 · 날짜.
export function meetingLine(m, kindLabel = () => '') {
  const name = String((m?.series_name && String(m.series_name).trim()) || m?.title || '').trim() || '사업 보고';
  const round = m?.round_no != null && Number.isFinite(Number(m.round_no)) ? ` ${Number(m.round_no)}차` : '';
  return {key:pickKey('meeting', m?.id), name:name + round, meta:['사업 보고', kindLabel(m), shortDay(kstDay(m?.meeting_at))].filter(Boolean).join(' · ')};
}
export function noteLine(n) {
  const first = String(n?.raw_text || '').split('\n').map(s => s.trim()).find(Boolean) || '';
  const name = [...(String(n?.title || '').trim() || first || '(빈 글)')].slice(0, 80).join('');
  return {key:pickKey('note', n?.id), name, meta:[n?.kind === 'basket' ? '업데이트' : '노트', shortDay(kstDay(n?.occurred_at || n?.updated_at))].filter(Boolean).join(' · ')};
}
