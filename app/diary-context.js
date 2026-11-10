// JOURNAL-일기원드라이브 10.6 '그날 맥락' (docs/design/diary-onedrive.md 10.6, 2026-11-10 명진 결정 — 일정·회의만, 크게 보기 캡션 시각 맞춤,
// 사진 없는 날은 그리지 않음). 일기 날짜 상세의 사진 격자 아래 접힌 한 줄 '그날 맥락 · 일정 2 · 회의 1'(네이티브 <details>).
// 읽기는 업무일지가 날짜별로 모으는 것과 같은 함수(journal-data.js readWeekEvents·readWeekMeetings, 주 단위 한 번)를 그대로 부른다.
// 새 표·새 저장·새 Edge 함수 없음. 읽은 것은 이 화면 메모리에만 둔다(브라우저 저장 없음). 줄을 누르면 그 일정의 달력 수정 창·그 회의 창을 연다.
import {weekStart, readWeekEvents, readWeekMeetings, eventsOn, eventTime, meetingsOn, meetingName, ownerScope} from './journal-data.js';
import {seoulClock} from './meeting-time.js';
import {openGoogleEvent} from './event-open.js';
import {MEETING_SPAN_MS, contextSummary, entryText} from './diary-context-model.mjs';

// 주 단위 읽기 기억(작업공간·주별, 최근 몇 주만). 일정이 달력에서 바뀌면 일정 쪽만 다시 읽는다(forgetEvents).
const KEEP_WEEKS = 6;
const weeks = new Map();
const weekKey = (rt, start) => `${ownerScope(rt)}|${start}`;
function weekRead(rt, start) {
  const key = weekKey(rt, start);
  let got = weeks.get(key);
  if (!got) {
    got = {};
    weeks.set(key, got);
    while (weeks.size > KEEP_WEEKS) weeks.delete(weeks.keys().next().value);
  }
  // 실패한 읽기는 기억하지 않는다(다음에 그날을 열면 다시 읽는다).
  const keep = (name, read) => { if (!got[name]) got[name] = read().catch(error => { if (weeks.get(key) === got) got[name] = null; throw error; }); return got[name]; };
  return {events:keep('events', () => readWeekEvents(start, rt)), meetings:keep('meetings', () => readWeekMeetings(start, rt))};
}
// 달력에서 일정이 바뀌면(kptu:calendar-changed, diary.js가 듣는다) 일정 쪽 기억만 비운다.
export function forgetEvents() { for (const got of weeks.values()) got.events = null; }

const eventEntry = event => {
  const startMs = Date.parse(event.start), endMs = Date.parse(event.end || event.start);
  return {kind:'event', id:String(event.id ?? ''), calendarId:event.calendarId || 'primary', title:String(event.title || '').trim() || '(제목 없음)',
    time:eventTime(event), allDay:!!event.allDay, startMs, endMs:Number.isFinite(endMs) && endMs > startMs ? endMs : startMs};
};
const meetingEntry = meeting => {
  const startMs = Date.parse(meeting.meeting_at), clock = seoulClock(meeting.meeting_at), timed = !!clock && clock !== '00:00';
  return {kind:'meeting', id:String(meeting.id ?? ''), title:meetingName(meeting), time:timed ? clock : '', allDay:!timed, startMs, endMs:startMs + MEETING_SPAN_MS};
};

// 그날 일정·회의 → {entries:[일정…, 회의…], failed:['events'|'meetings']}. 한쪽이 실패해도 다른 쪽은 보인다.
export async function readDayContext(day, rt = window.KPTURuntime) {
  const read = weekRead(rt, weekStart(day));
  const [events, meetings] = await Promise.allSettled([read.events, read.meetings]);
  const entries = [
    ...(events.status === 'fulfilled' ? eventsOn(events.value, day).filter(event => event?.status !== 'cancelled').map(eventEntry) : []),
    ...(meetings.status === 'fulfilled' ? meetingsOn(meetings.value, day).map(meetingEntry) : []),
  ];
  return {entries, failed:[events.status === 'rejected' && 'events', meetings.status === 'rejected' && 'meetings'].filter(Boolean)};
}

// 접힌 한 줄 + 펼친 제목 목록. 일정·회의가 없으면 null(자리를 그리지 않는다, 빈 안내도 없음).
export function contextSection(entries) {
  const summary = contextSummary(entries);
  if (!summary) return null;
  const box = document.createElement('details');
  box.className = 'diary-ctx'; box.dataset.diaryContext = '';
  const head = document.createElement('summary');
  head.className = 'diary-ctx-head'; head.textContent = summary;
  const list = document.createElement('ul');
  list.className = 'diary-ctx-list';
  entries.forEach((entry, i) => {
    const li = document.createElement('li'), button = document.createElement('button');
    button.type = 'button'; button.className = 'row-act diary-ctx-line'; button.dataset.diaryContextOpen = String(i);
    const tag = document.createElement('span');
    tag.className = 'diary-ctx-kind'; tag.textContent = entry.kind === 'meeting' ? '회의' : '일정';
    button.append(tag, ' ', entryText(entry));
    button.setAttribute('aria-label', `${entry.kind === 'meeting' ? '회의' : '일정'} ${entryText(entry)} 열기`);
    li.append(button); list.append(li);
  });
  box.append(head, list);
  return box;
}

// 줄 하나를 연다: 일정은 달력의 수정 창(홈·업무일지와 같은 길), 회의는 회의 창(검색·할 일 레이더와 같은 길). 둘 다 이 화면 위에 열린다.
export async function openContextEntry(entry) {
  if (entry?.kind === 'event') return openGoogleEvent(entry.id, entry.calendarId);
  if (entry?.kind === 'meeting' && entry.id) {
    await window.KPTUViewLoader?.prepare?.('meetings');
    await import('./meeting-round-detail.js');
    if (!(await window.__KPTU_MEETING_ROUND_DETAIL_READY__)) throw new Error('meeting');
    await window.KPTUMeetingRoundDetail.open(entry.id);
    return true;
  }
  return false;
}
