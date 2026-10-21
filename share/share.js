// SHARE-현장공유 PR 2: Web1 read page for one share page (work.bokdoong.com/work/share/#t=<link value>).
// The link value is read from the address after # (never sent to Pages, Cloudflare or search engines), posted once to
// the share-page-read Edge function as {token}, and kept nowhere else: no storage, no logs, no other request.
// Everything from the server is drawn with textContent; links open only http(s) addresses.
// BUG-공유페이지삼성: the page area id must not look like a social-share widget ("#sharePage" is hidden by the
// Fanboy social list that browser ad blockers use), one failing block draws a short notice instead of blanking the
// page, and the syntax stays at what older Samsung Internet (Chromium 7x) can parse: no ?. ?? or replaceChildren.
// The blocks are drawn by app/sr-render.mjs, the same module the Web2 editor uses for its "as it will look" view.
import {el, renderPage} from '../app/sr-render.mjs';

const ENDPOINT = 'https://xmlkxfjeagycwttklxjw.supabase.co/functions/v1/share-page-read';
const TOKEN = /^[0-9a-f]{64}$/;
const main = document.getElementById('srMain');

export function tokenFromHash(hash) {
  const match = /^#t=([0-9a-f]{64})$/.exec(String(hash || ''));
  return match && TOKEN.test(match[1]) ? match[1] : null;
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
  const token = tokenFromHash(location.hash);
  if (!token) { show(renderClosed()); return; }
  let page;
  try {
    const response = await fetch(ENDPOINT, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({token}),
      cache:'no-store', credentials:'omit', referrerPolicy:'no-referrer'});
    const data = response.ok ? await response.json() : null;
    if (!data || !data.ok || !data.page || typeof data.page.title !== 'string' || !Array.isArray(data.page.blocks)) throw new Error('closed');
    page = data.page;
  } catch {
    show(renderClosed());
    return;
  }
  // Drawing is outside the try above: a drawing problem is not a closed link (renderPage keeps each block apart).
  show(renderPage(page), page.title);
}
if (main) {
  void start();
  // A different link pasted into the same tab: read again.
  window.addEventListener('hashchange', () => { main.setAttribute('aria-busy', 'true'); void start(); });
}
