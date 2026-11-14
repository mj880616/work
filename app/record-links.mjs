// S62-02 MTG-원문칸넘침(11/15 명진 '원문에 링크를 넣으면 자동으로 하이퍼링크 북마크'): 기록 글 안의 주소(http·https만)를 찾는 유일한 곳.
// 순수 함수라 DOM·네트워크가 없다(단위 시험 대상). 바깥 주소의 페이지를 읽어 오지 않는다 — 북마크는 도메인·주소만 보인다.
// - recordLinkParts(line): 한 줄을 [{text}|{url}] 조각으로. 주소 끝의 문장부호(. , ; : ! ? 따옴표·닫는 괄호)는 주소에서 뺀다
//   (여는 괄호가 주소 안에 있으면 닫는 괄호는 주소에 남긴다).
// - bookmarkLine(line): 줄 전체가 주소 하나면 그 주소(북마크 줄로 그린다), 아니면 ''.
// - linkHost(url): 보이는 도메인('www.' 뺌). http·https가 아니거나 읽을 수 없으면 ''.
const URL_RE = /https?:\/\/[^\s<>"'`]+/gi;
const TRAIL = /[.,;:!?'"’”」』>\]}]+$/;

export function linkHost(url) {
  try {
    const u = new URL(String(url ?? ''));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.hostname.replace(/^www\./i, '');
  } catch { return ''; }
}

function trimUrl(raw) {
  let url = raw;
  for (;;) {
    const next = url.replace(TRAIL, '');
    const closes = (next.match(/\)/g) || []).length, opens = (next.match(/\(/g) || []).length;
    const cut = next.endsWith(')') && closes > opens ? next.slice(0, -1) : next;
    if (cut === url) return url;
    url = cut;
  }
}

export function recordLinkParts(line) {
  const text = String(line ?? ''), parts = [];
  let at = 0;
  for (const m of text.matchAll(URL_RE)) {
    const url = trimUrl(m[0]);
    if (!linkHost(url)) continue;
    if (m.index > at) parts.push({text: text.slice(at, m.index)});
    parts.push({url});
    at = m.index + url.length;
  }
  if (at < text.length) parts.push({text: text.slice(at)});
  return parts;
}

export function bookmarkLine(line) {
  const parts = recordLinkParts(String(line ?? '').trim());
  return parts.length === 1 && parts[0].url ? parts[0].url : '';
}
