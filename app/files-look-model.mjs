// FILES-폰보기끌기 ①(S51-20, 요청함 11/06 01:12, 시안 docs/design/mockups/files-phone-grid-two-drag.html ①·folder-inline-expand-pinch.html): [파일] 목록 보기 크기. 화면 없이 시험하는 계산.
// - 세 단계 list(목록) → grid(격자) → big(큰 격자). 두 손가락을 벌리면 한 단계 크게, 오므리면 한 단계 작게(끝에서는 그대로).
// - 한 줄 칸 수는 화면 폭이 정한다: 폰 한 칸(600px 미만) 격자 3칸·큰 격자 2칸, 폴드 펼침·PC는 한 칸 더(격자 4칸·큰 격자 3칸, FILES-폴드나무목록 ②).
//   두 칸 보기에서는 칸이 좁아 폴드도 폰과 같은 칸 수를 쓴다.
// - 마지막 보기는 서버 view_prefs.files_look에 기기 종류(app·phone·pc, files-sources-model.mjs)별 · 화면 폭 종류(narrow·fold·wide)별로 둔다
//   (migration 20261106200000, files_two와 같은 모양). 칸이 없으면 list. 기기 저장 없음.
export const FILES_LOOK_KEY = 'files_look';
export const FILES_LOOKS = Object.freeze(['list', 'grid', 'big']);
export const FILES_LOOK_LAYOUTS = Object.freeze(['narrow', 'fold', 'wide']);
export const FILES_LOOK_DEFAULT = 'list';
export const FILES_LOOK_NAME = Object.freeze({list: '목록', grid: '격자', big: '큰 격자'});
// 폭 종류. narrow = 폰 한 칸(600px 미만), wide = 1200px 이상, 그 사이 fold.
export const lookLayout = ({narrow = false, wide = false} = {}) => (narrow ? 'narrow' : wide ? 'wide' : 'fold');
// 서버 값(이 기기 칸) → 이 폭의 보기. 모양이 틀리면 기본값.
export function lookOf(devValue, layout) {
  const v = devValue && typeof devValue === 'object' && !Array.isArray(devValue) ? devValue[layout] : undefined;
  return FILES_LOOKS.includes(v) ? v : FILES_LOOK_DEFAULT;
}
// 이 폭의 보기를 바꾼 이 기기 칸 값(다른 폭 칸은 아는 것만 그대로 둔다).
export function lookValue(devValue, layout, look) {
  const out = {};
  for (const k of FILES_LOOK_LAYOUTS) if (devValue && FILES_LOOKS.includes(devValue[k])) out[k] = devValue[k];
  if (FILES_LOOK_LAYOUTS.includes(layout) && FILES_LOOKS.includes(look)) out[layout] = look;
  return out;
}
// 손짓 한 번. step = 'out'(벌림, 크게) | 'in'(오므림, 작게). 끝에서는 그대로.
export function stepLook(look, step) {
  const i = Math.max(0, FILES_LOOKS.indexOf(look));
  const j = step === 'out' ? Math.min(FILES_LOOKS.length - 1, i + 1) : step === 'in' ? Math.max(0, i - 1) : i;
  return FILES_LOOKS[j];
}
// 한 줄 칸 수(격자만). roomy = 칸 하나가 폴드·PC 폭인가(폰 한 칸·두 칸 보기의 한 칸이면 false).
export function lookCols(look, roomy) {
  if (look === 'grid') return roomy ? 4 : 3;
  if (look === 'big') return roomy ? 3 : 2;
  return 0;
}
// 작은 그림을 받는 줄인가: 사진 파일만(폴더·문서는 아이콘). kind = files-model.mjs kindOf.
export const thumbWanted = (kind, isFolder) => !isFolder && kind === 'image';
