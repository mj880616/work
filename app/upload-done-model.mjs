// LIB-업로드완료알림 (2026-11-03): 올리기가 끝났을 때 알림 한 줄의 글(화면 없이 시험하는 부분).
// 한 개: '○○.pdf 올렸어요' / 여러 개: 'n개 올렸어요' / 실패가 있으면 'n개 못 올렸어요' / 둘 다: 'n개 올렸어요 · m개 못 올렸어요'.
// 폴더·묶음 이름이 있으면 'A에 n개 올렸어요'(끌어 놓기 결과 글과 같은 말). 파일 이름 말고 자료 내용은 담지 않는다.
const SHORT = 28;
const clip = name => { const s = String(name ?? '').replace(/\s+/g, ' ').trim(); return s.length > SHORT ? s.slice(0, SHORT - 1) + '…' : s; };
export function uploadDoneLine({ done = 0, names = [], failed = 0, where = '' } = {}) {
  const ok = Math.max(0, Number(done) || 0), bad = Math.max(0, Number(failed) || 0);
  if (!ok && !bad) return '';
  const list = (Array.isArray(names) ? names : []).filter(Boolean);
  const loc = where ? `${where}에 ` : '';
  const good = !ok ? '' : ok === 1 && list.length ? `${loc}${clip(list[0])} 올렸어요` : `${loc}${ok}개 올렸어요`;
  if (!bad) return good;
  return good ? `${good} · ${bad}개 못 올렸어요` : `${bad}개 못 올렸어요`;
}
// 알림이 보이는 시간(ms): 큰 파일을 올리고 다른 일을 하다 보게 기본(2초)보다 길게, 실패가 있으면 더 길게.
export const uploadDoneMs = ({ failed = 0 } = {}) => (failed ? 6000 : 4000);
