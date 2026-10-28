// JOURNAL-오늘한줄초안 (요청함 10/29 01:28, 명진 '진행, 추천대로'): 업무일지 '오늘 한 줄'의 저녁 AI 초안 — 화면 쪽 순수 규칙.
// 초안은 서버(ai-assist kind=journal_draft)가 만들어 app_journal_drafts(owner RLS, 하루 1행)에 '확정 전'으로 둔다. 화면은 그날 한 줄이
// 하나도 없을 때만 입력칸에 흐린 글씨로 넣어 보여 주고, 명진이 고쳐 [저장]해야 업무일지 줄(kind=work)이 된다 — 그 전에는 주간보고 재료가 아니다.
// 여기서는 ① 보낼 때인지(오늘·18시 뒤·한 줄 없음·초안 없음) ② 그날 재료 줄(일정·한 일·회의·소식·업무 통화)을 정한다.
// 업무 통화는 업무 통화함(app_feed_items source=call)만 쓴다. 개인 통화함 표는 읽지도 보내지도 않는다.
export const DRAFT_HOUR = 18;
export const DRAFT_LINES = 60;
export const DRAFT_LINE_CHARS = 160;

const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2028\u2029\u2060-\u2069]+/g;
const clean = text => [...String(text ?? '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim()].slice(0, DRAFT_LINE_CHARS).join('').trim();
const firstLine = text => String(text ?? '').split(/\r?\n/).map(line => line.trim()).find(Boolean) || '';

// 보낼 때인가: 오늘(한국 날짜)·18시 뒤·그날 한 줄 없음·초안 표가 있고 그날 초안 없음·이번 방문에 아직 안 물어봄.
export function shouldAskDraft({day, today, hour, hasLine, drafts, asked}) {
  return day === today && hour >= DRAFT_HOUR && !hasLine && !!drafts && !drafts.missing && !drafts.map?.has(day) && !asked;
}
// 보여 줄 초안: 그날 한 줄이 하나도 없을 때만(이미 적은 줄은 덮지 않음).
export const draftFor = (drafts, day, hasLine) => (!hasLine && drafts && !drafts.missing ? drafts.map?.get(day) || '' : '');

// 업무 통화 한 줄: "14:20 상대 · 제목(없으면 요약 첫 줄)".
export function callLine(row, clock = '') {
  const who = String(row?.counterpart ?? '').trim(), what = String(row?.title ?? '').trim() || firstLine(row?.summary);
  return clean([clock, [who, what].filter(Boolean).join(' · ')].filter(Boolean).join(' ')) || '';
}

// 그날 재료 줄: 하루 카드(journal-data.js dayCard)와 그날 업무 통화에서. 꼬리표 [일정]·[한 일]·[회의·활동]·[사업 소식]·[조직 소식]·[메모]·[업무 통화].
// 할 일 예정·자료실·공유 페이지 등은 '한 일'이 아니라 넣지 않는다. 최대 60줄, 줄마다 160자.
// 업무 통화는 하루 카드의 '업무 통화' 묶음(그 밖의 기록) 줄 {text, callSummary}에서 온다.
export function draftMaterial(card) {
  const out = [];
  const add = (tag, text) => { const line = clean(`[${tag}] ${text}`); if (line.length > tag.length + 3) out.push(line); };
  for (const item of card?.events?.items || []) add('일정', item.text);
  for (const item of card?.tasks?.done || []) add('한 일', item.text);
  for (const part of card?.report || []) {
    if (part.key === 'activities') for (const item of part.items || []) { if (!item.hidden) add('회의·활동', item.summary ? `${item.text} — ${item.summary}` : item.text); }
    else for (const section of part.sections || []) for (const text of section.items || []) add(part.key === 'business' ? '사업 소식' : '조직 소식', `${section.name} · ${text}`);
  }
  for (const part of card?.others || []) {
    if (part.key === 'memos') for (const item of part.items || []) add('메모', item.text);
    if (part.key === 'calls') for (const item of part.items || []) add('업무 통화', item.callSummary ? `${item.text} — ${firstLine(item.callSummary)}` : item.text);
  }
  return [...new Set(out)].slice(0, DRAFT_LINES);
}
