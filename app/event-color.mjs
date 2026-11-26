// S67-65 CAL-꽉찬색(사용자 11/21 시안 E1): 일정 칩은 구글 캘린더처럼 꽉 찬 색 바탕 + 흰 글자.
// S68-03 CAL-밝은색 G2(사용자 11/22 "거무티티하다" → 시안 G2): 색은 구글 화면 색보다 한 톤만 차분한 밝은 값(E1 35% + 구글 화면 색 65%).
// 색은 각 일정·캘린더의 구글 색을 따르되 이 파일의 표 하나가 기준이다.
// 글자는 구글처럼 흰색이 기본: 흰 글자 대비 2.7:1 이상이면 흰색, 아니면(노랑처럼 밝은 바탕) 아주 진한 글자 #2A2410 — 색마다 자동 판정.
// 일정 화면(월·주·목록·하루 목록), 홈 '그날 일정' 색 띠가 모두 home-read-model.js eventColor → 이 함수를 거친다.
// 저장·고르는 값(구글에 보내는 색)은 원래 구글 색 그대로다. 바꾸는 것은 화면에 칠하는 색뿐이다.

export const INK_LIGHT = '#ffffff';
export const INK_DARK = '#2a2410';
export const DEFAULT_GOOGLE = '#4285f4';

// 구글 일정 색 11가지(colorId 1~11). 구글 API가 주는 값(옛 값)과 구글 화면 이름의 값(새 값) 둘 다 같은 톤으로 바꾼다.
export const EVENT_COLOR_IDS = {
  1: {name: '라벤더', google: ['#a4bdfc', '#7986cb'], tone: '#7683c4'},
  2: {name: '세이지', google: ['#7ae7bf', '#33b679'], tone: '#4a9e88'},
  3: {name: '포도', google: ['#dbadff', '#8e24aa'], tone: '#9459ae'},
  4: {name: '플라밍고', google: ['#ff887c', '#e67c73'], tone: '#d98077'},
  5: {name: '바나나', google: ['#fbd75b', '#f6bf26'], tone: '#eebe4e'},
  6: {name: '귤', google: ['#ffb878', '#f4511e'], tone: '#eb7d43'},
  7: {name: '공작', google: ['#46d6db', '#039be5'], tone: '#368cc0'},
  8: {name: '흑연', google: ['#e1e1e1', '#616161'], tone: '#787776'},
  9: {name: '블루베리', google: ['#5484ed', '#3f51b5'], tone: '#5166b0'},
  10: {name: '바질', google: ['#51b749', '#0b8043'], tone: '#338860'},
  11: {name: '토마토', google: ['#dc2127', '#d50000'], tone: '#d8503c'}
};

// 구글 캘린더 기본색(캘린더 목록 backgroundColor 24가지 + 기본 파랑 #4285f4).
// 구글 화면이 그 캘린더 색을 실제로 보여 주는 진한 색 쪽으로 65% 섞은 값. 일정 색과 같은 이름(토마토·바나나 등)은 일정 색과 같은 칠,
// 서로 비슷해지는 색(코발트 두 가지·시트론/바나나·자수정/포도·아보카도)은 조금 벌렸다.
export const CALENDAR_COLOR_TONES = {
  '#4285f4': '#437bdb',
  '#ac725e': '#815a4d', '#d06b64': '#d98077', '#f83a22': '#d8503c', '#fa573c': '#eb7d43',
  '#ff7537': '#dc6612', '#ffad46': '#ea981a', '#42d692': '#0f8d79', '#16a765': '#338860',
  '#7bd148': '#6ba03d', '#b3dc6c': '#b8c84a', '#fbe983': '#e0d465', '#fad165': '#eebe4e',
  '#92e1c0': '#4a9e88', '#9fe1e7': '#368cc0', '#9fc6e7': '#5a97d2', '#4986e7': '#5166b0',
  '#9a9cff': '#7683c4', '#b99aff': '#9f8acd', '#c2c2c2': '#787776', '#cabdbf': '#978b84',
  '#cca6ac': '#a1325f', '#f691b2': '#c93168', '#cd74e6': '#9459ae', '#a47ae2': '#a873b8'
};

// 원래 구글 색 → 화면에 칠하는 색. 위 두 표를 합친 것.
export const COLOR_TONES = Object.freeze({
  ...CALENDAR_COLOR_TONES,
  ...Object.fromEntries(Object.values(EVENT_COLOR_IDS).flatMap(row => row.google.map(hex => [hex, row.tone])))
});

const HEX = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i;
export function parseHex(value) {
  const m = String(value ?? '').trim().match(HEX);
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, c => c + c) : m[1];
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
}
const toHex = rgb => '#' + rgb.map(x => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');

export function luminance(color) {
  const rgb = Array.isArray(color) ? color : parseHex(color);
  if (!rgb) return 0;
  return rgb.map(x => { x /= 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; })
    .reduce((sum, x, i) => sum + x * [0.2126, 0.7152, 0.0722][i], 0);
}
export function contrastRatio(a, b) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hslToRgb([h, s, l]) {
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  return [0, 8, 4].map(n => 255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
}

export const WHITE_MIN = 2.7; // S68-03 G2: 흰 글자를 쓰는 최소 대비(구글처럼 흰 글자 기본). 진한 글자로 바뀌면 대비는 늘 4.5 이상.

// 표에 없는 색(사용자가 고른 임의 색 등)도 같은 밝기: 채도를 조금 낮추고 밝기를 30~62% 안에 두되,
// 흰 글자 대비가 2.7이 될 때까지만 조금씩 어둡게(E1처럼 4.5까지 내리지 않는다).
// 노랑 계열(색상 40~75°)의 밝은 색은 어둡게 하면 탁해지므로 밝은 톤을 두고 진한 글자를 쓴다.
export function toneColor(value) {
  const rgb = parseHex(value);
  if (!rgb) return toneColor(DEFAULT_GOOGLE);
  const hex = toHex(rgb);
  if (COLOR_TONES[hex]) return COLOR_TONES[hex];
  let [h, s, l] = rgbToHsl(rgb);
  s = Math.min(s * 0.9, 0.65);
  if (h >= 40 && h <= 75 && l >= 0.4 && s > 0.2) return toHex(hslToRgb([h, s, Math.min(l, 0.65)]));
  l = Math.max(0.3, Math.min(l, 0.62));
  let out = hslToRgb([h, s, l]);
  while (contrastRatio(INK_LIGHT, out) < WHITE_MIN && l > 0.2) { l -= 0.01; out = hslToRgb([h, s, l]); }
  return toHex(out);
}

/** 바탕색 위 글자: 흰 글자 대비가 2.7:1 이상이면 흰색, 아니면 진한 글자(이때 진한 글자 대비는 4.5:1 이상). */
export function eventInk(background) {
  return contrastRatio(INK_LIGHT, background) >= WHITE_MIN ? INK_LIGHT : INK_DARK;
}

/** 일정 칩 한 개의 칠: {background, ink}. 원래 색이 없으면 구글 기본 파랑. */
export function eventChip(value) {
  const background = toneColor(value || DEFAULT_GOOGLE);
  return {background, ink: eventInk(background)};
}
