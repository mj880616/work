// S70-57 메뉴 화면 표(tests/app-e2e/search-per-menu.spec.mjs가 한 줄씩 돈다). 메뉴 화면 하나 = 파일 하나(같은 모양):
// {name, label: '<메뉴>에서 찾기', query, before, after, match?, rows(page) → 목록 줄 locator, open(page, width) → 그 화면을 데이터와 함께 연다, settle?(page)}
// 새 메뉴 화면을 더하면 여기 한 줄을 더한다(홈은 spec 안 '전체 검색' 시험).
import calendar from './calendar.mjs';
import tasks from './tasks.mjs';
import diary from './diary.mjs';
import library from './library.mjs';
import photos from './photos.mjs';
import notes from './notes.mjs';
import basket from './basket.mjs';
import reading from './reading.mjs';
import team from './team.mjs';
import meetings from './meetings.mjs';
import projects from './projects.mjs';
import files from './files.mjs';
import brief from './brief.mjs';
import hwp from './hwp.mjs';
import outside from './outside.mjs';
import calls from './calls.mjs';
import telegram from './telegram.mjs';
import arsenal from './arsenal.mjs';
import updates from './updates.mjs';
export default [calendar, tasks, diary, library, photos, notes, basket, reading, team, meetings, projects, files, brief, hwp, outside, calls, telegram, arsenal, updates].filter(Boolean);
