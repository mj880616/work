// S48-31 새 폰 폴더는 꺼진 채: 폰 사진을 읽기 전에 폰 폴더 목록을 '아는 폴더'(view_prefs.phone_folders_known)와 맞춰 본다.
// - 규칙은 phone-folders-model.mjs reconcilePhoneFolders(화면 없이 시험). 여기는 폰 앱 다리·화면 기억(서버 저장)만 잇는다. 기기 저장 없음.
// - 폰 앱 0.4.1+(상태에 hide)이고 사진 접근이 '전체'일 때만 한다. '고른 사진만'이면 폴더가 일부만 보여 새 폴더로 잘못 알 수 있어 하지 않는다.
// - 화면 기억을 서버에서 읽은 뒤(status 'ok')에만 한다. 못 읽은 채로 하면 아는 폴더를 처음부터 다시 채워 새 폴더가 켜진 채 남는다.
// - 폴더 목록은 5분에 한 번만 다시 읽는다(사진 [폴더] 탭이 읽은 목록은 folders로 넘겨 다시 읽지 않는다).
// - DB 적용 전에는 phone_folders_known 쓰기가 거절된다(이 접속에서는 다시 보내지 않음). 그동안은 지금처럼 새 폴더가 켜진 채다.
// - S53-3 PHOTO-폰불러오기느림: 사진 읽기는 맞춰 보기를 QUICK_MS까지만 기다린다(quick). 그보다 늦으면 지금 끈 목록으로 먼저 읽고,
//   맞춰 보기가 끝나 새로 끈 폴더가 생기면 onLateAdded로 알린다(받는 화면이 목록을 다시 읽는다). 첫 화면이 폴더 목록 읽기를 기다리지 않게.
import {viewPrefs} from './view-prefs.js';
import {parsePhoneOff, phoneOffValue, parsePhoneKnown, reconcilePhoneFolders, sameKnown} from './phone-folders-model.mjs';

const TTL = 5 * 60 * 1000;
export const QUICK_MS = 800;

export function createPhoneFoldersSync({prefs = viewPrefs, clock = () => Date.now(), win = globalThis.window, quickMs = QUICK_MS} = {}) {
  let lastAt = -Infinity, running = null, knownRefused = false;
  const lateListeners = new Set();
  const late = new WeakSet(); // quick가 기다리다 먼저 간 맞춰 보기
  win?.addEventListener?.('kptu:view-prefs-rejected', e => { if ((e.detail?.paths || []).includes('phone_folders_known')) knownRefused = true; });
  const currentOff = () => parsePhoneOff(prefs.get('phone_folders_off'));
  const currentKnown = () => parsePhoneKnown(prefs.get('phone_folders_known'));
  // 아는 폴더 저장(같은 값이면 보내지 않음). 적용 전 거절이 한 번 나면 이 접속에서는 보내지 않는다.
  function saveKnown(value) {
    if (!Array.isArray(value) || knownRefused) return;
    const now = prefs.get('phone_folders_known');
    if (Array.isArray(now) && sameKnown(now, value)) return;
    prefs.set('phone_folders_known', value, {rejectable:true});
  }
  const canSync = phone => !!phone?.usable && phone.state?.().hide === true && phone.state().access === 'full' && !!phone.state().key && prefs.status() === 'ok';
  const stay = () => ({off:currentOff(), added:[]});
  // → {off:Set(끈 폴더), added:[새로 끈 경로]}. 맞춰 볼 수 없으면 지금 끈 목록 그대로.
  function sync(phone, {folders = null, force = false} = {}) {
    if (!canSync(phone)) return Promise.resolve(stay());
    if (!folders && !force && clock() - lastAt < TTL) return Promise.resolve(stay());
    if (running && !folders) return running;
    const job = (async () => {
      let list = folders;
      if (!list) { try { list = await phone.folders(); } catch { list = null; } }
      if (!Array.isArray(list) || !canSync(phone)) return stay();
      lastAt = clock();
      const known = currentKnown();
      if (!known && knownRefused) return stay();
      const r = reconcilePhoneFolders({folders:list, off:currentOff(), known});
      if (r.knownChanged && r.known) saveKnown(r.known);
      if (r.offChanged) {
        const value = phoneOffValue(r.off);
        if (!value) return stay();
        prefs.set('phone_folders_off', value, {rejectable:true});
      }
      return {off:r.off, added:r.added};
    })();
    if (!folders) {
      running = job;
      job.finally(() => { if (running === job) running = null; });
      job.then(r => { if (late.has(job) && r.added.length) lateListeners.forEach(fn => { try { fn(r); } catch { /* 한 곳 실패가 다른 곳을 막지 않게 */ } }); }, () => {});
    }
    return job;
  }
  // 맞춰 보기를 quickMs까지만 기다린다. 늦으면 null(부른 쪽은 지금 끈 목록으로 읽고, 끝나면 onLateAdded가 알린다).
  function quick(phone) {
    const job = sync(phone);
    let timer = null;
    const wait = new Promise(ok => { timer = setTimeout(() => { late.add(job); ok(null); }, quickMs); });
    return Promise.race([job, wait]).finally(() => clearTimeout(timer));
  }
  return {
    sync,
    quick,
    onLateAdded(fn) { lateListeners.add(fn); return () => lateListeners.delete(fn); },
    // 폰 사진 읽기에 붙일 끈 폴더 목록(맞춰 본 뒤, 늦으면 지금 끈 목록).
    hideList: async phone => [...((await quick(phone)) || stay()).off],
    saveKnown,
    currentOff,
    currentKnown
  };
}
const shared = createPhoneFoldersSync();
export const syncPhoneFolders = (phone, options) => shared.sync(phone, options);
export const quickPhoneFolders = phone => shared.quick(phone);
export const onPhoneFoldersLateAdded = fn => shared.onLateAdded(fn);
export const phoneHideList = phone => shared.hideList(phone);
export const savePhoneKnown = value => shared.saveKnown(value);
export const currentPhoneKnown = () => shared.currentKnown();
