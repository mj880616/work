// MD-표시보완: ChatGPT 화면을 Web2에서 원본 모양에 가깝게 보기 위한 순수 함수. DOM이 없어 Node 단위 검사에서도 그대로 돈다.
// - 공유 링크 카드: 메모 글 속 https://chatgpt.com/share/<id>만 인정한다(서버가 그 페이지를 가져오지 않는다).
// - HTML 붙여넣기: 완전한 HTML 문서(<!doctype html> 또는 ```html 블록)를 .html 첨부로 바꾼다.
// - 칸막이 문서: 보여 줄 HTML 맨 앞에 네트워크를 모두 막는 CSP와 높이 알림 스크립트를 붙인다(html-frame.js가 sandbox iframe에 넣는다).

export const CHATGPT_HTML_REQUEST = '위 답변을 외부 라이브러리·폰트·이미지 주소 없이 인라인 CSS와 인라인 SVG만 쓴 HTML 파일 하나로 만들어 줘. 카드·표·도식 모양을 살려 줘.';
export const HTML_MAX_BYTES = 2 * 1024 * 1024;
export const HTML_MARK = '📄 ChatGPT HTML';

const SHARE_ID = /^[A-Za-z0-9][A-Za-z0-9-]{7,99}$/;
// Candidates only; each one is parsed and checked as a URL below.
const SHARE_CANDIDATE = /https?:\/\/[^\s<>()\[\]"'`]+/gi;

// The exact form https://chatgpt.com/share/<id> (no other host, port, account part, path or http).
export function chatgptShareUrl(value) {
  let url;
  try { url = new URL(String(value ?? '').trim()); } catch { return null; }
  if (url.protocol !== 'https:' || url.hostname !== 'chatgpt.com' || url.port || url.username || url.password) return null;
  const match = /^\/share\/([^/]+)\/?$/.exec(url.pathname);
  if (!match || !SHARE_ID.test(match[1])) return null;
  return `https://chatgpt.com/share/${match[1]}`;
}

// Every distinct share link in the text, in the order written (at most 5 cards).
export function chatgptShareLinks(text) {
  const found = [];
  for (const [candidate] of String(text ?? '').matchAll(SHARE_CANDIDATE)) {
    const url = chatgptShareUrl(candidate.replace(/[.,;:!?。、]+$/, ''));
    if (url && !found.includes(url)) found.push(url);
    if (found.length === 5) break;
  }
  return found;
}

const isDocument = html => /^<!doctype\s+html\b/i.test(html) || (/^<html[\s>]/i.test(html) && /<\/html>\s*$/i.test(html));
const FENCE = /(^|\n)[ \t]*```[ \t]*html[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```[ \t]*(?=\r?\n|$)/i;

// A pasted complete HTML document: the whole paste, or one ```html block whose body is a whole document.
// Returns {html, before, after} (the text around a fenced block stays in the memo), or null.
export function extractHtmlDocument(text) {
  const value = String(text ?? '');
  const whole = value.trim().replace(/^﻿/, '');
  if (isDocument(whole)) return {html: whole, before: '', after: ''};
  const match = FENCE.exec(value);
  if (!match) return null;
  const html = match[2].trim();
  if (!isDocument(html)) return null;
  const start = match.index + match[1].length;
  return {html, before: value.slice(0, start).trimEnd(), after: value.slice(match.index + match[0].length).trimStart()};
}

export const utf8Bytes = text => new TextEncoder().encode(String(text ?? '')).length;
export const isHtmlName = name => /\.html?$/i.test(String(name || ''));

// "chatgpt-20261015-1430.html" in Korean time.
export function htmlFileName(date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).formatToParts(date).map(x => [x.type, x.value]));
  return `chatgpt-${p.year}${p.month}${p.day}-${p.hour}${p.minute}.html`;
}

// Inline styles and scripts and data: images/fonts only. Nothing may load, connect, submit or embed.
export const FRAME_CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:; media-src 'none'; connect-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'; manifest-src 'none'; form-action 'none'; base-uri 'none'";

// Runs inside the sandbox; it can only tell the parent its own height. The parent checks the sender frame.
const HEIGHT_SCRIPT = '<script>(function(){var last=0;function send(){var d=document.documentElement,b=document.body;var h=Math.ceil(Math.max(d?d.scrollHeight:0,b?b.scrollHeight:0));if(h&&h!==last){last=h;try{parent.postMessage({type:"web2-html-height",height:h},"*")}catch(e){}}}addEventListener("load",send);addEventListener("resize",send);try{new ResizeObserver(send).observe(document.documentElement)}catch(e){setInterval(send,1000)}send()})()</script>';

// The policy comes first so it covers everything in the document. A leading doctype stays first (standards mode).
export function frameDocument(html) {
  const value = String(html ?? '').replace(/^﻿/, '');
  const doctype = /^\s*<!doctype[^>]*>/i.exec(value);
  const head = `<meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}"><meta name="referrer" content="no-referrer">${HEIGHT_SCRIPT}`;
  return doctype ? doctype[0].trim() + head + value.slice(doctype[0].length) : '<!doctype html>' + head + value;
}
