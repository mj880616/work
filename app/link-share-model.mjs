// S71-69 SHARE-글공유 ①(사용자 결정 2026-11-26 "기사는 링크로 공유"): 기사(읽을 거리·저장한 글) [공유] 계산 한 곳(화면 없음, 시험 가능).
// - 넘기는 것 = 제목 + 원래 주소. 본문은 넘기지 않는다. 주소는 http·https만(그 밖의 주소·빈 주소면 공유 칸을 두지 않는다).
// - 폰(좁은 화면, 기기 공유 창이 있음) = 기기 공유 창, PC·넓은 화면·공유 창이 없는 곳(폰 앱 화면 포함) = 복사 + '복사했어요'.
// 화면 쪽은 link-share.js. 서버로 아무것도 보내지 않고 기기 저장도 없다.
// 넓은 화면(PC·펼친 폴드 761px~) 기준 한 곳 — 사진 [공유](share-menu.js)도 이 값을 쓴다.
export const WIDE_SHARE_QUERY = '(min-width:761px)';
export const wideShare = (mm = globalThis.matchMedia) => !!(typeof mm === 'function' && mm(WIDE_SHARE_QUERY)?.matches);
export const SHARE_LABEL = '공유';
export const SHARE_NOTE = Object.freeze({copied: '복사했어요', copyFail: '복사하지 못했어요. 다시 눌러 주세요.', openFail: '공유 창을 열지 못했어요', none: '공유할 주소가 없어요'});
const TITLE_MAX = 300, URL_MAX = 2000;
const oneLine = v => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
// http·https 주소만(호스트가 있어야 함). 아니면 ''.
export function shareUrlOf(v) {
  if (typeof v !== 'string' || !v || v.length > URL_MAX) return '';
  try { const u = new URL(v.trim()); return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname ? u.href : ''; } catch { return ''; }
}
// 기사 하나 → 공유할 것 {title, url, text}(text = 복사할 글 '제목\n주소'). 주소가 없거나 http·https가 아니면 null.
export function articleShare({title = '', url = ''} = {}) {
  const href = shareUrlOf(url);
  if (!href) return null;
  const t = oneLine(title).slice(0, TITLE_MAX);
  return {title: t, url: href, text: t ? `${t}\n${href}` : href};
}
// 어느 길로: 'native'(기기 공유 창) | 'copy'.
export const shareWay = ({wide = false, canNative = false} = {}) => (!wide && canNative ? 'native' : 'copy');
// 기기 공유 창에 넘길 값(제목은 받는 앱이 버리는 일이 많아 text에도 제목을 넣는다).
export const nativeData = d => (d ? {title: d.title || d.url, text: d.title || '', url: d.url} : null);
