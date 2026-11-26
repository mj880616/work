// S69-34 APP-업데이트확인(사용자 요청 "앱에 업데이트 확인 버튼 추가 현재 버전 몇인지도 알려주고"): 계정 메뉴 '앱 정보'의 판단(화면 없이 시험).
// - 화면(웹) 판: Pages 빌드가 app.js에 붙인 ?v=(내용 해시)와 같은 빌드가 내보내는 공개 파일 app/build-info.json의 배포 시각.
// - 폰 앱 판: 사용자 에이전트 KPTUAndroid/<버전>(phone-push-model.mjs appVersion), 플레이 판은 ' WorkOnPlay' 표시(android-app build.gradle UA_MARK).
// - 옛 윈도우 앱(보관판): KPTUWindows/<버전>. PC 파일 올리기 도우미: 문(127.0.0.1) hello의 version.
// 저장하지 않는다(메모리만). 로그인·토큰·개인정보와 상관없다.
import {appVersion} from './phone-push-model.mjs';

const VER = /^\d{1,4}(?:\.\d{1,4}){1,3}$/;
const HASH = /^[A-Za-z0-9._-]{1,64}$/;

/** 지금 이 화면을 연 곳: android(폰 앱) · windows(옛 윈도우 앱) · web(브라우저). */
export function shellOf(ua = '') {
  const s = String(ua || '');
  const phone = appVersion(s);
  if (/KPTUAndroid/i.test(s)) return {kind: 'android', version: phone || '', channel: /WorkOnPlay/.test(s) ? 'play' : 'github'};
  const win = /KPTUWindows\/([0-9.]{1,20})/.exec(s);
  if (win) return {kind: 'windows', version: VER.test(win[1]) ? win[1] : ''};
  return {kind: 'web'};
}

/** 0.5.27 < 0.5.28. 모양이 이상하면 false(새 판으로 보지 않음). */
export function isNewer(next, now) {
  if (!VER.test(String(next || '')) || !VER.test(String(now || ''))) return false;
  const a = String(next).split('.').map(Number), b = String(now).split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0, y = b[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

/** build-info.json → {v, at}. 모양이 다르면 null. */
export function buildInfo(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const v = typeof raw.v === 'string' && HASH.test(raw.v) ? raw.v : '';
  const at = typeof raw.at === 'string' && Number.isFinite(Date.parse(raw.at)) ? raw.at : '';
  return v ? {v, at} : null;
}

const pad = n => String(n).padStart(2, '0');
/** 서울 시각: 2026-11-24 14:05. 못 읽으면 ''. */
export function stamp(iso) {
  const ms = Date.parse(iso || '');
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms + 9 * 3600000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** 화면 판 한 줄: '2026-11-24 14:05 배포 · a1b2c3' (시각을 모르면 판 번호만). */
export function webLine(current, info) {
  if (!current) return '시험판';
  const short = current.slice(0, 7);
  const when = info && info.v === current ? stamp(info.at) : '';
  return when ? `${when} 배포 · ${short}` : short;
}

/** 폰 앱 다리 답 → {state, version}. 업데이트 소식이 아니면 null. */
export function phoneAnswer(data) {
  const s = typeof data === 'string' ? data : '';
  if (!s.startsWith('update:')) return null;
  if (s === 'update:busy') return {state: 'busy'};
  if (s === 'update:fail') return {state: 'fail'};
  if (s === 'update:store') return {state: 'store'};
  const m = /^update:(new|latest):(.{1,40})$/.exec(s);
  if (m && VER.test(m[2])) return {state: m[1], version: m[2]};
  return null;
}

/** 폰 앱 다리 답 → 한 줄. */
export function phoneText(answer, current) {
  switch (answer?.state) {
    case 'new': return `새 앱 ${answer.version}이 있어요`;
    case 'latest': return `최신이에요 (${answer.version || current})`;
    case 'busy': return '확인 중이에요. 잠시 뒤 다시 눌러 주세요';
    case 'store': return '플레이 스토어에서 업데이트를 확인해 주세요';
    default: return '확인하지 못했어요. 잠시 뒤 다시 해 주세요';
  }
}
