// S69-52 ① 자료실 ⋯ [드라이브와 맞는지 보기]: 화면 글 규칙(DOM·네트워크 없음). 시험: tests/library-drive-check-model.test.mjs.
// 서버(workspace-drive drive-check, _shared/library-drive-check.mjs)가 준 줄·숫자만 쓴다.
export const DRIVE_CHECK_LABEL = '드라이브와 맞는지 보기';
export const CHECK_ROUNDS = 40;
export const CHECK_WAIT_MS = 45000; // 서버는 한 번에 10초까지만 하고 돌려준다
export const KIND_ORDER = Object.freeze(['missing', 'extra', 'file', 'name', 'place']);
export const KIND_TITLE = Object.freeze({
  missing: '드라이브에 없는 자료실 폴더', extra: '자료실에 없는 드라이브 폴더', file: '다른 폴더에 있는 파일', name: '이름 다른 폴더', place: '자리 다른 폴더',
});
export const REASON_WORDS = Object.freeze({
  parent_first: '위 폴더부터 맞춰야 해요', long_name: '이름이 40자를 넘어 자료실 폴더로 만들 수 없어요', in_trash: '자료실 휴지통에 있는 폴더의 짝이에요',
  gone: '이미 맞았거나 없어졌어요', cant_app: '자료실이 모르는 자리예요',
});
const n = v => Number(v) || 0;
const pathText = (p, top = '자료실') => [top, ...(Array.isArray(p) ? p : [])].join(' › ');

/** 위 한 줄. */
export function headLine(scan) {
  if (!scan?.ok) return '';
  const total = n(scan.total);
  return total ? `어긋난 곳 ${total}개` : '드라이브와 같아요';
}

/** 아래 작은 안내(연결된 원본·다른 앱 파일·폴더 먼저). 없으면 ''. */
export function noteLine(scan) {
  const parts = [];
  if (n(scan?.linked)) parts.push(`연결된 원본 ${n(scan.linked)}개는 드라이브 원래 자리에 그대로 둬요`);
  if (n(scan?.outside)) parts.push(`자료실 밖에 있는 다른 기능 파일 ${n(scan.outside)}개도 그대로 둬요`);
  if (n(scan?.waiting)) parts.push(`폴더를 먼저 맞추면 자료 ${n(scan.waiting)}개를 더 살펴요`);
  if (scan?.partial) parts.push('폴더가 많아 일부만 봤어요');
  return parts.join(' · ');
}

/**
 * 줄 하나 → {text, sub, acts:[{to?, label}], note}. to 없음 = 서버 기본(바뀐 쪽, 모르면 드라이브).
 */
export function lineView(kind, l) {
  if (kind === 'missing') return { text: pathText(l.path), sub: '드라이브에 같은 자리 폴더를 만들어요', acts: [{ label: '맞추기' }] };
  if (kind === 'extra') {
    const note = l.in_trash ? REASON_WORDS.in_trash : !l.can_app ? REASON_WORDS.long_name : !l.parent_ready ? REASON_WORDS.parent_first : '';
    return { text: pathText(l.path), sub: '자료실에 같은 자리 폴더를 만들어요', acts: l.can_app ? [{ label: '맞추기' }] : [], note };
  }
  if (kind === 'file') return { text: l.title || '이름 없는 자료', sub: `드라이브 ${pathText(l.from)} → ${pathText(l.to)}`, acts: [{ label: '맞추기' }] };
  if (kind === 'name') {
    const acts = [];
    if (l.can_app) acts.push({ to: 'app', label: '드라이브 이름으로' });
    acts.push({ to: 'drive', label: '자료실 이름으로' });
    const which = l.suggest === 'app' ? '드라이브에서 바꿨어요' : l.suggest === 'drive' ? '자료실에서 바꿨어요' : '어느 쪽에서 바꿨는지 몰라요';
    return { text: `자료실 '${l.app_name}' · 드라이브 '${l.drive_name}'`, sub: which, acts, prefer: l.suggest || (l.can_app ? 'app' : 'drive') };
  }
  if (kind === 'place') {
    const acts = [];
    if (l.can_app) acts.push({ to: 'app', label: '드라이브 자리로' });
    acts.push({ to: 'drive', label: '자료실 자리로' });
    const where = l.outside ? '드라이브에서 자료실 밖으로 옮겨졌어요' : `드라이브 ${pathText(l.drive_path)}`;
    return { text: pathText(l.path), sub: where, acts, prefer: l.suggest || (l.can_app ? 'app' : 'drive') };
  }
  return { text: '', sub: '', acts: [] };
}

export function addFix(sum, r) {
  const out = { ...sum };
  for (const k of ['done', 'failed', 'cant', 'skipped']) out[k] = n(out[k]) + n(r?.[k]);
  out.reasons = { ...(sum?.reasons || {}) };
  for (const [k, v] of Object.entries(r?.reasons || {})) out.reasons[k] = n(out.reasons[k]) + n(v);
  out.left = n(r?.left);
  return out;
}

/** 맞추기 결과 한 줄. */
export function fixLine(s) {
  const extra = [
    n(s.cant) ? `권한이 없어 그대로 ${n(s.cant)}` : '', n(s.failed) ? `실패 ${n(s.failed)}` : '',
    ...Object.entries(s.reasons || {}).filter(([k, v]) => n(v) && k !== 'gone').map(([k, v]) => `${REASON_WORDS[k] || '건너뜀'} ${n(v)}`),
    n(s.left) ? `남음 ${n(s.left)} — 다시 누르면 이어서 해요` : '',
  ].filter(Boolean);
  return `맞춤 ${n(s.done)}` + (extra.length ? ' · ' + extra.join(' · ') : '');
}
export const undoLine = (restored, stopped) => `되돌렸어요 · ${n(restored)}곳` + (stopped ? ' · 중간에 멈췄어요 — 다시 눌러 주세요' : '');

export function failText(code) {
  if (code === 'drive_not_connected') return 'Google Drive 연결을 확인해 주세요.';
  if (code === 'none' || code === 'library_missing') return '드라이브 자료실 폴더가 아직 없어요.';
  return '드라이브를 읽지 못했어요. 잠시 뒤 다시 해 주세요.';
}
