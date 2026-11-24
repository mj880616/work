/*************************************************
 * 녹음 중복 막기·정리 (S69 녹음중복, 2026-11-24)
 *
 * 명진의 전사 앱 스크립트(Code.gs)에 붙여 넣는 교체본·추가본이다. 붙이는 곳과 순서: docs/ops/transcription-dedupe-patch.md
 * 폴더 ID·파일 이름·번호는 이 파일에 없다(Code.gs의 PIPELINES가 그대로 쓰인다).
 *
 * 원인(확인한 사실):
 *  - 폰 녹음 백업 앱은 '원본' 폴더에 녹음이 없으면 다시 올린다(같은 이름·같은 크기, 새 파일 번호).
 *  - 옛 Code.gs는 45MB가 넘거나 전사에 실패한 녹음을 '원본'에서 '수동전사대기'로 옮겼다(moveTo).
 *  - 옮기면 '원본'에서 사라지므로 백업 앱이 다시 올리고, 새 파일 번호라 실패 기록(파일 번호 기준)에 걸리지 않아
 *    또 옮겨졌다. 큰 녹음은 전사가 끝내 안 되니 한 시간마다 한 벌씩 쌓였다(음성녹음 자동 전사를 끈 10/24에 멈춤).
 *    통화 녹음은 통화 중에 덜 쓰인 파일이 올라와 실패 → 옮김 → 다시 올림이 전사가 될 때까지 되풀이됐다.
 *
 * 고친 점:
 *  1. 옮기지 않는다. 녹음은 '원본'에 그대로 두고 '수동전사대기'에는 바로가기만 하나 만든다(용량 0, 백업 앱이 다시 올리지 않음).
 *  2. '원본' 안 같은 내용(md5) 녹음은 하나만 남기고 나머지는 휴지통(이름이 남아 있어 백업 앱이 다시 올리지 않음).
 *  3. 막 올라온 녹음(10분 안에 바뀐 것)은 아직 쓰는 중일 수 있어 다음 실행으로 미룬다.
 *  4. 실패 기록에 크기를 적어 두고, 같은 파일이 더 커지면(백업 앱이 이어 올림) 실패 기록을 지워 다시 전사한다.
 *  5. [이미 쌓인 중복 정리]: 같은 md5 묶음마다 하나만 남기고 휴지통(30일 되돌리기, 영구 삭제 없음). 기록이 가리키는 파일은 지우지 않는다.
 *
 * 내용은 열지 않는다. 파일 번호·이름·크기·md5·시각(메타데이터)만 본다.
 *************************************************/

const RECORDING_SETTLE_MS = 10 * 60 * 1000;
const RECORDING_CLEANUP_LIMIT = 400;                       // 한 번 실행에 휴지통 후보로 잡는 최대 수(시간 지키기가 먼저 멈출 수 있음).
const RECORDING_TRASH_BATCH = 50;                          // 휴지통 요청을 한꺼번에 보내는 묶음 크기(UrlFetchApp.fetchAll).
const RECORDING_CLEANUP_TIME_MS = 4.5 * 60 * 1000;         // 앱 스크립트 한도 6분 전에 멈추고 결과를 남긴다.
const RECORDING_CLEANUP_RETRY_MS = 5 * 60 * 1000;          // 남은 게 있으면 5분 뒤 자동으로 이어 한다.
const RECORDING_CLEANUP_HANDLER = 'cleanupDuplicateRecordings';
const RECORDING_KEEP_IDS_KEY = 'RECORDING_KEEP_IDS';         // 지우면 안 되는 파일 번호(쉼표). 커맨드센터가 웹2 확인 뒤 넣는다.
const RECORDING_EXTRA_ROOTS_KEY = 'RECORDING_CLEANUP_ROOTS';  // 정리할 녹음 맨 위 폴더 번호(쉼표, 없어도 됨).
const RECORDING_CLEANUP_LAST_KEY = 'RECORDING_CLEANUP_LAST';
const RECORDING_VOICE_ROOT_NAME = '음성 녹음 백업';
const RECORDING_SUBFOLDERS = { '원본': 'source', '수동전사대기': 'manual', '전사': 'transcript' };
const RECORDING_SHORTCUT_MIME = 'application/vnd.google-apps.shortcut';
const RECORDING_FOLDER_MIME = 'application/vnd.google-apps.folder';

/*************************************************
 * 순수 판단(드라이브 없음, 단위 시험 tests/security/transcription-dedupe-gas.test.mjs)
 *************************************************/

function recordingTime_(f) {
  const t = Date.parse(f && f.createdTime);
  return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
}

function recordingOlderFirst_(a, b) {
  return recordingTime_(a) - recordingTime_(b) || String(a.id).localeCompare(String(b.id));
}

/** 같은 내용 묶음: md5가 있고 크기가 0보다 큰 진짜 파일(바로가기·폴더 제외)만, 2개 이상인 것. */
function recordingGroupDuplicates_(files) {
  const byKey = {};
  (files || []).forEach(f => {
    if (!f || !f.id || !f.md5 || f.shortcut || f.mimeType === RECORDING_FOLDER_MIME) return;
    if (!(Number(f.size) > 0)) return;
    const key = f.md5 + '|' + Number(f.size);
    (byKey[key] = byKey[key] || []).push(f);
  });
  return Object.keys(byKey).sort().map(key => ({ key, files: byKey[key].slice().sort(recordingOlderFirst_) }))
    .filter(g => g.files.length > 1);
}

/**
 * 묶음 하나에서 남길 것·휴지통에 보낼 것.
 * - 전사 중인 파일이 있으면 손대지 않는다(skip).
 * - 기록이 가리키는 파일(protectedIds)은 모두 남긴다.
 * - '원본'에 있는 것이 있으면 그중 가장 오래된 것 하나를 남긴다(원본에서 사라지면 백업 앱이 또 올린다).
 * - 위에서 남긴 것이 없으면 가장 오래된 것 하나를 남긴다.
 * - needShortcut: 수동전사대기에 있던 것을 지우는데 남긴 것이 수동전사대기에 없으면, 대기 목록에 바로가기가 필요하다.
 */
function recordingPlanGroup_(group, protectedIds, activeIds) {
  const files = group.files.slice().sort(recordingOlderFirst_);
  const has = (set, id) => !!set && (typeof set.has === 'function' ? set.has(id) : set.indexOf(id) >= 0);
  if (files.some(f => has(activeIds, f.id))) return { key: group.key, keep: files.map(f => f.id), trash: [], skip: 'active', needShortcut: false, bytes: 0 };
  const keep = new Set(files.filter(f => has(protectedIds, f.id)).map(f => f.id));
  const source = files.filter(f => f.folder === 'source');
  if (source.length && !source.some(f => keep.has(f.id))) keep.add(source[0].id);
  if (keep.size === 0) keep.add(files[0].id);
  const trash = files.filter(f => !keep.has(f.id));
  const keptManual = files.some(f => keep.has(f.id) && f.folder === 'manual');
  return {
    key: group.key,
    keep: files.filter(f => keep.has(f.id)).map(f => f.id),
    keeper: files.find(f => keep.has(f.id) && f.folder === 'source') || files.find(f => keep.has(f.id)),
    trash: trash.map(f => f.id),
    trashFiles: trash,
    skip: null,
    needShortcut: !keptManual && trash.some(f => f.folder === 'manual'),
    bytes: trash.reduce((n, f) => n + Number(f.size || 0), 0),
  };
}

function recordingBytesText_(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024 * 1024) return (n / (1024 * 1024 * 1024)).toFixed(1) + 'GB';
  if (n >= 1024 * 1024) return Math.round(n / (1024 * 1024)) + 'MB';
  return Math.round(n / 1024) + 'KB';
}

/** 결과 한 줄: "묶음 N개 · 휴지통 N개 · 줄인 용량 X". */
function recordingSummaryLine_(plans) {
  const active = (plans || []).filter(p => !p.skip && p.trash.length > 0);
  const trashed = active.reduce((n, p) => n + p.trash.length, 0);
  const bytes = active.reduce((n, p) => n + p.bytes, 0);
  return '묶음 ' + active.length + '개 · 휴지통 ' + trashed + '개 · 줄인 용량 ' + recordingBytesText_(bytes);
}

/** 막 올라온(아직 쓰는 중일 수 있는) 녹음인지. */
function recordingIsSettled_(createdMs, updatedMs, nowMs) {
  const t = Math.max(Number(createdMs) || 0, Number(updatedMs) || 0);
  return nowMs - t >= RECORDING_SETTLE_MS;
}

/** 분석 결과 파일 이름 '검토__…__SRC_<전사 TXT 번호>.md'에서 전사 TXT 번호를 꺼낸다(내용은 열지 않음). */
function recordingSrcIdsFromNames_(names) {
  const out = new Set();
  (names || []).forEach(n => {
    const m = /__SRC_([A-Za-z0-9_-]{10,200})\.md$/.exec(String(n || ''));
    if (m) out.add(m[1]);
  });
  return out;
}

/** 쉼표로 적은 파일 번호 목록(모양이 맞는 것만). */
function recordingIdList_(text) {
  return String(text || '').split(/[\s,]+/).filter(v => /^[A-Za-z0-9_-]{10,200}$/.test(v));
}

/** 실패 기록에 적어 둔 크기와 지금 크기가 다르면(백업 앱이 이어 올림) 다시 전사해야 한다. 크기를 안 적은 옛 기록은 그대로. */
function recordingFailureOutdated_(failure, currentSize) {
  return !!failure && failure.size != null && Number(failure.size) !== Number(currentSize);
}

/*************************************************
 * 드라이브 읽기(메타데이터만)
 *************************************************/

/** 폴더 바로 아래 파일 목록: 번호·이름·크기·md5·시각·종류. 내용은 받지 않는다. */
function recordingListFolder_(folderId, kind) {
  const out = [];
  let pageToken = '';
  const q = "'" + folderId + "' in parents and trashed = false";
  do {
    const url = 'https://www.googleapis.com/drive/v3/files?pageSize=1000&supportsAllDrives=false' +
      '&fields=' + encodeURIComponent('nextPageToken,files(id,name,size,md5Checksum,createdTime,modifiedTime,mimeType,shortcutDetails(targetId))') +
      '&q=' + encodeURIComponent(q) + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
    const res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error('드라이브 목록 읽기 실패(HTTP ' + res.getResponseCode() + ')');
    const body = JSON.parse(res.getContentText());
    (body.files || []).forEach(f => out.push({
      id: f.id, name: f.name, size: Number(f.size || 0), md5: f.md5Checksum || '', createdTime: f.createdTime, modifiedTime: f.modifiedTime,
      mimeType: f.mimeType, shortcut: f.mimeType === RECORDING_SHORTCUT_MIME, targetId: f.shortcutDetails ? f.shortcutDetails.targetId : null,
      folder: kind, folderId,
    }));
    pageToken = body.nextPageToken || '';
  } while (pageToken);
  return out;
}

function recordingStates_() {
  return PropertiesService.getScriptProperties().getProperties();
}

function recordingActiveIds_(states) {
  return new Set(Object.keys(states).filter(k => k.indexOf('TRANSCRIBE_ACTIVE_') === 0).map(k => k.slice('TRANSCRIBE_ACTIVE_'.length)));
}

/** 수동전사대기 폴더(없으면 만든다). 같은 이름이 둘이면 멈춘다(옛 코드와 같음). */
function recordingManualFolder_(rootFolderId) {
  const root = DriveApp.getFolderById(rootFolderId);
  const found = root.getFoldersByName(MANUAL_TRANSCRIPT_FOLDER_NAME);
  if (found.hasNext()) {
    const folder = found.next();
    if (found.hasNext()) throw new Error('같은 이름의 수동전사대기 폴더가 여러 개입니다.');
    return folder;
  }
  return root.createFolder(MANUAL_TRANSCRIPT_FOLDER_NAME);
}

/** 대기 폴더에 이 녹음의 바로가기가 없으면 하나 만든다. 만든(또는 있던) 바로가기 번호를 돌려준다. */
function recordingEnsureShortcut_(targetId, manualFolder, existing) {
  const have = (existing || []).find(f => f.shortcut && f.targetId === targetId);
  if (have) return have.id;
  const shortcut = DriveApp.createShortcut(targetId);
  shortcut.moveTo(manualFolder);
  return shortcut.getId();
}

/*************************************************
 * 교체 ① transcriptionMoveManualCandidates_ (Code.gs의 같은 이름 함수를 통째로 바꾼다)
 *
 * 옮기지 않는다. 원본은 '원본'에 두고, 수동전사대기에 바로가기 하나 + 실패 기록(status=manual, 크기, 바로가기 번호).
 * 이미 바로가기를 만든 녹음은 다시 만들지 않는다. 돌려주는 모양(moved·movedIds 등)은 옛 함수와 같다 —
 * movedIds에 든 녹음은 이번 전사 후보에서 빠진다.
 *************************************************/
function transcriptionMoveManualCandidates_(candidates) {
  const props = PropertiesService.getScriptProperties();
  const states = props.getProperties();
  const manual = candidates.filter(item => transcriptionNeedsManualMove_(item.file, states));
  const summary = { moved: 0, skipped: 0, failed: 0, metadataFailed: 0, remaining: manual.length, movedIds: [], folders: {} };
  if (manual.length === 0) {
    Logger.log('수동전사대기 분리 결과(API 요청 없음): ' + JSON.stringify(summary));
    return summary;
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    summary.busy = true;
    Logger.log('수동전사대기 분리 대기: 다른 실행이 진행 중입니다.');
    return summary;
  }
  const destinations = {};
  const listed = {};
  try {
    for (let i = 0; i < manual.length && summary.moved + summary.failed < MAX_OVERSIZE_MOVES_PER_RUN; i++) {
      const item = manual[i];
      const fileId = item.file.getId();
      const key = 'TRANSCRIBE_FAILURE_' + fileId;
      let failure = null;
      try { failure = states[key] ? JSON.parse(states[key]) : null; } catch (e) { failure = null; }
      // 이미 바로가기까지 만든 녹음: 다시 만들지 않고 이번 후보에서만 뺀다.
      if (failure && failure.status === 'manual' && failure.shortcutId) {
        summary.skipped++;
        summary.movedIds.push(fileId);
        continue;
      }
      try {
        // 후보 수집 이후 전사본이 생겼다면 대기 목록에 넣지 않는다.
        if (item.transcriptFolder.getFilesByName(item.txtName).hasNext()) {
          summary.skipped++;
          continue;
        }
        let destination = destinations[item.pipeline.key];
        if (!destination) {
          destination = recordingManualFolder_(item.pipeline.rootFolderId);
          destinations[item.pipeline.key] = destination;
          listed[item.pipeline.key] = recordingListFolder_(destination.getId(), 'manual');
          summary.folders[item.pipeline.key] = destination.getId();
        }
        const shortcutId = recordingEnsureShortcut_(fileId, destination, listed[item.pipeline.key]);
        listed[item.pipeline.key].push({ id: shortcutId, shortcut: true, targetId: fileId });
        summary.moved++;
        summary.movedIds.push(fileId);
        Logger.log('[' + item.pipeline.label + '] 수동전사대기 바로가기(원본은 그대로): fileId=' + fileId + ' / shortcutId=' + shortcutId);
        try {
          const next = failure || { count: 0, errorCode: 'OVERSIZE', lastError: '자동 전사 크기 한도(' + Math.round(MAX_UPLOAD_BYTES / 1048576) + 'MB) 초과' };
          next.status = 'manual';
          next.manualFolderId = destination.getId();
          next.shortcutId = shortcutId;
          next.size = item.file.getSize();
          next.separatedAt = new Date().toISOString();
          next.retryable = false;
          next.nextAttemptAt = null;
          props.setProperty(key, JSON.stringify(next));
        } catch (err) {
          summary.metadataFailed++;
          console.error('바로가기 후 상태 기록 실패: ' + fileId, err);
        }
      } catch (err) {
        summary.failed++;
        console.error('수동전사대기 분리 실패: ' + fileId, err);
      }
    }
  } finally {
    lock.releaseLock();
  }
  summary.remaining = manual.length - summary.moved - summary.skipped;
  Logger.log('수동전사대기 분리 결과(API 요청 없음): ' + JSON.stringify(summary));
  return summary;
}

/*************************************************
 * 추가 ② 전사 전에 '원본'을 정돈한다 (transcribeNewRecordings가 파이프라인마다 부른다)
 *
 * - 같은 내용(md5) 녹음이 '원본'에 여럿이면 하나만 남기고 휴지통(이름이 남으니 백업 앱이 다시 올리지 않음).
 * - 실패 기록의 크기와 지금 크기가 다르면 기록·바로가기를 지워 다시 전사 후보로 돌린다.
 * 돌려주는 값: 휴지통에 보낸 파일 번호 모음(이번 후보에서 뺀다).
 *************************************************/
function recordingTidySource_(pipeline, sourceFolder) {
  const trashed = new Set();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return trashed;
  try {
    const props = PropertiesService.getScriptProperties();
    const states = props.getProperties();
    const keepIds = new Set(recordingIdList_(states[RECORDING_KEEP_IDS_KEY]));
    const files = recordingListFolder_(sourceFolder.getId(), 'source');
    recordingGroupDuplicates_(files).forEach(group => {
      const plan = recordingPlanGroup_(group, keepIds, recordingActiveIds_(states));
      if (plan.skip) return;
      plan.trashFiles.forEach(f => {
        DriveApp.getFileById(f.id).setTrashed(true);
        trashed.add(f.id);
        recordingMoveFailureState_(props, states, f.id, plan.keeper);
        Logger.log('[' + pipeline.label + '] 원본 안 같은 녹음 휴지통: ' + f.id + ' (남김 ' + plan.keeper.id + ')');
      });
    });
    files.forEach(f => {
      const raw = states['TRANSCRIBE_FAILURE_' + f.id];
      if (!raw || trashed.has(f.id)) return;
      let failure = null;
      try { failure = JSON.parse(raw); } catch (e) { return; }
      if (!recordingFailureOutdated_(failure, f.size)) return;
      if (failure.shortcutId) {
        try { DriveApp.getFileById(failure.shortcutId).setTrashed(true); } catch (e) { /* 이미 없음 */ }
      }
      props.deleteProperty('TRANSCRIBE_FAILURE_' + f.id);
      Logger.log('[' + pipeline.label + '] 녹음 크기가 바뀌어 다시 전사 후보: ' + f.id);
    });
  } finally {
    lock.releaseLock();
  }
  return trashed;
}

/** 휴지통에 보낸 녹음의 실패 기록은 남긴 녹음으로 옮긴다(남긴 쪽에 기록이 없을 때만). */
function recordingMoveFailureState_(props, states, fromId, keeper) {
  const raw = states['TRANSCRIBE_FAILURE_' + fromId];
  if (!raw) return;
  props.deleteProperty('TRANSCRIBE_FAILURE_' + fromId);
  if (!keeper || states['TRANSCRIBE_FAILURE_' + keeper.id]) return;
  try {
    const failure = JSON.parse(raw);
    failure.size = keeper.size;
    delete failure.shortcutId;
    props.setProperty('TRANSCRIBE_FAILURE_' + keeper.id, JSON.stringify(failure));
    states['TRANSCRIBE_FAILURE_' + keeper.id] = JSON.stringify(failure);
  } catch (e) { /* 깨진 기록은 버린다 */ }
}

/*************************************************
 * 교체 ③ transcribeNewRecordings (Code.gs의 같은 이름 함수를 통째로 바꾼다)
 * 옛 함수와 같고, 바뀐 곳은 '// S69 녹음중복' 표시 세 군데뿐이다.
 *************************************************/
function transcribeNewRecordings() {
  // v2: 요청 한도 대기 중이면 폴더를 훑지도 않고 바로 끝냄(실패 아님).
  if (transcriptionRateLimitWaiting_()) return;
  const scanStarted = Date.now();
  const apiKey = getApiKey_();
  const recordedFrom = new Date(Date.now() - TRANSCRIBE_RECENT_DAYS * 24 * 3600 * 1000);
  transcriptionRecoverInterrupted_();
  const props = PropertiesService.getScriptProperties();

  let candidates = [];
  const seenTranscriptKeys = new Set();

  PIPELINES.forEach(pipeline => {
    const baselineString = props.getProperty(pipeline.baselineKey);
    if (!baselineString) throw new Error(pipeline.label + ' 기준선이 없습니다. initializeBaseline()이 필요합니다.');
    const baseline = new Date(baselineString);
    const folders = getPipelineFolders_(pipeline);

    // S69 녹음중복 ①: 원본 안 같은 녹음 정리·크기가 바뀐 실패 기록 풀기(실패해도 전사는 이어 감).
    let tidied = new Set();
    try { tidied = recordingTidySource_(pipeline, folders.source); } catch (err) { console.error('[' + pipeline.label + '] 원본 정돈 실패', err); }
    const failureStates = props.getProperties();

    const transcriptNames = transcriptionListNames_(folders.transcript);
    const files = folders.source.getFiles();
    while (files.hasNext()) {
      const file = files.next();
      if (!isAudioFile_(file)) continue;
      if (tidied.has(file.getId())) continue;
      const created = file.getDateCreated().getTime();
      const updated = file.getLastUpdated().getTime();
      const fileTime = new Date(Math.max(created, updated));

      // S69 녹음중복 ②: 막 올라온 녹음은 백업 앱이 아직 쓰는 중일 수 있어 다음 실행으로 미룸.
      if (!recordingIsSettled_(created, updated, Date.now())) continue;

      if (fileTime <= baseline && !failureStates['TRANSCRIBE_FAILURE_' + file.getId()]) continue;
      const recordedAt = transcriptionRecordedAt_(file.getName()) || fileTime;
      if (recordedAt < recordedFrom && !failureStates['TRANSCRIBE_FAILURE_' + file.getId()]) continue;

      const txtName = makeTranscriptName_(file.getName());
      if (transcriptNames.has(txtName)) continue;

      const transcriptKey = pipeline.key + '|' + txtName;
      const manualCandidate = transcriptionNeedsManualMove_(file, failureStates);
      if (!manualCandidate && seenTranscriptKeys.has(transcriptKey)) {
        Logger.log('[' + pipeline.label + '] 중복 후보 제외: ' + file.getName());
        continue;
      }
      if (!manualCandidate) seenTranscriptKeys.add(transcriptKey);
      candidates.push({ pipeline, file, transcriptFolder: folders.transcript, fileTime, txtName });
    }
  });

  candidates.sort((a, b) => a.fileTime - b.fileTime);

  Logger.log('[시간] 신규 후보 탐색: ' + (Date.now() - scanStarted) + 'ms');
  // S69 녹음중복 ③: 아래 함수는 이제 옮기지 않고 바로가기만 만든다(교체 ①).
  const separated = transcriptionMoveManualCandidates_(candidates);
  const movedIds = new Set(separated.movedIds);
  candidates = candidates.filter(item => !movedIds.has(item.file.getId()));
  candidates = transcriptionSelectCandidates_(candidates, MAX_NEW_FILES_PER_RUN);

  if (candidates.length === 0) {
    transcriptionAssertSeparation_(separated);
    Logger.log('이번 실행에서 전사 가능한 신규 녹음이 없습니다. 대기·검토 대상은 후보 분류 로그를 확인하십시오.');
    return;
  }
  processCandidates_(candidates, apiKey, '신규');
  transcriptionAssertSeparation_(separated);
}

/*************************************************
 * 추가 ④ 이미 쌓인 중복 정리
 *   previewDuplicateRecordings(): 미리 보기(아무것도 바꾸지 않음). 결과 한 줄 + 휴지통 후보 번호를 로그에 적는다.
 *   cleanupDuplicateRecordings(): 실제 정리. 휴지통(30일 되돌리기)만, 영구 삭제 없음. 실행 기록 파일을 남긴다.
 *     - 휴지통 요청은 Drive API(files.update trashed=true)를 50개씩 묶어 한꺼번에 보낸다(한 개씩 보내면 6분에 끊겼다).
 *     - 4분 30초가 지나면 새로 보내지 않고 결과 한 줄·실행 기록 파일을 남긴 뒤 끝낸다.
 *     - 남은 게 있으면 5분 뒤 한 번 도는 트리거를 하나만 걸고, 다 끝나면 지운다. 진행: 스크립트 속성 RECORDING_CLEANUP_LAST.
 *************************************************/
function previewDuplicateRecordings() {
  return recordingCleanup_(true);
}

/** 사람이 한 번 누르면 끝까지: 4분 30초마다 끊어 결과를 남기고, 남은 게 있으면 5분 뒤 스스로 이어 한다. */
function cleanupDuplicateRecordings(e) {
  return recordingCleanup_(false, e);
}

/** 정리할 녹음 맨 위 폴더들: PIPELINES + 스크립트 속성 RECORDING_CLEANUP_ROOTS + 내 드라이브 맨 위 '음성 녹음 백업'(하나뿐일 때). */
function recordingCleanupRoots_() {
  const ids = [];
  PIPELINES.forEach(p => ids.push(p.rootFolderId));
  recordingIdList_(PropertiesService.getScriptProperties().getProperty(RECORDING_EXTRA_ROOTS_KEY)).forEach(id => ids.push(id));
  const found = DriveApp.getRootFolder().getFoldersByName(RECORDING_VOICE_ROOT_NAME);
  if (found.hasNext()) {
    const one = found.next();
    if (!found.hasNext()) ids.push(one.getId());
    else Logger.log('내 드라이브 맨 위에 "' + RECORDING_VOICE_ROOT_NAME + '"가 여러 개라 이름으로는 고르지 않음(RECORDING_CLEANUP_ROOTS에 적을 것).');
  }
  return Array.from(new Set(ids));
}

/** 기록이 가리키는 파일: 지우면 안 되는 번호(속성) + 분석 결과가 가리키는 전사 TXT + 바로가기가 가리키는 녹음. */
function recordingProtectedIds_(allFiles) {
  const out = new Set(recordingIdList_(PropertiesService.getScriptProperties().getProperty(RECORDING_KEEP_IDS_KEY)));
  const names = [];
  const it = DriveApp.searchFiles("title contains '__SRC_' and trashed = false");
  while (it.hasNext()) names.push(it.next().getName());
  recordingSrcIdsFromNames_(names).forEach(id => out.add(id));
  allFiles.forEach(f => { if (f.shortcut && f.targetId) out.add(f.targetId); });
  return out;
}

function recordingCleanup_(dryRun, event) {
  const started = Date.now();
  const props = PropertiesService.getScriptProperties();
  if (!dryRun) recordingDropFiredTrigger_(event);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) {
    if (dryRun) throw new Error('다른 실행이 진행 중입니다. 잠시 후 다시 실행하십시오.');
    // 실제 정리는 끊지 않고 5분 뒤 다시 시도한다(트리거는 하나만).
    const scheduled = recordingScheduleContinue_(true);
    const busyLine = '다른 실행이 진행 중이라 이번에는 건너뜀' + (scheduled ? ' · 5분 뒤 자동으로 다시' : '');
    Logger.log(busyLine);
    props.setProperty(RECORDING_CLEANUP_LAST_KEY, JSON.stringify({ at: new Date().toISOString(), dryRun: false, line: busyLine, remaining: null, done: false }));
    return busyLine;
  }
  try {
    const states = props.getProperties();
    const active = recordingActiveIds_(states);
    const all = [];
    const manualFolderByRoot = {};
    const roots = recordingCleanupRoots_();
    roots.forEach(rootId => {
      const root = DriveApp.getFolderById(rootId);
      Object.keys(RECORDING_SUBFOLDERS).forEach(name => {
        const it = root.getFoldersByName(name);
        while (it.hasNext()) {
          const folder = it.next();
          const kind = RECORDING_SUBFOLDERS[name];
          if (kind === 'manual' && !manualFolderByRoot[rootId]) manualFolderByRoot[rootId] = folder;
          recordingListFolder_(folder.getId(), kind).forEach(f => { f.rootId = rootId; all.push(f); });
        }
      });
    });
    const protectedIds = recordingProtectedIds_(all);
    // 같은 md5라도 다른 맨 위 폴더(통화·음성)끼리는 섞지 않는다.
    const plans = [];
    const byRoot = {};
    all.forEach(f => (byRoot[f.rootId] = byRoot[f.rootId] || []).push(f));
    Object.keys(byRoot).forEach(rootId => recordingGroupDuplicates_(byRoot[rootId]).forEach(g => {
      const plan = recordingPlanGroup_(g, protectedIds, active);
      plan.rootId = rootId;
      plans.push(plan);
    }));

    const rows = [];
    const queue = [];
    let candidates = 0;
    plans.forEach(plan => {
      if (plan.skip) { rows.push('건너뜀(전사 중)\t' + plan.key); return; }
      plan.trashFiles.forEach(f => {
        candidates++;
        if (queue.length < RECORDING_CLEANUP_LIMIT) queue.push({ plan, file: f });
      });
    });

    let trashedNow = 0;
    let failedNow = 0;
    let stoppedForTime = false;
    if (dryRun) {
      queue.forEach(item => rows.push('휴지통 후보\t' + item.file.id + '\t' + item.file.folder + '\t' + item.file.size + '\t' + item.file.md5 + '\t남김 ' + item.plan.keeper.id));
    } else {
      const shortcutReady = new Set();
      const shortcutFailed = new Set();
      const batches = recordingChunks_(queue, RECORDING_TRASH_BATCH);
      for (let b = 0; b < batches.length && !stoppedForTime; b++) {
        const send = [];
        for (let i = 0; i < batches[b].length; i++) {
          // 시간 지키기: 4분 30초가 지나면 새로 보내지 않고 결과·기록을 남긴 뒤 끝낸다.
          if (recordingTimeUp_(started, Date.now())) { stoppedForTime = true; break; }
          const item = batches[b][i];
          const plan = item.plan;
          if (shortcutFailed.has(plan)) continue;
          // 대기 목록이 비지 않게: 수동전사대기 사본을 지우기 전에 남긴 녹음의 바로가기를 먼저 만든다.
          if (plan.needShortcut && !shortcutReady.has(plan) && manualFolderByRoot[plan.rootId] && plan.keeper.folder !== 'manual') {
            try {
              recordingCleanupShortcut_(plan, manualFolderByRoot[plan.rootId], all, props, states);
              shortcutReady.add(plan);
            } catch (err) {
              shortcutFailed.add(plan);
              rows.push('건너뜀(바로가기 실패)\t' + plan.key);
              console.error('바로가기 만들기 실패: ' + plan.keeper.id, err);
              continue;
            }
          }
          send.push(item);
        }
        if (!send.length) continue;
        const codes = recordingTrashMany_(send.map(item => item.file.id));
        let limited = false;
        send.forEach((item, i) => {
          const f = item.file;
          const code = codes[i];
          if (code === 200) {
            trashedNow++;
            rows.push('휴지통\t' + f.id + '\t' + f.folder + '\t' + f.size + '\t' + f.md5 + '\t남김 ' + item.plan.keeper.id);
            recordingMoveFailureState_(props, states, f.id, item.plan.keeper);
          } else {
            failedNow++;
            if (code === 403 || code === 429) limited = true;
            rows.push('실패(HTTP ' + code + ', 다음 실행에서 다시)\t' + f.id + '\t' + f.folder + '\t' + f.size + '\t' + f.md5 + '\t남김 ' + item.plan.keeper.id);
          }
        });
        // 요청 한도에 걸리면 잠깐 쉬고 다음 묶음.
        if (limited && typeof Utilities.sleep === 'function') Utilities.sleep(2000);
      }
    }

    const remaining = dryRun ? candidates : candidates - trashedNow;
    // 이번에 하나도 못 보냈으면(목록 읽기에 시간이 다 걸렸거나 모두 실패) 같은 일을 되풀이하지 않게 자동 이어 하기를 걸지 않는다.
    const stuck = !dryRun && remaining > 0 && trashedNow === 0;
    const scheduled = !dryRun && recordingScheduleContinue_(remaining > 0 && !stuck);
    const sameNameOtherContent = recordingSameNameOtherContent_(all);
    const line = recordingSummaryLine_(plans) + (dryRun ? ' (미리 보기)' : '') +
      (dryRun && candidates > RECORDING_CLEANUP_LIMIT ? ' · 후보 줄은 앞 ' + RECORDING_CLEANUP_LIMIT + '개만 적음' : '') +
      (!dryRun && remaining > 0 ? ' · 이번에 휴지통 ' + trashedNow + '개 · 남음 ' + remaining + '개 · 한 번 더 실행' + (scheduled ? '(5분 뒤 자동)' : '') : '') +
      (failedNow ? ' · 실패 ' + failedNow + '개(다음 실행에서 다시)' : '') +
      (stoppedForTime ? ' · 시간 한도(4분 30초)에서 멈춤' : '') +
      (stuck ? ' · 이번에 하나도 못 보내 자동 이어 하기 안 함(확인 필요)' : '') +
      (sameNameOtherContent ? ' · 이름만 같고 내용이 다른 녹음 ' + sameNameOtherContent + '묶음(그대로 둠)' : '');
    Logger.log(line);
    rows.forEach(r => Logger.log(r));
    props.setProperty(RECORDING_CLEANUP_LAST_KEY, JSON.stringify({
      at: new Date().toISOString(), dryRun: !!dryRun, line, trashed: trashedNow, failed: failedNow, remaining, done: !dryRun && remaining === 0, scheduled: !!scheduled,
    }));
    if (!dryRun && rows.length) {
      try {
        const stamp = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMdd_HHmm');
        DriveApp.getFolderById(roots[0]).createFile('중복정리기록_' + stamp + '.txt', [line, '', '종류\t파일 번호\t폴더\t크기\tmd5\t남긴 파일', ...rows].join('\n'), MimeType.PLAIN_TEXT);
      } catch (err) {
        console.error('실행 기록 파일 만들기 실패(결과 한 줄은 RECORDING_CLEANUP_LAST에 있음)', err);
      }
    }
    return line;
  } finally {
    lock.releaseLock();
  }
}

/** 남긴 녹음의 바로가기를 수동전사대기에 만들고 실패 기록(status=manual)을 남긴 녹음에 둔다. */
function recordingCleanupShortcut_(plan, manual, all, props, states) {
  const existing = all.filter(x => x.folderId === manual.getId());
  const shortcutId = recordingEnsureShortcut_(plan.keeper.id, manual, existing);
  all.push({ id: shortcutId, shortcut: true, targetId: plan.keeper.id, folderId: manual.getId(), folder: 'manual', rootId: plan.rootId });
  const key = 'TRANSCRIBE_FAILURE_' + plan.keeper.id;
  // 남긴 녹음에 기록이 없으면 지울 사본의 기록을 이어받는다.
  let raw = states[key] || null;
  if (!raw) plan.trashFiles.some(f => (raw = states['TRANSCRIBE_FAILURE_' + f.id] || null));
  let failure = null;
  try { failure = raw ? JSON.parse(raw) : null; } catch (e) { failure = null; }
  failure = failure || { count: 0, errorCode: 'OVERSIZE', retryable: false };
  failure.status = 'manual';
  failure.shortcutId = shortcutId;
  failure.size = plan.keeper.size;
  props.setProperty(key, JSON.stringify(failure));
  states[key] = JSON.stringify(failure);
}

/** 휴지통 보내기(trashed=true)를 묶어서 한꺼번에. 파일 번호 순서대로 HTTP 상태 번호를 돌려준다(요청 자체가 실패하면 0). */
function recordingTrashMany_(ids) {
  if (!ids.length) return [];
  const requests = recordingTrashRequests_(ids, ScriptApp.getOAuthToken());
  try {
    return UrlFetchApp.fetchAll(requests).map(res => res.getResponseCode());
  } catch (err) {
    console.error('휴지통 묶음 요청 실패', err);
    return ids.map(() => 0);
  }
}

/** 순수: Drive API v3 files.update(trashed=true) 요청 모양. 휴지통까지만(30일 되돌리기), 영구 삭제 없음. */
function recordingTrashRequests_(ids, token) {
  return ids.map(id => ({
    url: 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) + '?fields=id,trashed&supportsAllDrives=false',
    method: 'patch',
    contentType: 'application/json',
    payload: JSON.stringify({ trashed: true }),
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true,
  }));
}

/** 순수: 목록을 n개씩. */
function recordingChunks_(list, n) {
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

/** 순수: 시작 뒤 4분 30초가 지났는지. */
function recordingTimeUp_(startedMs, nowMs) {
  return nowMs - startedMs >= RECORDING_CLEANUP_TIME_MS;
}

function recordingCleanupTriggers_() {
  return ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === RECORDING_CLEANUP_HANDLER);
}

/** 이 실행을 부른 이어 하기 트리거(한 번 쓰고 끝)는 지운다. 사람이 누른 실행이면 아무것도 안 한다. */
function recordingDropFiredTrigger_(event) {
  const uid = event && event.triggerUid;
  if (!uid) return;
  recordingCleanupTriggers_().forEach(t => { if (String(t.getUniqueId()) === String(uid)) ScriptApp.deleteTrigger(t); });
}

/**
 * 남은 게 있으면 5분 뒤 한 번 도는 트리거를 하나만 건다(같은 이름 트리거가 이미 있으면 새로 안 건다).
 * 다 끝나면 이 이름 트리거를 모두 지운다. 다른 트리거(transcribeNewRecordings 10분)는 건드리지 않는다.
 * 돌려주는 값: 이어 하기 트리거가 걸려 있는지.
 */
function recordingScheduleContinue_(needed) {
  const existing = recordingCleanupTriggers_();
  if (!needed) {
    existing.forEach(t => ScriptApp.deleteTrigger(t));
    return false;
  }
  if (existing.length) return true;
  ScriptApp.newTrigger(RECORDING_CLEANUP_HANDLER).timeBased().after(RECORDING_CLEANUP_RETRY_MS).create();
  return true;
}

/** 같은 폴더 종류 안에서 이름은 같은데 내용(md5)이 다른 녹음 묶음 수(덜 쓰인 통화 녹음 등). 지우지 않고 세기만 한다. */
function recordingSameNameOtherContent_(files) {
  const byName = {};
  files.forEach(f => {
    if (f.shortcut || !f.md5 || f.folder === 'transcript') return;
    const k = (f.rootId || '') + '|' + f.name;
    (byName[k] = byName[k] || new Set()).add(f.md5);
  });
  return Object.keys(byName).filter(k => byName[k].size > 1).length;
}

// node 단위 시험용(앱 스크립트에는 module이 없어 무시된다).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    RECORDING_SETTLE_MS, recordingGroupDuplicates_, recordingPlanGroup_, recordingSummaryLine_, recordingIsSettled_, recordingSrcIdsFromNames_,
    recordingIdList_, recordingFailureOutdated_, recordingBytesText_, recordingSameNameOtherContent_,
    transcriptionMoveManualCandidates_, recordingTidySource_, recordingCleanup_, cleanupDuplicateRecordings,
    recordingTrashRequests_, recordingChunks_, recordingTimeUp_, recordingScheduleContinue_,
    RECORDING_CLEANUP_LIMIT, RECORDING_TRASH_BATCH, RECORDING_CLEANUP_TIME_MS,
  };
}
