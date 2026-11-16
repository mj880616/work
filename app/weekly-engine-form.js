// WEEKLY-내양식자유변형 ⑤-2(명진 결정 11/16 "가" — 자동 저장): 한글 파일 엔진에 넘길 양식(profile)을 '내 양식'(app_weekly_forms)에서 고른다.
//  - engineForm(rt): 바탕(확정본)을 열기 전에 저장된 '내 양식'을 읽는다.
//      자리가 모두 붙은 양식 → 그 profile(status 'own').
//      저장된 양식 없음 → 지금과 같은 기본값 LEGACY_PROFILE(status 'none' — 바탕을 연 뒤 adoptLegacyForm 으로 한 번 옮긴다).
//      자리가 깨진 양식(칸 수 바꿈·자리 없음 등) → 기본값으로 열되 몰래 돌지 않고 한 줄 안내(status 'broken').
//      표 준비 전(missing) → 기본값, 안내 없음. 읽기 실패 → 기본값 + 한 줄 안내(status 'readFailed'). 던지지 않는다.
//  - adoptLegacyForm(rt): 자료실 바탕을 지금 양식(LEGACY_PROFILE)으로 연 사람에게만, 지금 엔진 글자(LEGACY_FORM) 그대로를 본인 로그인으로
//      자기 '내 양식'에 한 번 저장한다(owner RLS 그대로, 기존 saveOwnForm). 이미 있으면(다른 기기가 먼저 저장 — 409) 그대로 둔다.
//      같은 작업공간에서 저장 중·저장한 뒤에는 다시 보내지 않는다(두 번 저장 방지). 실패해도 화면은 기본값으로 계속, 한 줄 안내.
//      바탕 없는 새 가입자에게는 부르지 않는다(11/15 결정 — 부르는 쪽 journal-hwpx.js 가 자료실 바탕일 때만 부름).
// 결과물은 지금과 똑같다: 저장되는 양식의 profile = LEGACY_PROFILE(tests/weekly-engine-form.test.mjs).
// ⑤-3에서 LEGACY_FORM·LEGACY_PROFILE 과 함께 이 옮기기를 지운다. 브라우저 저장소 없음. 로그·오류에 양식 글자를 쓰지 않는다.
import {readOwnForm, saveOwnForm} from './weekly-own-form-store.js';
import {LEGACY_FORM, LEGACY_PROFILE, profileOf} from './weekly-hwpx/form-profile.mjs';

// 화면 글(docs/design/ui-words.md). 상태 줄 한 줄.
export const ENGINE_FORM_TEXT = Object.freeze({
  broken: '내 양식이 한글 파일 칸과 맞지 않아 기본 양식으로 열었어요.',
  readFailed: '내 양식을 읽지 못해 기본 양식으로 열었어요.',
  saveFailed: '내 양식으로 옮겨 두지 못했어요. 다음에 열 때 다시 해요.',
});

// → {status:'own'|'none'|'missing'|'broken'|'readFailed', profile, note}
export async function engineForm(rt = window.KPTURuntime) {
  let read;
  try { read = await readOwnForm(rt); }
  catch { return {status: 'readFailed', profile: LEGACY_PROFILE, note: ENGINE_FORM_TEXT.readFailed}; }
  if (read.missing) return {status: 'missing', profile: LEGACY_PROFILE, note: ''};
  if (!read.row) return {status: 'none', profile: LEGACY_PROFILE, note: ''};
  const profile = profileOf(read.row.form);
  return profile ? {status: 'own', profile, note: ''} : {status: 'broken', profile: LEGACY_PROFILE, note: ENGINE_FORM_TEXT.broken};
}

const adopting = new Map(); // 작업공간 → 저장 약속(한 번만)
const workspaceOf = rt => rt?.context?.read?.()?.workspace?.id ?? '';

// → {status:'saved'|'exists'|'missing'|'failed', note}
export function adoptLegacyForm(rt = window.KPTURuntime) {
  const ws = workspaceOf(rt);
  if (!ws) return Promise.resolve({status: 'failed', note: ENGINE_FORM_TEXT.saveFailed});
  if (adopting.has(ws)) return adopting.get(ws);
  const job = (async () => {
    try {
      const r = await saveOwnForm({known: null, name: '', form: LEGACY_FORM}, rt);
      if (r.ok) return {status: 'saved', note: ''};
      if (r.missing) { adopting.delete(ws); return {status: 'missing', note: ''}; }
      return {status: 'exists', note: ''}; // 그사이 다른 기기가 먼저 저장 — 그것을 그대로 둔다
    } catch {
      adopting.delete(ws); // 다음에 열 때 다시
      return {status: 'failed', note: ENGINE_FORM_TEXT.saveFailed};
    }
  })();
  adopting.set(ws, job);
  return job;
}

// 시험용: 한 번 저장 기억 비우기(로그인 바뀜 등).
export function forgetAdopt() { adopting.clear(); }
