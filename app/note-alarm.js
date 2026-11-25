// S69-97 노트 알림(NOTE-에버노트 ②): 노트 ⋯ [알림 걸기…]·읽기 화면 알림 줄에서 여는 작은 고르기창.
// 빠른 고르기(오늘 저녁 6시·내일 아침 9시·금요일 9시·다음 주 월요일 9시) · [날짜·시각 고르기…](달력 + 시각) · 걸려 있으면 [알림 끄기].
// 저장은 basket-data.js setNoteAlarm(노트 metadata.alarm, 서버 저장, 기기 저장 없음). 폰 알림은 서버가 그 시각에 보낸다(phone-push).
import {askChoice, askDateTime} from './small-notice.js';
import {setNoteAlarm} from './basket-data.js';
import {alarmLabel, alarmPast, checkAlarm, kstDay, kstIso, kstTime, noteAlarmAt, quickAlarms} from './note-alarm-model.mjs';

const BELL = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15Z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>';

// 읽기 화면 알림 줄 글자: '알림 11/27(금) 09:00' / '지난 알림 11/24(월) 09:00'. 없으면 ''.
export function alarmLine(note, now = Date.now()) {
  const at = noteAlarmAt(note); if (!at) return '';
  return `${alarmPast(at, now) ? '지난 알림' : '알림'} ${alarmLabel(at, now)}`;
}

// 고르기창을 열고 저장한다. 반환: 저장된 노트 행 {id, updated_at, metadata} · 그대로면 null. 실패는 error를 던진다(부른 쪽이 한 줄로 알림).
export async function openNoteAlarm(anchor, note, {rt = window.KPTURuntime, now = Date.now()} = {}) {
  const at = noteAlarmAt(note), quick = quickAlarms(now);
  const choices = [
    ...quick.map(q => ({value: q.at, label: q.label, note: alarmLabel(q.at, now), icon: BELL})),
    {value: 'pick', label: '날짜·시각 선택…', note: '달력에서 선택'},
    ...(at ? [{value: 'off', label: '알림 끄기', note: `${alarmPast(at, now) ? '지난 알림' : '지금'} ${alarmLabel(at, now)}`, danger: true}] : []),
  ];
  const picked = await askChoice(anchor, {text: '이 노트를 언제 다시 볼까요?', choices, foot: '그 시각에 폰으로 알려요(폰 앱 알림을 켠 기기).'});
  if (!picked) return null;
  let next = picked;
  if (picked === 'pick') {
    const base = at && !alarmPast(at, now) ? Date.parse(at) : now + 86400000;
    const got = await askDateTime(anchor, {text: '알림 날짜와 시각', day: kstDay(base), time: at && !alarmPast(at, now) ? kstTime(base) : '09:00', ok: '저장'});
    if (!got) return null;
    next = kstIso(got.day, got.time);
    const bad = next ? checkAlarm(next, Date.now()) : '날짜와 시각을 확인해 주세요.';
    if (bad) throw new Error(bad);
  }
  const saved = await setNoteAlarm(note, next === 'off' ? null : next, rt);
  return saved;
}
