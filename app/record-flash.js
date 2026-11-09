// 열린 화면에서 기록 하나를 찾아 가운데로 옮기고 잠깐 밝히기 — 업무일지(journal.js)의 원본 열기와
// 담당조직 [전체 표]의 '원래 기록 열기'(S50-25, docs/design/weekly-menu-pairing.md 3.1·4.2 ⑨)가 같이 쓴다.
// - 주인 모듈이 그릴 때까지 몇 프레임 기다린다. 그려지지 않으면(없어짐) 화면만 열린 채 둔다. 조직 상세 '지난 기록 n'에 접힌 줄은 펼친다.
// - 열자마자 주인 모듈이 한 번 더 그리면(연결 기록 읽기 도착) 그 동안 다시 밝힌다(base-ui.css [data-journal-flash]).
// - 읽기·쓰기 없음, 브라우저 저장소 없음.
export const FLASH_MS = 1600;

// 조직 상세(#wdUpdates)의 기록 줄 고르기. record = 'up:<담당조직 기록 id>' | 'link:<연결 id>' | 'note:<업데이트·노트 id>'.
export function orgRecordSelector(record) {
  const [kind, id] = String(record || '').split(/:(.*)/s);
  if (!id) return '';
  if (kind === 'up') return `#wdUpdates [data-wd-up="${CSS.escape(id)}"]`;
  if (kind === 'note') return `#wdUpdates [data-basket-link-note="${CSS.escape(id)}"]`;
  return `#wdUpdates [data-basket-link="${CSS.escape(id)}"]`;
}

export async function flashRecord(selector) {
  if (!selector) return false;
  // ORG-기록하나로 O-5: 조직 상세의 오래된 기록은 '지난 기록 n'(details) 안에 접혀 있다 — 찾는 기록이 거기 있으면 펼친다.
  const find = () => {
    const all = [...document.querySelectorAll(selector)];
    for (const node of all) { const fold = node.closest('details[data-wd-log-older]'); if (fold && !fold.open) fold.open = true; }
    return all.find(node => node.getClientRects().length);
  };
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  let el = null, until = 0;
  for (let i = 0; i < 90 && !el; i++) { el = find(); if (!el) await frame(); }
  if (!el) return false;
  const light = node => {
    node.scrollIntoView({block:'center', behavior:'instant'});
    node.removeAttribute('data-journal-flash'); void node.offsetWidth; node.setAttribute('data-journal-flash', '');
    node.addEventListener('animationend', () => node.removeAttribute('data-journal-flash'), {once:true});
  };
  light(el); until = performance.now() + FLASH_MS;
  while (performance.now() < until) {
    await frame();
    if (el.isConnected) continue;
    const again = find(); if (!again) return true;
    el = again; light(el);
  }
  return true;
}
