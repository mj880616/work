// MULTI-노조사용자 ②-3(D5, S50-13): 주간 정리 '주요 일정'의 업무 캘린더 이름 — 사람마다 따로, 내 프로필 화면 기억
// (app_profiles.view_prefs.report_calendar, view-prefs.js)에 있다. 이 파일이 그 이름을 읽는 한 곳이고, 주간 정리 표(journal-weekly.js)·
// .hwpx 초안(journal-hwpx.js)·일정 만들기 기본 캘린더(calendar-plus.js·project-system-v3.js는 같은 값을 window.KPTUViewPrefs로 읽는다)가 같은 값을 쓴다.
// S71-34 PROFILE-주간캘린더칸삭제(사용자 11/26): 이 값을 고르던 내 프로필 칸은 없앴다. 이미 저장된 값은 서버에 그대로 두고 업무 캘린더로 계속 쓴다
// (바꿀 일이 생기면 CC가 SQL로). 이름이 없으면 ''(미지정) = 모든 캘린더를 업무 일정으로 본다. 이름 비교는 대소문자·띄어쓰기 차이를 무시한다.
export const calendarKey = name => String(name ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
export function reportCalendarName() {
  try {
    const v = globalThis.KPTUViewPrefs?.get?.('report_calendar'); // 브라우저에서는 window.KPTUViewPrefs(view-prefs.js)
    return typeof v === 'string' ? v : '';
  } catch { return ''; }
}
