// SHARE-보이는편집: the one drawing of share page blocks (class names sr-*, look in sr-blocks.css), used by the Web1 reader
// (share/share.js) and by the Web2 editor's "as it will look" view (share-pages.js), so both always show the same thing.
// Everything is drawn with textContent; links open only http(s) addresses (safeUrl).
// The Web1 reader imports this file, so it keeps to syntax older Samsung Internet parses: no ?. ?? replaceChildren or
// structuredClone (BUG-공유페이지삼성). Class and id names never contain "share" (ad blockers' social lists hide those).
import {BLOCK_LABELS, safeUrl} from './share-pages-model.mjs';
import {renderDoc} from './ed-render.mjs';

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}
const str = value => typeof value === 'string' ? value : '';
const items = block => (block && Array.isArray(block.items) ? block.items : []).filter(item => item && typeof item === 'object');
const heading = (block, type) => el('h2', 'sr-h', str(block.title).trim() || BLOCK_LABELS[type]);

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
// ED-통합편집기 ①b: one 'doc' block is the new editor's document, drawn by ed-render.mjs (cleaned allowlist, textContent
// only, links http(s)·mailto, a photo only with a short https address from share-page-read) in the ed-doc.css look.
function doc(block, media) {
  const box = el('section', 'sr-block sr-doc');
  box.append(renderDoc(block.doc, media));
  return box;
}
const RENDER = {summary, stages, schedule, issues, links, updates, doc};
export const canDraw = block => !!block && Object.prototype.hasOwnProperty.call(RENDER, block.type);

// One block that cannot be drawn shows this notice in its place; the title and the other blocks still show.
export function renderBlockError(block) {
  const box = el('section', 'sr-block sr-block-error');
  box.setAttribute('role', 'note');
  const label = block && Object.prototype.hasOwnProperty.call(BLOCK_LABELS, block.type) ? BLOCK_LABELS[block.type] : '';
  box.append(el('p', '', (label ? label + ' ' : '') + '칸을 표시하지 못했어요. 새로고침하거나 보낸 사람에게 알려 주세요.'));
  return box;
}
// One block as the reader shows it, or null for a type the reader skips.
export function renderBlock(block, media) {
  if (!canDraw(block)) return null;
  try { return RENDER[block.type](block, media); } catch (e) { return renderBlockError(block); }
}
export function renderPage(page, media) {
  const nodes = [el('h1', 'sr-title', str(page && page.title))];
  for (const block of page && Array.isArray(page.blocks) ? page.blocks : []) {
    const node = renderBlock(block, media);
    if (node) nodes.push(node);
  }
  return nodes;
}
