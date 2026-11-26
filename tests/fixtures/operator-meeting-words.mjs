// WEEKLY-내부회의사람별: 운영자 프로필 한 행에만 넣는 '빼기' 단어(migration 20261117190000 원문에서 읽는다 — 코드·시험이 따로 적지 않게).
// OLD_FIXED는 그 전까지 app/weekly-major-schedule.mjs에 고정돼 모든 사람에게 걸리던 말(사용자 결과 불변 시험의 기준).
import {readFileSync} from 'node:fs';
export const MIGRATION = readFileSync(new URL('../../supabase/migrations/20261117190000_weekly_meeting_words.sql', import.meta.url), 'utf8');
export const OLD_FIXED = Object.freeze(['상집', '중집', '집행위', '집행국', '상무집행', '중앙집행']);
const found = MIGRATION.match(/set weekly_hidden_meeting_kinds = weekly_hidden_meeting_kinds \|\| array\[([^\]]+)\]/);
export const OPERATOR_ENTRIES = Object.freeze(found ? [...found[1].matchAll(/'([^']+)'/g)].map(x => x[1]) : []);
export const OPERATOR_WORDS = Object.freeze(OPERATOR_ENTRIES.map(e => e.slice(1, -1)));
// 운영자 목록 = 지금 기본 두 종류 + 위 단어(적용 뒤 사용자 행의 모양).
export const OPERATOR_LIST = Object.freeze(['궤도집행국회의', '본부집행위', ...OPERATOR_ENTRIES]);
