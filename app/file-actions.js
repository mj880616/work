// FILE-누르면동작: 파일 줄을 누르면 무엇이 되는지의 유일한 규칙과 그 실행(자료실·바구니·노트·할 일·담당조직·프로젝트·사업 보고 자료).
// - PDF: Drive 보기 주소를 새 탭으로 연다(앱에는 PDF 보기 화면이 없고, Drive 보기가 곧 PDF 보기).
// - HWP·HWPX: Drive 미리보기를 거치지 않고 내려받기가 바로 시작된다.
// - 사진(jpeg·png·webp·gif): 사진 크게 보기(photo-view.js). 자료 번호가 있는 곳(자료실·프로젝트·담당조직·사업 보고 자료)은 한 번 쓰는 내려받기 주소로 앱 안에서 크게 본다.
//   Drive 파일 번호만 있는 곳(할 일 첨부)은 읽을 서버 길이 없어 Drive 보기를 새 탭으로 연다. HEIC·BMP는 브라우저가 못 그려 내려받기.
// - HTML(.html·.htm, 자료실 자료): 화면 안 칸막이로 본다(viewHtml을 준 화면만, PRESS-자료실편입). 칸막이가 없는 화면은 내려받기.
// - 그 밖(엑셀·워드 등): 내려받기.
// 내려받기 두 길(둘 다 서버가 Content-Disposition으로 원래 이름을 준다):
//   · 자료실 자료(app_documents 번호가 있음): workspace-drive download-token → 5분짜리 한 번 쓰는 주소. 서버가
//     `attachment; filename*=UTF-8''<퍼센트 인코딩 이름>`을 보낸다(한글·공백 안전).
//   · Drive 파일 번호만 있는 첨부(바구니·노트·할 일): Drive의 내려받기 주소(uc?export=download). Drive가 원래 이름을 보낸다.
//     서버를 거치지 않으므로 Edge 변경도 인증 변경도 없다. 보는 사람이 Drive에서 그 파일을 열 권한이 있어야 하는 것은
//     기존 [Drive에서 열기]와 같다.
// ⋯ 메뉴에는 어느 파일이든 [Drive에서 열기]와 [내려받기]를 둘 다 둔다(menuItemsHtml).
import {fileKind} from './meeting-compact.js';
import {isViewableImage} from './library-tree.js';

// Drive 보기 주소(번호가 올바를 때만). 할 일 첨부(task-files.js)도 이것을 다시 내보내 쓴다.
export function driveFileUrl(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,255}$/.test(id) ? `https://drive.google.com/file/d/${id}/view` : '';
}
const DRIVE_ID = /^[A-Za-z0-9_-]{1,255}$/;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// 'pdf' | 'hwp' | 'photo' | 'download'. 종류는 이름 끝(확장자)을 먼저 보고, 사진은 mime도 본다.
export function clickKind({name = '', mime = ''} = {}) {
  const key = fileKind(name).key;
  if (key === 'pdf' || /^application\/pdf$/i.test(String(mime || ''))) return 'pdf';
  if (key === 'hwp') return 'hwp';
  if (isViewableImage(name, mime)) return 'photo'; // 자료실 '그림' 판정(fileKindOf)과 같은 규칙 하나
  return 'download';
}

// Drive에서 열 주소: 자료실 자료는 저장된 drive_url(http·https만), 없으면 Drive 파일 번호로 만든 보기 주소.
export function driveOpenUrl({driveUrl = '', driveId = ''} = {}) {
  try { const u = new URL(String(driveUrl || '')); if (u.protocol === 'https:' || u.protocol === 'http:') return u.href; } catch { /* 번호로 */ }
  return driveFileUrl(String(driveId || ''));
}
export function driveDownloadUrl(driveId) {
  return DRIVE_ID.test(String(driveId || '')) ? `https://drive.google.com/uc?export=download&id=${encodeURIComponent(driveId)}` : '';
}
// 이 파일에 내려받기 길이 있는가(자료 번호 또는 Drive 파일 번호).
export const canDownload = file => !!(file?.documentId || driveDownloadUrl(file?.driveId));
export const canOpenInDrive = file => !!driveOpenUrl(file);

// 사용자가 누른 그 자리에서 바로 새 탭 링크를 누른다(팝업 차단을 피하려고 비동기 뒤에 열지 않는다).
function clickLink(url) {
  const a = document.createElement('a');
  a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.hidden = true;
  document.body.append(a); a.click(); a.remove();
}

export function openInDrive(file, {onError = () => {}} = {}) {
  const url = driveOpenUrl(file);
  if (!url) { onError('열 수 있는 파일 링크가 없습니다.'); return false; }
  clickLink(url);
  return true;
}

// 내려받기. 자료 번호가 있으면 서버 토큰 길, 없으면 Drive 내려받기 주소. api(path, options)는 호출한 화면의 공용 런타임 호출.
async function documentTokenUrl(documentId, api) {
  const d = await api('/functions/v1/workspace-drive?action=download-token', {method: 'POST', body: {document_id: documentId}});
  if (!d?.url) throw new Error('다운로드 주소를 받지 못했습니다.');
  return d.url;
}
export async function downloadFile(file, {api = (...a) => window.KPTURuntime.api(...a), onError = () => {}} = {}) {
  if (file?.documentId) {
    try {
      location.href = await documentTokenUrl(file.documentId, api);
      return true;
    } catch (e) { onError(e?.message || String(e)); return false; }
  }
  const url = driveDownloadUrl(file?.driveId);
  if (!url) { onError('내려받을 수 있는 파일 링크가 없습니다.'); return false; }
  clickLink(url);
  return true;
}

// 파일 줄을 눌렀을 때. file: {name, mime, documentId?, driveId?, driveUrl?, noteId?}. viewPhoto(file)는 사진 크게 보기를 가진 화면만 준다.
// viewHtml(file)는 HTML 칸막이 보기를 가진 화면(자료실)만 준다. 그 화면의 .html 자료는 내려받지 않고 화면 안 칸막이로 본다(PRESS-자료실편입).
export const isHtmlFile = file => /\.html?$/i.test(String(file?.name || ''));
// 자료 번호가 있는 사진: 앱 안 크게 보기. 주소는 열 때마다 새로 받는다(한 번 쓰면 끝나는 주소).
// 크게 보기 그림: 서버가 줄여 주는 큰 그림(library-files photo, large)을 먼저 쓰고, 못 받으면 원본 내려받기 주소로 대신한다.
async function documentPhotoUrl(documentId, api) {
  try { return await (await import('./library-photo.js')).libraryPhotoUrl(documentId, 'large'); } catch { return documentTokenUrl(documentId, api); }
}
export async function viewDocumentPhoto(file, {api = (...a) => window.KPTURuntime.api(...a), trigger = null} = {}) {
  const {openDocumentPhotoView} = await import('./photo-view.js');
  return openDocumentPhotoView({file, trigger, driveHref: driveOpenUrl(file), getUrl: () => documentPhotoUrl(file.documentId, api)});
}
// ACT-사진 3단계: 사업 보고 사진 줄의 크게 보기. files = 같은 사업 보고의 사진들({name,mime,documentId,driveId,driveUrl}), index = 누른 사진.
// 좌우로 넘기고(‹ › / ←→), ⋯ 에 [Drive에서 열기] [내려받기]와 부른 화면이 주는 extraActions(file)(예: [지우기], run()이 true를 주면 닫힘)가 든다.
export async function viewDocumentPhotos(files, index, {api = (...a) => window.KPTURuntime.api(...a), trigger = null, extraActions = null, onError = () => {}} = {}) {
  const list = (files || []).filter(f => f?.documentId);
  if (!list.length) return false;
  const at = Math.min(Math.max(0, index | 0), list.length - 1);
  const {openDocumentPhotoView} = await import('./photo-view.js');
  const itemOf = i => ({file: list[i], getUrl: () => documentPhotoUrl(list[i].documentId, api), driveHref: driveOpenUrl(list[i])});
  return openDocumentPhotoView({...itemOf(at), trigger, nav: {count: list.length, index: at, item: itemOf}, actions: item => [
    ...(canOpenInDrive(item.file) ? [{label: 'Drive에서 열기', href: driveOpenUrl(item.file)}] : []),
    ...(canDownload(item.file) ? [{label: '내려받기', run: async () => { await downloadFile(item.file, {api, onError}); return false; }}] : []),
    ...((extraActions && extraActions(item.file)) || [])
  ]});
}
export async function pressFile(file, {viewPhoto = null, viewHtml = null, api, onError = () => {}} = {}) {
  if (typeof viewHtml === 'function' && file?.documentId && isHtmlFile(file)) { viewHtml(file); return 'html'; }
  const kind = clickKind(file);
  if (kind === 'photo' && typeof viewPhoto === 'function') { viewPhoto(file); return 'photo'; }
  if (kind === 'photo' && file?.documentId) { await viewDocumentPhoto(file, {api}); return 'photo'; }
  if (kind === 'photo' || kind === 'pdf') {
    // 자료실 자료는 Drive 주소가 없고 파일 번호만 있어도 Drive 보기를 연다. 아무 주소도 없으면 내려받기로 대신한다.
    if (canOpenInDrive(file)) { openInDrive(file, {onError}); return kind === 'pdf' ? 'pdf' : 'photo-drive'; }
    await downloadFile(file, {api, onError}); return 'download';
  }
  // 내려받을 길이 없는 링크 전용 자료(파일 없이 주소만 적은 자료)는 주소를 연다.
  if (!canDownload(file) && canOpenInDrive(file)) { openInDrive(file, {onError}); return 'link'; }
  await downloadFile(file, {api, onError});
  return 'download';
}

// ⋯ 메뉴 두 항목. attr는 호출한 메뉴가 줄을 찾는 데 쓰는 속성 문자열(예: ' data-x="id"'), 각 항목은 attr(기본 data-file-menu)="open|download".
export function menuItemsHtml(file, {attrs = '', cls = '', attr = 'data-file-menu'} = {}) {
  const item = (act, label, ok) => ok ? `<button type="button"${cls ? ` class="${esc(cls)}"` : ''} ${attr}="${act}"${attrs}>${label}</button>` : '';
  return item('open', 'Drive에서 열기', canOpenInDrive(file)) + item('download', '내려받기', canDownload(file));
}

// 링크로 그려지는 파일 줄(할 일 첨부·담당조직 자료·프로젝트 자료)용. 줄 요소에 fileAttrs를 붙이면 아래 전역 클릭 처리가 같은 규칙을 적용한다.
//   · data-fa-press가 붙은 <a>: PDF·사진은 링크 그대로(Drive 보기 새 탭), HWP·그 밖은 링크를 막고 내려받기.
//   · data-fa-menu="open|download" 버튼: 어느 파일이든 Drive에서 열기 / 내려받기. 안에 든 <details> 메뉴는 닫는다.
export function fileAttrs(file, {press = false} = {}) {
  const a = (k, v) => v ? ` data-fa-${k}="${esc(v)}"` : '';
  return a('name', file?.name) + a('mime', file?.mime) + a('doc', file?.documentId) + a('id', file?.driveId) + a('url', file?.driveUrl) + (press ? ' data-fa-press' : '');
}
const fileOfEl = el => ({name: el.dataset.faName || '', mime: el.dataset.faMime || '', documentId: el.dataset.faDoc || '', driveId: el.dataset.faId || '', driveUrl: el.dataset.faUrl || ''});
function toast(text) { const t = document.querySelector('#toast'); if (!t) return; t.textContent = text; t.classList.remove('hidden'); clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.add('hidden'), 4200); }
if (typeof document !== 'undefined' && !globalThis.__kptuFileActionsBound) {
  globalThis.__kptuFileActionsBound = true;
  document.addEventListener('click', e => {
    const el = e.target.closest?.('[data-fa-menu],[data-fa-press]'); if (!el) return;
    const file = fileOfEl(el);
    if (el.dataset.faMenu) {
      e.preventDefault(); el.closest('details')?.removeAttribute('open');
      if (el.dataset.faMenu === 'open') openInDrive(file, {onError: toast}); else void downloadFile(file, {onError: toast});
      return;
    }
    const kind = clickKind(file);
    if (kind === 'photo' && file.documentId) { e.preventDefault(); void viewDocumentPhoto(file, {trigger: el}); return; }
    if (kind === 'pdf' || kind === 'photo' || !canDownload(file)) return; // 링크 그대로 Drive 보기
    e.preventDefault(); void downloadFile(file, {onError: toast});
  });
}
