// S68-02(명진 11/22 08:49 결정): 서버가 사용자 드라이브에 만드는 폴더 이름. 새 사용자는 'WORK ON+ …', 명진 화면(운영자 기능 nojo_words)은 지금 이름 '노조+ …'.
// S69-42(명진 11/24 15:49 "중단없이 꾸준히 WORK ON+ 등 최신 이름으로 폴더 명도 최신화"): 앱 폴더는 이름이 아니라 저장한 id·표식으로 찾고,
// 옛 이름(아래 olds)은 계속 알아본다. 기능이 그 폴더를 쓸 때(app-folders.mjs renameIfOld)와 [한곳으로 모으기]를 누를 때 새 이름으로 바꾼다.
// 바꾸려는 새 이름의 폴더가 같은 자리에 이미 있으면 합치지 않고 그대로 둔다(결과에 '같은 이름 있음'으로 셈).
// (S69-41로 바뀜: 구글 드라이브 폴더는 새로 만들 때 늘 새 이름, 이미 있는 폴더는 사람이 [한곳으로 모으기]를 누를 때만 표식으로 알아본 앱 폴더의 옛 이름을 바꾼다.)
// 데이터 안전이 먼저다: 이미 있는 폴더의 이름은 몰래 바꾸지 않는다. 찾을 때는 옛 이름·새 이름을 모두 보고, 옛 이름 폴더가 있으면 그것을 계속 쓴다.
// 새로 만들 때만 이름을 고른다(folderNameFor). nojo_words인지 모르면(확인 실패) 지금 이름 그대로(옛 이름) — 지금 동작과 같은 쪽.
// 화면(app/brand/girok-words.mjs '노조+' → 'WORK ON+')도 같은 규칙으로 글자를 보인다. 서버가 실제 폴더 이름을 알려 줄 수 있으면 화면은 그 이름을 쓴다.
// DOM·네트워크 없음(단위 시험 tests/brand-folders.test.mjs).
export const NOJO_WORDS_FEATURE = 'nojo_words';

// S69-20(명진 11/24 08:48 'ㄱ'): 서버가 새 사용자 드라이브 맨 위에 만드는 앱 폴더 이름(자료실·회의자료·회의 녹음이 이 아래).
// 이미 있는 사람은 app_drive_settings.root_folder_id(폴더 id)로 찾으므로 이름을 바꾸지 않는다(명진은 '웹2' 그대로 — 드라이브에서 바꾼 이름 존중).
// 옛 기본 이름: library-files·workspace-drive '공공기관사업팀 Workspace', meeting-files·meeting-transcribe '웹2'.
// S69-41(명진 11/24 "구글드라이브에 웹2, 노조플러스 같은 옛 이름 모두 WORK ON PLUS 라는 새 이름으로"):
// 구글 드라이브에 앱이 만드는 폴더의 앱 이름 글자는 이 한 줄이 기준이다. 'WORK ON PLUS'로 바꾸려면 여기만 고친다
// (지금 'WORK ON+' 이름 폴더는 PAST_BRANDS 덕분에 옛 이름이 되어 [한곳으로 모으기]가 새 글자로 다시 바꾼다).
export const DRIVE_BRAND = 'WORK ON+';
// 예전에 드라이브 폴더 이름에 썼던 앱 이름(지금 DRIVE_BRAND와 같으면 빠진다).
const PAST_BRANDS = Object.freeze(['WORK ON+']);
const pastBrand = suffix => PAST_BRANDS.map(b => `${b}${suffix}`);

export const ROOT_FOLDER_NAME = DRIVE_BRAND;
const without = (list, now) => Object.freeze([...new Set(list)].filter(n => n !== now));
// 맨 위 앱 폴더의 옛 기본 이름(앱이 만들 때 쓴 이름만). 사람이 드라이브에서 다른 이름으로 바꿨으면 그 이름은 그대로 둔다.
export const ROOT_OLD_NAMES = without(['웹2', 'Web2', '공공기관사업팀 Workspace', '노조+', '노동조합+', ...PAST_BRANDS], ROOT_FOLDER_NAME);

// old: 예전 대표 이름(찾기 보조), now: 지금 이름(새로 만들 때·이름 맞추기), olds: 이름 맞추기가 now로 바꿀 옛 이름 전부.
// 구글 드라이브 폴더(drive: true)는 새로 만들 때도 늘 now(S69-41). photo_trash는 원드라이브라 예전 규칙(S68-02) 그대로.
const driveKind = (old, suffix, more = []) => {
  const now = `${DRIVE_BRAND}${suffix}`;
  return Object.freeze({ old, now, olds: without([old, ...more, ...pastBrand(suffix)], now), drive: true });
};
export const FOLDER_NAMES = Object.freeze({
  // record-backup '내 기록 백업' 맨 위 폴더(찾기는 이름이 아니라 appProperties 표식 kptu_backup=root)
  record_backup: driveKind('노조+ 백업', ' 백업'),
  // _shared/hwp-edit.ts 한글 문서 덮어쓰기 전 사본 폴더(표식 kptu_app_folder=edit_backup, 옛 폴더만 이름으로 한 번)
  edit_backup: driveKind('노조+ 편집 백업', ' 편집 백업', ['Web2 편집 백업']),
  // _shared/drive-upload.ts 바구니 원본 폴더(저장한 id basket_folder_id·표식 kptu_app_folder=basket)
  basket: driveKind('Web2 바구니', ' 바구니'),
  // drive-summary 읽기용 사본(표식 kptu_summary=folder)
  copy: driveKind('노조+ 읽기용 사본', ' 읽기용 사본', ['Web2 읽기용 사본']),
  // onedrive-photos 사진 휴지통(고른 맨 위 폴더 바로 아래, 저장한 id로 찾고 없을 때만 이름). 원드라이브라 [한곳으로 모으기] 대상은 아니고,
  // S69-42(명진 11/24 15:46 "WORK ON+ 휴지통이어야하지 않은지"): 서버가 휴지통을 쓸 때마다 옛 이름 둘을 '.WORK ON+ 휴지통'으로 바꾼다.
  photo_trash: Object.freeze({ old: '.노조+ 휴지통', now: `.${DRIVE_BRAND} 휴지통`, olds: without(['.노조+ 휴지통', '.Web2 휴지통', ...pastBrand(' 휴지통').map(n => `.${n}`)], `.${DRIVE_BRAND} 휴지통`), drive: false }),
});

// S71-49 NOTE-보드사진(사용자 결정 2026-11-26 "보드 위에 붙여넣은 사진은 WORK ON + 폴더 안에 보드 사진 관련 폴더를 만들어서 자동으로 거기"):
// 노트 보드에 넣은 사진 파일이 들어가는 폴더 이름. 맨 위 앱 폴더(app_drive_settings.root_folder_id) 바로 아래에 서버가 찾거나 만든다
// (_shared/drive-upload.ts boardPhotoFolder). 앱 이름이 붙지 않는 이름이라 브랜드가 바뀌어도 그대로다.
export const BOARD_PHOTO_FOLDER_NAME = '보드 사진';

/** 이 종류 폴더로 알아볼 이름 전부(옛 이름들 + 지금 이름). 표식 없는 옛 폴더 찾기·이름 거절에 쓴다. */
export const knownFolderNames = kind => Object.freeze([...FOLDER_NAMES[kind].olds, FOLDER_NAMES[kind].now]);

/** 이름 맞추기: 지금 이름이 이 종류의 옛 이름이면 새 이름, 아니면(이미 새 이름·사람이 바꾼 이름) null.
 * S69-42: 원드라이브 사진 휴지통도 같은 규칙(서버가 쓸 때 바꾼다). NFC로 맞춰 본다(원드라이브 이름은 NFD로 올 수 있음). */
export function renameTo(kind, name) {
  const k = FOLDER_NAMES[kind];
  return k && typeof name === 'string' && k.olds.includes(name.normalize('NFC').trim()) ? k.now : null;
}
/** 맨 위 앱 폴더 이름 맞추기: 옛 기본 이름이면 새 이름, 아니면 null. */
export const rootRenameTo = name => typeof name === 'string' && ROOT_OLD_NAMES.includes(name.trim()) ? ROOT_FOLDER_NAME : null;

// S68-21(명진 11/22 17:04): 서버가 새로 만드는 문서 안에 쓰는 앱 이름(record-backup 읽기용 문서 첫 줄). 폴더 이름과 같은 규칙.
export const APP_NAMES = Object.freeze({ old: '노조+', now: 'WORK ON+' });

/** 새로 만드는 문서에 쓸 앱 이름. S69-42: 누구나 'WORK ON+'(명진 nojo_words여도 — 노조+는 따로 만드는 노조 공간 앱 이름). keepOld는 받기만 한다. */
export const appNameFor = () => APP_NAMES.now;

/** 이 종류 폴더의 이름 둘(옛·새). 찾기·휴지통 판별·이름 거절에 쓴다. */
export const folderNames = kind => [FOLDER_NAMES[kind].old, FOLDER_NAMES[kind].now];

/** 새로 만들 때 쓸 이름. 늘 새 이름(구글 드라이브 S69-41, 원드라이브 사진 휴지통 S69-42 — 명진도 WORK ON+).
 * keepOld는 예전 부르는 쪽과 모양을 맞추려고 받기만 하고 쓰지 않는다. */
export function folderNameFor(kind, keepOld) {
  const names = FOLDER_NAMES[kind];
  if (!names) throw new Error(`모르는 폴더 종류: ${kind}`);
  return names.now;
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
