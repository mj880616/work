// LIB-폴더100단(명진 결정 2026-10-28 10:34): 폴더 단 제한과 들여쓰기 한도를 한 곳에서 정한다.
// 자료실 폴더가 지금 쓰고, 노트 폴더(10/28 09:24 요청)가 생기면 같은 숫자를 여기서 가져다 쓴다.
// 서버 규칙(supabase/migrations/20261028113000_library_folder_depth_100.sql의 'LIB_FOLDER_DEPTH: folders are limited to 100 levels')과
// 같은 숫자여야 한다(tests/folder-limits.test.mjs가 둘을 맞춰 본다). 화면·저장소·네트워크에 닿지 않는 순수 모듈.

// 폴더 안 폴더는 100단까지(사실상 무한). 서버 트리거가 강제하고, 화면은 그 이상을 만들지 않는다.
export const FOLDER_DEPTH_LIMIT=100;
// 폰 화면이 깨지지 않게 들여쓰기는 4단까지만 늘리고, 그보다 깊은 폴더는 더 밀지 않는다.
export const FOLDER_INDENT_MAX=4;
export function folderIndent(depth){const d=Math.floor(Number(depth)||0);return d<0?0:Math.min(d,FOLDER_INDENT_MAX)}
// 서버 거절 글('LIB_FOLDER_DEPTH: folders are limited to N levels')의 N. 서버 규칙이 아직 3단(DB 적용 전)이면 3을 돌려준다.
// 숫자가 없으면 화면의 한도를 쓴다.
export function folderDepthLimitFrom(message){const m=/limited to (\d+) levels/.exec(String(message||''));const n=m?Number(m[1]):NaN;return Number.isInteger(n)&&n>0?n:FOLDER_DEPTH_LIMIT}
