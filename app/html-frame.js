// MD-표시보완: 바구니 메모의 .html 첨부(ChatGPT HTML)를 칸막이 iframe으로 보여 준다(hwp-frame.js와 같은 sandbox 방식).
// - sandbox="allow-scripts"만 준다(allow-same-origin·forms·popups·top-navigation 없음). 문서는 고유 origin("null")이 되어
//   Web2 창(parent·top)·로그인 정보·저장소·쿠키에 닿지 못하고, 폼 제출·새 창·최상위 이동도 막힌다.
// - 문서 맨 앞에 CSP(default-src 'none', 인라인 스타일·스크립트·data: 이미지·글꼴만)를 붙여 모든 네트워크 요청을 막는다.
// - 높이는 칸막이 안 스크립트가 보낸 숫자만 받는다(보낸 창이 그 iframe일 때만, 범위 제한).
// - 내용은 document-actions `html-view`(읽기 전용, 2MB까지)로 받는다. 요청은 자동으로 다시 보내지 않는다.
import {frameDocument, HTML_MAX_BYTES} from './chatgpt-html.mjs?v=1';

export const HTML_FRAME_TEXT = Object.freeze({
  notReady: 'HTML 보기 서버가 아직 준비되지 않았어요. [Drive에서 열기]로 확인해 주세요.',
  session: '로그인을 확인하지 못했어요. 다시 로그인한 뒤 열어 주세요.',
  tooLarge: '2MB보다 큰 HTML은 화면으로 보지 않아요. [Drive에서 열기]로 확인해 주세요.',
  failed: 'HTML을 불러오지 못했어요.',
  left: '칸막이 안 문서가 다른 주소로 이동하려 해서 닫았어요. [다시 보기]로 처음 화면을 열 수 있어요.',
});
const OLD_SERVER = new Set(['document_id가 필요합니다.', 'Unknown action']);
const MIN_HEIGHT = 120, MAX_HEIGHT = 20000;
const fail = (kind, message) => Object.assign(new Error(message), {kind});

export async function openBasketHtml(noteId, fileId, {rt = window.KPTURuntime, fetcher = fetch, timeoutMs = 60000} = {}) {
  if (!(await rt.session.ensure())) throw fail('session', HTML_FRAME_TEXT.session);
  const session = rt.session.read();
  if (!session?.access_token) throw fail('session', HTML_FRAME_TEXT.session);
  let timer, response;
  try {
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(fail('failed', HTML_FRAME_TEXT.failed)), timeoutMs); });
    response = await Promise.race([fetcher(rt.config.url + '/functions/v1/document-actions', {
      method: 'POST', cache: 'no-store',
      headers: {apikey: rt.config.key, Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json'},
      body: JSON.stringify({action: 'html-view', note_id: noteId, drive_file_id: fileId}),
    }), deadline]);
  } catch (err) {
    throw err?.kind ? err : fail('failed', HTML_FRAME_TEXT.failed + ' 네트워크를 확인해 주세요.');
  } finally { clearTimeout(timer); }
  let data = null;
  try { data = await response.json(); } catch {}
  if (response.ok) {
    if (data?.ok !== true || typeof data.html !== 'string') throw fail('failed', HTML_FRAME_TEXT.failed);
    return {html: data.html, fileName: String(data.file_name || '')};
  }
  if (response.status === 401) throw fail('session', HTML_FRAME_TEXT.session);
  // The gateway refuses these before the function runs; an older function does not know the action.
  if ([403, 404, 405].includes(response.status) || OLD_SERVER.has(String(data?.error || ''))) throw fail('notReady', HTML_FRAME_TEXT.notReady);
  if (data?.code === 'FILE_TOO_LARGE') throw fail('tooLarge', HTML_FRAME_TEXT.tooLarge);
  throw fail('failed', [HTML_FRAME_TEXT.failed, data?.error].filter(Boolean).join(' '));
}

// One listener for every frame: a height is accepted only from that frame's own window.
const frames = new Set();
let listening = false;
function listen() {
  if (listening) return;
  listening = true;
  window.addEventListener('message', event => {
    for (const frame of frames) {
      if (!frame.isConnected) { frames.delete(frame); continue; }
      if (event.source !== frame.contentWindow) continue;
      const data = event.data;
      if (data?.type !== 'web2-html-height' || !Number.isFinite(data.height)) return;
      frame.style.height = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(data.height))) + 'px';
      return;
    }
  });
}

function button(label, onClick) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'secondary'; b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

// Shows html in host. Returns {close()}. The frame never reaches Web2: no same-origin, no network, no top navigation.
export function mountHtmlFrame(host, html, {title = 'ChatGPT HTML'} = {}) {
  listen();
  const box = document.createElement('div'), bar = document.createElement('div'), note = document.createElement('p');
  box.className = 'html-frame'; bar.className = 'html-frame-bar'; note.className = 'html-frame-note'; note.setAttribute('role', 'status');
  const name = document.createElement('b');
  name.className = 'html-frame-title'; name.textContent = title;
  let frame = null, full = false;
  const big = button('크게 보기', () => setFull(!full));
  // Escape leaves the full view only; the memo screen around it must not also close.
  const onKey = event => { if (event.key === 'Escape' && full) { event.preventDefault(); event.stopPropagation(); setFull(false); } };
  box.addEventListener('keydown', onKey);
  const onOutsideKey = event => { if (!box.contains(event.target)) onKey(event); };
  function setFull(on) {
    full = on;
    box.classList.toggle('html-frame-full', on);
    big.textContent = on ? '작게 보기' : '크게 보기';
    big.setAttribute('aria-pressed', String(on));
    if (on) { box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', title); document.addEventListener('keydown', onOutsideKey); }
    else { box.removeAttribute('role'); box.removeAttribute('aria-modal'); box.removeAttribute('aria-label'); document.removeEventListener('keydown', onOutsideKey); }
    big.focus();
  }
  function show() {
    note.textContent = '';
    frame?.remove(); frames.delete(frame);
    frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.setAttribute('loading', 'lazy');
    frame.title = title;
    frame.className = 'html-frame-view';
    frame.style.height = '360px';
    // The first load is our document. Any later load means the page navigated itself: close it.
    let loads = 0;
    frame.addEventListener('load', () => {
      if (++loads < 2) return;
      frames.delete(frame); frame.remove(); frame = null;
      note.textContent = HTML_FRAME_TEXT.left;
      again.hidden = false;
    });
    frame.srcdoc = frameDocument(html);
    frames.add(frame);
    again.hidden = true;
    box.append(frame);
  }
  const again = button('다시 보기', show);
  again.hidden = true;
  bar.append(name, big, again);
  box.append(bar, note);
  host.replaceChildren(box);
  show();
  return {close() { if (full) setFull(false); frames.delete(frame); box.remove(); }};
}

export {HTML_MAX_BYTES};
