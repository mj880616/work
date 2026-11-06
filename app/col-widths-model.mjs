// UI-칸너비끌기(S51-33, 요청함 11/06 22:33 "이름 위치 바뀐 날 이런거 드래그해서 너비 조절 가능하게"): 표 칸 너비 저장 규칙(순수 함수, node --test).
// 너비는 서버 view_prefs.col_widths.<화면>.<칸>에 둔다(기기 저장 없음). 화면 종류(폰·폴드 펼침·PC)마다 따로라 칸 이름 끝에 종류 꼬리를 붙인다:
//   PC(1200px 이상) = 꼬리 없음(옛 저장 값 그대로 PC 값) · 폴드 펼침·태블릿(600~1199px) = _f · 폰(600px 미만) = _p.
// 화면 종류 경계는 앱 공용 경계(screen-width.mjs 600px, [파일] PC 1200px)와 같다. 칸 이름 규칙(소문자·숫자·_ 20자)은 DB 검사와 같아 새 칸 없이 저장된다.
import {SPLIT_MIN_WIDTH} from './screen-width.mjs';
export const COL_PC_MIN_WIDTH = 1200;
export const COL_DEVICES = Object.freeze(['', 'f', 'p']);
// 화면 폭 → 종류 꼬리('' PC, 'f' 폴드 펼침, 'p' 폰).
export const colDevice = width => { const w = Number(width) || 0; return w >= COL_PC_MIN_WIDTH ? '' : w >= SPLIT_MIN_WIDTH ? 'f' : 'p'; };
// 칸 이름 + 종류 꼬리 → 저장 칸 이름.
export const colKey = (key, device = '') => device ? `${key}_${device}` : key;
// 저장된 {칸: px} 중 이 화면 종류의 값만 {칸: px}로.
export function colsFor(stored, keys, device = '') {
  const out = {};
  if (!stored || typeof stored !== 'object') return out;
  for (const key of keys) { const v = stored[colKey(key, device)]; if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[key] = v; }
  return out;
}
// 이 화면 종류의 한 칸만 바꾼 새 저장 값(다른 종류·다른 칸은 그대로). w=null이면 그 칸을 지워 기본 너비로.
export function withCol(stored, key, device, w) {
  const next = {...(stored && typeof stored === 'object' ? stored : {})};
  if (w === null || w === undefined) delete next[colKey(key, device)]; else next[colKey(key, device)] = w;
  return Object.keys(next).length ? next : null;
}
// 두 번 누르기 판정: 같은 손잡이를 짧은 사이(ms)에 움직이지 않고 두 번 눌렀나.
export const DOUBLE_TAP_MS = 350;
export const isDoubleTap = (last, now) => !!last && now.key === last.key && now.at - last.at <= DOUBLE_TAP_MS;
