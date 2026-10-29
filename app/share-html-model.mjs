// SHARE-보관함·HTML공유 (docs/design/share-html-pages.md): the rules of an HTML file share page that do not need the screen.
// share-html.js draws the window; share/share.js and share/frame.js show the file to the people with the link.
// The file runs only inside a sandboxed frame without allow-same-origin (an origin of its own, "null"): it cannot read
// this app's sign-in (browser storage), cookies or the page around it, and cannot move that page elsewhere.
export const MAX_HTML_BYTES = 5 * 1024 * 1024; // the DB check app_share_page_html_size_check uses the same number
export const HTML_SANDBOX = 'allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms';
export const SHORT_BASE = 'https://bokdoong.com/s/';
export const CODE_LENGTH = 8; // letters the DB adds after the name (design 3: 4 letters are too few to be safe)
export const NAME_MAX = 40;
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CODE = /^[a-km-np-z2-9]{8}$/;

export function htmlBytes(text) { return new TextEncoder().encode(String(text ?? '')).length; }

// What is wrong with this file, in everyday words; '' when it can be sent.
export function fileProblem(file) {
  if (!file) return '파일을 골라 주세요.';
  const name = String(file.name || '');
  const type = String(file.type || '');
  if (!/\.html?$/i.test(name) && type !== 'text/html') return 'HTML 파일(.html)만 올릴 수 있어요.';
  if (!file.size) return '빈 파일이에요.';
  if (file.size > MAX_HTML_BYTES) return '5MB까지 올릴 수 있어요.';
  return '';
}
export function textProblem(text) {
  const bytes = htmlBytes(text);
  if (!bytes) return '빈 파일이에요.';
  if (bytes > MAX_HTML_BYTES) return '5MB까지 올릴 수 있어요.';
  return '';
}

const ENTITIES = {amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:' ', '#39':"'"};
// The file's own <title>, as plain text (used as the page title and the link-preview title). '' when there is none.
export function htmlTitle(text) {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(String(text ?? ''));
  if (!match) return '';
  const plain = match[1].replace(/&(#\d+|#x[0-9a-f]+|[a-z]+|#39);/gi, (all, code) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 31 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    return ENTITIES[code.toLowerCase()] ?? all;
  });
  return plain.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

// A link name suggestion from the title: only a-z, 0-9 and single hyphens (Korean titles give '', the owner types one).
export function nameFrom(title) {
  return String(title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, NAME_MAX).replace(/-+$/, '');
}
export function nameProblem(name) {
  const value = String(name ?? '');
  if (!value) return '링크 이름을 정해 주세요(영어 소문자·숫자·하이픈).';
  if (value.length < 2) return '링크 이름은 두 글자 이상이에요.';
  if (value.length > NAME_MAX) return `링크 이름은 ${NAME_MAX}글자까지예요.`;
  if (!NAME.test(value)) return '링크 이름은 영어 소문자·숫자와 가운데 하이픈(-)만 써요.';
  return '';
}
export function shortUrl(name, code) {
  if (nameProblem(name) || !CODE.test(String(code ?? ''))) throw new Error('링크 주소를 확인할 수 없어요.');
  return `${SHORT_BASE}${name}-${code}`;
}

// 기한 choice: 'none' | '30' | '90' | 'date' (with a yyyy-mm-dd day). The end of that day in Korea.
export function expiryOf(choice, day, now = Date.now()) {
  if (!choice || choice === 'none') return null;
  if (choice === '30' || choice === '90') {
    const until = new Date(now + Number(choice) * 86400000);
    const ymd = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Seoul', year:'numeric', month:'2-digit', day:'2-digit'}).format(until);
    return `${ymd}T23:59:59+09:00`;
  }
  if (choice === 'date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day ?? ''))) throw new Error('기한 날짜를 골라 주세요.');
    const iso = `${day}T23:59:59+09:00`;
    if (!(Date.parse(iso) > now)) throw new Error('기한은 오늘이나 그 뒤 날짜로 골라 주세요.');
    return iso;
  }
  throw new Error('기한을 확인해 주세요.');
}

// The list line state of an HTML page from its status and its links: 'on' (● 공유 중), 'off' (링크 꺼짐), 'draft' (초안).
export function htmlState(page, links, now = Date.now()) {
  if (!page || page.status !== 'published') return 'draft';
  const live = (links || []).some(l => !l.disabled_at && !(l.expires_at && Date.parse(l.expires_at) <= now));
  return live ? 'on' : 'off';
}
export const HTML_STATE_TEXT = {on:'● 공유 중', off:'링크 꺼짐', draft:'초안'};
