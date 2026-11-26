// HELP-처음쓰는사람안내 ③(시안 help-first-use.html ④, 사용자 확정 11/16): '앱 내려받기' 기기별 안내 — [안드로이드|아이폰|윈도우|맥] 탭, 지금 기기의 탭이 먼저 열린다.
// 쓰는 법 화면의 '앱 내려받기' 줄(help.js)과 계정 메뉴 '앱 내려받기'(아이폰·맥 등, topbar-actions.js)가 같이 쓴다. 글은 help-content.mjs 한 곳,
// 받는 주소는 app-download.mjs(배포 때 정한 최신 폰 앱·PC 도우미 — 같은 저장소·같은 태그 이름만). 탭 선택은 메모리에만(기기 저장 없음).
import {DEVICES, APP_GUIDE, deviceOf} from './help-content.mjs';
import {apkFromInfo, loadPhoneAppInfo, RELEASES_PAGE, setupFromInfo, loadPcAppInfo, PC_RELEASES_PAGE, PC_BUTTON} from './app-download.mjs';

const el = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text != null) n.textContent = text; return n; };
let seq = 0;

function actionNode(kind) {
  if (kind === 'android') {
    const a = el('a', 'secondary mini adg-link', '안드로이드 앱 내려받기'); a.href = RELEASES_PAGE; a.rel = 'noopener'; a.dataset.adgAndroid = '';
    void loadPhoneAppInfo().then(info => { const apk = apkFromInfo(info); if (apk) { a.href = apk.url; a.textContent = `안드로이드 앱 내려받기 (${apk.version})`; } });
    return a;
  }
  if (kind === 'windows') {
    const a = el('a', 'secondary mini adg-link', PC_BUTTON); a.href = PC_RELEASES_PAGE; a.rel = 'noopener'; a.dataset.adgPc = '';
    void loadPcAppInfo().then(info => { const s = setupFromInfo(info); if (s) { a.href = s.url; a.textContent = `${PC_BUTTON} (${s.version})`; } });
    return a;
  }
  return null;
}

/** 탭 + 단계 안내 한 덩어리. ua로 먼저 열 탭을 정한다. */
export function appGuideEl({ua = navigator.userAgent || ''} = {}) {
  const id = 'adg' + (++seq);
  const root = el('div', 'adg'); root.dataset.appGuide = '';
  const tabs = el('div', 'adg-tabs ds-seg'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', '기기');
  const panel = el('div', 'adg-panel'); panel.id = id + 'p'; panel.setAttribute('role', 'tabpanel');
  const show = device => {
    for (const b of tabs.children) { const on = b.dataset.adgTab === device; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; if (on) panel.setAttribute('aria-labelledby', b.id); }
    const g = APP_GUIDE[device];
    const ol = el('ol', 'fu-steps adg-steps');
    g.steps.forEach(([text, ex], i) => { const li = el('li', 'fu-step'); const t = el('span', 'fu-t', text); if (ex) t.append(el('small', 'fu-ex', ex)); li.append(el('span', 'fu-n', String(i + 1)), t); li.firstChild.setAttribute('aria-hidden', 'true'); ol.append(li); });
    const out = [ol];
    const act = actionNode(g.action); if (act) out.push(act);
    if (g.note) out.push(el('p', 'adg-note', g.note));
    panel.replaceChildren(...out);
    root.dataset.device = device;
  };
  for (const d of DEVICES) {
    const b = el('button', 'ds-seg-btn adg-tab', d.label); b.type = 'button'; b.id = `${id}-${d.id}`; b.dataset.adgTab = d.id; b.setAttribute('role', 'tab'); b.setAttribute('aria-controls', panel.id);
    tabs.append(b);
  }
  tabs.addEventListener('click', e => { const b = e.target.closest?.('[data-adg-tab]'); if (b) show(b.dataset.adgTab); });
  tabs.addEventListener('keydown', e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const list = [...tabs.children], i = list.indexOf(document.activeElement); if (i < 0) return;
    e.preventDefault(); const next = list[(i + (e.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length]; show(next.dataset.adgTab); next.focus();
  });
  root.append(tabs, panel);
  show(deviceOf(ua));
  return root;
}

/** 계정 메뉴 '앱 내려받기'(아이폰·맥 등): 작은 창으로 같은 안내를 연다. */
export async function openAppGuide(trigger) {
  const {openFormModal} = await import('./small-form-modal.js');
  openFormModal({id: 'appGuideModal', title: '앱 내려받기', okLabel: '닫기', cancel: false, trigger, className: 'adg-modal',
    fill(body) { body.append(appGuideEl()); return '[aria-selected="true"]'; },
    onSubmit: async () => true});
}
