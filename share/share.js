// SHARE-현장공유 PR 2: Web1 read page for one share page (work.bokdoong.com/work/share/?t=<link value>, or #t= for
// links sent before SHARE-미리보기제목).
// The link value is read from the address (a ?t= value is moved after # at once, see below), posted once to the
// share-page-read Edge function as {token}, and kept nowhere else: no storage, no logs, no other request.
// Everything from the server is drawn with textContent; links open only http(s) addresses.
// BUG-공유페이지삼성: the page area id must not look like a social-share widget ("#sharePage" is hidden by the
// Fanboy social list that browser ad blockers use), one failing block draws a short notice instead of blanking the
// page, and the syntax stays at what older Samsung Internet (Chromium 7x) can parse: no ?. ?? or replaceChildren.
// The blocks are drawn by app/sr-render.mjs, the same module the Web2 editor uses for its "as it will look" view.
import {el, renderPage} from '../app/sr-render.mjs';

const ENDPOINT = 'https://xmlkxfjeagycwttklxjw.supabase.co/functions/v1/share-page-read';
const TOKEN = /^[0-9a-f]{64}$/;
// SHARE-보관함·HTML공유: short address (name + "-" + 8 letters the DB made), from bokdoong.com/s/<it> via the Worker (?s=).
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*-[a-km-np-z2-9]{8}$/;
// An HTML file page runs only in this sandboxed frame (no allow-same-origin: an origin of its own) loaded from ./frame.html,
// a page without this page's strict CSP (a srcdoc frame would inherit it and block the file's scripts and CDN libraries).
export const HTML_SANDBOX = 'allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms';
const main = document.getElementById('srMain');

export function tokenFromHash(hash) {
  const match = /^#t=([0-9a-f]{64})$/.exec(String(hash || ''));
  return match && TOKEN.test(match[1]) ? match[1] : null;
}
// SHARE-미리보기제목: links copied from Web2 now carry the value as ?t= so link-preview bots (which never send # to the
// server) can be shown the page title by the Worker. In the browser the value is moved to # at once, so reloads and
// this page's own requests do not send it again, and from then on the page works exactly like a #t= link.
export function tokenFromSearch(search) {
  const match = /^\?t=([0-9a-f]{64})$/.exec(String(search || ''));
  return match && TOKEN.test(match[1]) ? match[1] : null;
}
export function slugFrom(text, mark) {
  const match = new RegExp('^\\' + mark + 's=([a-z0-9-]{11,49})$').exec(String(text || ''));
  return match && SLUG.test(match[1]) ? match[1] : null;
}
function moveSearchTokenToHash() {
  const token = tokenFromSearch(location.search), slug = slugFrom(location.search, '?');
  if (location.hash || (!token && !slug)) return;
  try { history.replaceState(null, '', location.pathname + (token ? '#t=' + token : '#s=' + slug)); } catch (e) { /* the read below still works */ }
}
// What to ask share-page-read for: {token} or {slug}, or null when the address holds neither.
export function askFor(hash, search) {
  const token = tokenFromHash(hash) || (hash ? null : tokenFromSearch(search));
  if (token) return {token};
  const slug = slugFrom(hash, '#') || (hash ? null : slugFrom(search, '?'));
  return slug ? {slug} : null;
}
function showHtml(html, title) {
  while (main.firstChild) main.removeChild(main.firstChild);
  const frame = document.createElement('iframe');
  frame.className = 'sr-html-frame';
  frame.setAttribute('sandbox', HTML_SANDBOX);
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.title = title || '공유 페이지';
  // The frame says when it is ready; only then (and only to that frame) the file is handed over.
  const onMessage = event => {
    if (event.source !== frame.contentWindow || !event.data || event.data.type !== 'kptu-share-frame-ready') return;
    window.removeEventListener('message', onMessage);
    frame.contentWindow.postMessage({type:'kptu-share-html', html}, '*');
  };
  window.addEventListener('message', onMessage);
  frame.src = './frame.html';
  main.appendChild(frame);
  main.removeAttribute('aria-busy');
  document.body.classList.add('is-html');
  document.title = title ? `${title} · 공유 페이지` : '공유 페이지';
}

export function renderClosed() {
  const box = el('section', 'sr-closed');
  box.append(el('h1', 'sr-title', '열 수 없는 링크예요'),
    el('p', '', '링크가 꺼졌거나 기한이 지났거나, 주소가 잘못됐을 수 있어요. 링크를 보낸 사람에게 다시 받아 주세요.'));
  return [box];
}
function show(nodes, title) {
  while (main.firstChild) main.removeChild(main.firstChild);
  for (const node of nodes) main.appendChild(node);
  main.removeAttribute('aria-busy');
  document.title = title ? `${title} · 공유 페이지` : '공유 페이지';
}

async function start() {
  document.body.classList.remove('is-html');
  const ask = askFor(location.hash, location.search);
  if (!ask) { show(renderClosed()); return; }
  let page, media = null;
  try {
    const response = await fetch(ENDPOINT, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(ask),
      cache:'no-store', credentials:'omit', referrerPolicy:'no-referrer'});
    const data = response.ok ? await response.json() : null;
    if (!data || !data.ok || !data.page || typeof data.page.title !== 'string') throw new Error('closed');
    if (data.page.kind === 'html') {
      if (typeof data.page.html !== 'string' || !data.page.html) throw new Error('closed');
      showHtml(data.page.html, data.page.title);
      return;
    }
    if (!Array.isArray(data.page.blocks)) throw new Error('closed');
    page = data.page;
    media = data.media && typeof data.media === 'object' ? data.media : null;
  } catch {
    show(renderClosed());
    return;
  }
  // Drawing is outside the try above: a drawing problem is not a closed link (renderPage keeps each block apart).
  show(renderPage(page, media), page.title);
}
if (main) {
  moveSearchTokenToHash();
  void start();
  // A different link pasted into the same tab: read again.
  window.addEventListener('hashchange', () => { main.setAttribute('aria-busy', 'true'); void start(); });
}
