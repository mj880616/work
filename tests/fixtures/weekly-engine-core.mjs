// 시험용 한글 파일 엔진 묶음 — 빈 서식·보고 읽고 쓰기만(template·report). 화면 시험(Playwright)은 이것만 부른다:
// draft.mjs 는 앱 .js 모듈까지 따라 불러 Playwright 로더(node 20)에서 못 읽는다. 앱 흐름 함수까지 필요한 node 시험은 weekly-engine.mjs.
// (WEEKLY-내양식자유변형 ⑤-3a): 엔진(template·report·draft)은 profile 을 꼭 받는다(코드에 기본 양식 없음).
// 시험 대부분은 지어낸 양식 고정 파일(weekly-own-form-legacy-shape.json — ⑤-3 전 엔진 기본 양식과 같은 모양·같은 글자, 실제 조직·사람 이름 없음)로 돈다.
// 여기 함수들은 엔진 함수와 같은 이름·같은 인자이고 profile 을 주지 않으면 이 고정 양식을 넣는다. 다른 것은 엔진 모듈 그대로 다시 내보낸다.
import {readFileSync} from 'node:fs';
import {profileOf} from '../../app/weekly-hwpx/form-profile.mjs';
import {makeFakeReport} from '../../scripts/weekly-hwpx/fixture.mjs';
import * as T from '../../app/weekly-hwpx/template.mjs';
import * as R from '../../app/weekly-hwpx/report.mjs';

export * from '../../app/weekly-hwpx/template.mjs';
export * from '../../app/weekly-hwpx/report.mjs';

export const FIXTURE_FORM = Object.freeze(JSON.parse(readFileSync(new URL('./weekly-own-form-legacy-shape.json', import.meta.url), 'utf8')));
export const FIXTURE_PROFILE = profileOf(FIXTURE_FORM);
const P = o => ({profile: FIXTURE_PROFILE, ...(o ?? {})});

export const isBoxTable = (tbl, profile = FIXTURE_PROFILE) => T.isBoxTable(tbl, profile);
export const extractBlankTemplate = (source, o) => T.extractBlankTemplate(source, P(o));
export const readPrototypes = (pkg, o) => T.readPrototypes(pkg, P(o));
export const assertBlank = (pkg, o) => T.assertBlank(pkg, P(o));
export const findTables = (pkg, o) => R.findTables(pkg, P(o));
export const readReport = (pkg, o) => R.readReport(pkg, P(o));
export const buildReport = (template, data, o) => R.buildReport(template, data, P(o));
export const reportWords = (report, o) => R.reportWords(report, P(o));

// 고정 양식과 같은 모양의 지어낸 확정본(가짜 보고서에 고정 양식의 항목 제목을 그대로 적음 — '3) 논의 요청' 줄 포함).
export const FIXTURE_TITLES = Object.freeze(Object.fromEntries(FIXTURE_FORM.sections.map(s => [s.role, s.title])));
export const legacyShapeReport = sample => makeFakeReport(sample, {titles: FIXTURE_TITLES});
