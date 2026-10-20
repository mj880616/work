// SHARE-현장공유 PR 2: Web1 read page for one share page (work.bokdoong.com/work/share/#t=<link value>).
// The link value is read from the address after # (never sent to Pages, Cloudflare or search engines), posted once to
// the share-page-read Edge function as {token}, and kept nowhere else: no storage, no logs, no other request.
// Everything from the server is drawn with textContent; links open only http(s) addresses.
import {BLOCK_LABELS, safeUrl} from '../app/share-pages-model.mjs';

const ENDPOINT = 'https://xmlkxfjeagycwttklxjw.supabase.co/functions/v1/share-page-read';
const TOKEN = /^[0-9a-f]{64}$/;
const main = document.querySelector('#sharePage');

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}
const str = value => typeof value === 'string' ? value : '';
const items = block => (Array.isArray(block?.items) ? block.items : []).filter(item => item && typeof item === 'object');
const heading = (block, type) => el('h2', 'sr-h', str(block.title).trim() || BLOCK_LABELS[type]);

export function tokenFromHash(hash) {
  const match = /^#t=([0-9a-f]{64})$/.exec(String(hash || ''));
  return match && TOKEN.test(match[1]) ? match[1] : null;
}

function summary(block) {
  const box = el('section', 'sr-summary');
  box.append(el('p', 'sr-summary-text', str(block.text)));
  return box;
}
function stages(block) {
  const list = items(block), current = Number.isInteger(block.current) ? block.current : 0;
  const box = el('section', 'sr-block sr-stages');
  box.append(heading(block, 'stages'));
  const bar = el('ol', 'sr-stage-bar');
  list.forEach((item, i) => {
    const step = el('li', `sr-stage${i < current ? ' is-done' : ''}${i === current ? ' is-current' : ''}`);
    step.append(el('span', 'sr-stage-mark'), el('span', 'sr-stage-name', str(item.name)));
    if (i === current) step.setAttribute('aria-current', 'step');
    bar.append(step);
  });
  box.append(bar);
  if (list[current]) box.append(el('p', 'sr-stage-now', `지금 단계: ${str(list[current].name)}`));
  return box;
}
function schedule(block) {
  const box = el('section', 'sr-block sr-schedule');
  box.append(heading(block, 'schedule'));
  const table = el('table', 'sr-table'), body = el('tbody');
  for (const item of items(block)) {
    const row = el('tr');
    row.append(el('th', 'sr-date', str(item.date)), el('td', '', str(item.text)));
    row.firstChild.setAttribute('scope', 'row');
    body.append(row);
  }
  table.append(body);
  box.append(table);
  return box;
}
function issues(block) {
  const box = el('section', 'sr-block sr-issues');
  box.append(heading(block, 'issues'));
  for (const item of items(block)) {
    const card = el('article', 'sr-issue');
    if (str(item.title)) card.append(el('h3', 'sr-issue-title', str(item.title)));
    if (str(item.body)) card.append(el('p', 'sr-issue-body', str(item.body)));
    box.append(card);
  }
  return box;
}
function links(block) {
  const box = el('section', 'sr-block sr-links');
  box.append(heading(block, 'links'));
  const list = el('ul', 'sr-link-list');
  for (const item of items(block)) {
    const url = safeUrl(item.url);
    if (!url) continue;
    const li = el('li'), a = el('a', 'sr-link', str(item.label).trim() || url);
    a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    li.append(a);
    list.append(li);
  }
  box.append(list);
  return box;
}
function updates(block) {
  const box = el('section', 'sr-block sr-updates');
  box.append(heading(block, 'updates'));
  const list = el('ol', 'sr-update-list');
  for (const item of items(block)) {
    const li = el('li', 'sr-update');
    if (str(item.date)) li.append(el('span', 'sr-update-date', str(item.date)));
    li.append(el('p', 'sr-update-text', str(item.text)));
    list.append(li);
  }
  box.append(list);
  return box;
}
const RENDER = {summary, stages, schedule, issues, links, updates};

export function renderPage(page) {
  const nodes = [el('h1', 'sr-title', str(page?.title))];
  for (const block of Array.isArray(page?.blocks) ? page.blocks : []) {
    const draw = RENDER[block?.type];
    if (draw) nodes.push(draw(block));
  }
  return nodes;
}
export function renderClosed() {
  const box = el('section', 'sr-closed');
  box.append(el('h1', 'sr-title', '열 수 없는 링크예요'),
    el('p', '', '링크가 꺼졌거나 기한이 지났거나, 주소가 잘못됐을 수 있어요. 링크를 보낸 사람에게 다시 받아 주세요.'));
  return [box];
}
function show(nodes, title) {
  main.replaceChildren(...nodes);
  main.removeAttribute('aria-busy');
  document.title = title ? `${title} · 공유 페이지` : '공유 페이지';
}

async function start() {
  const token = tokenFromHash(location.hash);
  if (!token) { show(renderClosed()); return; }
  try {
    const response = await fetch(ENDPOINT, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({token}),
      cache:'no-store', credentials:'omit', referrerPolicy:'no-referrer'});
    const data = response.ok ? await response.json() : null;
    if (!data?.ok || !data.page || typeof data.page.title !== 'string' || !Array.isArray(data.page.blocks)) throw new Error('closed');
    show(renderPage(data.page), data.page.title);
  } catch {
    show(renderClosed());
  }
}
if (main) {
  void start();
  // A different link pasted into the same tab: read again.
  window.addEventListener('hashchange', () => { main.setAttribute('aria-busy', 'true'); void start(); });
}
