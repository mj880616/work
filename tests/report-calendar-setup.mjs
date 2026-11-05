// MULTI ②-3(D5): 보고 캘린더 이름은 내 프로필 설정(view_prefs.report_calendar)에서 읽는다(app/report-calendar.mjs).
// 주간 정리 일정 시험들은 운영자와 같은 이름을 정한 사람으로 본다. import만 하면 된다(다른 값을 이미 넣었으면 그대로 둔다).
import {prefsStub} from './org-order-fixture.mjs';
globalThis.KPTUViewPrefs ??= prefsStub();
