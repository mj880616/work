// S69-29 UI-창높이끌기: 상자 높이 저장 규칙(순수 함수, node --test). 높이는 서버 view_prefs.col_widths.<화면>.<칸>에 둔다(height-resize.js).
// 그 칸은 DB 검사가 40~800 숫자만 받으므로(칸 너비용) 높이 ÷ 2를 적는다 → 80~1600px. 새 칸·DB 변경 없이 저장된다.
// 40·800은 view-prefs.js COL_WIDTH_MIN·COL_WIDTH_MAX(= DB 검사)와 같다(tests/height-resize-model.test.mjs가 맞춰 본다).
export const COL_WIDTH_MIN = 40, COL_WIDTH_MAX = 800;
export const HEIGHT_SCALE = 2, HEIGHT_STEP = 16;
export const HEIGHT_MAX = COL_WIDTH_MAX * HEIGHT_SCALE;
// 끈 높이(px) → 화면에 쓸 높이: min 이상, HEIGHT_MAX 이하, 정수.
export const clampHeight = (h, min = 200) => Math.round(Math.min(HEIGHT_MAX, Math.max(Math.max(min, COL_WIDTH_MIN * HEIGHT_SCALE), Number(h) || 0)));
// 화면 높이(px) → 저장 값(40~800 정수).
export const heightStored = h => Math.min(COL_WIDTH_MAX, Math.max(COL_WIDTH_MIN, Math.round((Number(h) || 0) / HEIGHT_SCALE)));
// 저장 값 → 화면 높이(px). 없거나 틀리면 null(자동).
export const heightOf = v => typeof v === 'number' && Number.isFinite(v) && v >= COL_WIDTH_MIN && v <= COL_WIDTH_MAX ? v * HEIGHT_SCALE : null;
