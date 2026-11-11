// S51-8 NEWS-전면개편 P4b(설계 docs/design/news-overhaul.md 6.1·6.3절, 시안 docs/design/mockups/news-overhaul.html): News 목록 색과 분류 꼬리표의 유일한 표.
// DOM·네트워크 없음. 색 값은 theme-tokens.css의 --ds-news-* 토큰에만 있고(밝은·어두운 화면 함께), 여기서는 어느 토큰을 쓸지만 정한다.
// - 매체 색: 카탈로그에 있는 단체·언론은 모두 키별 고정 색(아래 FIXED_*, NEWS-고유색 ①②). 카탈로그에 없는 매체(키워드로 찾은 기사의 매체 이름 등)와 앞으로 카탈로그에 새로 들어올 키만
//   묶음마다 색 계열 하나(노동=붉은 갈색, 정당=청록, 사회운동=보라, 외국=회색, 언론=파랑·초록) 안에서 매체마다 한 칸(넷 중 하나, 카탈로그 순서로 돌아감).
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

// 키별 고정 색(NEWS-정당색 → NEWS-고유색 ①②, 명진 2026-11-10·11-11, 시안 docs/design/mockups/news-identity-colors.html): 매체 키 → 그 단체·언론의 고유색.
// 값은 theme-tokens.css 토큰 두 개뿐: --ds-news-id-<키>(이름 글자) · --ds-news-id-<키>-bar(막대 — 한 색, 또는 공공운수노조·Red Pepper처럼 여러 색 띠 그라데이션).
// 막대는 고유색 그대로, 흰 바탕에서 안 읽히는 밝은 색(샛노랑 등)만 이름 글자를 같은 계열 진한 색으로(토큰 값에서 정함). 조사 표·근거·확인 정도는 docs/design/news-identity-colors.md.
// 새 매체 색은 이 표에 키를 더하고 토큰 두 개를 밝은·어두운 화면에 넣으면 된다. 표에 없는 매체는 묶음 돌려쓰기 그대로.
// 고정 키도 같은 묶음 순서 셈에는 남아 있어서, 표에 키를 더해도 다른 매체의 돌려쓰기 칸은 바뀌지 않는다.
// 언론 키는 카탈로그 키(news- 앞머리) 그대로라 토큰 이름도 --ds-news-id-news-<이름>이다. 구글 뉴스(news-google)는 매체가 아니라 키워드 찾기 길이라 표에 없다(기사마다 실제 매체 이름으로 칸 고르기 그대로).
export const FIXED_OUTSIDE = Object.freeze([
  'justice', 'kgreens', 'laborparty', 'jinboparty', 'kmwu', 'kptu',
  'kctu', 'kfsu', 'hakbi', 'pssp', 'ws', 'platformc', 'leftall', 'socialism', 'socialist', 'jacobin', 'labornotes', 'redpepper', 'socialistworker',
]);
export const FIXED_NEWS = Object.freeze([
  'news-labortoday', 'news-beminor', 'news-pressian', 'news-khan', 'news-ohmynews', 'news-hankyung', 'news-mk', 'news-sisain', 'news-newstapa', 'news-hani',
  'news-yna', 'news-donga', 'news-jtbc', 'news-sbs', 'news-nocut', 'news-chosun', 'news-mediatoday', 'news-newsis', 'news-sedaily', 'news-imaeil',
  'news-psi', 'news-itf', 'news-labourstart',
]);
const fixedInk = key => `var(--ds-news-id-${key})`;
const fixedBar = key => `var(--ds-news-id-${key}-bar)`;

// 사회운동 단체 이름 글자 색: 고정 표 → 아니면 카탈로그 [{key, group}]에서 같은 묶음 안 순서로 칸을 고른다.
export function outsideColor(key, catalog = []) {
  if (FIXED_OUTSIDE.includes(key)) return fixedInk(key);
  const src = (catalog || []).find(s => s?.key === key);
  const family = src ? familyOfGroup(src.group) : 'movement';
  const same = (catalog || []).filter(s => s && familyOfGroup(s.group) === family);
  const i = src ? same.indexOf(src) : shadeOf(key);
  return colorVar(family, i);
}
// 사회운동 단체 막대(와 매체 고르기 점) 색: 고정 표면 막대 토큰, 아니면 글자 색과 같다.
export const outsideBar = (key, catalog = []) => (FIXED_OUTSIDE.includes(key) ? fixedBar(key) : outsideColor(key, catalog));
// 언론 매체 색: 고정 표 → 아니면 뉴스 카탈로그 [{key}] 안 순서. 카탈로그에 없으면(키워드 기사) 매체 이름으로 칸을 고른다.
export function newsColor(item, catalog = []) {
  if (FIXED_NEWS.includes(item?.source_key)) return fixedInk(item.source_key);
  const i = (catalog || []).findIndex(s => s?.key && s.key === item?.source_key);
  return colorVar('press', i >= 0 ? i : shadeOf(item?.publisher || item?.source_key || ''));
}
export const newsBar = (item, catalog = []) => (FIXED_NEWS.includes(item?.source_key) ? fixedBar(item.source_key) : newsColor(item, catalog));

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
