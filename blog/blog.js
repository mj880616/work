// BLOG ②(docs/design/blog.md 5절): 명진 블로그 밖 화면 — 게시판 목록 → 글 목록 → 글 본문.
// 주소에서 요청 하나를 만들어 share-page-read 블로그 길에 묻는다(로그인·쿠키·저장소 없음, credentials omit, no-store).
// 서버 글자는 textContent로만, 글 본문은 공유 화면과 같은 그리기(app/sr-render.mjs)로만 그린다. 옮겨 다니기는 보통 링크(뒤로가기 = 이전 화면).
import {el, renderPage} from '../app/sr-render.mjs';
import {askOf, boardHref, postHref, shortDate} from './blog-model.mjs';

const ENDPOINT = 'https://xmlkxfjeagycwttklxjw.supabase.co/functions/v1/share-page-read';
const head = document.getElementById('blHead'), main = document.getElementById('blMain');

async function ask(body) {
  const response = await fetch(ENDPOINT, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body),
    cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'});
  const data = response.ok ? await response.json() : null;
  if (!data || data.ok !== true || !data.blog || typeof data.blog.title !== 'string') throw new Error('none');
  return data;
}
function link(href, text, meta, current) {
  const li = el('li'), a = el('a');
  a.href = href;
  a.append(el('span', '', text));
  if (meta) a.append(el('span', 'bl-m', meta));
  if (current) a.setAttribute('aria-current', 'page');
  li.append(a);
  return li;
}
function setHead(blog, intro) {
  while (head.firstChild) head.removeChild(head.firstChild);
  const home = el('a', '', blog.title);
  home.href = '/';
  head.append(home);
  if (intro) head.append(el('span', '', intro));
  // 결정 D: 검색 허용을 켠 블로그만 색인을 연다(기본은 금지 그대로).
  const robots = document.querySelector('meta[name="robots"]');
  if (robots && blog.indexable === true) robots.setAttribute('content', 'index,follow,noarchive');
}
function boardsList(boards, currentKey) {
  const box = el('nav', 'bl-side');
  box.setAttribute('aria-label', '게시판');
  box.append(el('div', 'bl-lh', '게시판'));
  const list = el('ul', 'bl-list');
  for (const b of boards) {
    const href = boardHref(b.key);
    if (href) list.append(link(href, b.name, String(b.count), b.key === currentKey));
  }
  if (!boards.length) box.append(el('p', 'bl-none', '아직 게시판이 없어요.'));
  else box.append(list);
  return box;
}
function postsList(board, posts, page, more, currentKey) {
  const box = el('section', 'bl-board');
  const back = el('a', 'bl-back', '‹ 게시판');
  back.href = '/';
  box.append(back, el('div', 'bl-lh', board.name));
  const list = el('ul', 'bl-list');
  for (const p of posts) {
    const href = postHref(p.key);
    if (href) list.append(link(href, p.title, shortDate(p.date), p.key === currentKey));
  }
  if (!posts.length) box.append(el('p', 'bl-none', '아직 글이 없어요.'));
  else box.append(list);
  if (more) { const a = el('a', 'bl-more', '더 보기'); a.href = boardHref(board.key, page + 1); box.append(a); }
  return box;
}
function show(nodes, step, title) {
  while (main.firstChild) main.removeChild(main.firstChild);
  const cols = el('div', 'bl-cols' + (step === 'post' ? '' : ' is-two'));
  cols.dataset.step = step;
  for (const n of nodes) cols.append(n);
  main.append(cols);
  main.removeAttribute('aria-busy');
  document.title = title;
}
function none() {
  while (main.firstChild) main.removeChild(main.firstChild);
  main.append(el('p', 'bl-none', '없는 주소예요.'));
  main.removeAttribute('aria-busy');
  document.title = '블로그';
}

async function start() {
  const want = askOf(location.pathname, location.search);
  if (!want) { none(); return; }
  try {
    const home = await ask({blog: 'home'});
    const boards = Array.isArray(home.boards) ? home.boards : [];
    setHead(home.blog, home.blog.intro);
    if (want.blog === 'home') { show([boardsList(boards, null)], 'home', home.blog.title); return; }
    if (want.blog === 'board') {
      const data = await ask(want);
      show([boardsList(boards, data.board.key), postsList(data.board, data.posts || [], want.page || 0, data.more === true, null)],
        'board', `${data.board.name} · ${home.blog.title}`);
      return;
    }
    const data = await ask(want);
    const list = await ask({blog: 'board', board: data.board.key});
    const art = el('article', 'bl-art');
    const nodes = renderPage({title: data.post.title, blocks: data.post.blocks}, data.media || null);
    const meta = el('div', 'bl-meta', [shortDate(data.post.date), data.post.updated ? '고침 ' + shortDate(data.post.updated) : '', data.board.name].filter(Boolean).join(' · '));
    art.append(nodes[0], meta, ...nodes.slice(1));
    const back = el('a', 'bl-back', '‹ ' + data.board.name);
    back.href = boardHref(data.board.key);
    art.prepend(back);
    show([boardsList(boards, data.board.key), postsList(list.board, list.posts || [], 0, list.more === true, data.post.key), art], 'post',
      `${data.post.title} · ${home.blog.title}`);
    if (main.querySelector('.ed-photo.is-place')) art.append(el('p', 'bl-photo-note', '일부 사진은 보이지 않아요.'));
  } catch {
    none();
  }
}
if (main && head) void start();
