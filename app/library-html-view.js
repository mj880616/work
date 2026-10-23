// PRESS-자료실편입 2단계: 자료실에서 .html 자료를 누르면 Web2 안 칸막이로 본다(html-frame.js 재사용, 새 보기 코드 없음).
// 내용은 document-actions `html-view`(document_id, 읽기 전용, 2MB까지)로 받는다. 자료실 .html을 아직 모르는 서버면
// HTML_FRAME_TEXT.notReady 안내와 [Drive에서 열기]만 보인다. 요청은 자동으로 다시 보내지 않는다.
import {openLibraryHtml, mountHtmlFrame, HTML_FRAME_TEXT} from './html-frame.js';
import {openInDrive, canOpenInDrive} from './file-actions.js';
import {HTML_MAX_BYTES} from './chatgpt-html.mjs';

let root = null, frame = null, sequence = 0;

function ensure() {
  if (root) return root;
  document.body.insertAdjacentHTML('beforeend', '<div id="libraryHtmlModal" class="modal hidden" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="libraryHtmlTitle"><div class="modal-card medium-card lu-html-card"><div class="modal-head"><div><h2 id="libraryHtmlTitle"></h2></div><button id="libraryHtmlClose" class="icon-btn" type="button" aria-label="닫기">×</button></div><p id="libraryHtmlStatus" class="lu-html-status" role="status"></p><button id="libraryHtmlDrive" class="lu-html-drive" type="button" hidden>Drive에서 열기</button><div id="libraryHtmlBody" class="lu-html-body"></div></div></div>');
  root = document.querySelector('#libraryHtmlModal');
  root.querySelector('#libraryHtmlClose').addEventListener('click', closeLibraryHtml);
  root.addEventListener('click', e => { if (e.target === root) closeLibraryHtml(); });
  return root;
}

export function closeLibraryHtml() {
  if (!root || root.classList.contains('hidden')) return;
  sequence++;
  frame?.close(); frame = null;
  root.querySelector('#libraryHtmlBody').replaceChildren();
  root.classList.add('hidden'); root.setAttribute('aria-hidden', 'true');
  if (window.KPTUA11y?.dialog?.deactivate) window.KPTUA11y.dialog.deactivate(root);
}

// file: file-actions 모양 {name, documentId, driveId, driveUrl, size?}, title: 보이는 자료 이름.
export async function openLibraryHtmlView(file, {title = '', rt = window.KPTURuntime} = {}) {
  const box = ensure(), mine = ++sequence;
  const name = title || file?.name || 'HTML';
  const status = box.querySelector('#libraryHtmlStatus'), drive = box.querySelector('#libraryHtmlDrive'), body = box.querySelector('#libraryHtmlBody');
  frame?.close(); frame = null; body.replaceChildren();
  box.querySelector('#libraryHtmlTitle').textContent = name;
  const say = (text, withDrive = false) => {
    status.textContent = text; status.hidden = !text;
    drive.hidden = !(withDrive && canOpenInDrive(file));
    drive.onclick = () => openInDrive(file, {onError: m => { status.textContent = m; }});
  };
  box.classList.remove('hidden'); box.setAttribute('aria-hidden', 'false');
  if (window.KPTUA11y?.dialog?.activate) window.KPTUA11y.dialog.activate(box, {initialFocus: '#libraryHtmlClose', onRequestClose: closeLibraryHtml});
  if (Number(file?.size) > HTML_MAX_BYTES) { say(HTML_FRAME_TEXT.tooLarge, true); return 'tooLarge'; }
  say('불러오는 중…');
  try {
    const {html} = await openLibraryHtml(file.documentId, {rt});
    if (mine !== sequence) return 'stale';
    say('');
    frame = mountHtmlFrame(body, html, {title: name, showTitle: false});
    return 'shown';
  } catch (err) {
    if (mine !== sequence) return 'stale';
    say(err?.message || HTML_FRAME_TEXT.failed, err?.kind !== 'session');
    return err?.kind || 'failed';
  }
}
