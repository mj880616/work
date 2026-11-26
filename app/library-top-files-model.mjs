// S69-40 LIB-맨위파일정리: 화면 글 규칙(DOM·네트워크 없음). 시험: tests/library-top-files-model.test.mjs.
// 서버(library-files top-files-scan·tidy, top-files.mjs)가 준 숫자만 쓴다.
export const TOP_FILES_LABEL = '맨 위 파일 정리';
export const TIDY_ROUNDS = 40;
export const TIDY_WAIT_MS = 45000; // 서버는 한 번에 10초까지만 하고 돌려준다
const n = v => Number(v) || 0;

/** 정리하기 전 한 줄 요약. 아무것도 할 것이 없으면 null. */
export function scanLines(r) {
  const c = r?.counts || {};
  const move = n(c.library), attach = n(c.attach), trash = n(c.temp) + n(c.junk) + n(c.dup), wait = n(c.old) + n(c.none);
  const parts = [];
  if (move) parts.push(`제 폴더로 ${move}`);
  if (attach) parts.push(`첨부 폴더로 ${attach}`);
  if (trash) parts.push(`휴지통 ${trash}(` + [[c.temp, '앱 임시'], [c.junk, '찌꺼기'], [c.dup, '중복']].filter(([v]) => n(v)).map(([v, w]) => `${w} ${n(v)}`).join('·') + ')');
  if (wait) parts.push(`정리 대기 ${wait}(` + [[c.old, '바꿔 끼운 옛 원본'], [c.none, '앱 기록 없음']].filter(([v]) => n(v)).map(([v, w]) => `${w} ${n(v)}`).join('·') + ')');
  const keep = n(c.library_top) ? `폴더 밖 자료 ${n(c.library_top)}개는 그 자리가 맞아 그대로` : '';
  const align = n(r?.need_align) ? `${n(r.need_align)}개는 드라이브 폴더가 아직 없어 못 옮겼어요(잠시 뒤 다시)` : '';
  return { head: `드라이브 자료실 맨 위 파일 ${n(r?.total)}개`, todo: parts.length ? parts.join(' · ') : null, note: [keep, align, r?.partial ? '폴더가 많아 일부만 봤어요' : ''].filter(Boolean).join(' · ') };
}

export function addTidy(sum, r) {
  const out = { ...sum };
  for (const k of ['moved', 'attached', 'trashed', 'waiting', 'cant', 'failed']) out[k] = n(out[k]) + n(r?.[k]);
  out.left = n(r?.left);
  return out;
}

/** 결과 한 줄 "옮김 N · 첨부로 N · 휴지통 N · 정리 대기 N". */
export function tidyLine(s) {
  const extra = [n(s.cant) ? `권한이 없어 그대로 ${n(s.cant)}` : '', n(s.failed) ? `실패 ${n(s.failed)}` : '', n(s.left) ? `남음 ${n(s.left)} — 다시 누르면 이어서 해요` : ''].filter(Boolean);
  return `옮김 ${n(s.moved)} · 첨부로 ${n(s.attached)} · 휴지통 ${n(s.trashed)} · 정리 대기 ${n(s.waiting)}` + (extra.length ? ' · ' + extra.join(' · ') : '');
}

export function sizeShort(bytes) {
  const v = n(bytes);
  if (v <= 0) return '';
  if (v < 1024 * 1024) return Math.max(1, Math.round(v / 1024)) + 'KB';
  return (v / 1024 / 1024).toFixed(v < 10 * 1024 * 1024 ? 1 : 0) + 'MB';
}
