// APP-폰알림 N4(설계 docs/design/phone-notifications.md 3절): 내 프로필 '폰 알림' 칸의 규칙. 화면·서버 호출 없이 node --test로 확인한다.
// 설정 모양은 DB 검사 제약(app_profiles_notify_prefs_check, migration 20261101010000)과 같다:
//   {"kinds":{"task_due":true,…},"quiet":{"from":"22:00","to":"07:00"}}. 비어 있으면 기본(전부 켬, 22:00~07:00 서울).
// 폰 앱 다리 글(push:…)은 android-app PushRules.kt와 같다.
// S62-27(JOURNAL-다음주준비삭제·PUSH-원장약속알림빼기): 'next_week'(다음 주 준비)·'commitment'(원장 약속) 종류는 없앴다. 저장된 설정에 옛 키가 남아 있어도
// parsePrefs가 모르는 칸으로 버리고, 다음 저장에서 빠진다(DB 검사는 허용 키 목록만 보므로 빠져도 통과).

export const KINDS = Object.freeze([
  ['task_due', '할 일 기한'],
  ['meeting_done', '회의 요약'],
  ['collect_stall', '수집 멈춤'],
  ['morning', '아침 묶음'],
  ['evening', '저녁 묶음'],
]);
export const KIND_KEYS = Object.freeze(KINDS.map(([k]) => k));
// MULTI-처음쓰는사람 ⑤: 통화·텔레그램 수집이 있는 운영자 계정에만 보이는 종류(고르기 칩만 빼고 저장 모양·서버 검사는 그대로).
export const COLLECT_KINDS = new Set(['collect_stall', 'morning', 'evening']);
// FAMILY-잊지말기 4단계: 운영자 기능 family가 있는 사람에게만 보이는 종류(잠금 화면엔 "잊지 말기 n건"만). 기본 켬이라 저장 값에는 끌 때만 kinds.family=false로 들어간다
// (DB 검사 20261105120000_family_push_kind가 이 키를 받는다. 켬일 때는 칸을 만들지 않아 기존 일곱 종류 모양 그대로).
export const FAMILY_KIND = Object.freeze(['family', '잊지 말기']);
// OPS-새가입알림(S62-25): 운영자(서버 허용 표 dev_inbox)에게만 보이는 종류 '새 가입'. family와 같은 방식 — 기본 켬, 끌 때만 kinds.signup=false
// (DB 검사 20261115234500_signup_notify가 이 키를 받는다). 알림은 서버가 운영자 작업공간에만 보내므로 칩을 빼는 것은 보안이 아니다.
export const SIGNUP_KIND = Object.freeze(['signup', '새 가입']);
// S69-97 노트 알림: 노트에 건 알림(정한 시각)을 서버(phone-push 15분 예약)가 보낸다. 모든 사람에게 보이는 칩. family·signup과 같은 방식 —
// 기본 켬, 끌 때만 kinds.note=false(DB 검사 20261125130000_note_alarm_push_kind가 이 키를 받는다. 켬일 때는 칸을 만들지 않아
// DB 변경 전에도 저장 모양이 그대로 통과한다).
export const NOTE_KIND = Object.freeze(['note', '노트 알림']);
export const SIGNUP_FEATURE = 'dev_inbox';
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
  return {kinds, quiet, family: given.family !== false, signup: given.signup !== false, note: given.note !== false};
}

/** 화면 값 → 저장 값(검사 제약에 맞는 모양만). 시간 모양이 틀리면 null(저장하지 않음). */
export function serializePrefs(prefs) {
  const p = parsePrefs({kinds: prefs?.kinds});
  const from = prefs?.quiet?.from, to = prefs?.quiet?.to;
  if (!TIME.test(from ?? '') || !TIME.test(to ?? '')) return null;
  const kinds = {...p.kinds, ...(prefs?.family === false ? {family: false} : {}), ...(prefs?.signup === false ? {signup: false} : {}), ...(prefs?.note === false ? {note: false} : {})};
  return {kinds, quiet: {from, to}};
}

export function toggleKind(prefs, key) {
  if (key === FAMILY_KIND[0]) return {...prefs, family: prefs.family === false};
  if (key === SIGNUP_KIND[0]) return {...prefs, signup: prefs.signup === false};
  if (key === NOTE_KIND[0]) return {...prefs, note: prefs.note === false};
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

// ---- UI-앱안알림 4·5단계(S47-40): 뒤에서 끝난 일 알림 줄 · 최근 알림 7일 ------------------------------------------------
// 서버(phone-push notices·recent)는 종류·기록 열쇠·시각·여는 주소만 준다. 보일 말은 종류에서 여기서 정한다(업무 내용 없음).
/** 알림 줄 한 줄(뒤에서 끝난 일). */
export const NOTICE_TEXT = Object.freeze({
  meeting_done: '회의 요약이 준비됐어요',
  signup: '새 가입', // 서버가 '새 가입 n명 — 이름'(text)을 함께 준다(이름은 기록에 남기지 않으므로). 없으면 이 말.
});
/** 최근 알림 목록의 '무엇'. */
export const RECENT_LABEL = Object.freeze({
  task_due: '할 일 기한', meeting_done: '회의 요약', collect_stall: '수집 멈춤',
  morning: '아침 묶음', evening: '저녁 묶음', quiet_digest: '조용한 시간 묶음', test: '시험 알림', family: '잊지 말기', signup: '새 가입',
});
const NOTICE_KIND = /^[a-z_]{1,20}$/;
const NOTICE_REF = /^[A-Za-z0-9_.:-]{1,80}$/;

/** 주소의 notice=종류.열쇠(폰 알림·알림 줄이 붙여 여는 표시) → {kind, ref_key} 또는 null. */
export function noticeParam(search) {
  let params;
  try { params = new URLSearchParams(String(search || '')); } catch { return null; }
  const raw = params.get('notice');
  if (!raw) return null;
  const dot = raw.indexOf('.');
  const kind = raw.slice(0, dot), ref = raw.slice(dot + 1);
  if (dot < 1 || !NOTICE_KIND.test(kind) || !Object.hasOwn(RECENT_LABEL, kind) || !NOTICE_REF.test(ref)) return null;
  return {kind, ref_key: ref};
}

/** APP-알림숫자지우기 ②: 웹2 안에서 알림 자리를 열었을 때 폰 앱에 보낼 '그 폰 알림 지우기' 다리 글. 꼬리표는 서버 open의 notice= 값(encodeURIComponent)과 같은 모양. 모양이 아니면 null. */
export function noticeClearMessage(kind, refKey) {
  if (typeof kind !== 'string' || typeof refKey !== 'string' || !NOTICE_KIND.test(kind) || !Object.hasOwn(RECENT_LABEL, kind) || !NOTICE_REF.test(refKey)) return null;
  return `push:clear:${kind}.${encodeURIComponent(refKey)}`;
}

/** 서버가 준 여는 주소(/work/app/?view=…) → 화면 안 이동 {view, pane} 또는 null. 웹2 앱 안 주소만. */
export function noticePlace(open) {
  if (typeof open !== 'string' || !/^\/work\/app\/(\?[A-Za-z0-9_=&%.-]{0,200})?$/.test(open)) return null;
  const params = new URLSearchParams(open.slice(open.indexOf('?') + 1 || open.length));
  const name = v => (v && /^[a-z][a-z0-9-]{0,31}$/.test(v) ? v : null);
  return {view: name(params.get('view')) || 'home', pane: name(params.get('pane'))};
}

/** 알림 줄에 올릴 수 있는 항목만(알아듣는 종류·모양). */
export function noticeItems(out) {
  const list = Array.isArray(out?.items) ? out.items : [];
  return list.filter(i => Object.hasOwn(NOTICE_TEXT, i?.kind) && NOTICE_REF.test(String(i?.ref_key || '')) && noticePlace(i?.open)).slice(0, 5);
}

/** 알림 줄 한 줄의 말. 서버 text는 signup만 받고(한 줄·100자), 그 밖에는 종류로 정한 말. */
export function noticeText(item) {
  const own = item?.kind === SIGNUP_KIND[0] && typeof item?.text === 'string'
    ? item.text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) : '';
  return own || NOTICE_TEXT[item?.kind] || '';
}

/** 최근 알림 한 줄: '11/06 16:00 · 회의 요약'. 모르는 종류는 뺀다. */
export function recentItems(out) {
  const list = Array.isArray(out?.items) ? out.items : [];
  return list.filter(i => Object.hasOwn(RECENT_LABEL, i?.kind) && shortWhen(i?.at) && noticePlace(i?.open))
    .map(i => ({kind: i.kind, ref_key: String(i.ref_key), open: i.open, opened: i.opened === true, line: `${shortWhen(i.at)} · ${RECENT_LABEL[i.kind]}`}));
}
