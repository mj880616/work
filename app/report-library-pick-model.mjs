// S67-39(사용자 11/20 20:20 "자료 + 자료실에서 추가도 가능하게", 20:25 "사업보고 사진 지우기 가능하게"):
// 사업 보고 '자료 +' [자료실에서 선택] 고르기 창 줄과 붙이기·빼기 결과 글의 순수 규칙(DOM·네트워크 없음, 단위 시험 대상).
// 화면은 report-library-pick.js. 고르기 창은 공용 library-move-picker.js(브리핑 룸 [자료실에서 선택]과 같은 창, 여러 개 선택).
// 붙이기 = 이미 있는 자료 행의 사업 보고 칸(app_documents.meeting_id)만 채운다(파일 다시 올리기·복사 없음, 같은 표·같은 owner RLS).
// 자료 행 하나는 사업 보고 하나에만 붙는다(칸이 하나). 그래서 다른 보고에 붙은 자료는 흐리게 '다른 보고에 있음'(옮기면 그 보고에서 빠지므로 고를 수 없음).
// 조직 보고(담당조직 상세)의 자료 칸도 같은 길(organization_id 칸, 다른 조직에 붙은 자료는 '다른 조직에 있음').
import { word } from './brand/brand.mjs';
export const PICK_RECENT = 50, PICK_FOUND = 100;
export const PICK_SECTIONS = Object.freeze({ all: '최근 자료', found: '찾은 자료' });
export const PICK_LABEL = '자료실에서 선택';
export const DEVICE_LABEL = '기기에서 업로드';
export const PICKED_NOTE = '저장하면 붙어요';
export const HERE_TAG = '이미 있음';
export const OTHER_TAG = '다른 보고에 있음';
export const OTHER_ORG_TAG = word('다른 조직에 있음');
// 붙이는 칸: 사업 보고(meeting_id) · 담당조직(organization_id, 조직 보고 자료 칸). 이 두 칸만 받는다.
export const PICK_COLUMNS = Object.freeze(['meeting_id', 'organization_id']);

const nameOf = d => String(d?.title || d?.file_name || '이름 없는 자료');

// docs = 내 자료실 자료(최근 순). column = 붙이는 칸, targetId = 지금 보고·조직(새 보고면 ''), chosen = 저장 전에 이미 고른 자료 id.
// meetingId는 column 'meeting_id'의 옛 이름(같은 뜻).
export function reportPickRows({ docs, column = 'meeting_id', targetId = '', meetingId = '', chosen = new Set(), query = '' }) {
  const col = PICK_COLUMNS.includes(column) ? column : 'meeting_id', target = targetId || meetingId;
  const otherTag = col === 'organization_id' ? OTHER_ORG_TAG : OTHER_TAG;
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const all = [];
  let total = 0;
  for (const d of Array.isArray(docs) ? docs : []) {
    if (!d || typeof d.id !== 'string') continue;
    total++;
    if (words.length) {
      const hay = `${d.title || ''} ${d.file_name || ''}`.toLowerCase();
      if (!words.every(w => hay.includes(w))) continue;
    }
    if (all.length >= (words.length ? PICK_FOUND : PICK_RECENT)) continue;
    const here = chosen.has(d.id) || (!!target && d[col] === target);
    const other = !here && !!d[col];
    const n = nameOf(d);
    all.push({ id: d.id, name: n, label: n, depth: 0, enabled: !here && !other, current: here, ...(other ? { tag: otherTag } : {}) });
  }
  return { recent: [], all, total };
}

// 고른 줄 → 저장 전 미리보기 칩에 쓸 모양(이름·형식만, 화면 메모리에만).
export function pickedChip(d) {
  return { id: String(d?.id || ''), name: String(d?.file_name || d?.title || '자료'), mime: String(d?.mime_type || '') };
}

// 붙인 뒤 한 줄. attached = 붙인 수, taken = 그사이 다른 보고에 붙어 건너뛴 수, failed = 못 붙인 수.
export function attachResult({ attached = 0, taken = 0, failed = 0, column = 'meeting_id' } = {}) {
  const where = column === 'organization_id' ? word('다른 조직') : '다른 보고';
  if (!attached && !taken && !failed) return null;
  if (!attached) return { text: taken && !failed ? `${where}에 붙은 자료라 붙이지 않았어요` : '자료를 붙이지 못했어요', error: true };
  const parts = [`자료 ${attached}개를 붙였어요`];
  if (taken) parts.push(`${taken}개는 ${where}에 있어 그대로 두었어요`);
  if (failed) parts.push(`${failed}개는 붙이지 못했어요`);
  return { text: parts.join(' · '), error: taken + failed > 0 };
}

// 빼기 확인·끝 글. kind = 'photo' | 'file'
export function detachAsk(name, kind = 'file') {
  const what = kind === 'photo' ? '사진' : '자료';
  return { text: `“${name}”을(를) 이 보고에서 뺄까요?`, note: `${what}${kind === 'photo' ? '과' : '와'} 파일은 자료실·Drive에 그대로 있고, 이 보고에 붙은 표시만 풀려요.`, ok: '빼기' };
}
export const detachDone = (kind = 'file') => (kind === 'photo' ? '이 보고에서 뺐어요. 사진은 자료실에 그대로 있어요.' : '이 보고에서 뺐어요. 자료는 자료실에 그대로 있어요.');
