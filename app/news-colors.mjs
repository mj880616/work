// S51-8 NEWS-전면개편 P4b(설계 docs/design/news-overhaul.md 6.1·6.3절, 시안 docs/design/mockups/news-overhaul.html): News 목록 색과 분류 꼬리표의 유일한 표.
// DOM·네트워크 없음. 색 값은 theme-tokens.css의 --ds-news-* 토큰에만 있고(밝은·어두운 화면 함께), 여기서는 어느 토큰을 쓸지만 정한다.
// - 매체 색: 묶음마다 색 계열 하나(노동=붉은 갈색, 정당=청록, 사회운동=보라, 외국=회색, 언론=파랑·초록) 안에서 매체마다 한 칸(넷 중 하나, 카탈로그 순서로 돌아감).
// - 분류 꼬리표: 성명(사회운동 글 종류가 성명·논평·보도자료) · 국제(외국 글) · 노동·정치(미리 만들기의 topic — 아직 서버에 없으면 그리지 않음).

export const FAMILIES = Object.freeze(['labor', 'party', 'movement', 'foreign', 'press']);
export const SHADES = 4;
const GROUP_FAMILY = Object.freeze({labor: 'labor', party: 'party', movement: 'movement', foreign: 'foreign'});
export const familyOfGroup = group => GROUP_FAMILY[group] || 'movement';
export const colorVar = (family, n) => `var(--ds-news-${FAMILIES.includes(family) ? family : 'press'}-${(Math.abs(Math.trunc(Number(n) || 0)) % SHADES) + 1})`;

// 글자 → 0~(SHADES-1). 카탈로그에 없는 매체(키워드로 찾은 기사의 매체 이름 등)도 늘 같은 칸.
export function shadeOf(text) {
  let h = 0;
  for (const ch of String(text ?? '')) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h % SHADES;
}

// 정당 넷은 당 색 고정(NEWS-정당색): 정의당 노랑·녹색당 녹색·노동당 빨강·진보당 주황. 값은 --ds-news-party-<키> 토큰.
export const PARTY_FIXED = Object.freeze(['justice', 'kgreens', 'laborparty', 'jinboparty']);

// 사회운동 단체 색: 카탈로그 [{key, group}]에서 같은 묶음 안 순서로 칸을 고른다.
export function outsideColor(key, catalog = []) {
  if (PARTY_FIXED.includes(key)) return `var(--ds-news-party-${key})`;
  const src = (catalog || []).find(s => s?.key === key);
  const family = src ? familyOfGroup(src.group) : 'movement';
  const same = (catalog || []).filter(s => s && familyOfGroup(s.group) === family);
  const i = src ? same.indexOf(src) : shadeOf(key);
  return colorVar(family, i);
}
// 언론 매체 색: 뉴스 카탈로그 [{key}] 안 순서. 카탈로그에 없으면(키워드 기사) 매체 이름으로 칸을 고른다.
export function newsColor(item, catalog = []) {
  const i = (catalog || []).findIndex(s => s?.key && s.key === item?.source_key);
  return colorVar('press', i >= 0 ? i : shadeOf(item?.publisher || item?.source_key || ''));
}

export const TAGS = Object.freeze({
  labor: {label: '노동'},
  politics: {label: '정치'},
  intl: {label: '국제'},
  statement: {label: '성명'},
});
export const tagLabel = id => TAGS[id]?.label || '';
export const tagStyle = id => (TAGS[id] ? `--nw-tag-bg:var(--ds-news-tag-${id}-soft);--nw-tag-ink:var(--ds-news-tag-${id}-ink)` : '');
const TOPIC_TAG = Object.freeze({'노동': 'labor', '정치': 'politics'});
const STATEMENT_KINDS = new Set(['statement', 'comment', 'press']);
const foreignLang = lang => typeof lang === 'string' && lang !== '' && lang !== 'ko';
// 사회운동 글 꼬리표: 성명 > 국제 > topic(노동·정치). 없으면 ''.
export function postTag(post) {
  if (STATEMENT_KINDS.has(post?.kind)) return 'statement';
  if (foreignLang(post?.lang)) return 'intl';
  return TOPIC_TAG[post?.topic] || '';
}
// 언론 기사 꼬리표: 국제 > topic(노동·정치). 없으면 ''.
export function newsTag(item) {
  if (foreignLang(item?.lang)) return 'intl';
  return TOPIC_TAG[item?.topic] || '';
}
