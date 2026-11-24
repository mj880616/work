// S68-02(명진 11/22 08:49 결정): 서버가 사용자 드라이브에 만드는 폴더 이름. 새 사용자는 'WORK ON+ …', 명진 화면(운영자 기능 nojo_words)은 지금 이름 '노조+ …'.
// 데이터 안전이 먼저다: 이미 있는 폴더의 이름은 바꾸지 않고 옮기지 않는다. 찾을 때는 옛 이름·새 이름을 모두 보고, 옛 이름 폴더가 있으면 그것을 계속 쓴다.
// 새로 만들 때만 이름을 고른다(folderNameFor). nojo_words인지 모르면(확인 실패) 지금 이름 그대로(옛 이름) — 지금 동작과 같은 쪽.
// 화면(app/brand/girok-words.mjs '노조+' → 'WORK ON+')도 같은 규칙으로 글자를 보인다. 서버가 실제 폴더 이름을 알려 줄 수 있으면 화면은 그 이름을 쓴다.
// DOM·네트워크 없음(단위 시험 tests/brand-folders.test.mjs).
export const NOJO_WORDS_FEATURE = 'nojo_words';

// S69-20(명진 11/24 08:48 'ㄱ'): 서버가 새 사용자 드라이브 맨 위에 만드는 앱 폴더 이름(자료실·회의자료·회의 녹음이 이 아래).
// 이미 있는 사람은 app_drive_settings.root_folder_id(폴더 id)로 찾으므로 이름을 바꾸지 않는다(명진은 '웹2' 그대로 — 드라이브에서 바꾼 이름 존중).
// 옛 기본 이름: library-files·workspace-drive '공공기관사업팀 Workspace', meeting-files·meeting-transcribe '웹2'.
export const ROOT_FOLDER_NAME = 'WORK ON+';

export const FOLDER_NAMES = Object.freeze({
  // record-backup '내 기록 백업' 맨 위 폴더(찾기는 이름이 아니라 appProperties 표식 kptu_backup=root)
  record_backup: Object.freeze({ old: '노조+ 백업', now: 'WORK ON+ 백업' }),
  // _shared/hwp-edit.ts 한글 문서 덮어쓰기 전 사본 폴더(내 드라이브 맨 위, 이름으로 찾음)
  edit_backup: Object.freeze({ old: '노조+ 편집 백업', now: 'WORK ON+ 편집 백업' }),
  // onedrive-photos 사진 휴지통(고른 맨 위 폴더 바로 아래, 이름으로 찾음)
  photo_trash: Object.freeze({ old: '.노조+ 휴지통', now: '.WORK ON+ 휴지통' }),
});

// S68-21(명진 11/22 17:04): 서버가 새로 만드는 문서 안에 쓰는 앱 이름(record-backup 읽기용 문서 첫 줄). 폴더 이름과 같은 규칙.
export const APP_NAMES = Object.freeze({ old: '노조+', now: 'WORK ON+' });

/** 새로 만드는 문서에 쓸 앱 이름. keepOld: false → 'WORK ON+', 그 밖(nojo_words·모름) → '노조+'(지금 동작과 같은 쪽). */
export const appNameFor = keepOld => keepOld === false ? APP_NAMES.now : APP_NAMES.old;

/** 이 종류 폴더의 이름 둘(옛·새). 찾기·휴지통 판별·이름 거절에 쓴다. */
export const folderNames = kind => [FOLDER_NAMES[kind].old, FOLDER_NAMES[kind].now];

/** 새로 만들 때 쓸 이름. keepOld: true(nojo_words) → 옛 이름, false → 새 이름, 그 밖(모름) → 옛 이름. */
export function folderNameFor(kind, keepOld) {
  const names = FOLDER_NAMES[kind];
  if (!names) throw new Error(`모르는 폴더 종류: ${kind}`);
  return keepOld === false ? names.now : names.old;
}

/** 로그인 사용자 토큰으로 부른 app_my_features() 답 → 옛 이름을 쓰나(true/false). 답이 목록이 아니면 null(모름). */
export function keepOldFromMyFeatures(features) {
  return Array.isArray(features) ? features.includes(NOJO_WORDS_FEATURE) : null;
}

/** service role로 부른 app_operator_feature_workspace('nojo_words') 답 → 이 작업공간이 옛 이름을 쓰나.
 * 답: 그 기능이 있는 작업공간 하나의 id, 없으면(또는 둘 이상이면) null. id가 이 작업공간이면 true, null이면 false, 그 밖(실패 등) null. */
export function keepOldFromFeatureWorkspace(answer, workspaceId) {
  if (typeof answer === 'string' && answer) return answer === workspaceId;
  if (answer === null) return false;
  return null;
}

/** Drive 검색 쿼리(q)의 작은따옴표 글자 안에 넣을 이름. '+'·공백은 그대로 되고, 역슬래시·작은따옴표만 막는다(URLSearchParams가 '+'를 %2B로 보냄). */
export const driveQuoted = name => String(name).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
