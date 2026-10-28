// FEAT-1029묶음 ④ 성명·보도자료 초안 — 화면 쪽 순수 함수(docs/design/feature-bundle-1029.md 4절, 시안 docs/design/mockups/press-draft.html).
// 서버(ai-assist kind=press_draft)의 답을 다시 검사하고, [노트로 저장]에 쓸 노트 제목·본문(근거 목록 포함)을 만든다. 네트워크·저장 없음.
export const PRESS_TYPES = Object.freeze([{value:'statement', label:'성명'}, {value:'release', label:'보도자료'}]);
export const PRESS_MAX_PICK = 5;
export const PRESS_DIRECTION_MAX = 80;
export const PRESS_FOLDER_NAME = '성명 초안';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const str = (v, max) => typeof v === 'string' && v.trim() && [...v].length <= max ? v.trim() : '';
export const typeLabel = type => PRESS_TYPES.find(t => t.value === type)?.label || '성명';
export const shortDay = day => { const m = String(day || '').match(/^\d{4}-(\d{2})-(\d{2})$/); return m ? `${Number(m[1])}.${Number(m[2])}` : ''; };

// 요청 몸통: 종류·고른 ID(1~5, 고른 순서)·한 줄 방향(빈 글이면 보내지 않음). 근거 글은 보내지 않는다.
export function pressRequest(type, ids, direction) {
  const picked = [...new Set((ids || []).map(id => String(id).toLowerCase()))].filter(id => UUID.test(id)).slice(0, PRESS_MAX_PICK);
  const dir = String(direction ?? '').replace(/\s+/g, ' ').trim().slice(0, PRESS_DIRECTION_MAX);
  return {kind:'press_draft', type:type === 'release' ? 'release' : 'statement', meeting_ids:picked, ...(dir ? {direction:dir} : {})};
}

// 서버 답 검사. 모양이 틀리면 null. 근거 번호는 돌려받은 근거 목록 안의 것만 남긴다(밖이면 그 번호만 버림).
export function parsePressAnswer(data) {
  if (!data || typeof data !== 'object' || data.kind !== 'press_draft') return null;
  const sources = Array.isArray(data.sources) ? data.sources.filter(s => s && Number.isSafeInteger(s.ref) && s.ref >= 1 && s.ref <= PRESS_MAX_PICK
    && UUID.test(String(s.meeting_id)) && typeof s.title === 'string' && (s.day === '' || DAY.test(String(s.day)))).map(s => ({ref:s.ref, meeting_id:String(s.meeting_id).toLowerCase(), title:s.title.trim().slice(0, 120) || '사업 보고', day:s.day})) : [];
  const known = new Set(sources.map(s => s.ref));
  const lines = (list, max) => (Array.isArray(list) ? list : []).map(p => ({text:str(p?.text, max), refs:[...new Set((Array.isArray(p?.refs) ? p.refs : []).filter(r => known.has(r)))]}))
    .filter(p => p.text && p.refs.length);
  const title = str(data.title, 80), paragraphs = lines(data.paragraphs, 700);
  if (!title || !paragraphs.length || !sources.length) return null;
  return {type:data.type === 'release' ? 'release' : 'statement', title, subtitle:str(data.subtitle, 120), paragraphs, demands:lines(data.demands, 160),
    checks:(Array.isArray(data.checks) ? data.checks : []).map(c => str(c, 120)).filter(Boolean).slice(0, 10), sources, partial:data.partial === true};
}

const refTag = refs => refs.map(r => `[근거 ${r}]`).join(' ');
// [노트로 저장]의 노트: 제목 = 초안 제목, 본문 = 머리 줄(AI 초안·사실 확인 전) + 부제 + 문단(근거 번호) + 요구 + 확인할 것 + 근거 목록.
export function pressNote(draft) {
  const out = [`[${typeLabel(draft.type)} 초안 · AI 초안 · 사실 확인 전]`, ''];
  if (draft.subtitle) out.push(draft.subtitle, '');
  for (const p of draft.paragraphs) out.push(`${p.text} ${refTag(p.refs)}`, '');
  if (draft.demands.length) { out.push('요구'); for (const d of draft.demands) out.push(`- ${d.text} ${refTag(d.refs)}`); out.push(''); }
  if (draft.checks.length) { out.push('확인할 것'); draft.checks.forEach((c, i) => out.push(`${i + 1}. ${c}`)); out.push(''); }
  out.push('근거');
  for (const s of draft.sources) out.push(`${s.ref}. 사업 보고 · ${s.title}${s.day ? ` · ${shortDay(s.day)}` : ''}`);
  return {title:[...draft.title].slice(0, 200).join(''), raw_text:out.join('\n')};
}

// 고르기 목록의 한 줄(사업 보고): 제목(회차 포함) · 칸 · 날짜.
export function meetingPickLine(m, kindLabel = () => '') {
  const name = String((m?.series_name && String(m.series_name).trim()) || m?.title || '').trim() || '사업 보고';
  const round = m?.round_no != null && Number.isFinite(Number(m.round_no)) ? ` ${Number(m.round_no)}차` : '';
  const t = Date.parse(m?.meeting_at || '');
  const day = Number.isFinite(t) ? new Date(t + 9 * 3600e3).toISOString().slice(0, 10) : '';
  return {id:String(m?.id || '').toLowerCase(), name:name + round, meta:[kindLabel(m), shortDay(day)].filter(Boolean).join(' · ')};
}
