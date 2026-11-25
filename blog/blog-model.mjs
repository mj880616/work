// BLOG ②: 밖 화면 주소 → 읽기 요청. share-page-read 블로그 길과 같은 모양만 만든다(그 밖은 null → '없는 주소').
// bokdoong.com/ · /board/<key>(?page=N) · /post/<key>. GitHub Pages 원 주소(/work/blog/)는 첫 화면으로 본다(글은 허용 출처 밖이라 안 나옴).
export const KEY = /^[0-9a-f]{10}$/;
export function askOf(pathname, search) {
  const path = String(pathname || '/');
  if (path === '/' || path === '/work/blog/' || path === '/work/blog/index.html') return search ? null : {blog: 'home'};
  let m = /^\/board\/([0-9a-f]{10})$/.exec(path);
  if (m) {
    if (!search) return {blog: 'board', board: m[1]};
    const p = /^\?page=([1-9][0-9]{0,2})$/.exec(String(search));
    return p ? {blog: 'board', board: m[1], page: Number(p[1])} : null;
  }
  m = /^\/post\/([0-9a-f]{10})$/.exec(path);
  return m && !search ? {blog: 'post', post: m[1]} : null;
}
export const boardHref = (key, page = 0) => KEY.test(key) ? `/board/${key}${page > 0 ? `?page=${page}` : ''}` : null;
export const postHref = key => KEY.test(key) ? `/post/${key}` : null;
// '2026-11-25' → '11.25'(올해) / '2025.11.25'(다른 해).
export function shortDate(date, now = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
  if (!m) return '';
  return Number(m[1]) === now.getFullYear() ? `${m[2]}.${m[3]}` : `${m[1]}.${m[2]}.${m[3]}`;
}
