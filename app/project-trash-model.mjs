// TRASH-삭제휴지통 2단계 + TRASH-화면2: 휴지통 화면의 순수 규칙(화면·네트워크 없음). 시험이 직접 읽는다.
// 서버 쪽은 app_trash_list / app_trash_restore / app_trash_purge (p_kind = 프로젝트·담당조직·사업 보고·자료실 폴더) 뿐이고, 이 파일은
// 그 응답과 오류를 화면 글로 바꾸고 "휴지통을 쓸 수 있는가"를 종류마다 한 곳에서 판정한다. 브라우저 저장소는 쓰지 않는다.

export const TRASH_KIND = 'project';
export const TRASH_KINDS = Object.freeze(['project', 'organization', 'report', 'library_folder', 'note', 'share_page']);
// 종류 이름(화면 글). 사업 보고는 화면 어디서나 '사업 보고'라고 부른다.
export const TRASH_KIND_LABEL = Object.freeze({project: '사업영역', organization: '담당조직', report: '사업 보고', library_folder: '자료실 폴더', note: '노트·업데이트', share_page: '공유 페이지'});

// 판정은 목록 호출 결과 하나로 한다. ready = 목록을 받음(함수가 있음), missing = 함수 없음(DB 미적용), failed = 그 밖의 실패.
export const TRASH_STATE = Object.freeze({ UNKNOWN: 'unknown', READY: 'ready', MISSING: 'missing', FAILED: 'failed' });

// 판단 근거(DB 적용 전): 프로젝트 휴지통만 아는 옛 app_trash_list는 다른 종류를 받으면 TRASH_KIND_UNKNOWN(22023)으로 거절한다.
// 그 신호는 "이 종류는 아직 휴지통이 없다"는 뜻이라 MISSING으로 본다. 그때 [삭제]를 보내면 휴지통이 아니라 진짜 삭제가 되므로
// 화면은 삭제 요청을 보내지 않는다. 종류가 프로젝트일 때의 TRASH_KIND_UNKNOWN은 있을 수 없는 오류라 FAILED로 둔다.
export function classifyTrashError(error, kind = TRASH_KIND) {
  const status = Number(error?.status || 0);
  const text = `${error?.message || ''} ${error?.code || ''} ${error?.details || ''}`;
  if (status === 404 || /PGRST202|Could not find the function|schema cache/i.test(text)) return TRASH_STATE.MISSING;
  if (kind !== TRASH_KIND && /TRASH_KIND_UNKNOWN/.test(text)) return TRASH_STATE.MISSING;
  return TRASH_STATE.FAILED;
}

// 배열이 아닌 응답(null 등)은 휴지통 목록으로 보지 않는다. 그때는 기존 삭제 문구를 쓴다.
export function classifyTrashList(data) {
  return Array.isArray(data) ? TRASH_STATE.READY : TRASH_STATE.MISSING;
}

function reportTitle(row) {
  const series = String(row.series_name || '').trim();
  const title = String(row.title || '').trim();
  const round = Number(row.round_no) > 0 ? ` ${Number(row.round_no)}회` : '';
  return (series ? `${series}${round}` : title) || '이름 없는 사업 보고';
}

// 노트·업데이트 줄 이름: 제목, 없으면 본문 앞부분 미리보기, 둘 다 없으면 안내 이름.
function noteTitle(row) {
  return String(row.title || '').trim() || String(row.preview || '').trim() || (row.note_kind === 'note' ? '이름 없는 노트' : '내용 없는 업데이트');
}
export const noteKindWord = (noteKind) => (noteKind === 'note' ? '노트' : '업데이트');
// 공유 페이지: 휴지통에 넣기 전 상태(초안·게시·보관) 이름. 모르는 값은 빈 글(표시 안 함).
export const sharePrevWord = (prev) => (prev === 'published' ? '게시 중이던 페이지' : prev === 'archived' ? '보관함에 있던 페이지' : prev === 'draft' ? '초안' : '');

// kind를 주면 그 종류의 줄만, null을 주면 모든 종류. 줄마다 kind를 붙인다(프로젝트 줄 모양은 그대로).
export function normalizeTrashRows(data, kind = TRASH_KIND) {
  if (!Array.isArray(data)) return [];
  const want = (row) => (kind ? (row.kind || TRASH_KIND) === kind : TRASH_KINDS.includes(row.kind || TRASH_KIND));
  return data
    .filter((row) => row && row.id && want(row))
    .map((row) => {
      const rowKind = row.kind || TRASH_KIND;
      return {
        id: String(row.id),
        kind: rowKind,
        name: rowKind === 'report' ? reportTitle(row) : rowKind === 'note' ? noteTitle(row) : rowKind === 'share_page' ? String(row.title || '').trim() || '제목 없음' : String(row.name || '').trim() || '이름 없음',
        parent_id: row.parent_id || null,
        deleted_at: row.deleted_at || null,
        child_count: Math.max(0, Number(row.child_count) || 0),
        file_count: Math.max(0, Number(row.file_count) || 0),
        project_name: rowKind === 'library_folder' ? String(row.project_name || '').trim() : '',
        note_kind: rowKind === 'note' ? (row.note_kind === 'note' ? 'note' : 'basket') : '',
        link_count: Math.max(0, Number(row.link_count) || 0),
        prev_status: rowKind === 'share_page' ? (['draft', 'published', 'archived'].includes(row.prev_status) ? row.prev_status : '') : '',
        parent_in_trash: row.parent_in_trash === true,
      };
    })
    .sort((a, b) => String(b.deleted_at || '').localeCompare(String(a.deleted_at || '')) || a.id.localeCompare(b.id));
}

// 종류별로 따로 읽은 상태를 한 장으로 합친다. 하나라도 READY면 휴지통 탭을 연다(준비 중인 종류는 목록만 비어 있다).
// READY가 하나도 없으면: FAILED가 있으면 FAILED(다시 시도), 아니면 MISSING.
export function mergeTrashStates(states) {
  const list = Object.values(states || {});
  if (!list.length || list.includes(TRASH_STATE.UNKNOWN)) return TRASH_STATE.UNKNOWN;
  if (list.includes(TRASH_STATE.READY)) return TRASH_STATE.READY;
  return list.includes(TRASH_STATE.FAILED) ? TRASH_STATE.FAILED : TRASH_STATE.MISSING;
}

// 삭제 창 글. 휴지통을 쓸 수 있을 때만 휴지통 문구를 쓰고, 아니면 지금 동작(바로 지움)에 맞는 기존 문구를 쓴다.
export function deleteDialogText({ trash, name, isChild, childCount }) {
  const label = isChild ? '하위 사업영역' : '사업영역';
  if (trash === TRASH_STATE.READY) {
    const kids = childCount ? ` 하위 사업영역 ${childCount}개도 함께 옮겨지고,` : '';
    return {
      title: name,
      message: `${label}을 휴지통으로 옮깁니다.${kids} 연결된 기록은 그대로 남습니다. 휴지통에서 되돌릴 수 있습니다.`,
      note: '',
      button: '휴지통으로 옮기기',
      busy: '옮기는 중…',
    };
  }
  return {
    title: name,
    message: `${label}을 삭제합니다.${childCount ? ` 하위 사업영역 ${childCount}개도 함께 삭제됩니다.` : ''}`,
    note: '연결된 할 일·일정·사업 보고·자료·게시물은 삭제하지 않고 사업영역 연결만 해제함. 사업영역 전용 진행기록·주요 일정·의견은 함께 삭제됨.',
    button: '삭제',
    busy: '삭제 중…',
  };
}

// 담당조직·사업 보고·자료실 폴더 [삭제]의 글. 휴지통에 들어갔다는 안내는 목록으로 확인한 뒤에만 한다.
// detail: 자료실 폴더의 {folders, files}(아래 폴더 수·그 안 자료 수).
export function otherDeleteText(kind, name, detail = null) {
  const shown = String(name || '').trim();
  const q = shown ? `“${shown}” ` : '';
  if (kind === 'organization') {
    return {
      confirm: `${q}담당조직을 휴지통으로 옮길까요?\n연결된 기록·담당자·타임라인은 그대로 남고, 휴지통에서 되돌릴 수 있습니다.`,
      moved: '담당조직을 휴지통으로 옮겼습니다.',
    };
  }
  if (kind === 'library_folder') {
    const inside = [detail?.folders ? `아래 폴더 ${detail.folders}개` : '', detail?.files ? `자료 ${detail.files}개` : ''].filter(Boolean).join('·');
    return {
      confirm: `${q}폴더를 휴지통으로 옮길까요?${inside ? `\n${inside}도 함께 들어가고, 자료는 자료실 목록에서 함께 숨습니다.` : ''}\n자료와 Drive 파일은 지워지지 않고, 휴지통에서 되돌리면 원래대로 돌아옵니다.`,
      moved: '폴더를 휴지통으로 옮겼습니다.',
    };
  }
  if (kind === 'note') {
    const word = noteKindWord(detail?.noteKind);
    const files = detail?.attachments ? `\n첨부 파일 ${detail.attachments}개는 Drive에 그대로 남습니다.` : '';
    const links = detail?.links ? `\n연결된 ${detail.links}곳은 그대로 이어져 있고, 휴지통에서 되돌리면 원래대로 돌아옵니다.` : '\n휴지통에서 되돌릴 수 있습니다.';
    return {
      confirm: `${q}${word}를 휴지통으로 옮길까요?${files}${links}`,
      moved: `${word}를 휴지통으로 옮겼어요.`,
    };
  }
  if (kind === 'share_page') {
    const live = detail?.status === 'published' ? '\n게시가 멈춰 링크로 보던 사람도 볼 수 없게 되고, 휴지통에서 되돌리면 같은 링크가 다시 열립니다.' : '\n휴지통에서 되돌릴 수 있습니다.';
    return {
      confirm: `${q}공유 페이지를 휴지통으로 옮길까요?\n링크·사진은 지워지지 않습니다.${live}`,
      moved: '공유 페이지를 휴지통으로 옮겼어요.',
    };
  }
  return {
    confirm: `${q}사업 보고를 휴지통으로 옮길까요?\n후속 할 일은 Google 할 일에 남고 자료 파일은 삭제하지 않습니다. 휴지통에서 되돌릴 수 있습니다.`,
    moved: '사업 보고를 휴지통으로 옮겼습니다.',
  };
}

// 휴지통 확인이 끝나기 전에는 삭제를 보내지 않는다. 이유별 글.
export function otherDeleteBlockedText(kind, state) {
  if (state === TRASH_STATE.MISSING) return `${TRASH_KIND_LABEL[kind]} 휴지통은 준비 중입니다. 준비가 끝나기 전에는 삭제할 수 없습니다.`;
  return '휴지통 상태를 확인하지 못해 삭제하지 않았습니다. 잠시 뒤 다시 시도해 주세요.';
}

export const TRASH_TEXT = Object.freeze({
  MOVED: '휴지통으로 옮겼습니다.',
  DELETED: '사업영역을 삭제했습니다.',
  RESTORED: '사업영역을 되돌렸습니다.',
  PURGED: '영구 삭제했습니다.',
  EMPTY: '휴지통이 비어 있습니다.',
  PREPARING: '휴지통은 준비 중입니다.',
  LOAD_FAILED: '휴지통을 불러오지 못했습니다.',
  PARENT_FIRST: '상위 사업영역을 먼저 되돌려 주세요.',
  NOT_FOUND: '이미 휴지통에 없습니다. 목록을 다시 불러왔습니다.',
  UNDO_DONE: '되돌렸습니다.',
  UNDO_FAILED: '되돌리지 못했습니다.',
  NOT_CONFIRMED: '삭제 요청은 보냈지만 휴지통에서 확인하지 못했습니다. 보관 창의 휴지통을 확인해 주세요.',
  PARENT_FIRST_FOLDER: '상위 폴더를 먼저 되돌려 주세요.',
  FOLDER_DEPTH: '폴더 단 제한을 넘어 되돌리지 못했습니다. 위 폴더를 옮긴 뒤 다시 시도해 주세요.',
  NAME_TAKEN: '같은 이름이 이미 있어 되돌리지 못했습니다. 이름을 바꾼 뒤 다시 시도해 주세요.',
});

// 위 단계가 아직 휴지통일 때 먼저 되돌리라는 안내(프로젝트는 상위 프로젝트, 자료실 폴더는 상위 폴더).
export const parentFirstText = (kind) => (kind === 'library_folder' ? TRASH_TEXT.PARENT_FIRST_FOLDER : TRASH_TEXT.PARENT_FIRST);

export const restoredText = (kind) => (kind === 'share_page' ? '공유 페이지를 되돌렸습니다.' : kind === 'note' ? '글을 되돌렸습니다.' : kind === 'organization' ? '담당조직을 되돌렸습니다.' : kind === 'report' ? '사업 보고를 되돌렸습니다.' : kind === 'library_folder' ? '폴더를 되돌렸습니다.' : TRASH_TEXT.RESTORED);

// 서버 오류 코드(메시지 첫머리)를 화면 글로 바꾼다. 모르는 오류는 일반 문구로 둔다.
export function trashErrorText(error, fallback = '처리하지 못했습니다. 다시 시도해 주세요.') {
  const message = String(error?.message || '');
  if (/TRASH_PARENT_IN_TRASH/.test(message)) return TRASH_TEXT.PARENT_FIRST;
  if (/TRASH_NOT_FOUND/.test(message)) return TRASH_TEXT.NOT_FOUND;
  if (/LIB_FOLDER_DEPTH/.test(message)) return TRASH_TEXT.FOLDER_DEPTH;
  if (/TRASH_KIND_UNKNOWN/.test(message)) return fallback;
  // 되돌릴 때 같은 이름이 이미 있어 막히는 경우(고유 제약 23505). 서버가 막으면 일상어로 안내한다.
  if (error?.code === '23505' || /23505|duplicate key|unique constraint/i.test(`${message} ${error?.details || ''}`)) return TRASH_TEXT.NAME_TAKEN;
  return fallback;
}

export function purgeConfirmText(row) {
  if (row.kind === 'organization') {
    return `“${row.name}” 담당조직을 영구 삭제할까요?\n조직에 달린 기록·담당자·타임라인·쟁의단계와 메모·원장 연결이 함께 지워지며 되돌릴 수 없습니다.`;
  }
  if (row.kind === 'report') {
    return `“${row.name}” 사업 보고를 영구 삭제할까요?\n보고에 달린 메모·원장 연결이 함께 지워지며 되돌릴 수 없습니다. 후속 할 일(Google 할 일)과 자료 파일은 지우지 않습니다.`;
  }
  if (row.kind === 'share_page') {
    return `“${row.name}” 공유 페이지를 영구 삭제할까요?\n페이지·링크${row.file_count ? `·사진 ${row.file_count}장` : '·사진'}이 모두 지워지고 되돌릴 수 없습니다.`;
  }
  if (row.kind === 'note') {
    return `“${row.name}” ${noteKindWord(row.note_kind)}를 영구 삭제할까요?\n${row.link_count ? `조직·사업영역·사업 보고 연결 ${row.link_count}곳도 함께 지워지고 ` : ''}되돌릴 수 없습니다.${row.file_count ? ` 첨부 파일 ${row.file_count}개는 Drive에 그대로 남습니다.` : ''}`;
  }
  if (row.kind === 'library_folder') {
    const inside = [row.child_count ? `아래 폴더 ${row.child_count}개` : '', row.file_count ? `자료 ${row.file_count}개` : ''].filter(Boolean).join('·');
    return `“${row.name}” 폴더를 영구 삭제할까요?\n폴더만 지워지고${inside ? ` 안의 ${inside}는` : ' 안의 것은'} 한 단 위로 올라갑니다. 자료와 Drive 파일은 지우지 않으며 폴더는 되돌릴 수 없습니다.`;
  }
  const kids = row.child_count ? `\n함께 든 하위 사업영역 ${row.child_count}개도 지워집니다.` : '';
  return `“${row.name}” 사업영역을 영구 삭제할까요?${kids}\n연결된 할 일·일정·사업 보고·자료·게시물은 지우지 않고 사업영역 연결만 풀립니다. 사업영역 전용 진행기록·주요 일정·의견은 함께 지워지며 되돌릴 수 없습니다.`;
}

// 휴지통에 들어간 담당조직을 가리키는 연결의 이름자리. 조직 목록을 이미 읽었는데 이 조직만 없으면 휴지통에 있다.
export function missingOrganizationLabel(listLoaded) {
  return listLoaded ? '휴지통의 담당조직' : '담당조직';
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
