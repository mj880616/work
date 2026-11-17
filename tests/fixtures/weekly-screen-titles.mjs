// ⑤-3b 시험용: 지어낸 고정 양식(weekly-own-form-legacy-shape.json — ⑤-3 전 기본 양식을 글자 그대로 옮긴 것, 실제 조직·사람 이름 없음)의
// 화면 제목. 화면·복사 글 시험이 '내 양식' 제목을 넘길 때 쓴다(앱에는 코드에 박힌 제목이 없다).
import {readFileSync} from 'node:fs';
import {profileOf} from '../../app/weekly-hwpx/form-profile.mjs';
import {screenTitles} from '../../app/weekly-screen-titles.mjs';
import {weeklyReportText} from '../../app/journal-weekly.js';

export const LEGACY_FORM = JSON.parse(readFileSync(new URL('./weekly-own-form-legacy-shape.json', import.meta.url), 'utf8'));
export const TITLES = screenTitles(profileOf(LEGACY_FORM));
// 복사 글: 모델에 제목이 없으면 고정 양식 제목으로.
export const reportText = model => weeklyReportText({...model, titles:model.titles ?? TITLES});
