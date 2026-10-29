// FEAT-1029묶음 ① Web2에 물어보기: 검색칸 답 상자의 순수 규칙(docs/design/ask-web2.md 1절). 그리는 곳은 global-search.js 하나.
// 질문 판별, 서버 답 검사(믿지 않는 입력), 근거 꼬리표 글자, 근거를 누르면 여는 곳. 화면·네트워크·기기 저장 없음.
import {openTarget} from './global-search-model.mjs';

export const ASK_MIN = 4, ASK_MAX = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REF = /^s[1-9]\d?$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ROOM = /^[A-Za-z0-9_.:-]{1,100}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const chars = s => [...String(s ?? '')].length;
const KINDS = ['update', 'note', 'work', 'document', 'meeting', 'project', 'organization', 'milestone', 'call', 'telegram', 'ledger'];
export const KIND_LABEL = Object.freeze({update: '업데이트', note: '노트', work: '업무일지', document: '자료', meeting: '회의', project: '사업영역',
  organization: '조직', milestone: '주요 일정', call: '통화', telegram: '텔레그램', ledger: '원장'});

// 물을 수 있는 글(한 줄 4~200자).
export function canAsk(text) {
  const q = String(text ?? '').trim();
  return chars(q) >= ASK_MIN && chars(q) <= ASK_MAX && !CONTROL.test(q);
}
// 질문처럼 보이나: 물음표로 끝남, 낱말 4개 이상, 또는 물음 말이 들어 있음. 그때만 결과 창 맨 위에 [Web2에 물어보기] 줄을 띄운다.
const ASKING = /(뭐|무엇|언제|왜|어떻게|누가|누구|얼마|어디|어느|무슨|했나|였지|었지|했지|인가|일까|였더라|었더라|됐나|있었나)/;
export function looksLikeQuestion(text) {
  const q = String(text ?? '').trim();
  if (!canAsk(q)) return false;
  return /[?？]$/.test(q) || q.split(/\s+/).filter(Boolean).length >= 4 || ASKING.test(q);
}

// 한 줄 상태 문구(말투 '~함. ~임.').
export const ASK_TEXT = Object.freeze({
  busy: '기록 찾고 답 쓰는 중',
  empty: '찾은 기록이 없음. 낱말을 바꿔 볼 것.',
  no_lines: '근거로 답을 만들지 못함.',
  monthly_limit: '이번 달 AI 한도에 걸림. 아래 검색 결과만 보임.',
  daily_limit: '오늘 물어보기 횟수를 다 씀.',
  failed: '답을 만들지 못함.',
  not_ready: '물어보기는 준비 중임.',
  session_required: '로그인이 필요함.',
  ask_secret: '비밀번호·키처럼 보이는 글은 물어볼 수 없음.',
  foot: 'AI가 찾은 기록을 요약한 것임. 원본을 눌러 확인할 것.',
});
// callAiAssist 실패 코드 → 한 줄. Edge 배포 전(모르는 쓰임·표 없음)이면 '준비 중'.
export function askFailText(code) {
  if (code === 'unsupported_kind' || code === 'ask_not_ready' || code === 'not_ready') return ASK_TEXT.not_ready;
  if (code === 'monthly_limit' || code === 'daily_limit' || code === 'session_required' || code === 'ask_secret') return ASK_TEXT[code];
  return ASK_TEXT.failed;
}
// callAiAssist에 넘기는 알려진 오류 코드(이 밖은 internal_error로 본다).
export const ASK_CODES = Object.freeze({unsupported_kind: 1, ask_not_ready: 1, ask_unavailable: 1, ask_secret: 1, monthly_limit: 1, daily_limit: 1,
  session_required: 1, invalid_request: 1, usage_unavailable: 1, ai_not_configured: 1, ai_busy: 1, ai_timeout: 1, internal_error: 1, forbidden: 1, auth_unavailable: 1});

const short = (v, n) => { const s = String(v ?? '').replace(/\s+/g, ' ').trim(); return chars(s) > n ? [...s].slice(0, n).join('') + '…' : s; };
const id = v => (typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : null);
const day = v => (typeof v === 'string' && DAY.test(v.slice(0, 10)) ? v.slice(0, 10) : null);

// 근거 한 줄 검사. 모르는 종류·id는 버린다.
export function cleanSource(raw) {
  if (!raw || typeof raw !== 'object' || !REF.test(String(raw.ref)) || !KINDS.includes(raw.kind) || !id(raw.id)) return null;
  return {ref: raw.ref, kind: raw.kind, source: typeof raw.source === 'string' ? raw.source : raw.kind, id: id(raw.id),
    date: day(raw.date), day: day(raw.day), room: typeof raw.room === 'string' && ROOM.test(raw.room) ? raw.room : null,
    project_id: id(raw.project_id), organization_id: id(raw.organization_id),
    title: short(raw.title, 80) || '(제목 없음)', snippet: short(raw.snippet, 160), sent: raw.sent !== false, tag: raw.tag === '교섭·전략' ? raw.tag : null};
}
// 서버 답(새 답·저장된 답 공용) 검사. 줄의 ref가 근거에 없으면 그 ref를 빼고, ref가 0개면 그 줄을 버린다(서버와 같은 규칙).
export function cleanAnswer(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const sources = (Array.isArray(raw.sources) ? raw.sources : []).map(cleanSource).filter(Boolean).slice(0, 30);
  const refs = new Set(sources.map(s => s.ref));
  const lines = (Array.isArray(raw.lines) ? raw.lines : []).slice(0, 6).map(l => ({
    text: typeof l?.text === 'string' ? short(l.text, 200) : '',
    refs: (Array.isArray(l?.refs) ? l.refs : []).filter(r => refs.has(r)).filter((r, i, a) => a.indexOf(r) === i).slice(0, 5),
  })).filter(l => l.text && l.refs.length);
  const status = typeof (raw.status ?? raw.ai_status) === 'string' ? (raw.status ?? raw.ai_status) : 'failed';
  return {id: id(raw.id), question: short(raw.question, 200), status, lines, sources, at: typeof raw.created_at === 'string' ? raw.created_at : null};
}
// 답 상자 첫 줄 아래 상태 한 줄. 정상 답이면 빈 글.
export function answerNote(answer) {
  if (!answer) return '';
  if (answer.status === 'ok') return answer.lines.length ? '' : ASK_TEXT.no_lines;
  return ASK_TEXT[answer.status] || ASK_TEXT.failed;
}

// 근거 꼬리표 글자: '회의 10/27'.
export function tagLabel(src) {
  const d = src?.date ? `${Number(src.date.slice(5, 7))}/${Number(src.date.slice(8, 10))}` : '';
  return [KIND_LABEL[src?.kind] || '', d].filter(Boolean).join(' ');
}
// 근거 묶음 요약: '근거 7건 — 회의 2 · 원장 2 · 통화 2'.
export function sourcesSummary(sources) {
  const counts = new Map();
  for (const s of sources || []) counts.set(s.kind, (counts.get(s.kind) || 0) + 1);
  const parts = [...counts].map(([k, n]) => `${KIND_LABEL[k] || k} ${n}`);
  return `근거 ${(sources || []).length}건${parts.length ? ' — ' + parts.join(' · ') : ''}`;
}

// 근거를 누르면 여는 곳. 검색 결과 줄과 같은 여는 길(openTarget) + 통화·텔레그램·원장.
export function sourceTarget(src) {
  if (!src) return null;
  if (src.kind === 'call') return {view: 'calls', id: src.id};
  if (src.kind === 'telegram') return src.room && src.day ? {view: 'telegram', room: src.room, day: src.day, item: src.id} : null;
  if (src.kind === 'ledger') return {view: 'ledger', id: src.id};
  return openTarget({source: src.source, kind: src.kind, id: src.id, day: src.day, project_id: src.project_id, organization_id: src.organization_id});
}

// 최근 물어본 것 줄 글자: '10/29 질문…'.
export function recentLabel(answer) {
  const t = Date.parse(answer?.at || '');
  const d = Number.isFinite(t) ? new Date(t + 9 * 3600 * 1000) : null;
  return `${d ? `${d.getUTCMonth() + 1}/${d.getUTCDate()} ` : ''}${short(answer?.question, 60)}`;
}
