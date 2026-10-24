// TRASH-삭제휴지통 2단계: 프로젝트 휴지통 화면의 순수 규칙(화면·네트워크 없음). 시험이 직접 읽는다.
// 서버 쪽은 app_trash_list / app_trash_restore / app_trash_purge (p_kind='project') 뿐이고, 이 파일은 그 응답과 오류를
// 화면 글로 바꾸고 "휴지통을 쓸 수 있는가"를 한 곳에서 판정한다. 브라우저 저장소는 쓰지 않는다.

export const TRASH_KIND = 'project';

// 판정은 목록 호출 결과 하나로 한다. ready = 목록을 받음(함수가 있음), missing = 함수 없음(DB 미적용), failed = 그 밖의 실패.
export const TRASH_STATE = Object.freeze({ UNKNOWN: 'unknown', READY: 'ready', MISSING: 'missing', FAILED: 'failed' });

export function classifyTrashError(error) {
  const status = Number(error?.status || 0);
  const text = `${error?.message || ''} ${error?.code || ''} ${error?.details || ''}`;
  if (status === 404 || /PGRST202|Could not find the function|schema cache/i.test(text)) return TRASH_STATE.MISSING;
  return TRASH_STATE.FAILED;
}

// 배열이 아닌 응답(null 등)은 휴지통 목록으로 보지 않는다. 그때는 기존 삭제 문구를 쓴다.
export function classifyTrashList(data) {
  return Array.isArray(data) ? TRASH_STATE.READY : TRASH_STATE.MISSING;
}

export function normalizeTrashRows(data) {
  if (!Array.isArray(data)) return [];
  return data
    .filter((row) => row && row.id && (row.kind || TRASH_KIND) === TRASH_KIND)
    .map((row) => ({
      id: String(row.id),
      name: String(row.name || '').trim() || '이름 없음',
      parent_id: row.parent_id || null,
      deleted_at: row.deleted_at || null,
      child_count: Math.max(0, Number(row.child_count) || 0),
      parent_in_trash: row.parent_in_trash === true,
    }))
    .sort((a, b) => String(b.deleted_at || '').localeCompare(String(a.deleted_at || '')) || a.id.localeCompare(b.id));
}

// 삭제 창 글. 휴지통을 쓸 수 있을 때만 휴지통 문구를 쓰고, 아니면 지금 동작(바로 지움)에 맞는 기존 문구를 쓴다.
export function deleteDialogText({ trash, name, isChild, childCount }) {
  const label = isChild ? '하위 프로젝트' : '프로젝트';
  if (trash === TRASH_STATE.READY) {
    const kids = childCount ? ` 하위 프로젝트 ${childCount}개도 함께 옮겨지고,` : '';
    return {
      title: name,
      message: `${label}를 휴지통으로 옮깁니다.${kids} 연결된 기록은 그대로 남습니다. 휴지통에서 되돌릴 수 있습니다.`,
      note: '',
      button: '휴지통으로 옮기기',
      busy: '옮기는 중…',
    };
  }
  return {
    title: name,
    message: `${label}를 삭제합니다.${childCount ? ` 하위 프로젝트 ${childCount}개도 함께 삭제됩니다.` : ''}`,
    note: '연결된 할 일·일정·사업 보고·자료·게시물은 삭제하지 않고 프로젝트 연결만 해제함. 프로젝트 전용 진행기록·주요 일정·의견은 함께 삭제됨.',
    button: '삭제',
    busy: '삭제 중…',
  };
}

export const TRASH_TEXT = Object.freeze({
  MOVED: '휴지통으로 옮겼습니다.',
  DELETED: '프로젝트를 삭제했습니다.',
  RESTORED: '프로젝트를 되돌렸습니다.',
  PURGED: '영구 삭제했습니다.',
  EMPTY: '휴지통이 비어 있습니다.',
  PREPARING: '휴지통은 준비 중입니다.',
  LOAD_FAILED: '휴지통을 불러오지 못했습니다.',
  PARENT_FIRST: '상위 프로젝트를 먼저 되돌려 주세요.',
  NOT_FOUND: '이미 휴지통에 없는 프로젝트입니다. 목록을 다시 불러왔습니다.',
  UNDO_DONE: '되돌렸습니다.',
  UNDO_FAILED: '되돌리지 못했습니다.',
});

// 서버 오류 코드(메시지 첫머리)를 화면 글로 바꾼다. 모르는 오류는 일반 문구로 둔다.
export function trashErrorText(error, fallback = '처리하지 못했습니다. 다시 시도해 주세요.') {
  const message = String(error?.message || '');
  if (/TRASH_PARENT_IN_TRASH/.test(message)) return TRASH_TEXT.PARENT_FIRST;
  if (/TRASH_NOT_FOUND/.test(message)) return TRASH_TEXT.NOT_FOUND;
  if (/TRASH_KIND_UNKNOWN/.test(message)) return fallback;
  return fallback;
}

export function purgeConfirmText(row) {
  const kids = row.child_count ? `\n함께 든 하위 프로젝트 ${row.child_count}개도 지워집니다.` : '';
  return `“${row.name}” 프로젝트를 영구 삭제할까요?${kids}\n연결된 할 일·일정·사업 보고·자료·게시물은 지우지 않고 프로젝트 연결만 풀립니다. 프로젝트 전용 진행기록·주요 일정·의견은 함께 지워지며 되돌릴 수 없습니다.`;
}

// 모달 위쪽 단추 줄(보관 / 휴지통) 이름. 보관이 없고 휴지통만 있으면 휴지통만 보인다.
export function archiveButtonLabel({ archived, trashCount, trash }) {
  const parts = [];
  if (archived > 0) parts.push(`보관 ${archived}`);
  if (trash === TRASH_STATE.READY && trashCount > 0) parts.push(`휴지통 ${trashCount}`);
  return parts.join(' · ');
}

// 단추를 눌렀을 때 먼저 보일 탭: 보관이 있으면 보관, 없으면 휴지통.
export function firstArchiveTab({ archived }) {
  return archived > 0 ? 'archive' : 'trash';
}
