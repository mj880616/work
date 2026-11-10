// JOURNAL-일기원드라이브 10.6 '그날 맥락' (docs/design/diary-onedrive.md 10.6, 2026-11-10 명진 결정): 사진 있는 날의 일정·회의를
// 보여 주기만 하는 규칙(화면·읽기는 diary-context.js). 새 저장 없음, AI가 사진을 읽지 않음, 일기 글에 쓰지 않음.
//   ① 붙이는 것은 일정(Google Calendar)과 회의(Web2 회의 기록)뿐 — 끝낸 할 일·메모는 붙이지 않는다.
//   ② 크게 보기 캡션: 찍은 시각이 일정·회의 시간 안이면 "14:20 ○○ 회의 중" 한 줄. 찍은 시각이 없거나 대략(approx)인 사진은 생략.
//   ③ 사진 없는 날에는 맥락을 그리지 않는다(diary.js가 사진 있는 날에만 자리를 만든다).
// 항목 모양(entry): {kind:'event'|'meeting', id, calendarId?, title, time('HH:MM'|'종일'), startMs, endMs, allDay}

// 회의 기록에는 끝 시각이 없다. 회의 시각부터 이만큼을 '회의 중'으로 본다.
export const MEETING_SPAN_MS = 2 * 60 * 60 * 1000;
const SEOUL_MS = 9 * 60 * 60 * 1000;

// 접힌 한 줄: '그날 맥락 · 일정 2 · 회의 1'. 둘 다 없으면 ''(그리지 않음).
export function contextSummary(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const events = list.filter(e => e?.kind === 'event').length, meetings = list.filter(e => e?.kind === 'meeting').length;
  if (!events && !meetings) return '';
  return ['그날 맥락', events ? `일정 ${events}` : '', meetings ? `회의 ${meetings}` : ''].filter(Boolean).join(' · ');
}

// 펼친 목록의 한 줄 글자: '14:00 ○○ 회의'(종일 일정은 '종일 ○○').
export const entryText = entry => `${entry?.time ? entry.time + ' ' : ''}${String(entry?.title ?? '').trim() || '(제목 없음)'}`;

// 찍은 시각(ms). 시각이 없거나 대략(파일 생성 시각으로 대신한 것)이면 null.
export function takenMs(item) {
  if (!item || item.approx === true) return null;
  const ms = Date.parse(item.taken_at || '');
  return Number.isFinite(ms) ? ms : null;
}
const seoulHhmm = ms => new Date(ms + SEOUL_MS).toISOString().slice(11, 16);

// 크게 보기 캡션 한 줄. 찍은 시각을 품은 시간 일정·회의 중 가장 늦게 시작한 것(가장 좁은 자리) 하나. 종일 일정은 맞추지 않는다.
// 같은 시각에 시작하면 회의(Web2 기록)를 먼저. 맞는 것이 없으면 ''.
export function photoContextLine(item, entries) {
  const at = takenMs(item);
  if (at === null || !Array.isArray(entries)) return '';
  const hits = entries.filter(e => e && !e.allDay && Number.isFinite(e.startMs) && Number.isFinite(e.endMs) && e.startMs <= at && at < e.endMs);
  if (!hits.length) return '';
  hits.sort((a, b) => b.startMs - a.startMs || (a.kind === 'meeting' ? -1 : 0) - (b.kind === 'meeting' ? -1 : 0));
  return `${seoulHhmm(at)} ${String(hits[0].title ?? '').trim() || '(제목 없음)'} 중`;
}
