// FILES-출처켜고끄기(S49-21, 요청함 11/04 07:34): [파일] 화면 위 줄 출처 아이콘 [원드라이브][구글 드라이브]의 켜기/끄기 규칙. 화면 없이 시험한다.
// - 서버 view_prefs.files_sources(migration 20261104090000)에 둔다(기기 저장 없음). 명진 결정 H-8(S49-26): 기기 종류마다 따로 기억한다 —
//   {app: {od, gd}, phone: {...}, pc: {...}}. app = 폰 앱(KPTUAndroid, phone-push-model.mjs isPhoneApp), phone = 폰 브라우저(폭 760 이하, 화면들이 쓰는 같은 기준),
//   pc = 그 밖(폴드 펼침 브라우저·PC). 종류는 화면을 연 때 한 번 정한다(접고 펴도 이번 접속은 같은 칸). 칸이 없으면 둘 다 켜짐(지금까지 보이던 그대로).
// - 켜진 출처 = 연결된 출처 중 켜진 것만 [최근]·[폴더]·[별표]·찾기·나무에 보인다. 끄기는 보기에서만 빠진다(연결·색인·밤 예약은 그대로).
// - 출처 이름은 files-model.mjs의 'od'·'gd'. 켜기/끄기 계산은 사진 화면과 같은 공용 규칙(source-flags.mjs).
import {parseFlags, toggleFlag} from './source-flags.mjs';
import {isPhoneApp} from './phone-push-model.mjs';

export const FILES_SOURCES_KEY = 'files_sources';
export const FILES_SRC = Object.freeze(['od', 'gd']);
export const FILES_SRC_DEFAULT = Object.freeze({od: true, gd: true});
export const parseFilesSources = value => parseFlags(value, FILES_SRC, FILES_SRC_DEFAULT);
export const filesSourcesValue = state => parseFilesSources(state);
export const FILES_DEVICES = Object.freeze(['app', 'phone', 'pc']);
export const PHONE_WIDTH_QUERY = '(max-width:760px)';
// 이 기기 종류. ua = navigator.userAgent, narrow = 폭 760 이하인가.
export const filesDeviceKind = ({ua = '', narrow = false} = {}) => (isPhoneApp(ua) ? 'app' : narrow ? 'phone' : 'pc');
export const toggleFilesSource = (state, name) => toggleFlag(state, FILES_SRC, FILES_SRC_DEFAULT, name);
// 보일 출처: 연결된 것(connected) 중 켜진 것. 순서는 connected 그대로.
export const visibleSources = (state, connected) => { const s = parseFilesSources(state); return (connected || []).filter(x => s[x] === true); };
// 줄 하나(색인 한 줄)가 켜진 출처 것인가.
export const rowVisible = (row, visible) => !!row && visible.includes(row.source);
export const filterBySource = (rows, visible) => (rows || []).filter(r => rowVisible(r, visible));
// 아이콘 단추 정보. connected = 그 출처가 연결됨.
export function chipInfo(state, connected, name) {
  const on = parseFilesSources(state)[name] === true, linked = (connected || []).includes(name);
  return {name, on, linked, pressed: linked && on};
}
