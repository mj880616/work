// S52-14 FILES-상자접힘기억(요청함 11/07 11:33, 명진 'ㅇ' — 상자만, 기기 종류별): [파일]·사진 [폴더]의 저장소 상자(원드라이브·구글 드라이브·이 폰·내 PC)
// 접힘·펼침 상태 한 곳. 서버 view_prefs.box_shut.<기기> = {files?, photos?: [접은 저장소]}에 기억한다 — 기기 저장 없음.
// 기기 종류(app 폰 앱·phone 폰 브라우저·pc 그 밖)는 files_sources·files_panes와 같은 filesDeviceKind로 정한다: 폰에서 접어도 PC는 그대로.
// 상자만 기억한다(안쪽 폴더 펼침은 기억하지 않는다 — 다시 열 때 미리 불러오기 없음). DB 적용 전이면 쓰기가 400이라 이번 접속만 접힌다.
// 노트·자료실 나무에는 저장소 상자가 없다(노트 폴더·자료실 폴더 상자 하나, '최근' 상자는 recent-fold.js).
import {viewPrefs, BOX_SHUT_SCREENS, FILES_PANE_SOURCES} from './view-prefs.js';
import {filesDeviceKind, PHONE_WIDTH_QUERY} from './files-sources-model.mjs';

// 사진 화면의 상자 이름 → 저장 이름(파일 화면과 같은 od·gd·ph·pc).
const PHOTO_CODE = Object.freeze({onedrive: 'od', gdrive: 'gd', phone: 'ph', pc: 'pc'});
const codeOf = (screen, source) => (screen === 'photos' ? PHOTO_CODE[source] : source);
// 기기 종류는 화면을 연 때 한 번 정한다([파일]의 DEVICE와 같은 값 — 폴드를 접고 펴도 같은 칸).
export const BOX_DEVICE = filesDeviceKind({ua: globalThis.navigator?.userAgent || '', narrow: !!globalThis.matchMedia?.(PHONE_WIDTH_QUERY)?.matches});

// 기기 칸 값에서 그 화면의 접은 저장소 목록(모양이 틀리면 빈 목록).
export function shutList(deviceValue, screen) {
  const v = deviceValue && typeof deviceValue === 'object' && !Array.isArray(deviceValue) ? deviceValue[screen] : null;
  return Array.isArray(v) ? v.filter(s => FILES_PANE_SOURCES.includes(s)) : [];
}
// 접기 ↔ 펼치기 뒤 기기 칸 값(다른 화면 칸은 그대로, 같은 저장소 두 번 없음, 빈 화면 칸은 뺀다).
export function toggledValue(deviceValue, screen, code) {
  const base = deviceValue && typeof deviceValue === 'object' && !Array.isArray(deviceValue) ? deviceValue : {};
  const out = {};
  for (const name of BOX_SHUT_SCREENS) { const list = shutList(base, name); if (list.length) out[name] = list; }
  const was = shutList(base, screen);
  const next = was.includes(code) ? was.filter(s => s !== code) : [...was, code];
  if (next.length) out[screen] = next; else delete out[screen];
  return out;
}

// DB 적용 전(서버가 box_shut을 400으로 거절)이면 view-prefs가 서버 값으로 되돌리므로, 이번 접속에서 고른 값을 화면 메모리에만 들고 있는다(기기 저장 없음).
let session = null, serverRefused = false;
const now = () => (serverRefused ? session : viewPrefs.getBoxShut?.(BOX_DEVICE));
globalThis.addEventListener?.('kptu:view-prefs-rejected', e => { if ((e.detail?.paths || []).includes('box_shut.' + BOX_DEVICE)) serverRefused = true; });

export function boxShut(screen, source) {
  const code = codeOf(screen, source);
  return !!code && shutList(now(), screen).includes(code);
}
// 접기 ↔ 펼치기. 돌려주는 값 = 이제 접혔는가.
export function toggleBoxShut(screen, source) {
  const code = codeOf(screen, source);
  if (!BOX_SHUT_SCREENS.includes(screen) || !FILES_PANE_SOURCES.includes(code)) return false;
  const value = toggledValue(now(), screen, code);
  session = value;
  viewPrefs.setBoxShut?.(BOX_DEVICE, value);
  return shutList(value, screen).includes(code);
}
