// ACT-사진 2단계(4단계에서 사업 보고 줄 섬네일도 이 함수 하나로 받는다): 자료실 그림 자료의 작은 그림·크게 보기. 서버 동작은 library-files `GET ?action=photo&document_id=&size=small|large`
// (소유자 로그인만, Drive 읽기만, 줄인 그림은 어디에도 저장하지 않는다). 그림인지 아닌지는 library-tree.js fileKindOf 하나로 판단한다.
// 받은 그림은 이 화면(메모리)에서만 쓰고 브라우저 저장소에 두지 않는다. 로그인한 소유자가 바뀌면 비운다.
import {fileKindOf} from './library-tree.js';
import {slotBox, slotImg, slotFailed} from './img-slot.js';

const SIZES = new Set(['small', 'large']);
const DOC_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const flights = new Map(); // `${문서}:${크기}` → Promise<objectURL>
const ready = new Map();   // 이미 받은 것: 같은 키 → objectURL (다시 그릴 때 바로 쓴다)
let cacheScope = '';

// 그림 자료인가: 파일 이름·mime으로 '그림' 형식이고 Drive 파일이 있는 자료.
export const isLibraryPhoto = doc => !!doc?.id && !!doc.file_id && fileKindOf(doc.file_name, doc.mime_type) === '그림';

// 로그인 정보가 아직 안 읽힌 순간(사용자 번호가 빈 값)은 사용자 바뀜으로 보지 않는다. 안 그러면 막 받은 그림 주소를 거두어 가 그림이 빈 칸이 된다.
const scopeOf = rt => { const c = rt?.context?.read?.(); return c?.user?.id ? `${c.user.id}:${c.workspace?.id || ''}` : ''; };
export function clearLibraryPhotoCache() {
  for (const flight of flights.values()) flight.then(url => URL.revokeObjectURL(url), () => {});
  flights.clear(); ready.clear();
}
export const cachedLibraryPhotoUrl = (documentId, size = 'small') => ready.get(`${documentId}:${size}`) || '';

export function libraryPhotoUrl(documentId, size = 'small', {rt = window.KPTURuntime, fetcher = globalThis.fetch} = {}) {
  if (!DOC_ID.test(String(documentId || '')) || !SIZES.has(size)) return Promise.reject(new Error('photo_request'));
  const scope = scopeOf(rt);
  if (scope && scope !== cacheScope) { if (cacheScope) clearLibraryPhotoCache(); cacheScope = scope; }
  const key = `${documentId}:${size}`;
  if (flights.has(key)) return flights.get(key);
  const flight = (async () => {
    if (!(await rt.session.ensure())) throw new Error('session');
    const token = rt.session.read()?.access_token;
    if (!token) throw new Error('session');
    const query = new URLSearchParams({action: 'photo', document_id: documentId, size});
    const response = await fetcher(`${rt.config.url}/functions/v1/library-files?${query}`, {headers: {apikey: rt.config.key, Authorization: 'Bearer ' + token}});
    if (!response.ok || !/^image\//.test(response.headers.get('content-type') || '')) throw new Error('photo');
    const url = URL.createObjectURL(await response.blob());
    ready.set(key, url);
    return url;
  })();
  flights.set(key, flight);
  flight.catch(() => { if (flights.get(key) === flight) flights.delete(key); });
  return flight;
}

// 목록 줄의 작은 그림 칸(.lu-thumb[data-lu-thumb=<자료 번호>])을 채운다. 보이는 줄만 부른다(접힌 묶음 안은 펼칠 때).
// 표시는 공용 img-slot.js(PHOTO-못받은사진): 받는 중 연한 회색 칸, 못 받으면 작은 ↻(누르면 그 사진만 다시). 목록을 다시 그려도 받아 둔 그림은 바로 쓴다.
let watcher = null;
function fill(el) {
  const id = el.dataset.luThumb, cached = cachedLibraryPhotoUrl(id, 'small');
  slotBox(el);
  const again = () => { el.replaceChildren(); fill(el); };
  const show = url => {
    if (!el.isConnected) return;
    const img = document.createElement('img');
    img.alt = ''; img.decoding = 'async'; img.draggable = false;
    el.replaceChildren();
    el.dataset.state = 'shown';
    slotImg(el, img, url, {retry: again, onFailed: () => { el.dataset.state = 'failed'; }});
  };
  if (cached) { show(cached); return; }
  el.dataset.state = 'loading';
  libraryPhotoUrl(id, 'small').then(show, () => { el.dataset.state = 'failed'; slotFailed(el, again, 'photo'); });
}
export function hydrateLibraryThumbs(root) {
  const cells = [...(root?.querySelectorAll?.('.lu-thumb[data-lu-thumb]:not([data-state])') || [])];
  if (!cells.length) return;
  if (typeof IntersectionObserver !== 'function') { cells.forEach(fill); return; }
  watcher ||= new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) { watcher.unobserve(entry.target); if (!entry.target.dataset.state) fill(entry.target); }
  }, {rootMargin: '200px'});
  cells.forEach(el => watcher.observe(el));
}
