// S67-65 CAL-꽉찬색(명진 11/21 시안 E1): 일정 칩은 구글 캘린더처럼 꽉 찬 색 바탕 + 흰 글자.
// 색은 각 일정·캘린더의 구글 색을 따르되 눈부시지 않게 톤을 조금 낮춘 값으로 바꾼다(이 파일의 표 하나가 기준).
// 글자는 흰색으로 대비 4.5:1이 되면 흰색, 아니면(노랑처럼 밝은 바탕) 아주 진한 글자 #2A2410 — 색마다 자동 판정.
// 일정 화면(월·주·목록·하루 목록), 홈 '그날 일정' 색 띠가 모두 home-read-model.js eventColor → 이 함수를 거친다.
// 저장·고르는 값(구글에 보내는 색)은 원래 구글 색 그대로다. 바꾸는 것은 화면에 칠하는 색뿐이다.

export const INK_LIGHT = '#ffffff';
export const INK_DARK = '#2a2410';
export const DEFAULT_GOOGLE = '#4285f4';

// 구글 일정 색 11가지(colorId 1~11). 구글 API가 주는 값(옛 값)과 구글 화면 이름의 값(새 값) 둘 다 같은 톤으로 바꾼다.
export const EVENT_COLOR_IDS = {
  1: {name: '라벤더', google: ['#a4bdfc', '#7986cb'], tone: '#6573ad'},
  2: {name: '세이지', google: ['#7ae7bf', '#33b679'], tone: '#3a8268'},
  3: {name: '포도', google: ['#dbadff', '#8e24aa'], tone: '#8a56a2'},
  4: {name: '플라밍고', google: ['#ff887c', '#e67c73'], tone: '#b55a54'},
  5: {name: '바나나', google: ['#fbd75b', '#f6bf26'], tone: '#e0b54a'},
  6: {name: '귤', google: ['#ffb878', '#f4511e'], tone: '#d9844a'},
  7: {name: '공작', google: ['#46d6db', '#039be5'], tone: '#2f7398'},
  8: {name: '흑연', google: ['#e1e1e1', '#616161'], tone: '#6e6d69'},
  9: {name: '블루베리', google: ['#5484ed', '#3f51b5'], tone: '#3f5fa8'},
  10: {name: '바질', google: ['#51b749', '#0b8043'], tone: '#1f6447'},
  11: {name: '토마토', google: ['#dc2127', '#d50000'], tone: '#c4473f'}
};

// 구글 캘린더 기본색(캘린더 목록 backgroundColor 24가지 + 기본 파랑 #4285f4).
export const CALENDAR_COLOR_TONES = {
  '#4285f4': '#4469ad',
  '#ac725e': '#8f6455', '#d06b64': '#b0554f', '#f83a22': '#c0473a', '#fa573c': '#bf5040',
  '#ff7537': '#b85a32', '#ffad46': '#e0a04a', '#42d692': '#2c7d5c', '#16a765': '#2b7a58',
  '#7bd148': '#4c7d34', '#b3dc6c': '#cfd48a', '#fbe983': '#e6d37a', '#fad165': '#e0b54a',
  '#92e1c0': '#3d7d67', '#9fe1e7': '#3f7b82', '#9fc6e7': '#4a6f8f', '#4986e7': '#3f64a5',
  '#9a9cff': '#6568b0', '#b99aff': '#7a68b3', '#c2c2c2': '#6e6d69', '#cabdbf': '#7a6e70',
  '#cca6ac': '#8a6a6f', '#f691b2': '#ae5a76', '#cd74e6': '#94559f', '#a47ae2': '#7660a8'
};

// 원래 구글 색 → 톤 낮춘 색. 위 두 표를 합친 것.
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

// 표에 없는 색(사용자가 고른 임의 색 등)도 같은 규칙: 채도를 조금 낮추고, 흰 글자 대비가 4.5가 될 때까지 조금씩 어둡게.
// 노랑 계열(색상 40~75°)의 밝은 색은 어둡게 하면 탁해지므로 밝은 톤을 두고 진한 글자를 쓴다.
export function toneColor(value) {
  const rgb = parseHex(value);
  if (!rgb) return toneColor(DEFAULT_GOOGLE);
  const hex = toHex(rgb);
  if (COLOR_TONES[hex]) return COLOR_TONES[hex];
  let [h, s, l] = rgbToHsl(rgb);
  s = Math.min(s * 0.8, 0.55);
  if (h >= 40 && h <= 75 && l >= 0.5 && s > 0.2) return toHex(hslToRgb([h, s, Math.min(l, 0.6)]));
  l = Math.min(l, 0.55);
  let out = hslToRgb([h, s, l]);
  while (contrastRatio(INK_LIGHT, out) < 4.5 && l > 0.2) { l -= 0.01; out = hslToRgb([h, s, l]); }
  return toHex(out);
}

/** 바탕색 위 글자: 흰색이 4.5:1을 넘으면 흰색, 아니면 진한 글자(둘 다 못 넘으면 더 잘 보이는 쪽). */
export function eventInk(background) {
  const white = contrastRatio(INK_LIGHT, background), dark = contrastRatio(INK_DARK, background);
  return white >= 4.5 || white >= dark ? INK_LIGHT : INK_DARK;
}

/** 일정 칩 한 개의 칠: {background, ink}. 원래 색이 없으면 구글 기본 파랑. */
export function eventChip(value) {
  const background = toneColor(value || DEFAULT_GOOGLE);
  return {background, ink: eventInk(background)};
}
