// APP-폰알림 N4(설계 docs/design/phone-notifications.md 3절): 내 프로필 '폰 알림' 칸의 규칙. 화면·서버 호출 없이 node --test로 확인한다.
// 설정 모양은 DB 검사 제약(app_profiles_notify_prefs_check, migration 20261101010000)과 같다:
//   {"kinds":{"task_due":true,…7가지},"quiet":{"from":"22:00","to":"07:00"}}. 비어 있으면 기본(전부 켬, 22:00~07:00 서울).
// 폰 앱 다리 글(push:…)은 android-app PushRules.kt와 같다.

export const KINDS = Object.freeze([
  ['task_due', '할 일 기한'],
  ['commitment', '원장 약속'],
  ['meeting_done', '회의 요약'],
  ['collect_stall', '수집 멈춤'],
  ['morning', '아침 묶음'],
  ['evening', '저녁 묶음'],
  ['next_week', '다음 주 준비'],
]);
export const KIND_KEYS = Object.freeze(KINDS.map(([k]) => k));
export const DEFAULT_QUIET = Object.freeze({from: '22:00', to: '07:00'});
export const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
export const TOKEN = /^[A-Za-z0-9_:-]{20,4096}$/;
const VERSION = /^[0-9A-Za-z.+-]{1,40}$/;

/** 서버 값(없거나 모양이 달라도) → 화면 값. 모르는 칸은 버리고 빠진 칸은 기본값. */
export function parsePrefs(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const kinds = {};
  const given = src.kinds && typeof src.kinds === 'object' && !Array.isArray(src.kinds) ? src.kinds : {};
  for (const key of KIND_KEYS) kinds[key] = typeof given[key] === 'boolean' ? given[key] : true;
  const q = src.quiet && typeof src.quiet === 'object' ? src.quiet : {};
  const quiet = TIME.test(q.from) && TIME.test(q.to) ? {from: q.from, to: q.to} : {...DEFAULT_QUIET};
  return {kinds, quiet};
}

/** 화면 값 → 저장 값(검사 제약에 맞는 모양만). 시간 모양이 틀리면 null(저장하지 않음). */
export function serializePrefs(prefs) {
  const p = parsePrefs({kinds: prefs?.kinds});
  const from = prefs?.quiet?.from, to = prefs?.quiet?.to;
  if (!TIME.test(from ?? '') || !TIME.test(to ?? '')) return null;
  return {kinds: p.kinds, quiet: {from, to}};
}

export function toggleKind(prefs, key) {
  if (!KIND_KEYS.includes(key)) return prefs;
  return {...prefs, kinds: {...prefs.kinds, [key]: !prefs.kinds[key]}};
}

export function onCount(prefs) {
  return KIND_KEYS.filter(k => prefs.kinds[k]).length;
}

/** 폰 앱이 다리로 보낸 글 → {state, token}. 알림 소식이 아니면 null. */
export function bridgeState(data) {
  if (typeof data !== 'string' || !data.startsWith('push:')) return null;
  if (data === 'push:none') return {state: 'none'};
  if (data === 'push:off') return {state: 'off'};
  if (data === 'push:denied') return {state: 'denied'};
  if (data === 'push:fail') return {state: 'fail'};
  if (data.startsWith('push:on:')) {
    const token = data.slice('push:on:'.length);
    return TOKEN.test(token) ? {state: 'on', token} : {state: 'fail'};
  }
  return null;
}

/** 폰 앱 판(KPTUAndroid/0.4.4) → 등록에 실을 판 번호. 없으면 undefined. */
export function appVersion(userAgent) {
  const m = /KPTUAndroid\/([0-9A-Za-z.+-]{1,40})/.exec(String(userAgent || ''));
  return m && VERSION.test(m[1]) ? m[1] : undefined;
}

export function isPhoneApp(userAgent) {
  return /KPTUAndroid/i.test(String(userAgent || ''));
}

/** phone-push가 돌려준 오류 이름 → 한 줄. */
export function errorText(code) {
  switch (String(code || '')) {
    case 'PUSH_NOT_CONFIGURED': return '알림 서버 설정 전이에요';
    case 'NO_DEVICE': return '등록된 폰이 없어요';
    case 'DAILY_LIMIT': return '오늘 시험 알림을 너무 많이 보냈어요';
    case 'TOO_MANY_DEVICES': return '등록된 폰이 너무 많아요. 안 쓰는 폰을 끊어 주세요';
    case 'UNAUTHORIZED': return '로그인을 다시 확인해 주세요';
    default: return '잠시 뒤 다시 해 주세요';
  }
}

export function testResultText(out) {
  const sent = Number(out?.sent) || 0, failed = Number(out?.failed) || 0, revoked = Number(out?.revoked) || 0;
  if (!sent) return revoked ? '폰 주소가 바뀌었어요. 폰 앱에서 다시 받기를 눌러 주세요' : '보내지 못했어요';
  return `시험 알림을 ${sent}대에 보냈어요${failed || revoked ? ` · 못 보냄 ${failed + revoked}` : ''}`;
}

const pad = n => String(n).padStart(2, '0');
/** 서울 시각 짧게: 11/01 10:20. */
export function shortWhen(iso) {
  const ms = Date.parse(iso || '');
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms + 9 * 3600000);
  return `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** 기기 줄: '폰 앱 0.4.4 · 11/01 10:20'. */
export function deviceLabel(device) {
  const ver = typeof device?.app_version === 'string' && VERSION.test(device.app_version) ? `폰 앱 ${device.app_version}` : '폰 앱';
  const when = shortWhen(device?.last_seen_at || device?.created_at);
  return when ? `${ver} · ${when}` : ver;
}
