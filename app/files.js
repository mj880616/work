import {waitHtml, barHtml, failHtml, emptyHtml} from './wait-state.js';
import {sendUpload} from './upload-send.mjs';
import {trackUpload, mountUploadRows} from './upload-progress.js'; // UI-올리기진행표시 ②: 기기 → 클라우드 올리기의 막대·%
import {requestLibraryDocument} from './basket-library-send.js';
import {slotBox, slotImg, slotFailed} from './img-slot.js';
import {lookLayout, lookOf, lookValue, stepLook, lookCols, thumbWanted, FILES_LOOK_KEY} from './files-look-model.mjs';
import {SOURCES, SOURCE_NAME, SHELVES, SHELF_NAME, SYNC_EVERY_MS, SHELF_LIMIT, FIND_LIMIT, FIND_WAIT_MS,
  TEXT_PREVIEW_BYTES, PDF_FIRST_PAGES, SORTS, SORT_NAME, kindOf, kindLabel, kindIcon, kindSvg, previewKind, sizeText, folderCountText, isLockedItem, dayText, fullTime,
  syncLabel, applySyncReply, syncSettled, sortRows, validSort, rowKey, applyChanges, touchesCounts, trailNames, trailIds, pathText, folderKey, treeRows,
  placeOf, whereOf, cleanQuery, findSummary, errorText, failReason, moveCheck, pickRange, groupBySource, touchedFolders, moveTargetOk,
  trashAsk, writeDoneText, writeErrorText, twinRows, TWIN_LIMIT, xferPlan, xferBig, sameNameRows, sameNameAsk, bigAsk, destTitle, destButton, destName,
  pushRecentDest, recentDestOf, xferLine, xferPercent, xferDoneText, XFER_BIG_HOW,
  jobsActive, jobReason, jobStatusText, jobLine, jobPercent, jobStrip, jobsTitle, jobAction, mergeJobs, newlyDone, deviceJobOnReopen,
  UPLOAD_BIG_HOW, UPLOAD_REOPEN_TEXT, upDropText, upStartText, uploadPlan, upBig, upSameName, sameUpFile, upPiece, deviceHint, upResultId,
  starWant, starLabel, applyStars, boxRows, MEDIA_PREVIEW_MAX, HWP_PREVIEW_MAX, HWP_PREVIEW_PAGES, mediaMime, stepFile, pathCopyText, treeAcrossBig, treeAcrossTooBigText, treeBigAsk, treeDoneText, TREE_MOVE_NOTE,
  TREE_DEV_MOVE_NOTE, treeDevKeptText, treeDevDoneText, LIB_TREE_MAX, LIB_TREE_BYTES, libTreeTooBigText, UPLOAD_MAX_BYTES} from './files-model.mjs';
// FOLDER-나무새기준 ②(S51-12): 폰 나무는 노트·자료실·사진과 같은 공용 줄·상자, 두 손가락 그 폴더만.
import {ftFolderRowHtml, ftMoreRowHtml, ftBoxHtml, ftMoreButtonHtml, ftFocusHtml, ftFocusCount, FT_PREVIEW} from './folder-tree-ui.mjs';
import {boxShut, toggleBoxShut} from './box-fold.js';
import {riseFromRow, sinkToRow, topOf} from './folder-focus-motion.js';
import {followPane} from './follow-pane.js';
import {bindFolderPinch} from './folder-pinch.js';
import {fillGestureArea, settleGestureAreas} from './gesture-fill.js';
import {bindTouchDrag} from './touch-drag.js';
import {appShare, docMimeOf, OUT_FILE_MAX} from './app-share.js';
import {mountSplitResize} from './split-resize.js';
import {folderLook} from './folder-prefs.js'; // FOLDER-순서·색 ③-2: 폴더 색·순서 읽기 사본([파일]·사진 폴더가 같이 씀)
import {colorChoiceHtml, createColorMode} from './folder-look.js';
import {folderShapeHtml} from './folder-look-model.mjs';
import {createAnchoredMenu} from './anchored-menu.js';
import {openRowMenu, appMenuPoint} from './row-menu.js';
import {treeMenuItems} from './files-tree-menu.mjs';
import {lastClean, lastPut, lastStart} from './files-last-model.mjs';
import {zipPlan, zipName, zipBusyText, zipDoneText} from './files-zip-model.mjs';
import {writeZip} from './weekly-hwpx/zip.mjs';
import {FIND_SCOPES, FIND_DIMS, FIND_DIM_NAME, freshFilter, filterSet, dimLabel, baseOf, findFilter} from './files-find-model.mjs';
import {PINS_MAX, pinParse, pinKey, pinsClean, pinHas, pinAdd, pinRemove, pinMove, pinStep, pinView} from './files-pins-model.mjs';
import {mountReorder} from './reorder-drag.js';
import {mountColResize, gripHtml} from './col-resize.js';
import {askConfirm, askText, notify} from './small-notice.js';
import {viewPrefs} from './view-prefs.js';
import {recentFolded, toggleRecentFolded} from './recent-fold.js';
import {MORE_LABEL} from './fold-chevron.mjs';
import {recentHumanRows} from './files-auto-model.mjs';
import {brandIconSvg} from './brand-icons.js';
import {treeIconHtml, iconSvg} from './tree-icons.js';
import {odLinkButtonHtml, paintOdLink} from './od-link.js';
import {FILES_SOURCES_KEY, FILES_SRC, filesSourcesValue, toggleFilesSource, visibleSources, chipInfo, filesDeviceKind, PHONE_WIDTH_QUERY} from './files-sources-model.mjs';
import {SOURCES_OFF_TEXT} from './source-flags.mjs';
import {checkFileBase, splitFileName, numberedName, FILE_BASE_MAX} from './file-rename-name.mjs';
import {bindPaste} from './paste-files.mjs';
import {createPhoneFiles} from './phone-files.js';
import {PHONE_SOURCE as PH, phoneTrail, phoneParent, phoneWriteText, PHONE_SAVE_MAX, PHONE_OLD_APP_TEXT, PHONE_MOVE_TEXT, PHONE_ASK_TEXT, PHONE_CANNOT_TEXT, PHONE_TRASH_BATCH, PHONE_FOLDER_LEFT_NOTE, phoneTrashAsk} from './phone-files-model.mjs';
import {createPcFiles} from './pc-files.js';
import {PC_SOURCE as PC, pcTrail, pcStateText, pcOffRowName, pcDeviceOk, pcParent, pcXferWhy, PC_READONLY_TEXT, PC_PREVIEW_TEXT, PC_PREVIEW_BIG_TEXT, PC_PREVIEW_MAX, PC_WRITE_LATER_TEXT, PC_XFER_MAX, PC_FILE_MAX} from './pc-files-model.mjs';
import {NARROW_QUERY, SPLIT_QUERY} from './screen-width.mjs';
import {FILES_TWO_KEY, twoLayout, twoOn, twoValue, paneSide, sendLabel, paneDest, DROP_ASK_TEXT, FILES_PANES_KEY, panesValue, paneStart, paneChoices, paneSourceLabel} from './files-panes-model.mjs';
import {within, isLoadTimeout} from './load-deadline.js';
// FILES-클라우드탐색기 ④ 화면(설계 docs/design/files-explorer.md 4·5·6절, 명진 결정 F1~F9 11/02): 메뉴 '파일'(?view=files). #filesView의 유일한 그리기 주인.
// - 목록은 서버 색인(app_cloud_list·app_cloud_find·app_cloud_trail, owner + 운영자 기능 files일 때만 읽힘)에서 바로 그린다. 클라우드는 부르지 않는다.
// - 갱신(F2): 들어올 때 + 2분마다 + 창으로 돌아올 때 Edge cloud-files sync(서버가 2분 안이면 클라우드를 부르지 않음). 응답의 바뀐 줄만
//   지금 목록에 입힌다(applyChanges). 많이 바뀌면(reload) 지금 목록을 서버에서 다시 읽는다. 밤 한 번은 서버 예약(⑧).
// - 미리보기(오른쪽 칸 / 폰·폴드는 겹친 칸, 뒤로가기 한 번 = 닫힘): 사진 = 큰 썸네일, PDF = 원본, 오피스 = 서버가 PDF로 바꾼 것(F4),
//   PDF는 저장소에 고정한 pdf.js로 쪽마다 그린다. 글 = 앞 200KB. 그 밖은 이름·크기·위치만 + [열기](클라우드 보기 새 창).
// - S50-33(명진 결정, 시안 승인): [최근]·폰 탭 줄은 없앴다. 폰 첫 화면은 나무(맨 위 '★ 별표 (개수)' · '큰 파일' → 저장소 뿌리 → 폴더, 줄 30px·들여쓰기 7px).
//   폴더·별표를 누르면 같은 자리에서 목록 + 위치 줄(원드라이브 › Pictures). 뒤로가기(브라우저·폰)·‹ = 한 단계 위, 맨 위 목록이면 나무(layer 'files-list').
//   위 줄은 찾기 칸 + 출처 단추(같은 줄 오른쪽 작은 정사각). '○분 전 맞춤'은 폰 나무의 첫 클라우드 뿌리 줄 오른쪽 작은 회색 글자. PC·폴드 첫 화면은 첫 저장소 맨 위.
// - 폰은 보기·찾기·열기·공유.
// - 쓰기(S48-45 ⑤·⑦): 이름 바꾸기·새 폴더·옮기기(같은 클라우드는 200개까지, 원드라이브↔구글은 전송 목록 — S52-43 ②부터 여러 개·폴더째)·휴지통(F1: 그 클라우드
//   휴지통, 확인 창 한 번). 모두 사람이 누른 것만 Edge cloud-files로 보내고(confirm:true), 서버가 로그인·주인·색인을 다시 본다.
//   고르기: PC는 Ctrl·⌘(하나씩)·Shift(이어서) 누르고 고르기, 폰은 꾹 누르기. 고르면 위에 한 줄 막대(옮기기·이름·휴지통·✕).
//   옮기기: [옮기기] → 옮길 폴더를 열고 [여기로 옮기기](잘라 붙이기와 같음). PC는 줄을 폴더(목록·나무)로 끌어 놓아도 된다.
//   PC 단축키: F2 이름 · Delete 휴지통 · Ctrl+A 모두 고르기 · Ctrl+X 옮기기 · Ctrl+V 여기로 옮기기 · Esc 고르기 풀기.
//   결과는 서버가 돌려준 바뀐 줄로 지금 목록을 고친다(sync와 같은 applyChanges, 다시 그리기 주인은 이 파일 하나).
// FILES-출처켜고끄기·두드라이브나무(S49-21, 요청함 11/04 07:34): 위 줄 오른쪽 출처 아이콘 [원드라이브][구글 드라이브](사진 화면과 같은 부품: od-link.js·brand-icons.js·source-chips.css)로
//   켜기/끄기(서버 view_prefs.files_sources의 이 기기 칸 — 폰 앱·폰 브라우저·PC 따로, files-sources-model.mjs). 켜진(연결된 것 중) 출처만 폴더·[별표]·찾기·나무에 보인다. 모두 끄면 '위 출처 아이콘을 켜 주세요' 한 줄.
//   끄기는 보기에서만 빠진다(연결·색인·밤 예약은 그대로). 연결 안 된 출처는 누르면 연결 안내 한 줄.
//   나무: 켜진 드라이브가 맨 위 줄(▸)로 나란히, 아래로 폴더를 펼치고 접는다. 폰(600px 미만)도 첫 화면이 같은 나무(한 화면에 두 드라이브, 여러 단계 펼치기),
//   폴더 이름을 누르면 그 폴더 안 목록(pane 'list'), 목록 맨 위 ‹ 로 나무(pane 'tree')로 돌아온다. 펼친 폴더는 그 폴더를 바로 읽어(Edge folder) 채우고 한 번 읽은 폴더는 다시 부르지 않는다(directDone).
//   펼침 상태는 이 탭 메모리만(서버에 저장하지 않음). 켜기/끄기만 서버에 기억해 다른 기기에서도 같다.
// FILES-통합 2-① 복사(S49-27, 명진 결정 H-3·H-4·H-5, 시안 files-unified-mockup.html ③④⑤): 고르기 막대 'N개 · [복사][옮기기][이름][휴지통] ✕' →
//   받을 곳 창(하단바 위, 최근 보낸 곳 칩 3개는 서버 view_prefs.files_dest_recent, 켜진 저장소 나무, [새 폴더][여기에 복사/옮기기]) → 같은 이름은 한 번 묻기
//   ([그래도 하기] = 서버가 '이름 (2)'로 번호 붙여 둘 다 둠 / [건너뛰기], '남은 것도 모두 같게') → 200MB 넘는 클라우드 사이 파일은 묻고 이 판에서는 다음 판 안내로 건너뜀
//   → 하단바 위 얇은 전송 줄 '2/5 보내는 중'(차례로 하나씩). 폴더째 복사는 S52-43 ②부터 원드라이브↔구글, S53-8부터 내 PC·이 폰과도(treeUp·treeDev). PC Ctrl+C·Ctrl+X → Ctrl+V.
// FILES-통합 2-② 전송 목록(S49-28, 명진 결정 H-4·H-6, 시안 ⑤⑧): 복사와 다른 저장소로 옮기기는 서버 작업표(Edge job_add → app_cloud_jobs)에 한 건 = 한 줄로 넣고
//   서버가 화면을 닫아도 차례로 잇는다(200MB 넘는 것은 [그래도 보내기]를 누른 것만 10MB 조각씩). 같은 저장소 안 옮기기는 지금처럼 move 한 번.
//   하단바 위 전송 줄을 누르면 전송 목록(폰: 하단바 위 칸, PC: 오른쪽 아래 작은 칸) — 줄마다 진행 막대·[멈춤]/[이어 하기]/[다시], '모두 멈춤'.
//   목록은 서버(job_list)에서 읽어 그린다. 보내는 것이 있는 동안만 2초마다 다시 읽고(화면이 보일 때만), 다시 열면 서버 목록으로 이어 보인다. 기기 저장 없음.
// FILES-통합 2-③ 두 칸(S49-30, 명진 결정 H-2, 시안 ⑥⑧): 폴드 펼침(600~1199, S51-18 전에는 761~)·PC(1200~)에서 위 줄 [두 칸]. 폴드 펼침은 기본 두 칸, PC는 기본 한 칸(나무·목록·미리보기),
//   폰(600px 미만)은 늘 한 칸. 켬은 서버 view_prefs.files_two(기기 종류별 · 폭 종류별, files-panes-model.mjs). 상태는 '칸 2개'(state.panes) — 한 칸 화면은 같은 코드로 칸 0 하나만 그린다.
//   칸마다 따로: 저장소·위치 줄·목록·정렬·고르기·찾기. 지금 칸(state.cur)은 칸 위 줄 밑선(fx-cur). 칸을 누르거나 Tab으로 바꾼다.
//   고르기 막대는 '→ 오른쪽에 복사 / → 옮기기'(받을 곳 = 반대 칸의 지금 폴더, 받을 곳 창 없이). 같은 이름·200MB 묻기·전송 목록은 2-①·2-② 그대로(xferRun).
//   칸 사이 끌어 놓기: 놓으면 '복사 · 옮기기' 작은 고르기. PC 키(두 칸일 때): F5 반대 칸에 복사 · F6 옮기기 · Tab 칸 바꾸기(입력 칸 안에서는 안 함). F2·Del은 그대로.
//   폴드 두 칸은 나무 대신 칸 위 줄 ▾(그 칸 위로 나무가 내려옴). 미리보기는 두 칸이면 덮는 칸(뒤로가기 한 번 = 닫힘).
// FILES-통합 3단계 '이 폰'(S49-51, 명진 결정 H-1·H-7, 폰 앱 0.5.0+): 위 줄 출처 아이콘에 [이 폰](폰 앱에서만). 앱 다리(phone-files.js)로 폰 저장 공간을 읽는다 —
//   나무 뿌리 줄에 '이 폰'(폴더 펼치기·목록). 미리보기·받기·공유는 폰 안에서 읽는다.
//   폰 파일 → 클라우드 [복사]는 올리기 길(upload_open, 2-④)을 그대로 쓴다(바이트는 폰 앱 안에서 읽어 클라우드 자리로 바로 보냄, 서버 Edge를 거치지 않음).
//   3-③(앱이 쓰기를 알 때, state.write): 클라우드 → 폰 [복사](받을 곳 창에 '이 폰', Edge media로 받아 앱이 그 폴더에 씀 — 같은 이름은 한 번 묻고 앱이 번호를 붙임, 덮어쓰기 없음),
//   폰 쪽 새 폴더·이름 바꾸기·휴지통(사람이 누른 것만, 휴지통은 확인 한 번 + 안드로이드 휴지통). 폰이 낀 옮기기는 아직 없다(복사 뒤 원본 지우기 안내).
//   [별표]·[큰 파일]·찾기는 클라우드만(폰 별표는 두지 않음, 설계 D-6).
//   폰 파일 목록은 이 화면 메모리에만 있고 서버·기기에 저장하지 않는다. [이 폰] 켜기/끄기는 이번 접속만 기억한다(서버 기억은 DB 한 칸이 더 필요해 다음 PR).
// FILES-내PC드라이브 ②(S50-27, 시안 A, 명진 결정 11/05 D1~D5·시안 A): 윈도우 PC 브라우저에서 바구니 PC 앱(0.3.0+) 문(pc-files.js, 127.0.0.1)이 같은 계정으로 답하면
//   나무 맨 끝 뿌리에 '내 PC'(원드라이브·구글 드라이브 다음 줄) → 드라이브(C:·D: …) → 폴더. 두 칸이면 칸마다 나무에서 '내 PC'를 고른다(왼쪽 내 PC · 오른쪽 원드라이브처럼).
//   이 단계는 보기·열기만: 파일 [이 PC에서 열기]·[탐색기에서 위치](그 PC의 프로그램이 엶, 바이트는 브라우저로 안 옴). 미리보기 그림·복사·옮기기·이름·휴지통·별표·색은 없다(다음 단계).
//   찾기에 PC 파일을 섞지 않는다(D3). 문이 답하지 않으면 '내 PC · 꺼짐' 흐린 줄 + 누르면 켜는 법 한 줄. 크롬 허락 창이 뜰 수 있으면 저절로 두드리지 않는다(누를 때만).
//   PC 목록·이름은 이 화면 메모리에만(서버·주소창·브라우저 저장소에 남기지 않음). 위 줄 [내 PC] 켜기/끄기는 이번 접속만 기억한다.
// FILES-내PC클라우드옮기기(S52-41, 요청함 11/08 1순위, 설계 docs/design/files-manager-audit.md A-1·C-1): 바구니 PC 앱 0.4.0+(문 hello의 can에 read·write·trash)이면
//   내 PC ↔ 원드라이브·구글 드라이브 복사·옮기기 — 칸 사이(·나무·폴더 줄) 끌어 놓기 → [복사][옮기기], 두 칸 F5/F6·'→ 오른쪽에 복사', Ctrl+C·X·V, 고르기 막대·⋯ [복사][옮기기]·받을 곳 창.
//   내 PC 줄도 끌기·놓기 대상(폴더 줄·드라이브 줄, '내 PC' 맨 위 목록은 받을 곳이 아님). 같은 이름은 한 번 묻고([그래도 하기] = '이름 (2)', 덮어쓰기 없음).
//   내 PC → 클라우드: 문에서 4MB씩 읽어(화면 메모리) 지금 올리기 길(upload_open·전송 목록·올리기 진행 표시 그대로). 옮기기면 서버가 올린 파일을 맞춘 뒤(upload_done)에만 원본을 윈도우 휴지통으로.
//   클라우드 → 내 PC: Edge media로 받아 문에 4MB씩 새 파일로 씀(문이 숨긴 조각 파일 → 크기가 맞으면 이름). 옮기기면 다 쓴 것만 클라우드 휴지통으로.
//   한 번에 20개·한 파일 1GB까지(폴더째는 S53-8 treeUp·treeDev — 폴더 하나에 파일 500개·폴더 100개까지). 내 PC와 이 폰 사이는 없음(pcXferWhy가 한 줄로 막음).
//   문 검사(127.0.0.1·허용 출처·매 요청 로그인 토큰)는 그대로. PC 경로·이름은 서버·로그·'최근 보낸 곳'에 남기지 않는다. 쓰기는 사람이 누른 것만.
// FILES-폰보기끌기 ①(S51-20, 시안 files-phone-grid-two-drag.html ①): 목록 위 두 손가락 벌리기 = 목록 → 격자 → 큰 격자, 오므리기 = 반대(폰·두 칸의 칸 3·2칸, 폴드·PC 한 칸 4·3칸).
//   사진은 목록·격자 모두 작은 그림(Edge thumb small · 이 폰은 앱 다리, 화면에 들어온 칸만), 폴더는 큰 폴더. 마지막 보기는 서버 view_prefs.files_look(기기 칸 · 폭 칸).
//   격자 칸은 목록 줄과 같은 단추·같은 data-*라 누르기·꾹 누르기·끌어 놓기 길이 그대로다. 찾는 중 목록은 늘 목록.
// FILES-폰보기끌기 ②(S51-20): 폰도 [두 칸 보기] = 위·아래 두 칸(files_two.<기기>.narrow). 폰 한 칸 흐름(나무 ⇄ 목록·뒤로가기)은 solo() 한 곳.
// FILES-폰보기끌기 ③(S51-20): 꾹 눌러 끌기(touch-drag.js) — 폴더(같은 칸·다른 칸·▾ 나무) 위 보라 점선, 놓으면 [복사][옮기기]. 같은 저장소 옮기기는 알림 [되돌리기].
// FILES-두칸나무접기(S52-41 ③, 명진 결정 (가) 11/08, 시안 files-two-pane-tree.html): 두 칸 보기(폴드 펼침·PC)면 왼쪽 나무를 접어 두고 맨 위 줄 왼쪽 ◫로 열고 닫는다
//   (서버 view_prefs.files_tree.<기기>.<fold|wide>, 없으면 접힘 — 적용 전에는 이번 접속만). 나무에서 누른 폴더는 지금 칸(초록 테두리)에 열린다. 칸 위 [출처 ▾] 맨 위에 별표·큰 파일.
//   나무 폴더 줄도 끌어서 칸·다른 나무 폴더에 놓을 수 있다(칸에 놓으면 [복사][옮기기]). 한 칸 보기·폰은 그대로.
// FILES-폴더고정(S52-41 ④, 시안 files-pinned-folders.html): 나무 맨 위(별표 위) '📌 고정한 폴더' 상자 — 어느 출처 폴더든, 줄 오른쪽 흐린 출처 글자, 누르면 그 폴더(두 칸이면 지금 칸),
//   ⠿(왼쪽, 공용 reorder-drag.js)로 순서. 폴더 ⋯·PC 우클릭 [위에 고정]·[고정 풀기], 나무 이름 옆 작은 📌, 칸 위 [출처 ▾] 맨 위에도.
//   클라우드 고정은 서버 view_prefs.files_pins('od:<id>'·'gd:<id>', 12개까지, 모든 기기 같게, 별표와 따로 — 적용 전에는 이번 접속만).
//   내 PC 고정은 그 PC에만(바구니 PC 앱 문 /v1/pins, 서버·브라우저 저장소·로그에 경로 없음) — 고정한 그 PC에서만 보인다. 출처를 껐거나 연결이 끊기면 흐리게 '연결 안 됨'(지우지 않음).
// FILES-내PC쓰기(S52-43 ①, 바구니 PC 앱 0.5.0+ — 문 hello의 can에 edit): 내 PC 줄도 클라우드와 같은 메뉴 — 고르기 막대 [복사][옮기기][이름][휴지통],
//   ⋯·우클릭(파일 = 열기·복사·옮기기·이름 바꾸기·휴지통, 폴더 = 열기·새 폴더·옮기기·이름 바꾸기·고정·휴지통), 위 줄 [새 폴더], F2·Delete.
//   내 PC 안끼리 옮기기(파일·폴더, 폴더는 같은 드라이브)·복사(파일) — 끌어 놓기(같은 칸은 기본 옮기기, 반대 칸은 [복사][옮기기])·Ctrl+C·X·V·받을 곳 창.
//   같은 이름은 한 번 묻고 [그래도 하기] = '이름 (2)'(문이 덮어쓰지 않음). 휴지통은 확인 한 번 → 윈도우 휴지통(드라이브는 아님).
//   미리보기: 0.4.0+ 문이면 사진·PDF(50MB까지)·글(앞 200KB)을 클라우드와 같은 보기 칸에(문에서 화면 메모리로 읽음). 오피스·한글은 이름·크기만.
//   PC 경로·이름은 서버·로그·브라우저 저장소에 남기지 않는다. 고정한 PC 폴더를 바꾸거나 옮기면 그 PC의 고정 목록 경로도 따라간다.
// FILES-저장소사이·되돌리기(S52-43 ②): 원드라이브 ↔ 구글 드라이브 폴더째 복사·옮기기(받을 곳에 같은 폴더 모양을 mkdir로 만들고 안의 파일을 전송 목록에 펼쳐 넣음,
//   한 폴더에 파일 500개·폴더 100개까지, 옮기기면 원래 폴더는 빈 폴더로 남음 — treeAcross). 여러 개 옮기기도 전송 목록(1개 제한 없음).
//   폰 ↔ 클라우드 옮기기(앱 3-③ 판): 복사한 뒤 원본을 휴지통으로(폰 → 클라우드는 서버가 맞춘 뒤 안드로이드 휴지통, 클라우드 → 폰은 다 받은 것만 클라우드 휴지통).
//   이름 바꾸기(클라우드·이 폰·내 PC)·내 PC 안 옮기기도 알림 [되돌리기](같은 저장소 클라우드 옮기기는 앞서 있음). 휴지통은 그 저장소 휴지통에서 되살린다(F1 그대로).
// FILES-관리자마무리(S52-43 ③): 미리보기 머리 줄 ← →(키 ←·→) = 같은 목록의 앞·다음 파일, 동영상·소리는 미리보기 칸에서 재생(200MB까지, blob: 메모리),
//   파일·폴더 ⋯·우클릭 [경로 복사](클립보드에만 — 내 PC는 실제 경로, 그 밖은 '원드라이브 › 문서 › 이름'), 그림·파일 붙여넣기(Ctrl+V) = 지금 클라우드 폴더에 올리기.
// FILES-관리자마무리 ②(S52-44): 칸마다 마지막으로 보던 원드라이브·구글 드라이브 폴더를 서버에 기억(view_prefs.files_last, files-last-model.mjs — 적용 전에는 이번 접속만).
//   PC·폴드 첫 칸·두 칸의 각 칸을 처음 열 때 그 저장소의 마지막 폴더로(폰 한 칸 첫 화면은 그대로 나무). 그 폴더가 없어졌으면 맨 위로 열고 기억을 지운다.
//   이 폰·내 PC 위치·폴더 이름은 서버에 두지 않는다.
// FILES-관리자마무리 ③④⑤(S52-44): 한글(HWP·HWPX) 미리보기 = 저장소 한글 엔진(칸막이 iframe)이 그린 앞 10쪽을 blob: SVG 그림으로(30MB까지).
//   찾기 결과 위 거르기 줄 — [이 폴더|전체](폴더를 연 칸, 서버 위치 글자로) · 종류 · 날짜 · 크기 칩(작은 메뉴). 받은 줄 안에서 화면이 거른다(files-find-model.mjs).
//   여러 개 고른 줄 ⋯·우클릭 [여러 개 받기] = 파일만 zip 하나(압축 없이 담기, 100개·500MB까지, files-zip-model.mjs). 줄 300개가 넘는 폴더는 화면 밖 줄을 그리지 않는다
//   (content-visibility). PC 두 칸(1200px~)도 종류 열을 보인다.
// 저장은 서버만: 목록은 이 탭 메모리(열린 동안만), 받은 그림·PDF는 blob: 주소(메모리)로만 두고 화면을 떠나면 놓는다. 기기 저장 없음.
// 파일 이름은 모두 글자로만 그린다(esc). 로그에 파일 이름·id를 남기지 않는다.

(() => {
if (window.KPTUFiles) return;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
// 종류 아이콘 속: 그림 이름이 있으면 공용 SVG, 없으면 짧은 글자(P·한·W 등).
const kindIco = r => (kindSvg(r) ? iconSvg(kindSvg(r), {size: 14}) : esc(kindIcon(r)));
const starFace = on => iconSvg(on ? 'star' : 'starLine', {size: 15});
const STAR_ICO = `<span class="fx-star" aria-label="별표">${iconSvg('star', {size: 11})}</span>`;
const FN = '/functions/v1/cloud-files';
const MEDIA_BIG_TEXT = '200MB가 넘어 여기서는 재생하지 않아요. [열기]로 보세요';
const HWP_BIG_TEXT = '30MB가 넘는 한글 파일은 여기서 보지 않아요. [열기]로 보세요';
// FILES-폴드나무목록 ⑥(S51-18): 폰 한 칸인가는 공용 판정(screen-width.mjs, 600px 미만). 펼친 폴드(약 673~884px)는 폴드 칸(나무 | 목록).
const PHONE = window.matchMedia(NARROW_QUERY);
// 출처 켜기/끄기를 기억하는 기기 칸(폰 앱·폰 브라우저·PC, 명진 결정 H-8). 화면을 연 때 한 번 정한다. 기억 칸은 지금까지처럼 760px 기준(바꾸면 기억한 켜기/끄기가 다른 칸으로 감).
const DEVICE = filesDeviceKind({ua: navigator.userAgent || '', narrow: !!window.matchMedia(PHONE_WIDTH_QUERY).matches});
const WIDE = window.matchMedia('(min-width:1200px)');
// 손가락이 주 입력인 기기(폰·폴드): 줄을 HTML 끌기(draggable)로 두지 않는다 — 안드로이드 크롬은 길게 누르면 그 끌기를 시작해 꾹 눌러 끌기(touch-drag.js)를 끊는다.
const TOUCH = window.matchMedia('(hover: none) and (pointer: coarse)');
const GDRIVE_SVG = brandIconSvg('gdrive', {size: 16, cls: 'fx-src-ic'});
const PDF_LIB = new URL('./pdf-lib/pdfjs-dist-6.3.289/', import.meta.url);
// '이 폰' 다리(폰 앱에서만 usable). phoneOff = 이번 접속에서 [이 폰]을 끔(메모리만).
const phone = createPhoneFiles(window);
let phoneOff = false;
// '내 PC' 다리(윈도우 PC 브라우저에서만). 문에는 지금 Web2 로그인 토큰을 매 요청 싣는다(문이 같은 계정인지 본다). pcOff = 이번 접속에서 [내 PC]를 끔.
const pc = createPcFiles(window, {enabled: pcDeviceOk({ua: navigator.userAgent || '', kind: DEVICE}), token: async () => {
  const r = window.KPTURuntime;
  if (!r || !(await r.session.ensure())) return '';
  return r.session.read()?.access_token || '';
}});
let pcOff = false;
const PC_SVG = '<svg class="fx-src-ic" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="8.5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M6 14h4M8 11v3" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>';
const PHONE_SVG = '<svg class="fx-src-ic" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="1.5" width="8" height="13" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="12.2" r=".8" fill="currentColor"/></svg>';

// S52-07 칸 머리 출처 그림(위 줄 출처 아이콘과 같은 그림).
const PANE_SRC_SVG = {od: brandIconSvg('onedrive', {size: 16, cls: 'fx-src-ic'}), gd: GDRIVE_SVG, ph: PHONE_SVG, pc: PC_SVG};

// 목록 칸 하나(칸 0 = 한 칸 화면의 그 칸 / 두 칸이면 왼쪽, 칸 1 = 두 칸일 때만 있는 오른쪽). 칸 위 줄(fx-ptop)은 두 칸일 때만 보인다.
const paneHtml = i => `<div class="fx-listcol" data-fx-pane-i="${i}"><div class="fx-ptop" data-fx-ptop hidden></div><nav class="fx-ptree nx-tree" data-fx-ptree aria-label="${i ? '오른쪽' : '왼쪽'} 칸 폴더" hidden></nav>`
  + `<div class="fx-wait" data-fx-wait hidden></div><section class="fx-list" data-fx-list aria-label="${i ? '오른쪽 칸 파일 목록' : '파일 목록'}"></section></div>`;
function install() {
  if (document.getElementById('filesView')) return;
  document.getElementById('appView')?.insertAdjacentHTML('beforeend', `<section id="filesView" class="view-panel hidden" aria-labelledby="fxTitle">
<h2 id="fxTitle" class="screen-title">파일</h2>
<div id="filesRoot" class="fx" data-fx-pane="list">
<div class="fx-top"><button type="button" class="icon-btn fx-tree-tog" data-fx-tree-tog aria-pressed="false" aria-label="폴더 나무 열기" title="폴더 나무 열기" hidden>◫</button><nav class="fx-crumb" data-fx-crumb aria-label="위치"></nav><input type="search" class="fx-search" data-fx-search placeholder="이름·자료실 글자 찾기" aria-label="파일 찾기" maxlength="200" autocomplete="off" enterkeyhint="search"><select class="fx-sort" data-fx-sort aria-label="정렬">${SORTS.map(k => `<option value="${k}">${SORT_NAME[k]}</option>`).join('')}</select><button type="button" class="fx-btn fx-mkdir" data-fx-mkdir hidden>새 폴더</button><button type="button" class="fx-btn fx-upload" data-fx-upload hidden>올리기</button><input type="file" multiple hidden data-fx-file aria-hidden="true" tabindex="-1"><input type="file" hidden data-fx-refile aria-hidden="true" tabindex="-1"><button type="button" class="fx-sync" data-fx-sync title="지금 맞추기"></button><span class="fx-srcs src-chips" data-fx-srcs role="group" aria-label="파일 출처" hidden>${odLinkButtonHtml('data-fx-src="od" data-src-chip aria-pressed="true"')}<button type="button" class="mini fx-src-btn" data-fx-src="gd" data-src-chip aria-pressed="true" aria-label="구글 드라이브" title="구글 드라이브" hidden>${GDRIVE_SVG}</button><button type="button" class="mini fx-src-btn" data-fx-src="ph" data-src-chip aria-pressed="false" aria-label="이 폰" title="이 폰" hidden>${PHONE_SVG}</button><button type="button" class="mini fx-src-btn" data-fx-src="pc" data-src-chip aria-pressed="false" aria-label="내 PC" title="내 PC" hidden>${PC_SVG}</button></span><button type="button" class="mini fx-two" data-fx-two title="두 칸으로 보기" hidden>두 칸 보기</button></div>
<div class="fx-bar" data-fx-bar role="toolbar" aria-label="고른 것" hidden></div>
<p class="fx-note" data-fx-note role="status" hidden></p>
<div class="fx-up" data-fx-uprows hidden></div>
<div class="fx-cols" data-fx-cols><nav class="fx-tree nx-tree" data-fx-tree aria-label="폴더"></nav><div class="fx-main" data-fx-main>${paneHtml(0)}<aside class="fx-prev" data-fx-prev aria-label="미리보기" hidden></aside></div></div>
<div class="fx-dim" data-fx-dim hidden></div><section class="fx-dest" data-fx-dest role="dialog" aria-modal="true" aria-labelledby="fxDestTitle" hidden></section>
<div class="fx-askbox" data-fx-askbox hidden></div><div class="fx-drop-ask" data-fx-dropask role="dialog" aria-label="놓을 때 고르기" hidden></div><section class="fx-jobs" data-fx-jobs role="dialog" aria-labelledby="fxJobsTitle" hidden></section><div class="fx-xfer" data-fx-xfer role="status" aria-live="polite" hidden></div>
</div></section>`);
}
install();

const root = document.getElementById('filesRoot');
const $ = sel => root?.querySelector(sel);
const rt = () => window.KPTURuntime;
const scopeOf = () => { const c = rt()?.context?.read?.(); return `${c?.user?.id || ''}:${c?.workspace?.id || ''}`; };
// 칸 하나의 상태(S49-30 두 칸): 위치·목록·정렬·찾기·고르기. pane = 폰 칸 0의 나무/목록(첫 화면은 나무), drop = 폴드 두 칸의 ▾ 나무가 내려와 있는가. seq·fseq·ftimer = 늦게 온 응답 거르기.
const freshPane = () => ({where: null, rows: [], loaded: false, failed: '', failedWhy: '', trail: [], sort: 'name', dir: 'asc',
  query: '', found: null, findFailed: '', findWhy: '', sel: '', picked: new Set(), anchor: '', pane: 'tree', drop: false, srcOpen: false, seq: 0, fseq: 0, ftimer: 0, lastTry: '', ff: freshFilter()});
const fresh = () => ({scope: '', status: null, statusFailed: '', statusWhy: '', panes: [freshPane(), freshPane()], cur: 0,
  children: new Map(), open: new Set(), stars: null, syncedAt: null, syncing: false,
  // FOLDER-나무새기준 ②: 폴더 안 파일(폰 나무 그 자리 펼치기), 접은 저장소 상자, 'n개 더 보기'를 누른 폴더, '최근' 상자(서버 p_shelf 'recent'),
  // 두 손가락으로 그 폴더만 보기 전 나무 화면 위치. 모두 화면 메모리만(기기 저장 없음).
  files: new Map(), more: new Set(), recent: null, recentAll: false, treeBack: null, treeRows: new Map(),
  // S51-22 나무 ⋯ 메뉴: 색을 바꿀 폴더·올릴 폴더(그 메뉴에서 고른 것, 화면 메모리만).
  lookRow: null, upTo: null,
  preview: null, clip: null, busy: '', hint: '', xfer: null, run: null, ask: null, dropAsk: null,
  jobs: [], jobsOpen: false, jobsBusy: false, jobsWere: false});
const jobsSeen = new Set();
let state = fresh(), syncTimer = 0, layer = null, entering = null, jobTimer = 0, jobsLayer = null;
// 지금 칸 · 두 칸인가(폰은 늘 한 칸) · 그려지는 칸들 · 반대 칸 · 칸 번호.
const P = () => state.panes[state.cur];
// S51-20 ②: 폰(600px 미만)도 [두 칸 보기] — 위·아래 두 칸(시안 files-phone-grid-two-drag.html ②). 켬은 files_two의 narrow 칸.
const twoPref = () => twoOn(viewPrefs.getFilesTwo?.(DEVICE), twoLayout(WIDE.matches, PHONE.matches));
const two = () => twoPref();
// 폰 한 칸(나무 화면 ⇄ 폴더 목록, 뒤로가기 = 한 단계 위·나무). 폰 두 칸은 폴드 두 칸처럼 칸마다 ▾ 나무.
const solo = () => PHONE.matches && !two();
// 칸 이름: 폰 두 칸은 위·아래, 그 밖은 왼쪽·오른쪽.
const VERT = () => PHONE.matches && two();
const side = i => paneSide(i, VERT());
const panesOn = () => (two() ? state.panes : [state.panes[0]]);
const idxOf = p => state.panes.indexOf(p);
const otherOf = p => state.panes[idxOf(p) ^ 1];
const paneEl = p => root?.querySelector(`[data-fx-pane-i="${idxOf(p)}"]`);
const inPane = (p, sel) => paneEl(p)?.querySelector(sel) || null;
const JOB_POLL_MS = 2000;

// ---------- 서버 ----------
const rpc = (name, body) => rt().api(`/rest/v1/rpc/${name}`, {method: 'POST', body, singleFlight: false});
const edge = (action, body = {}) => rt().api(FN, {method: 'POST', body: {action, ...body}, singleFlight: false, timeoutMs: 30000});
const codeOf = e => String(e?.message || (e?.status ? 'http_' + e.status : '') || '');
// 그림·PDF·글 바이트(썸네일·원본·미리보기 PDF). 응답이 JSON이면 서버 오류 코드.
async function bytes(body, {range = ''} = {}) {
  const r = rt();
  if (!(await r.session.ensure())) throw Object.assign(new Error('session_required'), {status: 401});
  const token = r.session.read()?.access_token;
  if (!token) throw Object.assign(new Error('session_required'), {status: 401});
  const headers = {apikey: r.config.key, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'};
  if (range) headers.Range = range;
  // LOAD-끝있는불러오기(S51-29): 작은 그림 받기 한 번은 BYTES_MS 안에 끝난다(넘으면 timeout → 칸 ↻·실패 표시).
  const job = async signal => {
    const res = await fetch(r.config.url + FN, {method: 'POST', cache: 'no-store', headers, body: JSON.stringify(body), signal});
    const type = (res.headers.get('content-type') || '').split(';')[0].trim();
    if (!res.ok || /json/.test(type)) {
      let code = ''; try { code = (await res.json())?.error || ''; } catch { /* 본문 없음 */ }
      throw Object.assign(new Error(code || `http_${res.status}`), {status: res.status});
    }
    return res.blob();
  };
  // 작은 그림(thumb)만 끊는다. 원본·미리보기는 크거나 서버 변환이 길 수 있어 그대로.
  return body.action === 'thumb' ? within(job, BYTES_MS).catch(e => { throw isLoadTimeout(e) ? Object.assign(new Error('timeout'), {code: 'timeout'}) : e; }) : job();
}
const BYTES_MS = 60000;

// ---------- 상태·목록 읽기 ----------
function resetIfOwnerChanged() {
  const scope = scopeOf();
  if (state.scope === scope) return;
  dropPreview();
  if (state.ask) state.ask.resolve({choice: 'skip', all: true, closed: true});
  state = fresh(); state.scope = scope; jobsSeen.clear(); clearTimeout(jobTimer);
}
const connected = () => SOURCES.filter(s => state.status?.[s]?.connected);
// 켜진 출처(연결된 것 중 아이콘으로 켠 것). 보기 전부(최근·폴더·별표·찾기·나무)가 이 목록만 본다.
const srcState = () => viewPrefs.getFilesSources?.(DEVICE);
// '이 폰': 폰 앱 다리가 '모든 파일 접근'으로 켜져 있고(phone.state.all) 이번 접속에서 끄지 않았을 때. 클라우드 뒤 맨 끝 줄.
const phoneLinked = () => phone.usable && phone.state.all;
const phoneOn = () => phoneLinked() && !phoneOff;
// '내 PC': 문이 같은 계정으로 답하고(pc.state.ok) 이번 접속에서 끄지 않았을 때. 맨 끝 줄(시안 A).
const pcOn = () => pc.usable && pc.state.ok && !pcOff;
// 내 PC ↔ 클라우드 복사·옮기기를 할 수 있나(문이 0.4.0+ — read·write·trash를 앎).
const pcWrite = () => pcOn() && pc.canXfer;
// FILES-내PC쓰기(S52-43 ①): 내 PC 안 이름 바꾸기·새 폴더·옮기기·복사·휴지통(문이 0.5.0+ — edit를 앎).
const pcEdit = () => pcWrite() && pc.canEdit;
const pcWhy = (rows, dest) => pcXferWhy(rows, dest, {can: pcOn() ? pc.state.can : []});
// 두 칸 보기 왼쪽 나무 열림(◫). 폭 종류(fold·wide)마다 서버에 기억, 서버가 거절하면(DB 적용 전) 이번 접속만(treeMem).
const treeLayout = () => (WIDE.matches ? 'wide' : 'fold');
const treeMem = new Map();
const treeOpen = () => (treeMem.has(treeLayout()) ? treeMem.get(treeLayout()) : viewPrefs.getFilesTree?.(DEVICE)?.[treeLayout()] === true);
const treeShut = () => two() && !PHONE.matches && !treeOpen();
// ---------- 고정한 폴더(S52-41 ④) ----------
let pinsMem = null, pinsPc = [];
const pinNames = new Map(), pinAsked = new Set();
const cloudPins = () => pinsClean(pinsMem ?? viewPrefs.getFilesPins?.());
const pcPinsOn = () => pcOn() && pc.canPins;
const pinOf = (source, id) => (source === PC ? (id ? 'pc:' + id : '') : pinKey(source, id));
const isPinned = (source, id) => (source === PC ? pinsPc.includes(id) : pinHas(cloudPins(), pinKey(source, id)));
// 고정할 수 있는 폴더인가(클라우드 폴더, 또는 바구니 문이 고정을 아는 내 PC 폴더·드라이브). 아니면 메뉴 항목 없음(null).
const pinState = r => (r?.is_folder && (SOURCES.includes(r.source) || (r.source === PC && pcPinsOn())) ? isPinned(r.source, r.item_id) : null);
function pinsChanged() { paintTree(); for (const p of panesOn()) if (p.srcOpen) paintPaneTop(p); }
// ---------- 칸마다 마지막 폴더(S52-44 ②) ----------
let lastMem = null;
const lastNow = () => lastClean(lastMem ?? viewPrefs.getFilesLast?.());
function rememberLast(p, where) {
  const next = lastPut(lastNow(), idxOf(p), where);
  if (!next) return;
  lastMem = next;
  viewPrefs.setFilesLast?.(next);
}
// 칸 p의 첫 자리(맨 위)를 기억한 폴더로. 바꿨으면 그 폴더가 아직 있는지 목록을 읽은 뒤 본다(p.lastTry).
function startAt(p, start) {
  const at = lastStart(start, lastNow(), idxOf(p));
  p.lastTry = at !== start ? at.parent : '';
  return at;
}
function setCloudPins(list) {
  pinsMem = list;
  viewPrefs.setFilesPins?.(list);
  pinsChanged();
}
async function setPcPins(list) {
  try { pinsPc = await pc.setPins(list); } catch (e) { notify(errorText(codeOf(e)), {error: true, record: false}); }
  pinsChanged();
}
async function loadPcPins() {
  if (!pcPinsOn()) { if (pinsPc.length) { pinsPc = []; pinsChanged(); } return; }
  try { pinsPc = await pc.pins(); } catch { pinsPc = []; }
  pinsChanged();
}
function pinToggle(r) {
  if (!r?.is_folder) return;
  if (r.source === PC) {
    const has = pinsPc.includes(r.item_id);
    if (!has && pinsPc.length >= PINS_MAX) { notify(`고정은 ${PINS_MAX}개까지예요. 다른 것을 풀고 다시 해 주세요`, {record: false}); return; }
    void setPcPins(has ? pinsPc.filter(x => x !== r.item_id) : [...pinsPc, r.item_id]);
    return;
  }
  const key = pinKey(r.source, r.item_id);
  if (pinHas(cloudPins(), key)) { setCloudPins(pinRemove(cloudPins(), key)); return; }
  if (r.name) pinNames.set(key, r.name);
  const out = pinAdd(cloudPins(), key);
  if (!out.ok) { notify(out.why, {record: false}); return; }
  setCloudPins(out.list);
}
// 고정한 폴더 이름: 이 화면이 이미 아는 줄에서 찾고, 모르면 색인 위치 줄(app_cloud_trail)에서 한 번 묻는다.
function pinNameOf(source, id) {
  const key = pinKey(source, id);
  if (pinNames.has(key)) return pinNames.get(key);
  for (const list of state.children.values()) { const f = list.find(x => x.source === source && x.item_id === id); if (f) { pinNames.set(key, f.name); return f.name; } }
  for (const p of state.panes) { const t = p.where?.source === source && p.trail.find(x => x.item_id === id); if (t) { pinNames.set(key, t.name); return t.name; } }
  if (!pinAsked.has(key) && connected().includes(source)) {
    pinAsked.add(key);
    rpc('app_cloud_trail', {p_source: source, p_item_id: id}).then(rows => {
      const me = (Array.isArray(rows) ? rows : []).find(x => x.item_id === id) || (Array.isArray(rows) ? rows : []).find(x => Number(x.depth) === 0);
      if (me?.name) { pinNames.set(key, me.name); pinsChanged(); }
    }).catch(() => {});
  }
  return '';
}
function pinRows() {
  const on = onSources();
  const cloud = cloudPins().map(k => { const {source, id} = pinParse(k); return {key: k, list: 'cloud', ...pinView({source, id, name: pinNameOf(source, id), on})}; });
  const local = pcPinsOn() ? pinsPc.map(path => ({key: 'pc:' + path, list: 'pc', ...pinView({source: PC, id: path, on})})) : [];
  return [...cloud, ...local];
}
function pinRowHtml(x, curKey) {
  return `<div class="fx-pin" data-reorder-id="${esc(x.key)}"><button type="button" class="icon-btn fx-pin-grip" data-reorder-handle aria-label="${esc(x.name)} 순서 옮기기(위·아래 화살표)">⠿</button>`
    + ftFolderRowHtml({name: x.name, count: x.tag || SOURCE_NAME[x.source], depth: 0, hasContent: false, current: curKey === pinOf(x.source, x.id) && !!x.live,
      className: x.live ? 'fx-pin-row' : 'fx-pin-row ft-off', mainAttrs: {'data-fx-pin-go': x.key, title: x.live ? '' : `${SOURCE_NAME[x.source]}이(가) 꺼져 있거나 연결이 끊겼어요`},
      more: {attrs: {'data-fx-pin-menu': x.key}, label: `${x.name} 고정 메뉴`}}) + '</div>';
}
function pinBoxHtml(curKey = '') {
  const rows = pinRows();
  if (!rows.length) return '';
  const part = list => { const r = rows.filter(x => x.list === list); return r.length ? `<div class="fx-pins" data-reorder-list="${list}">${r.map(x => pinRowHtml(x, curKey)).join('')}</div>` : ''; };
  return ftBoxHtml({head: `<span class="ft-box-ico">${iconSvg('pin', {size: 13})}</span>고정한 폴더`, body: part('cloud') + part('pc'), label: '고정한 폴더', attrs: {'data-fx-box': 'pins'}});
}
function pinGo(key, p = P()) {
  const x = pinRows().find(y => y.key === key);
  if (!x) return;
  if (!x.live) { notify(`${SOURCE_NAME[x.source]}이(가) 꺼져 있거나 연결이 끊겼어요. 위 출처 아이콘을 확인해 주세요`, {record: false}); return; }
  state.open.add(folderKey(x.source, null));
  goFolder(x.source, x.id, p);
}
function pinMenu(b) {
  const key = b.dataset.fxPinMenu, x = pinRows().find(y => y.key === key);
  if (!x) return;
  openRowMenu(b, {key: 'pin:' + key, label: x.name, items: [{id: 'go', label: '열기'}, {id: 'unpin', label: '고정 풀기', sep: true}],
    run: id => { if (id === 'go') pinGo(key); else if (x.source === PC) void setPcPins(pinsPc.filter(y => y !== x.id)); else setCloudPins(pinRemove(cloudPins(), key)); }});
}
function pinReorder(key, list, index) {
  if (list !== (key.startsWith('pc:') ? 'pc' : 'cloud')) return; // 클라우드 ↔ 내 PC 묶음 사이로는 옮기지 않는다(저장 곳이 다름)
  if (list === 'pc') { const k = key.slice(3); if (pinsPc.includes(k)) void setPcPins(pinMove(pinsPc, k, index)); return; }
  if (pinHas(cloudPins(), key)) setCloudPins(pinMove(cloudPins(), key, index));
}
function pinNudge(key, dir) {
  if (key.startsWith('pc:')) { const k = key.slice(3); void setPcPins(pinStep(pinsPc, k, dir)); }
  else setCloudPins(pinStep(cloudPins(), key, dir));
  requestAnimationFrame(() => root?.querySelector(`[data-reorder-id="${CSS.escape(key)}"] [data-reorder-handle]`)?.focus({preventScroll: true}));
}
function toggleTree() {
  const at = treeLayout(), on = !treeOpen();
  treeMem.set(at, on);
  viewPrefs.setFilesTree?.(DEVICE, {...(viewPrefs.getFilesTree?.(DEVICE) || {}), [at]: on});
  paint();
  $('[data-fx-tree-tog]')?.focus({preventScroll: true});
}
const onSources = () => [...visibleSources(srcState(), connected()), ...(phoneOn() ? [PH] : []), ...(pcOn() ? [PC] : [])];
const cloudOn = () => onSources().filter(s => s !== PH && s !== PC);
// 폰에 쓸 수 있나(앱 3-③ 판 + 허락 + 켜짐).
const phoneWrite = () => phoneOn() && phone.state.write === true;
const anyLinked = () => connected().length > 0 || phoneLinked() || (pc.usable && pc.state.ok);
const nothingOn = () => !!state.status && anyLinked() && !onSources().length;
async function loadStatus() {
  const scope = state.scope;
  try {
    const d = await edge('status');
    if (state.scope !== scope) return;
    state.status = d && typeof d === 'object' ? d : {}; state.statusFailed = '';
    const times = SOURCES.map(s => Date.parse(d?.[s]?.synced_at || '')).filter(Number.isFinite);
    if (times.length) state.syncedAt = Math.min(...times);
  } catch (e) {
    if (state.scope !== scope) return;
    state.statusFailed = codeOf(e); state.statusWhy = failReason(e);
  }
}
function setWhere(p, where, {keepPreview = false} = {}) {
  const fromShelf = !!p.where?.shelf || !p.where;
  p.where = where; p.rows = []; p.loaded = false; p.failed = ''; p.trail = []; p.drop = false;
  // 묶음은 저마다 기본 정렬(큰 파일 = 크기, 별표 = 이름). 폴더 안에서 고른 정렬은 폴더를 옮겨도 그대로.
  if (where?.shelf) [p.sort, p.dir] = where.shelf === 'big' ? ['size', 'desc'] : ['name', 'asc'];
  else if (fromShelf) [p.sort, p.dir] = ['name', 'asc'];
  if (!keepPreview) { p.sel = ''; closePreview(); }
  p.picked.clear(); p.anchor = ''; p.pane = 'list'; state.hint = '';
  if (where?.parent !== p.lastTry) p.lastTry = '';
  rememberLast(p, where);
  if (p === state.panes[0]) {
    // 주소 자리는 at·shelf 중 하나만(묶음 → 폴더로 옮겨도 옛 shelf가 남아 새로고침 때 묶음으로 열리지 않게).
    window.KPTURouter?.setPlace?.('files', {at: null, shelf: null, ...placeOf(where)});
    listLayerOpen();
  }
  paint();
  return loadList(p);
}
async function loadList(p, {quiet = false} = {}) {
  const where = p.where, scope = state.scope, seq = ++p.seq;
  if (!where) return;
  try {
    let rows, trail = [];
    // 묶음(큰 파일·별표)은 켜진 출처를 서버로 넘겨 서버가 거른다(S49-26, 화면이 200줄을 받아 덮어 거르지 않음).
    if (where.shelf) {
      const on = cloudOn();
      rows = on.length ? await rpc('app_cloud_find_in', {p_sources: on, p_query: null, p_shelf: where.shelf, p_limit: SHELF_LIMIT}) : [];
    } else if (where.source === PH) {
      rows = await phone.list(where.parent);
      trail = phoneTrail(where.parent);
    } else if (where.source === PC) {
      rows = await pc.list(where.parent);
      trail = pcTrail(where.parent);
    } else {
      [rows, trail] = await Promise.all([
        rpc('app_cloud_list', {p_source: where.source, p_parent_id: where.parent}),
        where.parent ? rpc('app_cloud_trail', {p_source: where.source, p_item_id: where.parent}) : Promise.resolve([])]);
    }
    if (seq !== p.seq || state.scope !== scope) return;
    p.rows = Array.isArray(rows) ? rows : []; p.trail = Array.isArray(trail) ? trail : []; p.loaded = true; p.failed = ''; p.failedWhy = '';
    // S52-44 ②: 기억한 마지막 폴더가 없어졌으면(위치를 못 찾음) 그 저장소 맨 위로 열고 기억을 지운다.
    if (p.lastTry && where.parent === p.lastTry && !where.shelf) {
      p.lastTry = '';
      if (!p.trail.length && !p.rows.length) return setWhere(p, {source: where.source, parent: null}, {keepPreview: true});
    }
    if (where.shelf === 'starred') state.stars = starCount(p.rows);
    recordCounts(p, scope);
    if (where.source) {
      state.children.set(folderKey(where.source, where.parent), p.rows.filter(r => r.is_folder));
      state.files.set(folderKey(where.source, where.parent), p.rows.filter(r => !r.is_folder && !isLockedItem(r)));
      // 위치 줄의 폴더(맨 위부터 지금 폴더까지)는 나무에서 펼쳐 둔다(나무가 칠하는 지금 칸만).
      if (p === P()) for (const id of [null, ...trailIds(p.trail)]) state.open.add(folderKey(where.source, id));
    }
  } catch (e) {
    if (seq !== p.seq || state.scope !== scope) return;
    if (!quiet || !p.loaded) { p.failed = codeOf(e); p.failedWhy = failReason(e); p.loaded = false; }
  }
  paint();
  if (where.source && !where.shelf) directRead(p, where, scope);
}
// 폴더를 열면 그 폴더만 클라우드에서 바로 읽어 색인에 합친다(폴더마다 이 화면이 열려 있는 동안 한 번). 색인이 덜 찼어도 빈 화면이 되지 않게.
const directDone = new Set();
// 폴더 줄 개수: 그 폴더를 클라우드에서 실제로 읽은 뒤(directRead 성공) 보이는 줄로 센 값만 쓴다. 안 읽은 폴더는 비워 둔다(색인 장수는 모름을 0으로 보임).
const readOk = new Set(), counts = new Map();
const countKey = (scope, source, id) => scope + '|' + folderKey(source, id);
function recordCounts(p, scope) {
  const where = p.where;
  if (!where?.source || where.shelf || !readOk.has(countKey(scope, where.source, where.parent))) return;
  const rows = p.rows.filter(r => !isLockedItem(r));
  counts.set(countKey(scope, where.source, where.parent), {folders: rows.filter(r => r.is_folder).length, files: rows.filter(r => !r.is_folder).length});
}
const countOf = (source, id) => folderCountText(counts.get(countKey(state.scope, source, id)));
async function directRead(p, where, scope) {
  const key = scope + '|' + folderKey(where.source, where.parent);
  if (directDone.has(key) || !connected().includes(where.source)) return;
  directDone.add(key);
  try {
    const d = await edge('folder', {source: where.source, ...(where.parent ? {id: where.parent} : {})});
    readOk.add(key);
    if (state.scope !== scope) return;
    // 두 칸이 같은 폴더를 보고 있으면 둘 다 고친다.
    for (const q of panesOn()) {
      if (q.where?.source !== where.source || (q.where.parent || null) !== (where.parent || null) || q.where.shelf) continue;
      if (d?.added > 0 || d?.reload) await loadList(q, {quiet: true});
      else { recordCounts(q, scope); paintPane(q); }
    }
    paintTree();
  } catch { /* 이번엔 색인 그대로. 다음 갱신이 이어 맞춘다 */ }
}
async function loadChildren(source, parent) {
  const key = folderKey(source, parent), scope = state.scope;
  try {
    const rows = source === PH ? await phone.list(parent) : source === PC ? await pc.list(parent) : await rpc('app_cloud_list', {p_source: source, p_parent_id: parent});
    if (state.scope !== scope) return;
    const all = Array.isArray(rows) ? rows : [];
    state.children.set(key, all.filter(r => r.is_folder));
    state.files.set(key, all.filter(r => !r.is_folder && !isLockedItem(r)));
  } catch { if (state.scope === scope) state.children.set(key, []); }
  paintTree();
}

// 나무에서 폴더를 펼칠 때: 색인에서 하위 폴더를 읽고(아직 모르면), 그 폴더를 클라우드에서 바로 한 번 읽어 채운다(directRead와 같은 길·같은 directDone — 읽은 폴더는 다시 부르지 않음).
async function fillFolder(source, parent) {
  const key = folderKey(source, parent), scope = state.scope, dk = scope + '|' + key;
  if (!state.children.has(key)) await loadChildren(source, parent);
  if (state.scope !== scope || directDone.has(dk) || !connected().includes(source)) return;
  directDone.add(dk);
  try {
    const d = await edge('folder', {source, ...(parent ? {id: parent} : {})});
    readOk.add(dk);
    if (state.scope !== scope) return;
    if (d?.added > 0 || d?.reload) await loadChildren(source, parent); else { recordCountsFor(source, parent, scope); paintTree(); }
  } catch { /* 이번엔 색인 그대로. 다음 갱신이 이어 맞춘다 */ }
}
function recordCountsFor(source, parent, scope) {
  for (const p of panesOn()) { const w = p.where; if (w?.source === source && (w.parent || null) === (parent || null)) recordCounts(p, scope); }
}

// '★ 별표 (개수)'(나무 맨 위 줄): 별표 목록을 읽으면 그 줄 수. 들어올 때·출처를 켜고 끌 때·별표를 바꾼 뒤 같은 읽기 함수(app_cloud_find_in)로 센다.
const starCount = rows => { const list = Array.isArray(rows) ? rows : []; return list.length >= SHELF_LIMIT ? `${SHELF_LIMIT}+` : String(list.filter(r => !isLockedItem(r)).length); };
// FOLDER-나무새기준 ① 파일 '최근' 상자: 켜진 클라우드의 최근 바뀐 파일(서버 p_shelf 'recent', 따로 저장 없음). 폰 나무에서만 보인다.
// S51-23 FILES-최근자동제외: Web2 자동화가 되풀이해 만드는 파일(텔레그램 수집·통화 전사·백업 등 시스템 폴더 안)은 '최근'에서만 뺀다
// (규칙은 files-auto-model.mjs 한 곳, 폴더 보기·찾기에는 그대로). 빼고도 15줄이 차도록 서버 한도(300)까지 읽은 뒤 거른다.
const RECENT_BOX = 5, RECENT_BOX_MORE = 15, RECENT_FETCH = 300;
async function loadRecent() {
  const scope = state.scope, on = cloudOn();
  if (!on.length || !solo()) { state.recent = null; return; }
  try {
    const rows = await rpc('app_cloud_find_in', {p_sources: on, p_query: null, p_shelf: 'recent', p_limit: RECENT_FETCH});
    if (state.scope !== scope) return;
    state.recent = recentHumanRows((Array.isArray(rows) ? rows : []).filter(r => !r.is_folder && !isLockedItem(r)), RECENT_BOX_MORE);
  } catch { if (state.scope === scope) state.recent = null; }
  paintTree();
}
async function loadStars() {
  void loadRecent();
  const scope = state.scope, on = cloudOn();
  if (!on.length) { state.stars = null; paintTree(); return; }
  try {
    const rows = await rpc('app_cloud_find_in', {p_sources: on, p_query: null, p_shelf: 'starred', p_limit: SHELF_LIMIT});
    if (state.scope !== scope) return;
    state.stars = starCount(rows);
  } catch { if (state.scope === scope) state.stars = null; }
  paintTree();
}
// 폰: 칸 0이 목록(폴더·별표·큰 파일)이면 뒤로가기 자리 하나(layer 'files-list'). 뒤로가기 = 한 단계 위 폴더(자리는 그대로), 맨 위 목록이면 나무로(자리 닫힘).
let listLayer = null;
function listLayerOpen() {
  if (!solo() || listLayer || state.panes[0].pane !== 'list') return;
  listLayer = window.KPTURouter?.layer?.open('files-list', {
    reopen: () => { const p = state.panes[0]; if (p.where) { p.pane = 'list'; window.KPTURouter?.setPlace?.('files', {at: null, shelf: null, ...placeOf(p.where)}); paint(); } },
    // S51-24: 뒤로 키 = 오므리기·[‹]와 같은 곳(어떤 길로 들어왔든 나무, 그 폴더를 펼친 그 자리).
    close: () => { listLayer = null; const back = treeSpot(), from = focusHeadTop(); toTree(); restoreTreeSpot(back, from); return true; }}) || null;
}
// 폰 칸 0을 나무로. release = 화면 안 ‹ 로 돌아옴(뒤로가기 자리도 닫는다). 보던 곳은 나무가 칠해 둔다.
function toTree({release = false} = {}) {
  const p = state.panes[0];
  state.treeBack = null;
  clearQuery(p);
  p.pane = 'tree'; p.picked.clear(); p.anchor = '';
  closePreview();
  // 나무 화면은 주소 자리가 없다(새로고침하면 나무). 보던 곳(p.where)은 나무 칠하기·앞으로 가기(reopen)용으로 둔다.
  window.KPTURouter?.setPlace?.('files', {at: null, shelf: null});
  if (release) { const l = listLayer; listLayer = null; l?.close(); }
  for (const src of onSources()) if (!state.children.has(folderKey(src, null))) loadChildren(src, null);
  paint();
}

// ---------- 찾기(F7: 이름 + 자료실이 이미 읽은 글자) — 칸마다 따로(위 줄 찾기 칸은 지금 칸의 찾기) ----------
function setQuery(p, raw) {
  const q = cleanQuery(raw);
  clearTimeout(p.ftimer);
  if (q === p.query) return;
  p.query = q;
  if (!q) { p.found = null; p.findFailed = ''; p.fseq++; p.ff = freshFilter(); paint(); return; }
  p.ftimer = setTimeout(() => find(p, q), FIND_WAIT_MS);
}
async function find(p, q) {
  const seq = ++p.fseq, scope = state.scope;
  try {
    const on = cloudOn();
    const rows = on.length ? await rpc('app_cloud_find_in', {p_sources: on, p_query: q, p_shelf: null, p_limit: FIND_LIMIT}) : [];
    if (seq !== p.fseq || state.scope !== scope || p.query !== q) return;
    p.found = Array.isArray(rows) ? rows : []; p.findFailed = ''; p.findWhy = '';
  } catch (e) {
    if (seq !== p.fseq || state.scope !== scope) return;
    p.found = []; p.findFailed = codeOf(e); p.findWhy = failReason(e);
  }
  paint();
}
const refind = p => { const q = p.query; p.query = ''; setQuery(p, q); };

// ---------- 갱신(F2) ----------
async function sync({force = false} = {}) {
  if (state.syncing || !state.status || !connected().length) return;
  const scope = state.scope, seen = panesOn().map(p => [p, p.where]);
  state.syncing = true; paintTop();
  try {
    const d = await edge('sync', force ? {force: true} : {});
    if (state.scope !== scope) return;
    // S50-14: 실패·이어 받기가 남은 출처가 있으면 '방금 맞춤'으로 덮지 않는다(단추 글자는 syncLabel).
    state.status = applySyncReply(state.status, d, SOURCES);
    if (syncSettled(d, SOURCES)) state.syncedAt = Date.now();
    if (SOURCES.some(s => d?.[s]?.more)) setTimeout(() => { if (state.scope === scope) sync(); }, 1500);
    const changed = Array.isArray(d?.changed) ? d.changed : [], removed = Array.isArray(d?.removed) ? d.removed : [];
    // 칸마다 같은 규칙으로 입힌다(한 칸 화면은 칸 0 하나).
    for (const [p, where] of seen) {
      if (p.where !== where || !p.loaded) continue;
      if (d?.reload || where?.shelf) { if (d?.reload || changed.length || removed.length) await loadList(p, {quiet: true}); continue; }
      if (!changed.length && !removed.length) continue;
      if (touchesCounts(p.rows, where, changed, removed)) { await loadList(p, {quiet: true}); continue; }
      const next = applyChanges(p.rows, where, changed, removed);
      if (next !== p.rows) { p.rows = next; state.children.set(folderKey(where.source, where.parent), next.filter(r => r.is_folder)); recordCounts(p, scope); paintList(p); paintTree(); }
    }
  } catch { /* 맞추기 실패는 다음 차례에 다시. 목록은 색인 그대로 */ }
  finally { if (state.scope === scope) { state.syncing = false; paintTop(); for (const p of panesOn()) if (!shown(p).length) paintList(p); } }
}
// FOLDER-순서·색 ③-2: 폴더 색·순서는 들어올 때·2분마다·창으로 돌아올 때 서버에서 다시 읽는다(다른 기기가 바꾼 것도 같아짐). 바뀐 것이 있으면 구독(아래)이 다시 그린다.
const lookLoad = () => { void folderLook.load(rt()); };
function startTimer() { clearInterval(syncTimer); syncTimer = setInterval(() => { if (visible()) { sync(); lookLoad(); } else paintTop(); }, SYNC_EVERY_MS); }
const visible = () => window.KPTURouter?.current === 'files' && document.visibilityState === 'visible';

// ---------- 그리기(이 화면의 유일한 그리기 주인 — 칸 둘도 이 함수들이 칸마다 같은 코드로 그린다) ----------
// 찾기·묶음 줄은 서버가 켜진 출처만 준다(app_cloud_find_in). 폴더 목록은 한 출처 것이고, 그 출처가 꺼지면 sourcesChanged가 최근으로 옮긴다.
// S52-44 ④: 찾기 거르기(이 폴더/전체 · 종류 · 날짜 · 크기)는 받은 줄 안에서 화면이 거른다(files-find-model.mjs). 고르기·키·미리보기 ←→도 이 줄을 쓴다.
const findBase = p => { const w = p.where; return w && !w.shelf && SOURCES.includes(w.source) ? {source: w.source, path: baseOf(trailNames(w.source, p.trail))} : null; };
const foundShown = p => findFilter((p.found || []).filter(r => !isLockedItem(r)), {...p.ff, scope: findBase(p) ? p.ff.scope : 'all'}, {base: findBase(p)});
// 찾기 거르기 줄: [이 폴더|전체](폴더를 연 칸에서만) + 종류·날짜·크기 칩(누르면 작은 메뉴).
function findBarHtml(p) {
  const base = findBase(p), f = p.ff;
  const seg = base ? `<div class="ds-seg fx-find-scope" role="radiogroup" aria-label="찾을 곳">${FIND_SCOPES.map(o => `<button type="button" class="ds-seg-btn" role="radio" aria-checked="${f.scope === o.value}" data-fx-fscope="${o.value}">${esc(o.value === 'here' && base.path ? base.path.split(' › ').at(-1) : o.value === 'here' ? SOURCE_NAME[base.source] : o.label)}</button>`).join('')}</div>` : '';
  const chips = Object.keys(FIND_DIMS).map(d => `<button type="button" class="ds-chip" data-fx-fdim="${d}" aria-pressed="${f[d] !== 'all'}" aria-haspopup="true" aria-label="${esc(FIND_DIM_NAME[d])} 거르기: ${esc(dimLabel(f, d))}">${esc(dimLabel(f, d))}<span class="fx-psrc-caret" aria-hidden="true"></span></button>`).join('');
  return `<div class="fx-find-bar" data-fx-find-bar>${seg}${chips}</div>`;
}
function findDimMenu(b) {
  const p = P(), dim = b.dataset.fxFdim, list = FIND_DIMS[dim];
  if (!list) return;
  openRowMenu(b, {key: 'find:' + dim, label: FIND_DIM_NAME[dim], items: list.map(o => ({id: o.value, label: (p.ff[dim] === o.value ? '✓ ' : '') + o.label})),
    run: id => { p.ff = filterSet(p.ff, dim, id); paint(); inPane(p, `[data-fx-fdim="${dim}"]`)?.focus({preventScroll: true}); }});
}
// FOLDER-순서·색 ③-2: 한 폴더 안 목록(찾기·묶음 아님)은 폴더 줄만 직접 정한 순서(없으면 이름순 그대로 뒤)로 앞에 둔다.
const orderable = p => !!p?.where?.source && !p.where.shelf && !p.query;
function shown(p) {
  if (p.query) return foundShown(p);
  const rows = sortRows(p.rows.filter(r => !isLockedItem(r)), p.sort, p.dir);
  if (!orderable(p)) return rows;
  const folders = rows.filter(r => r.is_folder);
  return folders.length > 1 ? [...folderLook.sort(p.where.source, folders, r => r.item_id), ...rows.filter(r => !r.is_folder)] : rows;
}
// 폰 첫 화면은 나무(pane 'tree'), 폴더·별표를 누르면 목록(pane 'list'). 찾는 중이면 늘 목록. PC·폴드는 CSS가 둘 다 보인다.
const treePane = () => solo() && state.panes[0].pane === 'tree' && !state.panes[0].query;
// 칸 1(오른쪽)의 자리는 두 칸일 때만 있다(한 칸이면 지움 — 숨김이 아니라 없음). 그리기 주인은 paint 하나.
function ensurePanes() {
  const on = two(), main = $('[data-fx-main]');
  root.dataset.fxTwo = on ? (WIDE.matches ? 'wide' : PHONE.matches ? 'phone' : 'fold') : '';
  if (!on) delete root.dataset.fxTwo;
  root.toggleAttribute('data-fx-tree-shut', treeShut());
  let el = root.querySelector('[data-fx-pane-i="1"]');
  if (on && !el && main) { main.querySelector('[data-fx-pane-i="0"]')?.insertAdjacentHTML('afterend', paneHtml(1)); el = root.querySelector('[data-fx-pane-i="1"]'); }
  if (!on && el) el.remove();
  markCur();
}
function markCur() {
  const on = two();
  for (const el of root.querySelectorAll('[data-fx-pane-i]')) el.classList.toggle('fx-cur', on && Number(el.dataset.fxPaneI) === state.cur);
}
function paint() {
  ensurePanes();
  root.dataset.fxPane = treePane() ? 'tree' : 'list';
  paintTop(); paintBar(); paintTree();
  for (const p of panesOn()) paintPane(p);
  paintPreview(); paintAsk(); paintDropAsk(); paintXfer(); paintJobs();
  paintScroll();
}
function paintPane(p) { paintPaneTop(p); paintList(p); }
// ---------- FILES-칸따로스크롤(S52-41 ②, 요청함 11/08) ----------
// 폴드 펼침·PC(600px~)에서 왼쪽 나무와 오른쪽 목록이 각자 따로 스크롤한다: 맨 위 줄(위치 길·찾기·정렬·출처·두 칸 보기)과 고르기 막대는 화면 위에 고정(sticky),
// 나무는 공용 부품 follow-pane.js로 그 아래에 붙어 화면보다 길면 나무만 스크롤(UI-상세칸고정과 같은 칸 모양). 한 칸 목록은 화면 스크롤 그대로라
// 나무를 끝까지 내려도 목록·위치 길은 제자리. 두 칸이면 칸마다 따로(칸 머리 줄은 칸 안 위에 고정). 폰(600px 미만, 폰 두 칸 위·아래 포함)은 지금대로.
// 명진 요청(11/08)이 C8 'UI-칸안스크롤하나로'(화면 스크롤 하나)보다 우선이다 — [파일]의 나무·목록 칸에서만.
const SPLIT_SCROLL = window.matchMedia('(min-width:600px)'), FOLLOW_WIDE = window.matchMedia('(min-width:761px)');
const dockBelow = () => parseFloat(getComputedStyle(root).getPropertyValue('--kptu-mobile-tab-height')) || 0;
let headWatch = null;
function paintScroll() {
  if (!root) return;
  const on = SPLIT_SCROLL.matches && !PHONE.matches;
  root.classList.toggle('fx-split-scroll', on);
  const tree = $('[data-fx-tree]'), cols = [...root.querySelectorAll('[data-fx-pane-i]')];
  if (!on) { for (const el of [tree, ...cols]) el?.classList.remove('kptu-follow-pane', 'kptu-follow-narrow'); return; }
  const top = $('.fx-top'), bar = $('[data-fx-bar]');
  const topH = top?.offsetHeight || 0, head = topH + (bar && !bar.hidden ? bar.offsetHeight : 0);
  root.style.setProperty('--fx-top-h', `${topH}px`);
  root.style.setProperty('--fx-head-h', `${head}px`);
  const at = {top: head + 4, reset: false, narrow: !FOLLOW_WIDE.matches, bottom: dockBelow};
  if (tree) followPane(tree, at);
  for (const el of cols) { if (two()) followPane(el, at); else el.classList.remove('kptu-follow-pane', 'kptu-follow-narrow'); }
  if (!headWatch && typeof ResizeObserver === 'function') {
    headWatch = new ResizeObserver(() => paintScroll());
    for (const el of [top, bar]) if (el) headWatch.observe(el);
  }
}
// 위치 줄(빵부스러기): 한 칸 화면은 위 줄, 두 칸이면 칸마다 칸 위 줄에 같은 글자.
function crumbHtml(p, {noRoot = false} = {}) {
  const w = p.where;
  if (p.query) return `<span class="fx-crumb-now">${esc(p.found ? findSummary(foundShown(p)) : `'${p.query}' 찾기`)}</span>`;
  // S50-33: 폰 나무 화면에는 위치 줄이 없다(중복 제목 '폴더' 뺌). 폰 목록의 ‹ 는 어느 단계에서든 나무로 돌아온다(S51-24, 위 단계는 위치 줄 글자로).
  if (p === state.panes[0] && treePane()) return '';
  if (!w) return '';
  // S51-24: 폰 '그 폴더만'은 위치 줄이 상자 안(paintFocus)이라 위 막대가 없다.
  if (focusBox(p)) return '';
  const back = solo() && p === state.panes[0];
  if (w.shelf) return (back ? '<button type="button" class="fx-up" data-fx-up aria-label="폴더 나무">‹</button>' : '') + `<span class="fx-crumb-now">${esc(SHELF_NAME[w.shelf])}</span>`;
  // S52-07: 두 칸 칸 머리는 출처 이름이 [출처 ▾] 단추에 있어 위치 줄은 출처 다음 단계부터(맨 위면 비움, 맨 위로 = 같은 출처 다시 고르기).
  const all = trailNames(w.source, p.trail), allIds = [null, ...trailIds(p.trail)];
  const names = noRoot ? all.slice(1) : all, ids = noRoot ? allIds.slice(1) : allIds;
  if (!names.length) return '';
  let html = names.map((n, i) => i === names.length - 1
    ? `<span class="fx-crumb-now" aria-current="location">${esc(n)}</span>`
    : `<button type="button" class="fx-crumb-step" data-fx-go="${esc(w.source)}" data-fx-id="${esc(ids[i] || '')}">${esc(n)}</button>`).join('<span class="fx-crumb-sep" aria-hidden="true">›</span>');
  if (names.length > 1 || back || (noRoot && names.length)) html = `<button type="button" class="fx-up" data-fx-up aria-label="${back ? '폴더 나무' : '위 폴더'}">‹</button>` + html;
  return html;
}
const sortHtml = p => `<select class="fx-sort" data-fx-sort aria-label="${p ? side(idxOf(p)) + ' 칸 ' : ''}정렬">${SORTS.map(k => `<option value="${k}"${p?.sort === k ? ' selected' : ''}>${SORT_NAME[k]}</option>`).join('')}</select>`;
// 칸 위 줄(두 칸일 때만): 폴드는 ▾(그 칸 위로 나무) + 위치 줄 + 정렬, PC는 위치 줄 + 정렬(나무는 왼쪽 그대로).
function paintPaneTop(p) {
  const top = inPane(p, '[data-fx-ptop]'), pt = inPane(p, '[data-fx-ptree]');
  if (!top) return;
  if (!two()) { top.hidden = true; top.innerHTML = ''; if (pt) { pt.hidden = true; pt.innerHTML = ''; } return; }
  top.hidden = false;
  const fold = !WIDE.matches, i = idxOf(p);
  top.innerHTML = (fold ? `<button type="button" class="mini fx-pdrop" data-fx-pdrop aria-expanded="${p.drop}" aria-label="${side(i)} 칸 폴더 나무">${treeIconHtml('folder', {open: p.drop, className: 'ft-ico'})}</button>` : '')
    + paneSrcHtml(p, i)
    + `<nav class="fx-crumb" aria-label="${side(i)} 칸 위치">${crumbHtml(p, {noRoot: !!p.where?.source && !p.query})}</nav>${sortHtml(p)}`;
  paintPaneTree(p);
}
// S52-07 FILES-칸출처고르기(시안 morning-1107/4 1-A): 칸 머리 '원드라이브 ⌄'(고르기 꺾쇠, 폴더 세모 아님) → 출처 네 줄 목록. 쓸 수 없는 출처는 흐리게 + 이유. 고르면 그 칸만 그 출처 맨 위.
// 목록 열림(srcOpen)은 칸 상태 하나가 주인이고 그리기는 paintPaneTop 한 곳.
function paneSrcHtml(p, i) {
  const src = !p.query && p.where?.source ? p.where.source : '';
  const label = `${src ? PANE_SRC_SVG[src] || '' : ''}<span class="fx-psrc-name">${esc(paneSourceLabel(src ? p.where : null))}</span><span class="fx-psrc-caret" aria-hidden="true"></span>`;
  const btn = `<button type="button" class="row-act fx-psrc" data-fx-psrc aria-haspopup="true" aria-expanded="${p.srcOpen}" aria-label="${side(i)} 칸 출처: ${esc(paneSourceLabel(src ? p.where : null))}">${label}</button>`;
  if (!p.srcOpen) return `<span class="fx-psrc-wrap">${btn}</span>`;
  const items = paneChoices({cur: src, on: onSources(), linked: connected(), phone: {usable: phone.usable, all: phoneLinked()}, pc: {usable: pc.usable, ok: !!pc.state.ok}})
    .map(c => `<button type="button" class="row-act fx-psrc-item${c.cur ? ' on' : ''}" data-fx-psrc-pick="${c.src}"${c.usable ? '' : ' disabled'}${c.cur ? ' aria-current="true"' : ''}>${PANE_SRC_SVG[c.src] || ''}<span class="fx-psrc-name">${esc(c.name)}</span>${c.cur ? '<span class="fx-psrc-on" aria-hidden="true">✓</span>' : ''}${c.why ? `<span class="fx-psrc-why">${esc(c.why)}</span>` : ''}</button>`).join('');
  // S52-41 ③: 두 칸에서 나무를 접어 두므로 칸 위 목록 맨 위에 별표·큰 파일(나무 '모아 보기'와 같은 묶음).
  const shelves = SHELVES.map(sh => `<button type="button" class="row-act fx-psrc-item${p.where?.shelf === sh ? ' on' : ''}" data-fx-psrc-shelf="${sh}">${treeIconHtml(sh, {className: 'ft-ico'})}<span class="fx-psrc-name">${esc(SHELF_NAME[sh])}</span></button>`).join('');
  // S52-41 ④: 고정한 폴더를 맨 위에(흐린 출처 글자, 연결 안 된 것은 흐리게).
  const pins = pinRows().map(x => `<button type="button" class="row-act fx-psrc-item fx-psrc-pin" data-fx-psrc-pin="${esc(x.key)}"${x.live ? '' : ' disabled'}>${treeIconHtml('folder', {className: 'ft-ico'})}<span class="fx-psrc-name">${esc(x.name)}</span><span class="fx-psrc-why">${esc(x.tag || SOURCE_NAME[x.source])}</span></button>`).join('');
  return `<span class="fx-psrc-wrap">${btn}<span class="fx-psrc-menu" data-fx-psrc-menu role="group" aria-label="${side(i)} 칸 출처 고르기">${pins}${shelves}${items}</span></span>`;
}
function paneSrcClose(focus = false) {
  let any = false;
  for (const q of state.panes) if (q.srcOpen) { q.srcOpen = false; any = true; if (two()) paintPaneTop(q); if (focus) inPane(q, '[data-fx-psrc]')?.focus({preventScroll: true}); }
  return any;
}
// 칸 i에서 출처를 골랐을 때: 그 칸만 그 출처 맨 위로, 고른 값은 서버에 기억(기기 종류마다). 거절되면 칸은 그대로(이번 접속만).
function paneSrcPick(p, src) {
  const i = idxOf(p);
  p.srcOpen = false;
  if (!onSources().includes(src)) { paintPaneTop(p); return; }
  const other = otherOf(p)?.where?.source || '';
  const value = panesValue(viewPrefs.getFilesPanes?.(DEVICE), i, src, other);
  if (value) viewPrefs.setFilesPanes?.(DEVICE, value);
  state.open.add(folderKey(src, null));
  setWhere(p, {source: src, parent: null}, {keepPreview: i !== state.cur});
  inPane(p, '[data-fx-psrc]')?.focus({preventScroll: true});
}
function paintPaneTree(p) {
  const pt = inPane(p, '[data-fx-ptree]');
  if (!pt) return;
  const on = two() && !WIDE.matches && p.drop;
  pt.hidden = !on; pt.innerHTML = on ? treeHtml(p) : '';
}
const syncNow = () => ({label: syncLabel(state.status, state.syncedAt, Date.now(), SOURCES), scanning: SOURCES.some(x => state.status?.[x]?.scanning), shown: !!state.status && connected().length > 0});
const syncTreeHtml = () => { const sn = syncNow(); return sn.shown ? `<button type="button" class="fx-sync fx-sync-tree" data-fx-sync title="${esc(sn.label.title)}" data-fx-sync-state="${esc(sn.label.state)}" aria-busy="${state.syncing || sn.scanning}"${state.syncing ? ' disabled' : ''}>${esc(sn.label.text)}</button>` : ''; };
function paintTop() {
  const crumb = $('[data-fx-crumb]');
  // 두 칸이면 위치 줄·정렬은 칸 위 줄에 있다(위 줄에는 찾기·새 폴더·맞추기·출처·[두 칸]).
  const twoNow = two(), p = P();
  const crumbNow = twoNow ? '' : crumbHtml(p);
  if (crumb) { crumb.hidden = !crumbNow; crumb.innerHTML = crumbNow; }
  const sort = $('.fx-top [data-fx-sort]');
  if (sort) { sort.hidden = twoNow; if (sort.value !== p.sort) sort.value = p.sort; }
  const search = $('[data-fx-search]');
  if (search && document.activeElement !== search && search.value !== p.query) search.value = p.query;
  // 맞추기 단추: PC·폴드는 위 줄, 폰은 나무의 첫 클라우드 뿌리 줄 오른쪽(treeHtml). 글자는 같은 계산(syncNow)으로 둘 다 칠한다.
  const sn = syncNow();
  for (const s of root?.querySelectorAll('[data-fx-sync]') || []) {
    s.textContent = sn.label.text; s.title = sn.label.title; s.dataset.fxSyncState = sn.label.state;
    s.disabled = state.syncing;
    s.setAttribute('aria-busy', String(state.syncing || sn.scanning));
    s.hidden = !sn.shown || (solo() && !s.closest('.ft-box-head'));
  }
  // UI-로딩자리전수: 맞추는 동안의 두 번째 글자('맞추는 중')는 없다. 목록 칸 맨 위 가는 줄(공용 부품) 하나로만 알린다.
  for (const q of panesOn()) {
    const bar = inPane(q, '[data-fx-wait]');
    if (bar) { const on = (state.syncing || sn.scanning) && q.loaded && !q.failed; if (on && bar.hidden) bar.innerHTML = barHtml(); bar.hidden = !on; if (!on) bar.replaceChildren(); }
  }
  const openHere = !!p.where?.source && !p.query && !treePane(), folderHere = openHere && cloudOn().includes(p.where.source);
  // 새 폴더: 클라우드 폴더 · (쓸 수 있으면) 이 폰 · (0.5.0+ 문이면) 내 PC 드라이브·폴더(맨 위 드라이브 목록은 아님).
  const mk = $('[data-fx-mkdir]'), mkHere = folderHere || (openHere && p.where.source === PH && phoneWrite()) || (openHere && p.where.source === PC && !!p.where.parent && pcEdit());
  if (mk) { mk.hidden = !mkHere; mk.disabled = !!state.busy; }
  // 올리기(2-④): 폴더를 연 칸에서만(받을 곳 = 지금 칸의 폴더). PC는 끌어 놓기도 된다.
  const upb = $('[data-fx-upload]');
  if (upb) { upb.hidden = !folderHere; upb.disabled = !!state.busy || !!state.ask; }
  const tt = $('[data-fx-tree-tog]');
  if (tt) {
    const show = twoNow && !PHONE.matches, open = show && treeOpen();
    tt.hidden = !show; tt.setAttribute('aria-pressed', String(open));
    const t = open ? '폴더 나무 닫기' : '폴더 나무 열기'; tt.title = t; tt.setAttribute('aria-label', t);
  }
  const tw = $('[data-fx-two]');
  // S50-20 FILES-두칸버튼글자: 글자가 누르면 될 상태를 말한다(한 칸이면 '두 칸 보기', 두 칸이면 '한 칸 보기'). 색으로 켜짐을 따로 보이지 않는다.
  if (tw) { tw.hidden = false; const t = twoNow ? '한 칸 보기' : '두 칸 보기'; if (tw.textContent !== t) tw.textContent = t; tw.title = twoNow ? '한 칸으로 보기' : '두 칸으로 보기'; tw.removeAttribute('aria-pressed'); }
  paintSrcs();
  const note = $('[data-fx-note]');
  if (note) {
    const t = state.statusFailed ? errorText(state.statusFailed) : state.status && !anyLinked() ? '연결된 클라우드가 없습니다' : state.hint;
    note.textContent = t; note.hidden = !t;
  }
}
// 출처 아이콘(사진 화면과 같은 부품). 원드라이브는 연결 전에도 보이고(눌러 연결 안내), 구글 드라이브는 연결돼 있을 때만 보인다([파일]이 구글 드라이브를 보여 주는 조건 그대로).
function paintSrcs() {
  const box = $('[data-fx-srcs]');
  if (!box) return;
  box.hidden = !state.status;
  const link = connected();
  for (const name of FILES_SRC) {
    const b = box.querySelector(`[data-fx-src="${name}"]`);
    if (!b) continue;
    const info = chipInfo(srcState(), link, name);
    if (name === 'od') paintOdLink(b, {configured: !!state.status, connected: info.linked}); else b.hidden = !info.linked;
    b.setAttribute('aria-pressed', String(info.pressed));
    const t = `${SOURCE_NAME[name]} ${info.linked ? (info.on ? '켜짐' : '꺼짐') : '연결 안 됨'}`;
    b.title = t; b.setAttribute('aria-label', t);
  }
  // [이 폰]: 폰 앱(0.5.0+)에서만 보인다. 허락 전에는 흐리게(누르면 설정 안내), 허락 뒤에는 켜기/끄기.
  const pb = box.querySelector('[data-fx-src="ph"]');
  if (pb) {
    pb.hidden = !(phone.usable && phone.state.known);
    pb.setAttribute('aria-pressed', String(phoneOn()));
    pb.classList.toggle('fx-src-off', !phoneLinked());
    const t = `${SOURCE_NAME[PH]} ${phoneLinked() ? (phoneOn() ? '켜짐' : '꺼짐') : '허락 안 됨'}`;
    pb.title = t; pb.setAttribute('aria-label', t);
  }
  // [내 PC]: 윈도우 PC 브라우저에서만. 문이 답하지 않으면 흐리게(누르면 다시 두드림·켜는 법), 답하면 켜기/끄기.
  const cb = box.querySelector('[data-fx-src="pc"]');
  if (cb) {
    cb.hidden = !(pc.usable && pc.state.known);
    cb.setAttribute('aria-pressed', String(pcOn()));
    cb.classList.toggle('fx-src-off', !pc.state.ok);
    const t = `${SOURCE_NAME[PC]} ${pc.state.ok ? (pcOn() ? '켜짐' : '꺼짐') : '연결 안 됨'}`;
    cb.title = t; cb.setAttribute('aria-label', t);
  }
}
function srcClick(name) {
  if (name === PH) { phoneClick(); return; }
  if (name === PC) { if (pc.state.ok) { pcOff = !pcOff; sourcesChanged(); } else pcKnock(); return; }
  if (!FILES_SRC.includes(name)) return;
  const info = chipInfo(srcState(), connected(), name);
  if (!info.linked) {
    state.hint = name === 'od' ? '원드라이브가 연결돼 있지 않아요. 사진 화면 위 원드라이브 아이콘에서 연결할 수 있어요.' : '구글 드라이브가 연결돼 있지 않아요.';
    paintTop();
    return;
  }
  viewPrefs.setFilesSources(DEVICE, filesSourcesValue(toggleFilesSource(srcState(), name)));
  sourcesChanged();
}
// [이 폰] 누름: 허락 전이면 설정 화면(앱이 돌아오면 상태를 다시 보낸다), 허락 뒤면 이번 접속에서 켜기/끄기.
function phoneClick() {
  if (!phone.usable) return;
  if (!phone.state.can) { state.hint = PHONE_CANNOT_TEXT; paintTop(); return; }
  if (!phone.state.all) { state.hint = PHONE_ASK_TEXT; paintTop(); phone.ask(); return; }
  phoneOff = !phoneOff;
  sourcesChanged();
}
// 앱이 상태를 알려 오면(설정에서 돌아옴·열쇠 바뀜): 켜졌으면 나무 맨 위를 읽고 [최근]을 다시 읽는다.
phone.on(() => { if (state.status) { state.hint = ''; phoneChanged(); } });
function phoneChanged() {
  state.children.delete(folderKey(PH, null));
  sourcesChanged();
}
// '내 PC' 문 두드리기(사람이 누름: 크롬 허락 창이 여기서 뜰 수 있다). 되면 '내 PC' 맨 위(드라이브)를 지금 칸에 연다. 안 되면 켜는 법 한 줄.
let pcWasOk = false;
async function pcKnock() {
  if (!pc.usable) return;
  state.hint = ''; paintTop();
  const s = await pc.hello();
  if (s.ok) { pcOff = false; state.open.add(folderKey(PC, null)); goFolder(PC, null); return; }
  state.hint = pcStateText(s.why); paintTop();
}
// 문 상태가 바뀌면(켬·끔·다른 계정): 나무 맨 위를 다시 읽고, 보던 '내 PC'가 사라졌으면 최근으로. 답하던 문이 끊긴 때만 한 줄 알린다.
pc.on(s => {
  state.children.delete(folderKey(PC, null));
  const lost = pcWasOk && !s.ok;
  pcWasOk = s.ok;
  void loadPcPins();
  if (!state.status) return;
  sourcesChanged();
  if (lost) { state.hint = pcStateText(s.why); paintTop(); }
});
// 켜기/끄기가 바뀐 뒤: 보던 출처가 꺼졌으면 첫 화면(폰 = 나무, PC·폴드 = 켜진 첫 저장소 맨 위)으로, 새로 켠 출처의 나무 맨 위를 읽고, 다시 그린다. 끄기는 보기에서만 빠진다(색인·연결은 그대로).
function sourcesChanged() {
  state.hint = '';
  const on = onSources();
  if (panesOn().some(p => p.query) || !on.length) closePreview();
  if (!on.length) { for (const p of state.panes) p.picked.clear(); state.clip = null; paint(); return; }
  let painted = false;
  for (const p of panesOn()) {
    const w = p.where;
    if (w?.source && !on.includes(w.source)) { goHome(p); painted = true; }
    else if (!w && !(solo() && p === state.panes[0])) { goHome(p); painted = true; }
    else if (w?.shelf) loadList(p);
    // 찾는 중이면 켜진 출처로 다시 찾는다(서버가 거름).
    if (p.query) find(p, p.query);
  }
  if (!painted) paint();
  for (const s of on) if (!state.children.has(folderKey(s, null))) loadChildren(s, null);
  loadStars();
}
// 첫 화면: 폰 칸 0은 나무, 그 밖(PC·폴드·오른쪽 칸)은 켜진 첫 저장소 맨 위(없으면 빈 칸).
function goHome(p) {
  if (solo() && p === state.panes[0]) {
    p.where = null; p.rows = []; p.loaded = false; p.failed = ''; p.trail = [];
    toTree({release: true});
    return;
  }
  // S52-07: 두 칸이면 그 칸에 기억한 출처(켜져 있을 때)의 맨 위, 아니면 켜진 첫 출처.
  const start = two() ? paneStart(idxOf(p), viewPrefs.getFilesPanes?.(DEVICE), onSources(), otherOf(p)?.where) : null;
  const first = start?.source || onSources()[0];
  if (first) { state.open.add(folderKey(first, null)); return setWhere(p, startAt(p, {source: first, parent: null})); }
  p.where = null; paint();
}
// ---------- S51-25 FOLDER-PC나무: 왼쪽 나무(PC·펼친 폴드 한 칸) · 두 칸의 칸 위 ▾ 나무가 같은 모양 ----------
// 기능은 그대로(나무에서 고르면 지금 칸에 열기, 끌어 놓기, 정렬·두 칸), 모양은 자료실(공용 folder-tree-ui.mjs):
// 왼쪽 위 '최근' 상자 · 묶음(별표·큰 파일) 상자 · 저장소마다 상자(머리 = 상자째 접기), 줄 넉넉히·맨 위 단계만 구분선·굵은 이름, 줄마다 오른쪽 ⋯.
// 세모(▸▾) 없음: 열린 폴더 그림 = 펼침, 닫힌 폴더 그림 = 접힘. 줄 누르기 = 지금 칸에 그 폴더 열기 + 펼침, 아이콘만 누르기 = 접기·펼치기만.
// p = 지금 위치를 칠할 칸.
const lookOrder = (source, rows) => folderLook.sort(source, rows, r => r.item_id);
function pcFolderRowHtml(r, curKey) {
  const cnt = countOf(r.source, r.id), full = (state.children.get(folderKey(r.source, r.parentId)) || []).find(x => x.item_id === r.id);
  if (full) state.treeRows.set(r.key, full);
  return ftFolderRowHtml({name: r.name, count: cnt || null, depth: r.depth - 1, open: r.open, hasContent: r.hasKids, color: folderLook.color(r.source, r.id),
    current: r.key === curKey, className: [/^0개$/.test(cnt || '') ? 'fx-zero' : '', r.id && isPinned(r.source, r.id) ? 'fx-pinned' : ''].filter(Boolean).join(' '),
    rowAttrs: {'data-fx-fold': r.key, 'data-fx-drop': r.source === PC && (!pcWrite() || !r.id) ? null : r.key,
      draggable: full && !PHONE.matches && !TOUCH.matches && (r.source !== PC || pcWrite()) ? 'true' : null},
    mainAttrs: {'data-fx-go': r.source, 'data-fx-id': r.id || ''},
    toggle: {attrs: {'data-fx-twist': r.key}, label: `${r.name} ${r.open && r.hasKids ? '접기' : '펼치기'}`},
    more: full ? {attrs: {'data-fx-tmenu': r.key, 'data-fx-tin': folderKey(r.source, r.parentId)}, label: `${r.name} 폴더 메뉴`} : null});
}
function treeHtml(p) {
  state.treeRows = new Map();
  const w = p.where, curKey = !p.query && w ? (w.shelf ? 'shelf:' + w.shelf : folderKey(w.source, w.parent)) : '';
  let html = '';
  html += recentBoxHtml();
  html += pinBoxHtml(curKey); // S52-41 ④: 별표 위 '고정한 폴더'
  const shelves = SHELVES.map(shelf => ftFolderRowHtml({name: SHELF_NAME[shelf], count: shelf === 'starred' && state.stars !== null ? `${state.stars}개` : null, depth: 0, hasContent: false,
    current: curKey === 'shelf:' + shelf, icon: treeIconHtml(shelf, {className: 'ft-ico'}), className: 'fx-shelf', mainAttrs: {'data-fx-shelf': shelf}})).join('');
  html += ftBoxHtml({body: shelves, label: '모아 보기', attrs: {'data-fx-box': 'shelves'}});
  const sources = onSources();
  // 상자가 열린 저장소는 맨 위 폴더들이 늘 보인다(옛 '뿌리 줄 펼치기'가 상자 머리 접기로 바뀜).
  const open = new Set([...state.open, ...sources.filter(s => !boxShut('files', s)).map(s => folderKey(s, null))]);
  const rows = treeRows({sources: onSources(), children: state.children, open, order: lookOrder});
  const parents = [];
  for (const source of sources) {
    const shut = boxShut('files', source);
    const mine = shut ? [] : rows.filter(r => r.type === 'folder' && r.source === source).map(r => { parents[r.depth] = r.id; return {...r, parentId: r.depth > 1 ? parents[r.depth - 1] : null}; });
    const loading = !shut && !state.children.has(folderKey(source, null));
    const body = loading ? waitHtml({rows: 2}) : mine.length ? mine.map(r => pcFolderRowHtml(r, curKey)).join('') : emptyHtml('빈 폴더');
    const here = curKey === folderKey(source, null);
    html += ftBoxHtml({head: `${treeIconHtml(source, {className: 'ft-box-ico'})}<span>${esc(SOURCE_NAME[source])}</span>`, collapsible: true, open: !shut,
      tail: `<button type="button" class="ft-btn ft-box-more fx-box-top${here ? ' fx-here' : ''}" data-fx-go="${esc(source)}" data-fx-id=""${here ? ' aria-current="true"' : ''} aria-label="${esc(SOURCE_NAME[source])} 맨 위 열기">맨 위</button>`,
      toggleAttrs: {'data-fx-box-tog': source}, attrs: {'data-fx-box': source, 'data-fx-drop': source === PC ? null : folderKey(source, null)}, label: SOURCE_NAME[source], body});
  }
  return html + pcOffRowHtml();
}
// 시안 공통 '꺼져 있을 때': 나무 맨 끝 '내 PC · 꺼짐' 흐린 줄(누르면 다시 두드림). 윈도우 PC 브라우저에서 문이 답하지 않을 때만. [내 PC]를 끈 때는 없다.
const pcOffRowHtml = () => (pc.usable && pc.state.known && !pc.state.ok
  ? ftBoxHtml({attrs: {'data-fx-box': 'pc-off'}, body: `<div class="ft-row ft-top fx-pc-off"><button type="button" class="ft-btn ft-main" data-fx-pc-knock title="${esc(pcStateText(pc.state.why))}">${treeIconHtml('pc', {className: 'ft-ico'})}<span class="ft-name">${esc(pcOffRowName(pc.state.why))}</span></button></div>`}) : '');
function paintTree() {
  paintMainTree();
  for (const p of panesOn()) paintPaneTree(p);
  // 받을 곳 창의 나무도 같은 하위 폴더 목록(state.children)을 쓴다: 새로 읽으면 함께 다시 그린다.
  if (state.xfer) paintDest();
}
// 왼쪽 나무(한 칸·PC 두 칸). 지금 칸의 위치를 칠한다. 폴드 두 칸은 CSS가 숨기고 칸 위 ▾ 나무를 쓴다.
function paintMainTree() {
  const tree = $('[data-fx-tree]');
  if (!tree) return;
  // 폰 첫 화면 나무: 상태를 읽는 동안 회색 빈 줄, 못 읽으면 까닭 + [다시], 켜진 출처가 없으면 안내 한 줄(연결된 클라우드가 없음은 위 알림 줄)
  // (PC·폴드는 목록 칸이 같은 것을 보인다 — 폰 나무 화면에서는 목록 칸이 없으므로 나무 칸이 대신 보인다).
  if (treePane() && !state.status) { tree.innerHTML = state.statusFailed ? failHtml({retry: 'data-fx-retry', text: errorText(state.statusFailed), reason: state.statusWhy}) : waitHtml({rows: 4}); return; }
  if (nothingOn() && treePane()) { tree.innerHTML = emptyHtml(SOURCES_OFF_TEXT); return; }
  tree.innerHTML = treePane() ? phoneTreeHtml() : treeHtml(P());
}
// ---------- FOLDER-나무새기준 ②(S51-12): 폰 나무 = '최근' 상자 + 묶음(별표·큰 파일) + 저장소마다 상자 ----------
// 폴더를 누르면 화면이 바뀌지 않고 그 자리에서 하위 폴더·파일까지 펼침(처음 5개 + 'n개 더 보기'), 상자 머리를 누르면 그 저장소 접기.
// 펼친 폴더 위 두 손가락 벌리기 = 그 폴더만(지금의 폴더 목록 화면), [‹]·뒤로 키·오므리기 = 펼친 자리 그대로 나무.
// 파일 줄을 누르면 미리보기, ⋯는 화면을 그대로 두고 그 줄 바로 옆 작은 메뉴(S51-22·S51-31, row-menu.js — 폰·폴드·PC 같은 상자, 누른 줄 연보라)를 연다.
const fileDay = r => dayText(r.modified_at);
function treeFileHtml(r, depth, parent) {
  const key = rowKey(r), kind = kindOf(r);
  state.treeRows.set(key, r);
  return `<div class="ft-row ft-item fx-titem" style="--ft-depth:${depth}" data-ft-parent="${esc(parent)}"><button type="button" class="ft-btn ft-main" data-fx-tfile="${esc(key)}">`
    + `<span class="fx-tkind" data-kind="${kind}" aria-hidden="true">${esc(kindLabel(r))}</span><span class="ft-name">${esc(r.name)}</span>${r.starred ? STAR_ICO : ''}<span class="ft-num fx-tday">${esc(fileDay(r))}</span></button>`
    + ftMoreButtonHtml({attrs: {'data-fx-tmenu': key, 'data-fx-tin': parent}, label: `${r.name} 메뉴`}) + '</div>';
}
function treeFolderHtml(r) {
  const cnt = countOf(r.source, r.id), full = (state.children.get(r.parent) || []).find(x => x.item_id === r.id);
  if (full) state.treeRows.set(r.key, full);
  return ftFolderRowHtml({name: r.name, count: cnt || null, depth: r.depth, open: r.open, hasContent: r.hasContent, color: folderLook.color(r.source, r.id),
    rowAttrs: {'data-fx-fold': r.key, 'data-fx-drop': r.source === PC && (!pcWrite() || !r.id) ? null : r.key}, mainAttrs: {'data-fx-tog': r.key},
    more: full ? {attrs: {'data-fx-tmenu': r.key, 'data-fx-tin': r.parent}, label: `${r.name} 폴더 메뉴`} : null});
}
// '최근' 상자(자료실 '최근 올린 파일'과 같은 상자, [더보기]면 15개) — 폰 나무·PC 나무가 같은 상자 하나(S51-25).
function recentBoxHtml() {
  const recent = state.recent || [];
  if (recent.length) {
    const shown = recent.slice(0, state.recentAll ? RECENT_BOX_MORE : RECENT_BOX);
    const more = recent.length > RECENT_BOX || state.recentAll ? `<button type="button" class="ft-btn ft-box-more" data-fx-recent-more aria-expanded="${state.recentAll}">${state.recentAll ? '접기' : MORE_LABEL}</button>` : '';
    // S51-22: 머리 줄을 누르면 접기(서버 view_prefs.recent_folded, recent-fold.js).
    const shut = recentFolded('files');
    return ftBoxHtml({head: '최근', tail: more, collapsible: true, caret: true, open: !shut, toggleAttrs: {'data-fx-recent-fold': ''}, label: '최근 파일', attrs: {'data-fx-box': 'recent'}, body: shut ? '' : shown.map(r => treeFileHtml(r, 0, 'recent')).join('')});
  }
  return '';
}
function phoneTreeHtml() {
  state.treeRows = new Map();
  let html = '';
  html += recentBoxHtml();
  html += pinBoxHtml(); // S52-41 ④: 별표 위 '고정한 폴더'
  // 묶음(별표·큰 파일): 작은 상자 하나.
  const shelves = SHELVES.map(shelf => ftFolderRowHtml({name: SHELF_NAME[shelf], count: shelf === 'starred' && state.stars !== null ? `${state.stars}개` : null, depth: 0, hasContent: false,
    icon: treeIconHtml(shelf, {className: 'ft-ico'}), className: 'fx-shelf', mainAttrs: {'data-fx-shelf': shelf}})).join('');
  html += ftBoxHtml({body: shelves, label: '모아 보기', attrs: {'data-fx-box': 'shelves'}});
  const sync = syncTreeHtml();
  let syncPut = false;
  for (const source of onSources()) {
    const shut = boxShut('files', source);
    const rows = shut ? [] : boxRows({source, children: state.children, files: state.files, open: state.open, more: state.more, order: lookOrder, limit: FT_PREVIEW});
    const tail = !syncPut && SOURCES.includes(source) && sync ? (syncPut = true, sync) : '';
    const loading = !shut && !state.children.has(folderKey(source, null));
    const body = loading ? waitHtml({rows: 2}) : rows.length ? rows.map(r => r.type === 'folder' ? treeFolderHtml(r) : r.type === 'more'
      ? ftMoreRowHtml({rest: r.rest, depth: r.depth, attrs: {'data-fx-tmore': r.key, 'data-ft-parent': r.key}}) : treeFileHtml(r.row, r.depth, r.parent)).join('') : emptyHtml('빈 폴더');
    html += ftBoxHtml({head: `${treeIconHtml(source, {className: 'ft-box-ico'})}<span>${esc(SOURCE_NAME[source])}</span>`, collapsible: true, open: !shut, tail,
      toggleAttrs: {'data-fx-box-tog': source}, attrs: {'data-fx-box': source}, label: SOURCE_NAME[source], body});
  }
  return html + pcOffRowHtml();
}
// 두 손가락 벌리기 → 그 폴더만(폴더 목록 화면). 돌아올 자리(화면 위치)를 기억해 두고, [‹]·뒤로 키·오므리기는 한 단계 위가 아니라 나무로.
function focusTreeFolder(key) {
  if (!treePane() || !key || key === 'recent' || key === 'shelves') return;
  const [source, ...rest] = key.split(':'), id = rest.join(':') || null;
  state.treeBack = {y: window.scrollY, key};
  state.open.add(key);
  // S51-24 ④: 그 줄 자리에서 상자 머리로 올라오는 0.2초(folder-focus-motion.js). 그 폴더만은 화면 맨 위부터.
  const from = topOf(root?.querySelector(`[data-fx-fold="${CSS.escape(key)}"]`) || root?.querySelector(`[data-fx-box="${CSS.escape(source)}"]`));
  goFolder(source, id);
  window.scrollTo({top: 0, behavior: 'instant'});
  riseFromRow(from, inPane(state.panes[0], '.ft-focus'));
}
// S51-24 FILES-핀치돌아오기(요청함 11/06 20:27): 폰 '그 폴더만'(칸 0 목록)에서 나무로 돌아올 자리 한 곳.
// 두 손가락으로 들어왔으면 그때 화면 위치(treeBack), 다른 길(두 칸 → 한 칸·새로고침·⋯ 등)로 들어왔으면 그 폴더 줄 자리.
// 그 폴더까지의 위 폴더는 loadList가 나무에서 펼쳐 두고(state.open), goFolder가 그 폴더도 펼쳐 둔다.
function treeSpot() {
  const back = state.treeBack, w = state.panes[0].where; state.treeBack = null;
  if (back) return back;
  return w?.source && !w.shelf ? {y: null, key: folderKey(w.source, w.parent)} : null;
}
// from: '그 폴더만' 상자 머리가 있던 화면 위치(있으면 그 줄이 거기서 제자리로 내려오는 0.2초, S51-24 ④).
function restoreTreeSpot(back, from = null) {
  if (!back) return;
  requestAnimationFrame(() => {
    const [source] = back.key.split(':');
    const row = root?.querySelector(`[data-fx-fold="${CSS.escape(back.key)}"]`) || root?.querySelector(`[data-fx-box="${CSS.escape(source)}"]`);
    settleGestureAreas();
    if (typeof back.y === 'number') window.scrollTo({top: back.y, behavior: 'instant'});
    else row?.scrollIntoView({block: 'center', behavior: 'instant'});
    row?.querySelector('.ft-main, .ft-box-toggle')?.focus({preventScroll: true});
    sinkToRow(from, row, root?.querySelectorAll('[data-fx-tree] .ft-box'));
  });
}
const focusHeadTop = () => topOf(inPane(state.panes[0], '.ft-focus-head'));
// 오므리기·[‹]: 나무로(뒤로가기 자리도 닫는다).
function backToTree() {
  const back = treeSpot(), from = focusHeadTop();
  toTree({release: true});
  restoreTreeSpot(back, from);
}
// S51-22 ⋯(요청함 11/06 19:51): 화면·펼친 자리·스크롤은 그대로, 그 줄 하나의 메뉴(예전 고르기 줄에 있던 기능 그대로 — files-tree-menu.mjs).
// 같은 부모 안 폴더 순서(위로·아래로): 나무가 그리는 순서(lookOrder) 그대로.
const treeSibs = (source, parentKey) => lookOrder(source, state.children.get(parentKey) || []).map(x => x.item_id);
function treeMenu(b) {
  const key = b.dataset.fxTmenu, inKey = b.dataset.fxTin || '', r = state.treeRows.get(key);
  if (!r) return;
  const sib = r.is_folder && SOURCES.includes(r.source) ? treeSibs(r.source, inKey) : [];
  const items = treeMenuItems(r, {phoneWrite: phoneWrite(), pcWrite: pcWrite(), pcEdit: pcEdit(), copyPath: canCopyPath(), sibIndex: sib.indexOf(r.item_id), sibCount: sib.length, pinned: pinState(r)});
  openRowMenu(b, {key, label: r.name, items, note: r.source === PC && !pcWrite() ? PC_READONLY_TEXT : '', run: id => { if (!offStop(items, id)) treeAct(id, r, inKey, liveMenuButton(key, b)); }});
}
// S53-10 메뉴 모양 통일: 흐린 항목(off — 지금은 지울 수 없는 줄의 [휴지통])을 누르면 지우지 않고 이유·할 일 한 줄만.
function offText(code) {
  if (code === 'pc') return pcWrite() ? PC_WRITE_LATER_TEXT : PC_READONLY_TEXT;
  if (code === 'ph') return phoneOn() && phone.state.all ? PHONE_OLD_APP_TEXT : phoneWriteText('permission');
  if (code === 'drive') return '드라이브는 휴지통으로 보내지 않아요. 드라이브를 열고 안의 파일·폴더를 골라 보내 주세요';
  return '';
}
function offStop(items, id) {
  const code = (items || []).find(x => x.id === id)?.off;
  if (!code) return false;
  notify(offText(code) || '지금은 할 수 없어요', {record: false});
  return true;
}
// [경로 복사](S52-43 ③): 클립보드에 위치 글자만(내 PC는 실제 경로 — 그 PC 화면 안에서만, 서버·로그로 가지 않음).
const canCopyPath = () => typeof navigator.clipboard?.writeText === 'function';
async function copyPath(r) {
  const text = pathCopyText(r, pathText(r.source, r.folder_path));
  try { await navigator.clipboard.writeText(text); notify('경로를 복사했어요', {record: false}); }
  catch { notify('경로를 복사하지 못했어요', {error: true, record: false}); }
}
// 메뉴가 열린 동안 나무가 다시 그려졌으면 같은 줄의 새 ⋯를 묻는 창의 자리로 쓴다.
const liveMenuButton = (key, b) => (b?.isConnected ? b : root?.querySelector(`[data-fx-tmenu="${CSS.escape(key)}"]`) || b);
async function treeAct(id, r, inKey, anchor) {
  const key = rowKey(r), here = {source: r.source, parent: r.item_id};
  if (id === 'open') { openPreview(r); return; }
  // '그 폴더만'(S51-24) 안 하위 폴더의 ⋯ '이 폴더만' = 한 단계 더 안으로(같은 상자 모양).
  if (id === 'only') { if (treePane()) focusTreeFolder(key); else goFolder(r.source, r.item_id); return; }
  if (id === 'mkdir') { await makeFolder(anchor, here); return; }
  if (id === 'upload') { const inp = $('[data-fx-file]'); if (inp) { state.upTo = here; inp.value = ''; inp.click(); } return; }
  if (id === 'tolib') { await sendToLibrary([r]); return; }
  if (id === 'libview') { openLibraryDoc(r.library_doc_id); return; }
  if (id === 'copy' || id === 'tocloud') { openDest('copy', [r]); return; }
  if (id === 'move') { openDest('move', [r]); return; }
  if (id === 'rename') { await renameRow(r, anchor); void loadRecent(); return; }
  if (id === 'color') { state.lookRow = r; lookMode.begin('x', anchor, lookMenu); return; }
  if (id === 'up' || id === 'down') { lookSave(() => folderLook.step(rt(), r.source, treeSibs(r.source, inKey), r.item_id, id === 'up' ? -1 : 1), '폴더 순서를 저장하지 못했어요.'); return; }
  if (id === 'star' || id === 'unstar') { await starRows([r]); return; }
  if (id === 'pin' || id === 'unpin') { pinToggle(r); return; }
  if (id === 'path') { await copyPath(r); return; }
  if (id === 'trash') { await trashRows([r], anchor); void loadRecent(); }
}
// ---------- S51-20 FILES-폰보기끌기 ①: 목록 보기 크기(목록 → 격자 → 큰 격자) + 사진 작은 그림 ----------
// 보기는 서버 view_prefs.files_look(이 기기 칸 · 이 폭 종류, files-look-model.mjs). 한 줄 칸 수는 폭이 정한다(폰·두 칸의 칸 3·2, 폴드·PC 한 칸 4·3).
// 찾는 중(위치 칸이 있는 목록)은 늘 목록. 작은 그림은 사진 파일만, 화면에 들어온 칸만 받는다(Edge cloud-files thumb small · 이 폰은 앱 다리).
// 받은 그림은 이 탭 메모리(blob:)에만 두고 화면을 떠나면 놓는다. 기기 저장 없음.
const lookLay = () => lookLayout({narrow: PHONE.matches, wide: WIDE.matches});
const lookNow = () => lookOf(viewPrefs.getFilesLook?.(DEVICE), lookLay());
const roomy = () => !PHONE.matches && !two();
function setLook(next) {
  if (!next || next === lookNow()) return;
  viewPrefs.setFilesLook?.(DEVICE, lookValue(viewPrefs.getFilesLook?.(DEVICE), lookLay(), next));
  paintLists();
}
const THUMB_KEEP = 400, THUMB_AT_ONCE = 4;
const thumbs = new Map(), thumbWait = new Set();
let thumbQueue = [], thumbBusy = 0;
const thumbKey = r => rowKey(r) + '|' + (r.modified_at || '');
function dropThumbs() {
  for (const v of thumbs.values()) if (v.url) URL.revokeObjectURL(v.url);
  thumbs.clear(); thumbWait.clear(); thumbQueue = [];
}
async function smallThumb(r) {
  if (r.source === PH) return phone.thumb(r.item_id, false);
  if (r.source === PC) throw new Error('pc_read');
  return bytes({action: 'thumb', source: r.source, id: r.item_id, size: 'small'});
}
function thumbShow(box, v) {
  if (v.url) { const img = document.createElement('img'); img.alt = ''; img.decoding = 'async'; slotImg(box, img, v.url); }
  else slotFailed(box, null, v.fail, {passive: true});
}
function thumbPump() {
  while (thumbBusy < THUMB_AT_ONCE && thumbQueue.length) {
    const {k, r} = thumbQueue.shift(), scope = state.scope;
    thumbBusy++;
    smallThumb(r).then(b => ({url: URL.createObjectURL(b)}), e => ({fail: codeOf(e) || 'thumb'})).then(v => {
      thumbBusy--; thumbWait.delete(k);
      if (scope !== state.scope) { if (v.url) URL.revokeObjectURL(v.url); return; }
      thumbs.set(k, v);
      while (thumbs.size > THUMB_KEEP) { const [old, ov] = thumbs.entries().next().value; thumbs.delete(old); if (ov.url) URL.revokeObjectURL(ov.url); }
      for (const box of root?.querySelectorAll(`[data-fx-thumb="${CSS.escape(k)}"]`) || []) thumbShow(box, v);
      thumbPump();
    });
  }
}
function wantThumb(box) {
  const k = box.dataset.fxThumb, b = box.closest('[data-fx-row]'), i = paneOfEl(box);
  if (!k || !b || i < 0 || thumbs.has(k) || thumbWait.has(k)) return;
  const r = rowByKey(b.dataset.fxRow, state.panes[i]);
  if (!r) return;
  thumbWait.add(k); thumbQueue.push({k, r}); thumbPump();
}
function mountThumbs(list) {
  list._fxIo?.disconnect(); list._fxIo = null;
  const boxes = list.querySelectorAll('[data-fx-thumb]');
  if (!boxes.length) return;
  const io = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) { io.unobserve(e.target); wantThumb(e.target); } }, {rootMargin: '240px'}) : null;
  list._fxIo = io;
  for (const box of boxes) {
    slotBox(box);
    const v = thumbs.get(box.dataset.fxThumb);
    if (v) thumbShow(box, v); else if (io) io.observe(box); else wantThumb(box);
  }
}
const thumbHtml = (r, cls) => `<span class="${cls} fx-th" data-kind="image" data-fx-thumb="${esc(thumbKey(r))}" aria-hidden="true"></span>`;
const wantsThumb = r => r.source !== PC && thumbWanted(kindOf(r), r.is_folder);
// 격자 칸 하나: 줄과 같은 단추·같은 data-*(누르기·꾹 누르기·끌기·놓기 길 그대로), 그림은 사진 = 작은 그림, 폴더 = 큰 폴더, 그 밖 = 종류 글자.
function cellHtml(p, r) {
  const key = rowKey(r), sel = p.sel === key || p.picked.has(key), kind = kindOf(r);
  const picked = p.picked.has(key) ? ' fx-picked' : '', cut = state.clip?.keys.includes(key) ? ' fx-cut' : '';
  const local = r.source === PC && !pcWrite(); // 옛 바구니 문(보기·열기만)이면 내 PC 줄은 끌기·놓기 없음
  const drag = PHONE.matches || TOUCH.matches || local ? '' : ' draggable="true"', drop = r.is_folder && !local ? ` data-fx-drop="${esc(folderKey(r.source, r.item_id))}"` : '';
  const fc = r.is_folder ? folderLook.color(r.source, r.item_id) : '';
  const pic = wantsThumb(r) ? thumbHtml(r, 'fx-cell-pic')
    : r.is_folder ? `<span class="fx-cell-pic fx-cell-fold fl-ico" data-kind="folder"${fc ? ` data-fc="${fc}"` : ''} aria-hidden="true">${folderShapeHtml('closed')}</span>`
      : `<span class="fx-cell-pic fx-cell-ic" data-kind="${kind}" aria-hidden="true">${kindIco(r)}</span>`;
  const star = r.starred ? STAR_ICO : '';
  const sub = r.is_folder ? countOf(r.source, r.item_id) : sizeText(r.size_bytes);
  return `<button type="button" class="fx-row fx-cell${r.is_folder ? ' fx-folder' : ''}${picked}${cut}" data-fx-row="${esc(key)}" aria-selected="${sel}"${drag}${drop} title="${esc([r.name, sub].filter(Boolean).join(' · '))}">`
    + `${pic}<span class="fx-nm"><span class="fx-name">${esc(r.name)}</span>${star}</span></button>`;
}
function rowHtml(p, r, {withPath = false} = {}) {
  const key = rowKey(r), sel = p.sel === key || p.picked.has(key), kind = kindOf(r);
  const picked = p.picked.has(key) ? ' fx-picked' : '', cut = state.clip?.keys.includes(key) ? ' fx-cut' : '';
  const local = r.source === PC && !pcWrite(); // 옛 바구니 문(보기·열기만)이면 내 PC 줄은 끌기·놓기 없음
  const drag = PHONE.matches || TOUCH.matches || local ? '' : ' draggable="true"', drop = r.is_folder && !local ? ` data-fx-drop="${esc(folderKey(r.source, r.item_id))}"` : '';
  const tags = [r.library_doc_id ? '자료실' : '', r.match_in === 'text' ? '글자 맞음' : ''].filter(Boolean).join(' · ');
  const tag = tags ? `<span class="fx-tag">${tags}</span>` : '';
  const star = r.starred ? STAR_ICO : '';
  const where = withPath ? pathText(r.source, r.folder_path) : '';
  const size = r.is_folder ? countOf(r.source, r.item_id) : sizeText(r.size_bytes);
  const day = dayText(r.modified_at);
  return `<button type="button" class="fx-row${r.is_folder ? ' fx-folder' : ''}${picked}${cut}" data-fx-row="${esc(key)}" aria-selected="${sel}"${drag}${drop}>`
    + (wantsThumb(r) ? thumbHtml(r, 'fx-ico')
      : r.is_folder
        ? `<span class="fx-ico fl-ico" data-kind="${kind}"${folderLook.color(r.source, r.item_id) ? ` data-fc="${folderLook.color(r.source, r.item_id)}"` : ''} aria-hidden="true">${folderShapeHtml('closed')}</span>`
        : `<span class="fx-ico" data-kind="${kind}" aria-hidden="true">${kindIco(r)}</span>`)
    + `<span class="fx-nm">${withPath ? `<span class="fx-dot" data-src="${esc(r.source)}" title="${esc(SOURCE_NAME[r.source] || '')}" aria-label="${esc(SOURCE_NAME[r.source] || '')}"></span>` : ''}<span class="fx-name">${esc(r.name)}</span>${star}${tag}</span>`
    + (withPath ? `<span class="fx-path">${esc(where)}</span>` : '')
    + `<span class="fx-day">${esc(day)}</span><span class="fx-size">${esc(size)}</span><span class="fx-kind">${esc(kindLabel(r))}</span>`
    + `<span class="fx-sub">${esc([withPath ? where : day, size].filter(Boolean).join(' · '))}</span></button>`;
}
// S49-4 FILES-칸폭: 폴더 나무 | 목록 경계(split_ratio.files)와 표 머리 칸(col_widths.files)을 끌어 조절 — 둘 다 서버에 기억.
// 나무 | 목록 경계는 나무가 보이는 동안만(폰·폴드 두 칸은 나무 칸이 없다).
// S51-33 UI-칸너비끌기(요청함 11/06 22:33): 머리줄 칸 사이 금(이름|위치|바뀐 날|크기|종류)을 끌면 금 왼쪽 칸 너비가 바뀐다 — 이름 칸 포함.
// 폰·폴드 펼침·PC 따로 기억(col-resize.js). 폴더 목록·큰 파일·별표·찾기 결과·두 칸 각 칸이 같은 머리줄(fileHeadHtml) 하나를 쓴다.
const COL_VARS = {name: '--fx-w-name', path: '--fx-w-path', day: '--fx-w-day', size: '--fx-w-size', kind: '--fx-w-kind'};
const COL_CELL = {name: '.fx-nm', path: '.fx-path', day: '.fx-day', size: '.fx-size', kind: '.fx-kind'};
// 칸 안 글자 길이: 이름 칸은 점·이름·별·꼬리표를 더한 길이(이름은 잘려 있어 scrollWidth로 잰다).
const cellFit = el => el.matches('.fx-nm')
  ? [...el.children].reduce((w, c, i) => w + (i ? 6 : 0) + (c.classList.contains('fx-name') ? c.scrollWidth : c.getBoundingClientRect().width), 0)
  : el.scrollWidth;
const fileHeadHtml = withPath => `<div class="fx-head${withPath ? ' fx-with-path' : ''}"><span aria-hidden="true"></span><span>이름${gripHtml('name', '이름')}</span>${withPath ? `<span>위치${gripHtml('path', '위치')}</span>` : ''}<span>바뀐 날${gripHtml('day', '바뀐 날')}</span><span>크기${gripHtml('size', '크기')}</span><span>종류</span></div>`;
function mountWidths(list) {
  const cols = $('[data-fx-cols]');
  if (cols) {
    mountSplitResize({container: cols, name: 'files', label: '폴더와 목록 칸 폭 조절', columns: [
      {el: () => $('[data-fx-tree]'), varName: '--ds-split-files-tree', minVar: '--ds-split-files-tree-min', minFallback: 160, share: 22},
      {el: () => $('[data-fx-main]'), varName: '--ds-split-files-main', minVar: '--ds-split-files-main-min', minFallback: 440, share: 78},
    ], query: SPLIT_QUERY, active: () => !PHONE.matches && !(two() && (!WIDE.matches || treeShut()))});
  }
  mountColResize({host: list, name: 'files', vars: COL_VARS,
    fit: key => Math.ceil(Math.max(0, ...[...list.querySelectorAll(`.fx-rows:not(.fx-grid) .fx-row ${COL_CELL[key]}`)].map(cellFit))) });
}
const MANY_ROWS = 300;
const scanningNow = () => state.syncing || SOURCES.some(x => state.status?.[x]?.scanning);
function paintList(p) {
  const list = inPane(p, '[data-fx-list]');
  if (!list) return;
  const drawn = list.fxHtml; list.fxHtml = '';
  mountWidths(list);
  if (state.statusFailed && !state.status) { list.innerHTML = failHtml({retry: 'data-fx-retry', text: errorText(state.statusFailed), reason: state.statusWhy}); return; }
  if (nothingOn()) { list.innerHTML = emptyHtml(SOURCES_OFF_TEXT); delete list.dataset.fxMode; return; }
  if (p.query) {
    if (p.findFailed) { list.innerHTML = failHtml({retry: 'data-fx-retry', text: errorText(p.findFailed), reason: p.findWhy}); return; }
    if (!p.found) { list.innerHTML = waitHtml({rows: 4}); return; }
    const found = foundShown(p);
    list.innerHTML = findBarHtml(p) + (found.length ? `${fileHeadHtml(true)}<div class="fx-rows fx-with-path" role="list">${found.map(r => rowHtml(p, r, {withPath: true})).join('')}</div>` : emptyHtml(p.found.length ? '거른 뒤 남은 것 없음' : '찾은 것 없음'));
    list.dataset.fxMode = 'find'; delete list.dataset.fxLook;
    mountThumbs(list);
    return;
  }
  const w = p.where;
  if (focusBox(p)) { paintFocus(p, list, drawn); return; }
  delete list.dataset.fxFocus;
  // 폰 첫 화면(나무)은 목록 칸을 보이지 않으므로 빈 칸(회색 줄을 숨겨 두지 않음).
  if (!w) { list.innerHTML = state.status && !anyLinked() ? emptyHtml('연결된 클라우드 없음') : treePane() ? '' : waitHtml({rows: 4}); return; }
  if (p.failed) { list.innerHTML = failHtml({retry: 'data-fx-retry', text: errorText(p.failed), reason: p.failedWhy}); return; }
  if (!p.loaded) { list.innerHTML = waitHtml({rows: 4}); return; }
  const rows = shown(p);
  list.dataset.fxMode = w.shelf || 'folder';
  // 불러오는 동안(처음 목록 맞추는 중 포함)에는 '별표 없음'·'빈 폴더'를 보이지 않는다. 다 읽은 뒤에만.
  if (!rows.length && scanningNow()) { list.innerHTML = waitHtml({rows: 4}); return; }
  if (!rows.length) { list.innerHTML = emptyHtml(w.shelf ? `${SHELF_NAME[w.shelf]} 없음` : '빈 폴더'); return; }
  const look = lookNow(), cols = lookCols(look, roomy());
  list.dataset.fxLook = look;
  // S52-44 ⑤: 수천 개 폴더도 끊김 없이 — 줄이 많으면 화면 밖 줄은 브라우저가 그리지 않는다(content-visibility, 줄·단추·키·끌기는 그대로).
  list.toggleAttribute('data-fx-many', rows.length > MANY_ROWS);
  if (cols) {
    list.innerHTML = `<div class="fx-rows fx-grid" role="list" data-fx-cols="${cols}" style="--fx-cols:${cols}">${rows.map(r => cellHtml(p, r)).join('')}</div>`;
    mountThumbs(list);
    return;
  }
  list.innerHTML = fileHeadHtml(!!w.shelf)
    + `<div class="fx-rows${w.shelf ? ' fx-with-path' : ''}" role="list">${rows.map(r => rowHtml(p, r, {withPath: !!w.shelf})).join('')}</div>`;
  mountThumbs(list);
}
// ---------- S51-24 FOLDER-그폴더만같은모양: 폰 '그 폴더만' = 나무와 같은 상자·같은 줄(시안 folder-focus-continuity.html ②) ----------
// 상자 맨 위 작은 회색 위치 줄(‹ + 저장소 › 위 폴더 ›, 누르면 그 단계), 머리 = 열린 폴더 그림 + 굵은 이름 + '폴더 n · 파일 m', 안 줄은 나무 줄 그대로(⋯ = 그 자리 메뉴).
// 줄을 누르는 동작·고르기·끌기는 목록과 같다(누르는 단추가 data-fx-row). 격자 보기면 상자 안이 격자. 돌아가기 글자는 없다(오므리기·‹·뒤로 키·위치 줄).
const focusBox = p => solo() && p === state.panes[0] && p.pane === 'list' && !p.query && !!p.where?.source && !p.where.shelf;
// 아직 서버 목록을 받기 전이면 나무가 읽어 둔 그 폴더 안(state.children·state.files)으로 바로 그린다(벌리는 순간 같은 줄이 이어지게).
function focusRows(p) {
  if (p.loaded) return shown(p);
  const k = folderKey(p.where.source, p.where.parent), kids = state.children.get(k), files = state.files.get(k);
  return kids && files ? shown({...p, rows: [...kids, ...files]}) : null;
}
// 위 단계(맨 위부터 지금 폴더까지): 받은 위치(p.trail), 아직이면 나무가 읽어 둔 폴더들로 거슬러 올라간다.
function focusTrail(p) {
  const {source, parent} = p.where;
  if (p.loaded || !parent) return {names: trailNames(source, p.trail), ids: [null, ...trailIds(p.trail)]};
  const up = []; let cur = parent;
  for (let guard = 0; cur && guard < 40; guard++) {
    let hit = null;
    for (const [k, list] of state.children) if (k.startsWith(source + ':') && (hit = list.find(x => x.item_id === cur))) break;
    if (!hit) break;
    up.unshift(hit); cur = hit.parent_id || null;
  }
  return {names: [SOURCE_NAME[source] || '', ...up.map(x => x.name)], ids: [null, ...up.map(x => x.item_id)]};
}
function focusFileHtml(p, r, parent) {
  const key = rowKey(r), sel = p.sel === key || p.picked.has(key), kind = kindOf(r);
  const cls = ['ft-btn', 'ft-main', p.picked.has(key) ? 'fx-picked' : '', state.clip?.keys.includes(key) ? 'fx-cut' : ''].filter(Boolean).join(' ');
  state.treeRows.set(key, r);
  return `<div class="ft-row ft-item fx-titem" style="--ft-depth:0" data-ft-parent="${esc(parent)}"><button type="button" class="${cls}" data-fx-row="${esc(key)}" aria-selected="${sel}">`
    + `${wantsThumb(r) ? thumbHtml(r, 'fx-tthumb') : `<span class="fx-tkind" data-kind="${kind}" aria-hidden="true">${esc(kindLabel(r))}</span>`}<span class="ft-name">${esc(r.name)}</span>${r.starred ? STAR_ICO : ''}<span class="ft-num fx-tday">${esc(fileDay(r))}</span></button>`
    + ftMoreButtonHtml({attrs: {'data-fx-tmenu': key, 'data-fx-tin': parent}, label: `${r.name} 메뉴`}) + '</div>';
}
function focusFolderHtml(p, r, parent) {
  const key = rowKey(r), fk = folderKey(r.source, r.item_id), local = r.source === PC && !pcWrite();
  state.treeRows.set(key, r);
  // 고름·잘라 둠 표시는 누르는 단추(data-fx-row)에 둔다(paintPicks가 그 단추만 바꾼다).
  const mark = [p.picked.has(key) ? 'fx-picked' : '', state.clip?.keys.includes(key) ? 'fx-cut' : ''].filter(Boolean).join(' ');
  return ftFolderRowHtml({name: r.name, count: countOf(r.source, r.item_id) || null, depth: 0, open: false, hasContent: false, color: folderLook.color(r.source, r.item_id),
    mainClass: mark,
    rowAttrs: {'data-ft-parent': parent}, mainAttrs: {'data-fx-row': key, 'data-fx-drop': local ? null : fk, 'aria-selected': String(p.sel === key || p.picked.has(key))},
    more: {attrs: {'data-fx-tmenu': key, 'data-fx-tin': parent}, label: `${r.name} 폴더 메뉴`}});
}
function paintFocus(p, list, drawn = '') {
  const w = p.where, parent = folderKey(w.source, w.parent);
  if (p.failed) { list.innerHTML = failHtml({retry: 'data-fx-retry', text: errorText(p.failed), reason: p.failedWhy}); return; }
  const rows = focusRows(p);
  const {names, ids} = focusTrail(p);
  const name = names[names.length - 1] || SOURCE_NAME[w.source] || '';
  let body;
  if (!rows) body = waitHtml({rows: 4});
  else if (!rows.length) body = p.loaded && !scanningNow() ? emptyHtml('빈 폴더') : waitHtml({rows: 4});
  else {
    const look = lookNow(), cols = lookCols(look, roomy());
    list.dataset.fxLook = look;
    body = cols ? `<div class="fx-rows fx-grid" role="list" data-fx-cols="${cols}" style="--fx-cols:${cols}">${rows.map(r => cellHtml(p, r)).join('')}</div>`
      : rows.map(r => (r.is_folder ? focusFolderHtml(p, r, parent) : focusFileHtml(p, r, parent))).join('');
  }
  const folders = rows ? rows.filter(r => r.is_folder).length : 0;
  const trail = names.slice(0, -1).map((label, i) => ({label, attrs: {'data-fx-go': w.source, 'data-fx-id': ids[i] || ''}}));
  const html = ftFocusHtml({back: {'data-fx-up': ''}, lead: treeIconHtml(w.source, {className: 'ft-box-ico'}), trail, name,
    color: w.parent ? folderLook.color(w.source, w.parent) : null, count: rows ? ftFocusCount(folders, rows.length - folders) : '', body, attrs: {'data-fx-focus': parent}});
  list.dataset.fxMode = 'folder'; list.dataset.fxFocus = '';
  // 같은 모양이면 다시 그리지 않는다(서버 목록이 나무가 읽어 둔 것과 같을 때 벌리는 움직임이 끊기지 않게).
  list.fxHtml = html;
  if (drawn === html) return;
  list.innerHTML = html;
  mountThumbs(list);
}
// ---------- 미리보기 ----------
const rowByKey = (key, p = P()) => (p.query ? p.found || [] : p.rows).find(r => rowKey(r) === key) || null;
// 미리보기가 덮는 칸인가: PC 한 칸만 오른쪽 칸, 폴드·두 칸은 덮는 칸(뒤로가기 한 번 = 닫힘).
const overlayPreview = () => !WIDE.matches || two();
function dropPreview() {
  const p = state.preview;
  if (p?.url) URL.revokeObjectURL(p.url);
  for (const u of p?.urls || []) URL.revokeObjectURL(u);
  if (p?.task) { try { p.task.destroy(); } catch { /* 이미 닫힘 */ } }
  state.preview = null;
}
function closePreview() { dropPreview(); const l = layer; layer = null; l?.close(); paintPreview(); }
function selectRow(key, {show = true} = {}) {
  const r = rowByKey(key);
  if (!r) return;
  const p = P();
  p.sel = key;
  for (const b of paneEl(p)?.querySelectorAll('[data-fx-row]') || []) b.setAttribute('aria-selected', String(b.dataset.fxRow === key || p.picked.has(b.dataset.fxRow)));
  if (show && !r.is_folder) openPreview(r);
}
// 줄 바이트: 클라우드는 Edge(thumb·media·preview), 이 폰은 앱 다리(폰 안에서 읽음). range = 앞 몇 바이트만(글 미리보기).
async function rowBlob(r, what, {range = 0} = {}) {
  // 내 PC(FILES-내PC쓰기 ①): 바구니 문에서 4MB씩 읽어 화면 메모리로(미리보기·클라우드로 보내기). 글은 앞부분만, 오피스 변환은 없다.
  if (r.source === PC) {
    if (what === 'preview' || !pc.canXfer) throw new Error('pc_read');
    return pc.read(r.item_id, {size: range ? null : r.size_bytes, ...(range ? {head: range} : {})});
  }
  if (r.source === PH) {
    const blob = what === 'thumb' ? await phone.thumb(r.item_id, true) : await phone.blob(r.item_id);
    return range ? blob.slice(0, range) : blob;
  }
  if (what === 'thumb') return bytes({action: 'thumb', source: r.source, id: r.item_id, size: 'large'});
  if (what === 'preview') return bytes({action: 'preview', source: r.source, id: r.item_id});
  return bytes({action: 'media', source: r.source, id: r.item_id}, range ? {range: `bytes=0-${range - 1}`} : {});
}
// 내 PC 미리보기(S52-43 ①): 0.4.0+ 문(read)이면 사진·PDF·글을 클라우드와 같은 칸에(50MB까지, 오피스는 없음). 아니면 이름·크기만.
const pcPreviewKind = r => {
  if (r.source !== PC) return previewKind(r);
  const k = previewKind(r);
  if (!pc.canXfer || !['image', 'pdf', 'text', 'video', 'audio', 'hwp'].includes(k)) return 'none';
  return k === 'text' || k === 'video' || k === 'audio' || Number(r.size_bytes) <= PC_PREVIEW_MAX ? k : 'none';
};
// 동영상·소리(S52-43 ③): MEDIA_PREVIEW_MAX보다 크면 재생하지 않고 이름·크기 + [열기]만(화면 메모리를 아끼려고).
const mediaBig = (r, k) => (k === 'video' || k === 'audio') && !(Number(r.size_bytes) <= MEDIA_PREVIEW_MAX);
// 한글(S52-44 ③): HWP_PREVIEW_MAX보다 크면 받지 않고 이름·크기 + [열기]만.
const hwpBig = (r, k) => k === 'hwp' && !(Number(r.size_bytes) <= HWP_PREVIEW_MAX);
// 한글 보기 엔진: 숨긴 칸막이 iframe 하나(hwp-frame.js, allow-same-origin 없음)를 처음 볼 때만 불러 이어 쓴다. 한 번에 한 파일만(차례로).
// 쪽은 엔진이 만든 SVG 글을 blob: 그림(<img>)으로만 보인다(그림 안 스크립트는 돌지 않음). 파일 바이트는 화면 메모리에서만.
let hwpEditor = null, hwpHost = null, hwpChain = Promise.resolve();
async function hwpEngine() {
  if (hwpEditor) return hwpEditor;
  const {createSandboxedEditor} = await import('./hwp-frame.js');
  hwpHost = document.createElement('div');
  hwpHost.className = 'fx-hwp-engine'; hwpHost.setAttribute('aria-hidden', 'true'); hwpHost.inert = true;
  document.body.append(hwpHost);
  try { hwpEditor = await createSandboxedEditor(hwpHost); } catch (e) { hwpHost.remove(); hwpHost = null; throw e; }
  return hwpEditor;
}
function hwpPages(bytes, name, alive) {
  const run = hwpChain.then(async () => {
    if (!alive()) return null;
    const ed = await hwpEngine();
    const loaded = await ed.loadFile(bytes, name, {skipUnsavedGuard: true});
    const count = Number(loaded?.pageCount) || Number(await ed.pageCount()) || 0;
    const svgs = [];
    for (let i = 0; i < Math.min(count, HWP_PREVIEW_PAGES) && alive(); i++) svgs.push(await ed.getPageSvg(i));
    return {count, svgs};
  });
  hwpChain = run.catch(() => {});
  return run;
}
async function openPreview(r) {
  if (state.preview?.key === rowKey(r)) { if (overlayPreview()) openLayer(); paintPreview(); return; }
  dropPreview();
  const k0 = pcPreviewKind(r), big = mediaBig(r, k0) || hwpBig(r, k0), kind = big ? 'none' : k0;
  const p = {key: rowKey(r), row: r, kind, big, bigText: hwpBig(r, k0) ? HWP_BIG_TEXT : MEDIA_BIG_TEXT, status: kind === 'none' ? 'done' : 'wait', url: '', urls: [], text: '', pages: 0, shown: 0, err: ''};
  state.preview = p;
  if (overlayPreview()) openLayer();
  paintPreview();
  loadTwins(p);
  if (kind === 'none') return;
  try {
    if (kind === 'image') {
      const blob = await rowBlob(r, 'thumb');
      if (state.preview !== p) return;
      p.url = URL.createObjectURL(blob);
    } else if (kind === 'text') {
      const blob = await rowBlob(r, 'media', {range: TEXT_PREVIEW_BYTES});
      if (state.preview !== p) return;
      p.text = new TextDecoder('utf-8', {fatal: false}).decode(new Uint8Array(await blob.slice(0, TEXT_PREVIEW_BYTES).arrayBuffer()));
    } else if (kind === 'hwp') {
      const blob = await rowBlob(r, 'media');
      if (state.preview !== p) return;
      const out = await hwpPages(new Uint8Array(await blob.arrayBuffer()), r.name, () => state.preview === p);
      if (!out || state.preview !== p) return;
      p.pages = out.count;
      p.urls = out.svgs.map(svg => URL.createObjectURL(new Blob([svg], {type: 'image/svg+xml'})));
    } else if (kind === 'video' || kind === 'audio') {
      const blob = await rowBlob(r, 'media');
      if (state.preview !== p) return;
      p.url = URL.createObjectURL(mediaMime(r) && blob.type !== mediaMime(r) ? new Blob([blob], {type: mediaMime(r)}) : blob);
    } else {
      const blob = await rowBlob(r, kind === 'office' ? 'preview' : 'media');
      if (state.preview !== p) return;
      const lib = await pdfjs();
      p.task = lib.getDocument({data: new Uint8Array(await blob.arrayBuffer()), cMapUrl: new URL('cmaps/', PDF_LIB).href, cMapPacked: true, isEvalSupported: false, disableFontFace: false, useSystemFonts: true, verbosity: 0});
      p.doc = await p.task.promise;
      if (state.preview !== p) return;
      p.pages = p.doc.numPages;
    }
    p.status = 'done';
  } catch (e) {
    if (state.preview !== p) return;
    p.status = 'fail'; p.err = codeOf(e);
  }
  paintPreview();
}
let pdfFlight = null;
function pdfjs() {
  if (!pdfFlight) pdfFlight = import(new URL('pdf.min.mjs', PDF_LIB).href).then(lib => {
    lib.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', PDF_LIB).href;
    return lib;
  }).catch(err => { pdfFlight = null; throw err; });
  return pdfFlight;
}
// PDF 쪽 그리기. 한 번에 하나만 돈다(p.drawing). 그리는 칸(data-fx-pages)이 다시 만들어지면 처음 쪽부터 그 칸에 다시 그린다.
async function drawPages(p, upto) {
  if (!p.doc || p.drawing) { if (p.doc) p.want = Math.max(p.want || 0, upto); return; }
  p.drawing = true;
  try {
    for (;;) {
      const host = $('[data-fx-pages]');
      if (!host || state.preview !== p) return;
      if (host !== p.host) { p.host = host; p.shown = 0; host.replaceChildren(); }
      const goal = Math.min(Math.max(upto, p.want || 0), p.pages);
      if (p.shown >= goal) break;
      const n = p.shown + 1, page = await p.doc.getPage(n);
      if (state.preview !== p || p.host !== $('[data-fx-pages]')) continue;
      const width = Math.max(200, host.clientWidth || 300);
      const base = page.getViewport({scale: 1}), ratio = Math.min(2, window.devicePixelRatio || 1);
      const vp = page.getViewport({scale: (width / base.width) * ratio});
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
      canvas.style.width = '100%'; canvas.className = 'fx-page'; canvas.setAttribute('aria-label', `${n}쪽`);
      await page.render({canvasContext: canvas.getContext('2d'), viewport: vp}).promise;
      if (state.preview !== p || p.host !== host) continue;
      host.append(canvas);
      p.shown = n;
    }
  } catch { /* 그리기 실패는 그 쪽까지만 보인다 */ }
  finally { p.drawing = false; }
  const more = $('[data-fx-more-pages]');
  if (more && state.preview === p) { more.hidden = p.shown >= p.pages; more.textContent = `다음 쪽 (${p.shown}/${p.pages})`; }
}
function openLayer() {
  root.dataset.fxPreview = 'open';
  layer ||= window.KPTURouter?.layer?.open('files-preview', {reopen: () => { if (state.preview) { root.dataset.fxPreview = 'open'; paintPreview(); } }, close: () => { layer = null; dropPreview(); paintPreview(); return true; }}) || null;
}
// S50-16: 폰 앱(0.5.1+)은 navigator.share가 없어도 앱 다리로 안드로이드 공유 창을 띄운다(app-share.js).
const canShare = () => (typeof navigator.share === 'function' && typeof navigator.canShare === 'function') || appShare().known();
// 미리보기 ←→(S52-43 ③): 그 줄이 있는 칸의 목록 차례에서 파일만 건너뛰며 앞·다음(키보드 ←·→, 머리 줄 작은 ← → 단추).
const STEP_HTML = '<button type="button" class="icon-btn" data-fx-pv-step="-1" aria-label="앞 파일" title="앞 파일 (←)">←</button>'
  + '<button type="button" class="icon-btn" data-fx-pv-step="1" aria-label="다음 파일" title="다음 파일 (→)">→</button>';
function previewPane() {
  const k = state.preview?.key;
  return k ? state.panes.find(q => (q.query ? q.found || [] : q.rows || []).some(x => rowKey(x) === k)) || null : null;
}
function previewNext(dir) {
  const p = state.preview, q = previewPane();
  if (!p || !q) return '';
  const keys = [...(paneEl(q)?.querySelectorAll('[data-fx-row]') || [])].map(b => b.dataset.fxRow);
  return stepFile([...new Set(keys)], p.key, dir, k => { const r = rowByKey(k, q); return !!r && !r.is_folder; });
}
function previewStep(dir) {
  const next = previewNext(dir), q = previewPane();
  if (!next || !q) return false;
  const r = rowByKey(next, q);
  if (!r) return false;
  q.sel = next; paintPicks(q);
  paneEl(q)?.querySelector(`[data-fx-row="${CSS.escape(next)}"]`)?.scrollIntoView?.({block: 'nearest'});
  openPreview(r);
  return true;
}
// keep = 다시 그리기 전 초점이 있던 ← → 단추('-1'|'1'): 새로 그린 같은 단추로 초점을 돌려 키를 이어 쓰게.
let stepKeep = '';
function paintStep(box) {
  for (const b of box.querySelectorAll('[data-fx-pv-step]')) b.disabled = !previewNext(Number(b.dataset.fxPvStep));
  const keep = stepKeep; stepKeep = '';
  if (keep) (box.querySelector(`[data-fx-pv-step="${keep}"]:not([disabled])`) || box.querySelector('[data-fx-pv-step]:not([disabled])'))?.focus({preventScroll: true});
}
function paintPreview() {
  const box = $('[data-fx-prev]');
  if (!box) return;
  const p = state.preview;
  if (!p) { box.hidden = true; box.innerHTML = ''; delete root.dataset.fxPreview; return; }
  box.hidden = false;
  stepKeep = box.contains(document.activeElement) ? document.activeElement?.dataset?.fxPvStep || '' : '';
  const r = p.row, at = state.panes.find(q => q.where?.source === r.source && !q.query && !q.where?.shelf && q.rows.some(x => rowKey(x) === p.key));
  const where = at ? trailNames(r.source, at.trail).join(' › ') : pathText(r.source, r.folder_path);
  let view = '';
  if (p.kind === 'image') view = '<div class="fx-pv-imgbox" data-fx-img></div>';
  else if (p.status === 'wait') view = barHtml(); // 미리보기 칸 맨 위 가는 줄(칸 한가운데 회색 막대가 아니라)
  else if (p.status === 'fail') view = `<p class="fx-pv-note">${esc(errorText(p.err))}</p>`;
  else if (p.kind === 'text') view = `<pre class="fx-pv-text">${esc(p.text)}</pre>`;
  else if (p.kind === 'video') view = `<video class="fx-pv-media" data-fx-media controls playsinline preload="metadata" src="${esc(p.url)}"></video>`;
  else if (p.kind === 'audio') view = `<audio class="fx-pv-media" data-fx-media controls preload="metadata" src="${esc(p.url)}"></audio>`;
  else if (p.kind === 'hwp') view = `<div class="fx-pages fx-hwp-pages">${p.urls.map((u, i) => `<img class="fx-hwp-page" alt="${esc(r.name)} ${i + 1}쪽" src="${esc(u)}">`).join('')}</div>`
    + (p.pages > p.urls.length ? `<p class="fx-pv-note">앞 ${p.urls.length}쪽만 보여요. 나머지는 [열기]로 보세요</p>` : '');
  else if (p.big) view = `<p class="fx-pv-note">${esc(p.bigText)}</p>`;
  else if (p.kind === 'pdf' || p.kind === 'office') view = `<div class="fx-pages" data-fx-pages></div><button type="button" class="fx-btn" data-fx-more-pages hidden></button>`;
  // 그리고 있는 PDF 칸은 그대로 둔다(다시 그리면 쪽을 처음부터 다시 그려야 함).
  if (p.doc && p.host && p.host.isConnected && box.contains(p.host) && box.dataset.fxKey === p.key) return;
  // 재생 중인 동영상·소리는 다시 그리지 않는다(다시 그리면 처음부터 다시 받거나 멈춤).
  if ((p.kind === 'video' || p.kind === 'audio') && p.status === 'done' && box.dataset.fxKey === p.key && box.querySelector('[data-fx-media]')) { paintStep(box); return; }
  box.dataset.fxKey = p.key;
  if (r.source === PC) {
    // 내 PC 미리보기(S52-43 ① FILES-내PC쓰기): 사진·PDF·글은 클라우드와 같은 보기 칸(바구니 문에서 화면 메모리로 읽음), 그 밖은 이름·크기만.
    //   아래 줄: [이 PC에서 열기][탐색기에서 위치] + (0.4.0+) [복사][옮기기] + (0.5.0+) [이름][휴지통] — 클라우드와 같은 항목.
    const big = p.big || (p.kind === 'none' && ['image', 'pdf'].includes(previewKind(r)) && Number(r.size_bytes) > PC_PREVIEW_MAX && pc.canXfer);
    box.innerHTML = `<div class="fx-pv-head"><button type="button" class="fx-back" data-fx-close aria-label="미리보기 닫기">‹</button><span class="fx-pv-nm">${esc(r.name)}</span>${STEP_HTML}</div>`
      + `<div class="fx-pv-view">${p.kind === 'none' ? `<p class="fx-pv-note">${esc(p.big ? p.bigText : big ? PC_PREVIEW_BIG_TEXT : PC_PREVIEW_TEXT)}</p>` : view}</div>`
      + `<dl class="fx-pv-meta"><dt>위치</dt><dd>${esc(where)}</dd><dt>크기</dt><dd>${esc(sizeText(r.size_bytes))}</dd><dt>바뀐 날</dt><dd>${esc(fullTime(r.modified_at))}</dd><dt>종류</dt><dd>${esc(kindLabel(r))}</dd></dl>`
      + '<div class="fx-pv-acts"><button type="button" class="fx-btn" data-fx-open>이 PC에서 열기</button><button type="button" class="fx-btn" data-fx-pc-reveal>탐색기에서 위치</button>'
      + (pcWrite() ? '<button type="button" class="secondary" data-fx-copy-one>복사</button><button type="button" class="secondary" data-fx-cut-one>옮기기</button><button type="button" class="secondary" data-fx-tolib-one>자료실로 보내기</button>' : '')
      + (pcEdit() ? '<button type="button" class="secondary" data-fx-rename-one>이름</button><button type="button" class="danger" data-fx-trash-one>휴지통</button>' : '') + '</div>';
    if (p.doc) { p.host = null; drawPages(p, Math.max(PDF_FIRST_PAGES, p.want || 0)); }
    const pcImg = box.querySelector('[data-fx-img]');
    if (pcImg) {
      slotBox(pcImg);
      if (p.status === 'done' && p.url) { const img = document.createElement('img'); img.className = 'fx-pv-img'; img.alt = r.name; slotImg(pcImg, img, p.url); }
      else if (p.status === 'fail') slotFailed(pcImg, () => { if (state.preview === p) { dropPreview(); openPreview(r); } }, p.err);
    }
    paintStep(box);
    return;
  }
  const mine = r.source === PH;
  box.innerHTML = `<div class="fx-pv-head"><button type="button" class="fx-back" data-fx-close aria-label="미리보기 닫기">‹</button><span class="fx-pv-nm">${esc(r.name)}</span>${STEP_HTML}`
    + (mine ? '' : `<button type="button" class="mini fx-star-btn${r.starred ? ' on' : ''}" data-fx-star-one aria-pressed="${!!r.starred}" aria-label="${r.starred ? '별표 빼기' : '별표'}" title="${r.starred ? '별표 빼기' : '별표'}">${starFace(r.starred)}</button>`) + '</div>'
    + `<div class="fx-pv-view">${view}</div>`
    + `<dl class="fx-pv-meta"><dt>위치</dt><dd>${esc(where)}</dd><dt>크기</dt><dd>${esc(sizeText(r.size_bytes))}</dd><dt>바뀐 날</dt><dd>${esc(fullTime(r.modified_at))}</dd><dt>종류</dt><dd>${esc(kindLabel(r))}</dd></dl>`
    + '<div class="fx-pv-twins" data-fx-twins hidden></div>'
    + `<div class="fx-pv-acts">${mine ? '' : '<button type="button" class="fx-btn" data-fx-open>열기</button>'}<button type="button" class="fx-btn" data-fx-down>받기</button>`
    + (canShare() ? '<button type="button" class="fx-btn fx-share" data-fx-share>공유</button>' : '')
    + (r.library_doc_id ? `<button type="button" class="fx-btn" data-fx-library="${esc(r.library_doc_id)}">자료실에서 보기</button>` : '<button type="button" class="secondary" data-fx-tolib-one>자료실로 보내기</button>')
    // 폰 파일: [클라우드에 복사] + (앱 3-③ 판이면) 옮기기·이름·휴지통. 폰에 쓸 수 있으면 받을 곳에 이 폰도 있어 [복사](S53-8).
    + (mine ? `<button type="button" class="fx-btn" data-fx-copy-one>${phoneWrite() ? '복사' : '클라우드에 복사'}</button>`
      + (phoneWrite() ? '<button type="button" class="secondary" data-fx-cut-one>옮기기</button>' : '')
      + (phoneWrite() ? '<button type="button" class="fx-btn" data-fx-rename-one>이름</button><button type="button" class="fx-btn fx-danger" data-fx-trash-one>휴지통</button>' : '') + '</div>'
      : `<button type="button" class="fx-btn" data-fx-rename-one>이름</button><button type="button" class="fx-btn" data-fx-copy-one>복사</button><button type="button" class="fx-btn" data-fx-cut-one>옮기기</button>`
      + `<button type="button" class="fx-btn fx-danger" data-fx-trash-one>휴지통</button></div>`);
  paintTwins();
  paintStep(box);
  if (p.doc) { p.host = null; drawPages(p, Math.max(PDF_FIRST_PAGES, p.want || 0)); }
  // 사진: 공용 그림 칸(img-slot.js) — 받는 중 회색, 못 받으면 ↻(그 사진만 다시 받기).
  const imgBox = box.querySelector('[data-fx-img]');
  if (imgBox) {
    slotBox(imgBox);
    if (p.status === 'done' && p.url) { const img = document.createElement('img'); img.className = 'fx-pv-img'; img.alt = r.name; slotImg(imgBox, img, p.url); }
    else if (p.status === 'fail') slotFailed(imgBox, () => { if (state.preview === p) { dropPreview(); openPreview(r); } }, p.err);
  }
}
// ⑦ 같은 파일(같은 해시): 색인 표를 로그인 토큰으로 읽는다(owner + files일 때만 읽히는 RLS). 미리보기 아래 작은 줄, 누르면 그 폴더로.
async function loadTwins(p) {
  const r = p.row;
  if (!r?.hash || r.is_folder) return;
  try {
    const q = `/rest/v1/app_cloud_items?hash=eq.${encodeURIComponent(r.hash)}&source=eq.${encodeURIComponent(r.source)}&trashed=eq.false`
      + `&select=source,item_id,parent_id,name,hash,trashed&order=name.asc&limit=${TWIN_LIMIT + 1}`;
    const rows = await rt().api(q, {singleFlight: false});
    if (state.preview !== p) return;
    p.twins = twinRows(Array.isArray(rows) ? rows : [], r);
    paintTwins();
  } catch { /* 같은 파일 보기는 덧붙임: 못 읽으면 줄을 보이지 않는다 */ }
}
function paintTwins() {
  const box = $('[data-fx-twins]'), p = state.preview;
  if (!box) return;
  const list = p?.twins || [];
  box.hidden = !list.length;
  box.innerHTML = list.length ? `<span class="fx-pv-twins-t">같은 파일 ${list.length}</span>` + list.map(t =>
    `<button type="button" class="fx-twin" data-fx-go="${esc(t.source)}" data-fx-id="${esc(t.parent_id || '')}" title="그 폴더 열기">${esc(t.name)}</button>`).join('') : '';
}
function note(text) { const n = $('[data-fx-note]'); if (n) { n.textContent = text; n.hidden = !text; } }
// 열기: 클라우드 보기 화면 새 창. 창은 누른 순간 열어 두고(팝업 막힘 피함) 주소를 받으면 넣는다.
async function openCloud(r) {
  if (r.source === PC) { pcOpen(r); return; }
  if (r.source === PH) return;
  const win = window.open('about:blank', '_blank');
  try {
    const d = await edge('open-url', {source: r.source, id: r.item_id});
    if (!d?.url) throw new Error('open_unavailable');
    if (win) { win.opener = null; win.location.href = d.url; } else window.open(d.url, '_blank', 'noopener');
  } catch (e) { win?.close(); note(errorText(codeOf(e))); }
}
// 내 PC 열기: 그 PC의 기본 프로그램(실행 파일·모르는 종류는 바구니 앱이 탐색기 위치만 엶). reveal = 탐색기에서 위치.
async function pcOpen(r, {reveal = false} = {}) {
  try {
    const done = await pc.open(r.item_id, {reveal});
    note(done === 'revealed' && !reveal ? '이 종류는 탐색기에서 위치만 열었어요' : '');
  } catch (e) { note(errorText(codeOf(e))); }
}
// S50-16: 폰 앱 안의 [공유]. 문서를 받아 앱 다리로 넘긴다(바이트는 이 화면 메모리에만). 못 보내는 종류·크기는 이유를 알린다.
async function shareViaApp(r) {
  if (!docMimeOf(r.name) && !/^image\//.test(r.mime || '')) { note('이 종류는 공유 창으로 못 보내요. [받기]를 써 주세요.'); return; }
  if (Number(r.size_bytes) > OUT_FILE_MAX) { note('파일이 너무 커서 공유 창으로 못 보내요.'); return; }
  note('공유 창을 준비해요…');
  const blob = await rowBlob(r, 'media');
  const file = new File([blob], r.name, {type: blob.type || ''});
  const result = await appShare().share([{file}]);
  note(result === 'shared' ? '' : result === 'busy' ? '앞 공유가 끝나는 중이에요. 잠시 뒤 다시 눌러 주세요.' : '공유하지 못했어요. 잠시 뒤 다시 해 주세요.');
}
async function download(r, {share = false} = {}) {
  try {
    if (share && !(typeof navigator.share === 'function' && typeof navigator.canShare === 'function') && appShare().known()) { await shareViaApp(r); return; }
    const blob = await rowBlob(r, 'media');
    if (share) {
      const file = new File([blob], r.name, {type: blob.type || 'application/octet-stream'});
      if (navigator.canShare({files: [file]})) { await navigator.share({files: [file], title: r.name}); return; }
    }
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = r.name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (e) { if (e?.name !== 'AbortError') note(errorText(codeOf(e))); }
}

// S52-44 ⑤ 여러 개 받기: 고른 파일을 하나씩 받아(rowBlob, 화면 메모리) 압축 없이 zip 하나로 묶어 내려받는다. 서버·기기에 남기지 않는다.
async function zipDownload(rows) {
  const plan = zipPlan(rows);
  if (!plan.ok) { notify(plan.why, {error: true, record: false}); return; }
  if (state.busy) return;
  const scope = state.scope, p = P(), entries = [];
  const folder = p.where && !p.where.shelf && !p.query ? trailNames(p.where.source, p.trail).at(-1) || '' : '';
  try {
    for (let i = 0; i < plan.files.length; i++) {
      state.busy = zipBusyText(i + 1, plan.files.length); paintBar();
      const blob = await rowBlob(plan.files[i], 'media');
      if (state.scope !== scope) return;
      entries.push({name: plan.names[i], data: new Uint8Array(await blob.arrayBuffer()), store: true});
    }
    const url = URL.createObjectURL(new Blob([writeZip(entries)], {type: 'application/zip'})), a = document.createElement('a');
    a.href = url; a.download = zipName(plan.files, folder); a.hidden = true; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    notify(zipDoneText(plan.files.length, plan.folders), {record: false});
  } catch (e) { notify(errorText(codeOf(e)), {error: true, record: false}); }
  finally { if (state.scope === scope) { state.busy = ''; paintBar(); } }
}
// ---------- 쓰기(S48-45 ⑤·⑦) ----------
const pickedRows = (p = P()) => [...p.picked].map(k => rowByKey(k, p)).filter(Boolean);
// 지금 손댈 줄: 고른 것이 있으면 그것, 없으면 미리보기·선택한 한 줄.
const actRows = () => { const p = P(), list = pickedRows(p); if (list.length) return list; const r = p.sel && rowByKey(p.sel, p); return r ? [r] : []; };
// 두 칸: 받을 곳 = 반대 칸의 지금 폴더(찾는 중·묶음이면 없음).
const oppDest = () => (two() ? paneDest(otherOf(P())) : null);
// FOLDER-순서·색 ③-2: 폴더 한 개만 골랐을 때 [색] [위로] [아래로]. 값은 서버(app_folder_prefs)에만 적고 클라우드의 실제 폴더는 바뀌지 않는다(이 앱에서만 보임, 아래 메뉴에 한 줄로 알림).
// 위로·아래로는 한 폴더 안 목록에서만(같은 부모 형제끼리), 끝이면 그 단추는 없다.
const lookSibs = p => shown(p).filter(r => r.is_folder).map(r => r.item_id);
function lookButtonsHtml(p) {
  const rows = pickedRows(p), r = rows[0];
  if (rows.length !== 1 || !r?.is_folder || !SOURCES.includes(r.source)) return '';
  const sib = orderable(p) ? lookSibs(p) : [], i = sib.indexOf(r.item_id);
  return '<button type="button" class="fx-btn" data-fx-look="tint" aria-haspopup="true">색</button>'
    + (i > 0 ? '<button type="button" class="fx-btn" data-fx-look="up">위로</button>' : '') + (i >= 0 && i < sib.length - 1 ? '<button type="button" class="fx-btn" data-fx-look="down">아래로</button>' : '');
}
const lookMode = createColorMode();
// 색을 바꿀 폴더: 나무 ⋯ 메뉴에서 고른 폴더(state.lookRow), 아니면 고르기 줄의 한 폴더.
const lookTarget = () => state.lookRow || pickedRows()[0];
const lookMenu = createAnchoredMenu({id: 'fxLookMenu', className: 'od-link-menu', label: '폴더 색', historyKey: 'kptuFilesLookMenu',
  key: t => t.dataset.fxLookFor || 'x', onClose: () => { lookMode.onClose(); if (!lookMode.active('x')) state.lookRow = null; },
  render: () => { const r = lookTarget(); return r?.is_folder ? colorChoiceHtml(folderLook.color(r.source, r.item_id)) + '<p class="od-link-status">이 색·순서는 이 앱에서만 보여요</p>' : ''; },
  onAction: b => {
    const r = lookTarget();
    if (!r?.is_folder) return;
    const picked = lookMode.pick('x', b);
    if (picked !== undefined) lookSave(() => folderLook.setColor(rt(), r.source, r.item_id, picked), '폴더 색을 저장하지 못했어요.');
  }});
function lookSave(job, failText) { return job().catch(() => notify(`${failText} 잠시 뒤 다시 해 주세요.`, {error: true})); }
function lookDo(act, button) {
  const p = P(), r = pickedRows(p)[0];
  if (!r?.is_folder) return;
  if (act === 'tint') { state.lookRow = null; lookMode.begin('x', button, lookMenu); return; }
  lookSave(() => folderLook.step(rt(), r.source, lookSibs(p), r.item_id, act === 'up' ? -1 : 1), '폴더 순서를 저장하지 못했어요.');
}
// 고르기 막대 공용 단추(클라우드·내 PC 줄이 같은 단추): 한 칸 [복사][옮기기], 두 칸 '→ 오른쪽에 복사 / → 옮기기'(PC는 키 이름), 고르기 풀기 ✕.
const COPY_CUT_HTML = '<button type="button" class="fx-btn" data-fx-copy>복사</button><button type="button" class="fx-btn" data-fx-cut>옮기기</button>';
const UNPICK_HTML = '<button type="button" class="fx-btn" data-fx-unpick aria-label="고르기 풀기">✕</button>';
const sendButtonsHtml = (i, off, keys) => ['copy', 'move'].map(m => `<button type="button" class="fx-btn" data-fx-send="${m}"${off}>${esc(sendLabel(i, m, VERT()))}${keys ? (m === 'copy' ? ' (F5)' : ' (F6)') : ''}</button>`).join('');
function paintBar() {
  const bar = $('[data-fx-bar]');
  if (!bar) return;
  const p = P(), n = p.picked.size, clip = state.clip;
  if (state.busy) {
    bar.hidden = false;
    bar.innerHTML = `<span class="fx-bar-t" role="status">${esc(state.busy)}</span>`;
    return;
  }
  if (clip) {
    const here = hereDest();
    const copy = clip.mode === 'copy';
    const ok = here && !pcWhy(clip.rows, here) && (copy ? xferPlan(clip.rows, here, 'copy').ok.length > 0 : moveTargetOk(clip.rows, here));
    bar.hidden = false;
    bar.innerHTML = `<span class="fx-bar-t">${clip.rows.length}개 ${copy ? '복사하는' : '옮기는'} 중 · ${ok ? '이 폴더로' : `${copy ? '복사할' : '옮길'} 폴더를 여세요`}</span>`
      + `<button type="button" class="fx-btn" data-fx-paste${ok ? '' : ' disabled'}>${copy ? '여기에 복사' : '여기로 옮기기'}</button><button type="button" class="fx-btn" data-fx-uncut>취소</button>`;
    return;
  }
  bar.hidden = !n;
  if (!n) { bar.innerHTML = ''; return; }
  // 내 PC 줄: 옛 바구니 문이면 보기·열기만. 0.4.0+ 문이면 클라우드로 [복사][옮기기](두 칸은 반대 칸으로 — 반대 칸이 클라우드 폴더일 때).
  //   이름·휴지통은 다음 판(FILES-내PC쓰기)이라 두지 않는다.
  if (hasPc(pickedRows(p))) {
    if (!pcWrite()) {
      bar.innerHTML = `<span class="fx-bar-t" title="${esc(PC_READONLY_TEXT)}">${n}개 · ${esc(SOURCE_NAME[PC])} · 보기·열기만</span>`
        + '<button type="button" class="fx-btn" data-fx-unpick aria-label="고르기 풀기">✕</button>';
      return;
    }
    const i = state.cur, dest = two() ? oppDest() : null, keys = WIDE.matches;
    const why = two() ? (dest ? pcWhy(pickedRows(p), dest) : `${side(i ^ 1)} 칸에서 받을 ${pcEdit() ? '' : '클라우드 '}폴더를 여세요`) : '';
    const off = why ? ` disabled title="${esc(why)}"` : '';
    // 0.5.0+ 문(FILES-내PC쓰기)이면 클라우드 막대와 같은 [이름][휴지통]도.
    const edit = pcEdit() ? (n === 1 ? `<button type="button" class="secondary" data-fx-rename>이름${two() && keys ? ' (F2)' : ''}</button>` : '')
      + `<button type="button" class="danger" data-fx-trash>휴지통${two() && keys ? ' (Del)' : ''}</button>` : '';
    bar.innerHTML = `<span class="fx-bar-t">${n}개 · ${esc(SOURCE_NAME[PC])}</span>` + (two() ? sendButtonsHtml(i, off, keys) : COPY_CUT_HTML) + TOLIB_BTN + edit + UNPICK_HTML;
    return;
  }
  // 폰 파일을 고르면 '클라우드에 복사'(받을 곳 창 / 두 칸이면 반대 칸이 클라우드 폴더일 때). 폰에 쓸 수 있는 앱이면 [옮기기]도(S52-43 ②, 복사 뒤 폰 원본 휴지통).
  //   S53-8: 폰에 쓸 수 있으면 받을 곳에 이 폰도(폰 안끼리) — 단추는 [복사], 반대 칸이 이 폰 폴더여도 된다.
  if (hasPhone(pickedRows(p))) {
    const i = state.cur, dest = two() ? oppDest() : null, ok = dest && dest.source !== PC && (dest.source !== PH || phoneWrite());
    const off = ok ? '' : ` disabled title="${esc(side(i ^ 1))} 칸에서 받을 ${phoneWrite() ? '' : '클라우드 '}폴더를 여세요"`;
    bar.innerHTML = `<span class="fx-bar-t">${n}개 · ${esc(SOURCE_NAME[PH])}</span>`
      + (two() ? `<button type="button" class="fx-btn" data-fx-send="copy"${off}>${esc(sendLabel(i, 'copy', VERT()))}</button>`
        + (phoneWrite() ? `<button type="button" class="secondary" data-fx-send="move"${off}>${esc(sendLabel(i, 'move', VERT()))}</button>` : '')
        : `<button type="button" class="fx-btn" data-fx-copy>${phoneWrite() ? '복사' : '클라우드에 복사'}</button>` + (phoneWrite() ? '<button type="button" class="secondary" data-fx-cut>옮기기</button>' : '')) + TOLIB_BTN
      + (phoneWrite() ? (n === 1 ? '<button type="button" class="fx-btn" data-fx-rename>이름</button>' : '') + '<button type="button" class="fx-btn fx-danger" data-fx-trash>휴지통</button>' : '')
      + '<button type="button" class="fx-btn" data-fx-unpick aria-label="고르기 풀기">✕</button>';
    return;
  }
  if (two()) {
    // 시안 ⑥⑧: 'N개 (왼쪽) · [→ 오른쪽에 복사] [→ 옮기기] [이름] [휴지통] ✕' — 받을 곳 창 없이 반대 칸으로. PC는 키 이름을 함께.
    const i = state.cur, dest = oppDest(), keys = WIDE.matches;
    // 반대 칸이 내 PC면 바구니 문이 받을 수 있을 때만(0.4.0+ · 드라이브나 폴더를 연 칸).
    const why = dest ? pcWhy(pickedRows(p), dest) : `${side(i ^ 1)} 칸에서 받을 폴더를 여세요`;
    const off = why ? ` disabled title="${esc(why)}"` : '';
    bar.innerHTML = `<span class="fx-bar-t">${n}개 (${side(i)})</span>` + sendButtonsHtml(i, off, keys)
      + TOLIB_BTN
      + (n === 1 ? `<button type="button" class="fx-btn" data-fx-rename>이름${keys ? ' (F2)' : ''}</button>` : '') + lookButtonsHtml(p)
      + `<button type="button" class="fx-btn" data-fx-star>${esc(starLabel(pickedRows(p)))}</button>`
      + `<button type="button" class="fx-btn fx-danger" data-fx-trash>휴지통${keys ? ' (Del)' : ''}</button><button type="button" class="fx-btn" data-fx-unpick aria-label="고르기 풀기">✕</button>`;
    return;
  }
  // 시안 ③: 'N개 · [복사] [옮기기] [이름] [휴지통] ✕'(쓰지 않는 ⋯는 두지 않는다).
  bar.innerHTML = `<span class="fx-bar-t">${n}개</span>` + COPY_CUT_HTML + TOLIB_BTN
    + (n === 1 ? '<button type="button" class="fx-btn" data-fx-rename>이름</button>' : '') + lookButtonsHtml(p)
    + `<button type="button" class="fx-btn" data-fx-star>${esc(starLabel(pickedRows(p)))}</button>`
    + '<button type="button" class="fx-btn fx-danger" data-fx-trash>휴지통</button><button type="button" class="fx-btn" data-fx-unpick aria-label="고르기 풀기">✕</button>';
}
function paintPicks(p = P()) {
  for (const b of paneEl(p)?.querySelectorAll('[data-fx-row]') || []) {
    const on = p.picked.has(b.dataset.fxRow);
    b.classList.toggle('fx-picked', on);
    b.setAttribute('aria-selected', String(on || b.dataset.fxRow === p.sel));
  }
  paintBar();
}
function togglePick(key) {
  const p = P();
  if (p.picked.has(key)) p.picked.delete(key); else p.picked.add(key);
  p.anchor = key; paintPicks(p);
}
function rangePick(key) {
  const p = P(), keys = [...(paneEl(p)?.querySelectorAll('[data-fx-row]') || [])].map(b => b.dataset.fxRow);
  for (const k of pickRange(keys, p.anchor || p.sel, key)) p.picked.add(k);
  paintPicks(p);
}
function unpick(p = P()) { p.picked.clear(); p.anchor = ''; paintPicks(p); }
// 서버가 돌려준 바뀐 줄을 보이는 칸마다 입힌다(sync와 같은 길). 찾기·묶음 화면은 서버에서 다시 읽는다.
async function applyWrite(d, touched = []) {
  const changed = Array.isArray(d?.changed) ? d.changed : [], removed = Array.isArray(d?.removed) ? d.removed : [];
  const gone = new Set(removed.map(x => `${x.source}:${x.id}`));
  for (const p of state.panes) for (const k of gone) p.picked.delete(k);
  // 지운 줄은 고른 것에서도 빠진다 → 막대 숫자를 바로 고친다(write()의 마무리 그리기는 이보다 먼저 돈다).
  paintBar();
  if (state.preview && gone.has(state.preview.key)) closePreview();
  else if (state.preview) { const c = changed.find(x => rowKey(x) === state.preview.key); if (c) { state.preview.row = {...state.preview.row, ...c}; paintPreview(); } }
  for (const key of touched) if (state.children.has(key)) { const [source, ...rest] = key.split(':'); loadChildren(source, rest.join(':') || null); }
  const work = [];
  for (const p of panesOn()) {
    if (p.query) { refind(p); continue; }
    const w = p.where;
    if (!w) continue;
    if (w.shelf || touchesCounts(p.rows, w, changed, removed)) { work.push(loadList(p, {quiet: true})); continue; }
    const next = applyChanges(p.rows, w, changed, removed);
    if (next !== p.rows) { p.rows = next; paintList(p); }
  }
  await Promise.all(work);
}
async function write(action, body, label, {timeoutMs = 60000} = {}) {
  if (state.busy || state.run) return null;
  const scope = state.scope;
  state.busy = label; paintBar(); paintTop();
  try {
    return await rt().api(FN, {method: 'POST', body: {action, ...body, confirm: true}, singleFlight: false, timeoutMs});
  } catch (e) {
    if (state.scope === scope) notify(writeErrorText(codeOf(e)), {error: true, record: false});
    return null;
  } finally {
    if (state.scope === scope) { state.busy = ''; paintBar(); paintTop(); }
  }
}
// 폰 줄·폰 받을 곳이 낀 일: 새 폴더·이름·휴지통(write)은 앱 3-③ 판이면 한다. 옮기기는 아직 없다. 막을 때 한 줄 안내.
const hasPhone = rows => (rows || []).some(r => r?.source === PH);
// 내 PC 줄·내 PC 받을 곳이 낀 일: 복사·옮기기는 pcXferWhy가 되는 것만 통과(0.4.0+ 문, 내 PC ↔ 클라우드).
//   write = 내 PC 안 이름·새 폴더·휴지통 — 다음 판(FILES-내PC쓰기)이라 막는다. 막을 때 한 줄 안내.
const hasPc = rows => (rows || []).some(r => r?.source === PC);
function pcStop(rows, dest, {write = false} = {}) {
  if (!hasPc(rows) && dest?.source !== PC) return false;
  const why = write ? (pcEdit() ? '' : pcWrite() ? PC_WRITE_LATER_TEXT : PC_READONLY_TEXT) : pcWhy(rows, dest);
  if (!why) return false;
  notify(why, {record: false});
  return true;
}
// 폰 ↔ 클라우드 옮기기(S52-43 ② FILES-저장소사이): 앱이 폰에 쓸 수 있을 때, 보낼 것이 모두 폰 파일이고 받을 곳이 클라우드(아직 안 골랐으면 통과)
//   이거나, 모두 클라우드 줄이고 받을 곳이 이 폰일 때. S53-8: 폰 안끼리도(복사 뒤 원본 폰 휴지통). 섞어 보내기는 없다.
const phoneMoveOk = (rows, dest) => phoneWrite() && ((rows.every(r => r.source === PH) && (!dest || SOURCES.includes(dest.source) || dest.source === PH))
  || (rows.every(r => SOURCES.includes(r.source)) && dest?.source === PH));
function phoneStop(rows, dest, {write = false} = {}) {
  if (pcStop(rows, dest, {write})) return true;
  if (!hasPhone(rows) && dest?.source !== PH) return false;
  if (write && phoneWrite()) return false;
  if (!write && phoneMoveOk((rows || []).filter(Boolean), dest)) return false;
  notify(write ? PHONE_OLD_APP_TEXT : PHONE_MOVE_TEXT, {record: false});
  return true;
}
// 폰(·내 PC)에 쓴 뒤: 그 폴더를 보고 있는 칸·나무·[최근]을 앱(·바구니 문)에서 다시 읽는다(폰·PC 목록은 화면 메모리만).
async function phoneRefresh(dirs, {gone = [], source = PH} = {}) {
  const set = new Set((dirs || []).map(d => d || null));
  if (state.preview && gone.includes(state.preview.key)) closePreview();
  for (const p of state.panes) for (const k of gone) p.picked.delete(k);
  for (const d of set) if (state.children.has(folderKey(source, d))) loadChildren(source, d);
  const work = [];
  for (const p of panesOn()) {
    const w = p.where;
    if (!w || p.query) continue;
    if (w.source === source && set.has(w.parent || null)) work.push(loadList(p, {quiet: true}));
  }
  paintBar();
  await Promise.all(work);
}
// 폰 쓰기 한 번(새 폴더·이름·휴지통): 막대에 '… 중' → 앱 답 → 실패면 한 줄.
async function phoneOp(body, label) {
  if (state.busy || state.run) return null;
  const scope = state.scope;
  state.busy = label; paintBar(); paintTop();
  try {
    const d = await phone.op(body);
    if (state.scope !== scope) return null;
    // S53-7: 실패든 일부만 됐든 앱이 준 이유(refused·direct·missing…)를 한 줄로. 옛 앱(del 없음)의 막연한 실패는 새 판 안내.
    const del = phone.state.del === true;
    if (!d.ok) { notify(phoneWriteText(d.error, {del}), {error: true, record: false}); return null; }
    if (d.error) notify(phoneWriteText(d.error, {del}), {error: true, record: false});
    return d;
  } finally {
    if (state.scope === scope) { state.busy = ''; paintBar(); paintTop(); }
  }
}
// 내 PC 쓰기 한 번(이름·새 폴더·옮기기·복사·휴지통, FILES-내PC쓰기 ①): 막대에 '… 중' → 문 답 → 실패면 한 줄(errorText가 pc_ 까닭을 바꾼다).
async function pcOp(run, label) {
  if (state.busy || state.run) return null;
  const scope = state.scope;
  state.busy = label; paintBar(); paintTop();
  try {
    return (await run()) || true;
  } catch (e) {
    if (state.scope === scope) notify(errorText(codeOf(e)), {error: true, record: false});
    return null;
  } finally {
    if (state.scope === scope) { state.busy = ''; paintBar(); paintTop(); }
  }
}
// 이름을 바꾼 내 PC 줄: 미리보기가 그 줄이면 새 경로로 닫고(경로가 줄 열쇠), 고정한 PC 폴더면 고정 목록의 경로도 바꾼다(그 PC에만).
function pcRenamed(r, to) {
  if (r.is_folder && pinsPc.includes(r.item_id)) void setPcPins(pinsPc.map(x => (x === r.item_id ? to : x)));
}
async function renameRow(r, anchor) {
  if (!r || phoneStop([r], null, {write: true})) return;
  const parts = r.is_folder ? {base: r.name, ext: ''} : splitFileName(r.name);
  const v = await askText(anchor, {text: '새 이름', value: parts.base, ok: '바꾸기', max: FILE_BASE_MAX});
  if (v === null) return;
  const chk = checkFileBase(v);
  if (!chk.ok) { notify(chk.message, {error: true, record: false}); return; }
  const name = chk.base + parts.ext;
  if (name === r.name) return;
  // S52-43 ② FILES-저장소사이·되돌리기: 바꾼 뒤 알림의 [되돌리기](5초 남짓) = 원래 이름으로 다시 바꾸기(사람이 누른 것만, 같은 길).
  const label = `이름 바꾸기 '${name}'`;
  if (r.source === PC) {
    const to = await pcOp(() => pc.rename(r.item_id, name), '이름 바꾸는 중');
    if (!to) return;
    await phoneRefresh([pcParent(r.item_id)], {source: PC, gone: [rowKey(r)]}); pcRenamed(r, to);
    notify(writeDoneText('rename'), {record: false, label, undo: async () => {
      const back = await pc.rename(to, r.name);
      await phoneRefresh([pcParent(back)], {source: PC, gone: [rowKey({source: PC, item_id: to})]}); pcRenamed({...r, item_id: to}, back);
      return {status: 'restored'};
    }});
    return;
  }
  if (r.source === PH) {
    const d = await phoneOp({op: 'rename', path: r.item_id, name}, '이름 바꾸는 중');
    if (!d) return;
    const dir = phoneParent(r.item_id), now = (dir ? dir + '/' : '') + name;
    await phoneRefresh([dir], {gone: [rowKey(r)]});
    notify(writeDoneText('rename'), {record: false, label, undo: async () => {
      const b = await phone.op({op: 'rename', path: now, name: r.name});
      if (!b?.ok) return false;
      await phoneRefresh([dir], {gone: [rowKey({source: PH, item_id: now})]});
      return {status: 'restored'};
    }});
    return;
  }
  const d = await write('rename', {source: r.source, id: r.item_id, name}, '이름 바꾸는 중');
  if (!d) return;
  await applyWrite(d, touchedFolders([r]));
  notify(writeDoneText('rename'), {record: false, label, undo: async () => {
    const b = await rt().api(FN, {method: 'POST', body: {action: 'rename', source: r.source, id: r.item_id, name: r.name, confirm: true}, singleFlight: false, timeoutMs: 60000});
    await applyWrite(b, touchedFolders([r]));
    return {status: 'restored'};
  }});
}
async function makeFolder(anchor, where = null) {
  const w = where || P().where;
  if (!w?.source || phoneStop([], w, {write: true})) return;
  const v = await askText(anchor, {text: '새 폴더 이름', value: '', ok: '만들기', max: FILE_BASE_MAX});
  if (v === null) return;
  const chk = checkFileBase(v);
  if (!chk.ok) { notify(chk.message, {error: true, record: false}); return; }
  if (w.source === PC) {
    if (!w.parent) { notify('내 PC에서는 드라이브나 폴더를 열어 주세요', {record: false}); return; }
    const to = await pcOp(() => pc.mkdir(w.parent, chk.base), '폴더 만드는 중');
    if (to) { await phoneRefresh([w.parent], {source: PC}); notify(writeDoneText('mkdir'), {record: false}); }
    return;
  }
  if (w.source === PH) {
    const d = await phoneOp({op: 'mkdir', dir: w.parent || '', name: chk.base}, '폴더 만드는 중');
    if (d) { await phoneRefresh([w.parent]); notify(writeDoneText('mkdir'), {record: false}); }
    return;
  }
  const d = await write('mkdir', {source: w.source, parent: w.parent, name: chk.base}, '폴더 만드는 중');
  if (d) { await applyWrite(d, [folderKey(w.source, w.parent)]); notify(writeDoneText('mkdir'), {record: false}); }
}
async function trashRows(rows, anchor) {
  const list = rows.filter(Boolean);
  if (!list.length || phoneStop(list, null, {write: true})) return;
  // 내 PC(S52-43 ①): 확인 한 번 → 윈도우 휴지통(파일·폴더, 드라이브는 아님). 다른 곳 줄과 섞여 있으면 따로 하게.
  if (hasPc(list)) {
    if (list.some(r => r.source !== PC)) { notify('내 PC 파일과 다른 곳 파일은 따로 휴지통으로 보내 주세요', {record: false}); return; }
    const items = list.filter(r => r.parent_id);
    if (!items.length) { notify('드라이브는 휴지통으로 보내지 않아요', {record: false}); return; }
    const one = items.length === 1;
    if (!(await askConfirm(anchor, {text: one ? `'${items[0].name}'을(를) 휴지통으로 보낼까요?` : `${items.length}개를 휴지통으로 보낼까요?`,
      note: '되돌리기는 윈도우 휴지통에서 합니다', ok: '휴지통으로', danger: true}))) return;
    let done = 0;
    const gone = [];
    for (const r of items) {
      const ok = await pcOp(() => pc.trash(r.item_id), `휴지통으로 보내는 중 (${done}/${items.length})`);
      if (!ok) break;
      done++; gone.push(r);
    }
    await phoneRefresh([...new Set(gone.map(r => r.parent_id))], {source: PC, gone: gone.map(rowKey)});
    if (gone.some(r => r.is_folder)) for (const r of gone) if (r.is_folder) state.children.delete(folderKey(PC, r.item_id));
    if (done) notify(writeDoneText('trash', {done, failed: items.length - done}), {error: done < items.length, record: false});
    return;
  }
  // 폰 파일: 확인 한 번 → 안드로이드 휴지통. 클라우드 줄과 섞여 있으면 따로 하게.
  // S53-10: 폰 폴더는 안 파일(하위 폴더 포함, 폴더째 복사와 같은 한도)을 모두 휴지통으로 — 폴더는 빈 채로 남는다(phoneTrashAsk).
  if (hasPhone(list)) {
    if (list.some(r => r.source !== PH)) { notify('폰 파일과 클라우드 파일은 따로 휴지통으로 보내 주세요', {record: false}); return; }
    const folders = list.filter(r => r.is_folder), files = list.filter(r => !r.is_folder), dirs = new Set(files.map(r => phoneParent(r.item_id)));
    if (folders.length) {
      const scope = state.scope;
      state.busy = '폴더 안을 읽는 중'; paintBar();
      try {
        for (const f of folders) {
          let tree;
          try { tree = await treeWalk(f); } catch (e) { notify(`${f.name}: ${phoneWriteText(e?.message, {del: phone.state.del === true})}`, {error: true, record: false}); return; }
          if (state.scope !== scope) return;
          if (tree === null) { notify(treeAcrossTooBigText(f.name), {error: true, record: false}); return; }
          files.push(...tree.files);
          dirs.add(f.item_id); for (const sub of tree.folders) dirs.add(sub.item_id);
          if (treeAcrossBig(files.length, 0)) { notify(treeAcrossTooBigText(f.name), {error: true, record: false}); return; }
        }
      } finally { if (state.scope === scope) { state.busy = ''; paintBar(); } }
      if (!files.length) { notify(folders.length === 1 ? `'${folders[0].name}' 폴더 안에 보낼 파일이 없어요(${PHONE_FOLDER_LEFT_NOTE})` : `고른 폴더 안에 보낼 파일이 없어요(${PHONE_FOLDER_LEFT_NOTE})`, {record: false}); return; }
    }
    const ask = phoneTrashAsk({files: files.length, folders: folders.map(r => r.name), one: files[0]?.name});
    if (!(await askConfirm(anchor, {text: ask.text, note: ask.note, ok: '휴지통으로', danger: true}))) return;
    let done = 0;
    for (let i = 0; i < files.length; i += PHONE_TRASH_BATCH) {
      const part = files.slice(i, i + PHONE_TRASH_BATCH);
      const d = await phoneOp({op: 'trash', paths: part.map(r => r.item_id)}, `휴지통으로 보내는 중 (${done}/${files.length})`);
      if (!d) break;
      done += d.count;
      if (d.error) break; // 확인 창에서 그만둠·일부 못 감: 이유는 phoneOp가 한 줄로 보였다. 남은 묶음은 보내지 않는다.
    }
    if (done || folders.length) await phoneRefresh([...dirs], {gone: files.map(rowKey)});
    if (done) notify(writeDoneText('trash', {done, failed: files.length - done}) + (folders.length ? ' · ' + PHONE_FOLDER_LEFT_NOTE : ''), {error: done < files.length, record: false});
    return;
  }
  const ask = trashAsk(list);
  if (!(await askConfirm(anchor, {text: ask.text, note: ask.note, ok: '휴지통으로', danger: true}))) return;
  let done = 0, failed = 0;
  for (const g of groupBySource(list)) {
    let ids = g.rows.map(r => r.item_id);
    while (ids.length) {
      const d = await write('trash', {source: g.source, ids}, `휴지통으로 보내는 중 (${done}/${list.length})`);
      if (!d) { failed += ids.length; break; }
      await applyWrite(d, touchedFolders(g.rows));
      failed += (d.failed || []).length;
      done += ids.length - (d.failed || []).length - (d.left || []).length;
      ids = Array.isArray(d.left) ? d.left : [];
    }
  }
  notify(writeDoneText('trash', {done, failed}), {error: !!failed, record: false});
}
// 잘라 붙이기·복사해 붙이기(PC Ctrl+X·Ctrl+C → 폴더를 열고 Ctrl+V / [여기로 옮기기·여기에 복사]).
function cutRows(rows, mode = 'move') {
  const list = rows.filter(Boolean);
  if (!list.length || pcStop(list) || (mode === 'move' && phoneStop(list))) return;
  if (mode === 'move') { const chk = moveCheck(list); if (!chk.ok) { notify(chk.reason, {error: true, record: false}); return; } }
  state.clip = {rows: list, keys: list.map(rowKey), mode};
  P().picked.clear(); paintLists(); paintBar();
}
function uncut() { state.clip = null; paintLists(); paintBar(); }
// 잘라 둔 줄(흐리게)은 두 칸 모두에 보일 수 있다.
function paintLists() { for (const p of panesOn()) paintList(p); }
function pasteClip(dest, anchor) {
  const c = state.clip;
  if (!c) return;
  if (c.mode === 'copy') { state.clip = null; paintLists(); paintBar(); xferRun('copy', c.rows, dest); }
  else moveRows(c.rows, dest, anchor);
}
// 끌어 놓기·붙여 넣기 옮기기: 받을 곳 창과 같은 길(xferRun)로. 다른 저장소로 옮기는 것은 원본이 휴지통으로 가므로 한 번 묻는다.
async function moveRows(rows, dest, anchor) {
  const list = rows.filter(Boolean);
  if (phoneStop(list, dest) || !moveTargetOk(list, dest)) return;
  const away = list.filter(r => r.source !== dest.source);
  if (away.length) {
    const r = away[0], one = away.length === 1;
    const ok = await askConfirm(anchor, {text: one ? `'${r.name}'을(를) ${SOURCE_NAME[dest.source]}로 옮길까요?` : `${away.length}개를 ${SOURCE_NAME[dest.source]}로 옮길까요?`, ok: '옮기기',
      note: `똑같이 옮겨졌는지 맞춘 뒤 원본은 ${[...new Set(away.map(x => SOURCE_NAME[x.source]))].join('·')} 휴지통으로 보냅니다`});
    if (!ok) return;
  }
  state.clip = null; paintLists(); paintBar();
  await xferRun('move', list, dest);
}

// ---------- 복사·옮기기: 받을 곳 창(시안 ④) · 같은 이름·큰 파일 묻기(H-3·H-4) · 전송 줄(시안 ⑤ 아래 줄) ----------
// 받을 곳 창은 하단바 위로 열리고(뒤로가기 한 번 = 닫힘), 맨 위 '최근 보낸 곳' 칩 3개(서버 view_prefs.files_dest_recent), 켜진 저장소 나무, [새 폴더][여기에 복사/옮기기].
// 보내기는 한 번에 하나씩 차례로(서버가 1개씩 받음, 같은 클라우드 옮기기만 move 한 번에 200개). 쓰기는 모두 사람이 누른 것(confirm:true).
let destLayer = null;
// 받을 곳 창의 저장소: 클라우드 + (폰에 쓸 수 있고, 보내는 것이 클라우드 파일이면) '이 폰' + (바구니 문 0.4.0+이고 클라우드 파일이면) '내 PC'.
//   내 PC 파일은 클라우드로만 보낸다.
const destSources = rows => {
  if (hasPc(rows)) return pcEdit() ? [...cloudOn(), PC] : cloudOn(); // 0.5.0+ 문이면 내 PC 안으로도(FILES-내PC쓰기)
  // S53-8: 폰 줄도 폰에 쓸 수 있으면 '이 폰' 안으로(폰 안끼리 복사·옮기기).
  const base = phoneWrite() && (!hasPhone(rows) || rows.every(r => r.source === PH)) ? onSources().filter(s => s !== PC) : cloudOn();
  return pcWrite() && !hasPhone(rows) ? [...base, PC] : base;
};
const destKey = d => d ? folderKey(d.source, d.parent) : '';
function openDest(mode, rows) {
  const list = (rows || []).filter(Boolean);
  if (!list.length || pcStop(list) || (mode === 'move' && phoneStop(list))) return;
  if (state.run) { notify('보내는 중이에요. 끝난 뒤 다시 해 주세요.', {record: false}); return; }
  const on = destSources(list), here = hereDest();
  const dest = here && on.includes(here.source) ? here : null;
  const open = new Set(on.map(s => folderKey(s, null)));
  const p = P();
  if (dest) for (const id of [null, ...trailIds(p.trail)]) open.add(folderKey(dest.source, id));
  state.xfer = {mode, rows: list, dest, open, names: new Map(p.trail.map(t => [folderKey(p.where?.source, t.item_id), t.name]))};
  for (const s of on) if (!state.children.has(folderKey(s, null))) loadChildren(s, null);
  destLayer ||= window.KPTURouter?.layer?.open('files-dest', {reopen: () => paintDest(), close: () => { destLayer = null; dropDest(); return true; }}) || null;
  paintDest();
  $('[data-fx-dest] [data-fx-dest-close]')?.focus({preventScroll: true});
}
function dropDest() {
  const x = state.xfer; state.xfer = null;
  if (state.ask && x) { const a = state.ask; state.ask = null; a.resolve({choice: 'skip', all: true, closed: true}); }
  paintDest(); paintAsk();
}
// 닫기 단추·보내기 시작: 창을 먼저 닫고(그리기 주인은 이 파일), 뒤로가기 칸(router layer)도 놓는다. 뒤로가기로 닫힐 때는 layer의 close가 dropDest를 부른다.
function closeDest() { const l = destLayer; destLayer = null; dropDest(); l?.close(); }
const recentDests = () => { const v = viewPrefs.get?.('files_dest_recent'); return Array.isArray(v) ? v : []; };
function destNameOf(dest) {
  if (!dest?.parent) return destName(dest);
  const known = state.xfer?.names.get(destKey(dest));
  if (known) return destName(dest, known);
  for (const p of state.panes) { const t = p.where?.source === dest.source && p.trail.find(x => x.item_id === dest.parent); if (t) return destName(dest, t.name); }
  for (const list of state.children.values()) { const f = list.find(r => r.source === dest.source && r.item_id === dest.parent); if (f) return destName(dest, f.name); }
  return destName(dest, '폴더');
}
function paintDest() {
  const box = $('[data-fx-dest]'), dim = $('[data-fx-dim]');
  if (!box) return;
  const x = state.xfer;
  if (!x) { box.hidden = true; box.innerHTML = ''; if (dim) dim.hidden = true; root.classList.remove('fx-dest-open'); return; }
  box.hidden = false; if (dim) dim.hidden = false; root.classList.add('fx-dest-open');
  const on = destSources(x.rows), cur = destKey(x.dest);
  const chips = recentDests().map(recentDestOf).filter(d => d && on.includes(d.source));
  const recent = chips.length ? `<div class="fx-dest-sub">최근 보낸 곳</div><div class="fx-dest-recent">${recentDests().filter(d => on.includes(d.source)).map(d =>
    `<button type="button" class="fx-dest-chip${destKey(recentDestOf(d)) === cur ? ' on' : ''}" data-fx-dest-pick="${esc(destKey(recentDestOf(d)))}" data-fx-dest-name="${esc(d.name)}">${d.source === 'gd' ? brandIconSvg('gdrive', {size: 12}) : brandIconSvg('onedrive', {size: 12})}<span>${esc(d.name)}</span></button>`).join('')}</div>` : '';
  const rows = treeRows({sources: on, children: state.children, open: x.open, order: lookOrder}).filter(r => r.type !== 'shelf');
  const tree = rows.map(r => {
    const key = r.key, sel = key === cur;
    // S51-25 FOLDER-세모0: 받을 곳 창 나무도 공용 줄 — 세모 없이 아이콘 단추(폴더 = 열린/닫힌 그림, 저장소 = 로고)가 펼치기·접기, 이름 = 받을 곳 고르기.
    const name = r.type === 'root' ? SOURCE_NAME[r.source] : r.name;
    return ftFolderRowHtml({name, depth: r.depth, open: r.open, hasContent: r.hasKids, current: sel, className: r.type === 'root' ? 'fx-root' : '',
      color: r.type === 'root' ? null : folderLook.color(r.source, r.id), icon: r.type === 'root' ? treeIconHtml(r.source, {className: 'ft-ico'}) : null,
      mainAttrs: {'data-fx-dest-pick': key, 'data-fx-dest-name': name}, toggle: {attrs: {'data-fx-dest-twist': key}, label: `${name} ${r.open && r.hasKids ? '접기' : '펼치기'}`}});
  }).join('');
  // '내 PC' 맨 위(드라이브 목록)는 받을 곳이 아니다(드라이브나 폴더를 골라야 함).
  const can = !!x.dest && !state.ask && !(x.dest.source === PC && !x.dest.parent);
  box.innerHTML = `<div class="fx-dest-h"><span id="fxDestTitle">${esc(destTitle(x.rows.length, x.mode))}</span><button type="button" class="mini" data-fx-dest-close aria-label="닫기">✕</button></div>`
    + recent + `<nav class="fx-dest-tree nx-tree" aria-label="받을 곳 폴더">${tree || waitHtml({rows: 3})}</nav>`
    + (state.ask ? askHtml(state.ask) : '')
    + `<div class="fx-dest-f"><span class="fx-dest-at">${x.dest ? esc(SOURCE_NAME[x.dest.source] + (x.dest.parent ? ' › ' + destNameOf(x.dest) : '')) : '받을 폴더를 고르세요'}</span>`
    + `<button type="button" class="fx-btn" data-fx-dest-mkdir${can ? '' : ' disabled'}>새 폴더</button><button type="button" class="fx-btn fx-pri" data-fx-dest-go${can ? '' : ' disabled'}>${esc(destButton(x.mode))}</button></div>`;
}
function pickDest(key, name) {
  const x = state.xfer, d = destOf(key);
  if (!x || !d || state.ask) return;
  x.dest = d;
  if (d.parent && name) x.names.set(key, name);
  x.open.add(key);
  fillFolder(d.source, d.parent);
  paintDest();
}
function toggleDest(key) {
  const x = state.xfer;
  if (!x) return;
  if (x.open.has(key)) x.open.delete(key); else { x.open.add(key); const d = destOf(key); if (d) fillFolder(d.source, d.parent); }
  paintDest();
  root.querySelector(`[data-fx-dest-twist="${CSS.escape(key)}"]`)?.focus({preventScroll: true});
}
async function destMkdir(anchor) {
  const x = state.xfer, d = x?.dest;
  if (!d) return;
  const v = await askText(anchor, {text: '새 폴더 이름', value: '', ok: '만들기', max: FILE_BASE_MAX});
  if (v === null || state.xfer !== x) return;
  const chk = checkFileBase(v);
  if (!chk.ok) { notify(chk.message, {error: true, record: false}); return; }
  if (d.source === PH) {
    const m = await phoneOp({op: 'mkdir', dir: d.parent || '', name: chk.base}, '폴더 만드는 중');
    if (!m?.path || state.xfer !== x) return;
    await loadChildren(PH, d.parent);
    x.open.add(destKey(d));
    pickDest(folderKey(PH, m.path), chk.base);
    return;
  }
  const r = await write('mkdir', {source: d.source, parent: d.parent, name: chk.base}, '폴더 만드는 중');
  const made = r?.changed?.[0];
  if (!made) return;
  await applyWrite(r, [folderKey(d.source, d.parent)]);
  if (state.xfer !== x) return;
  x.open.add(destKey(d));
  pickDest(folderKey(made.source, made.item_id), made.name);
}
// 같은 이름·큰 파일 묻기: 받을 곳 창이 열려 있으면 그 안, 아니면 하단바 위 작은 칸. 고른 값을 돌려준다({choice:'go'|'skip', all}).
function askHtml(a) {
  return `<div class="fx-ask" role="alertdialog" aria-labelledby="fxAskText"><p id="fxAskText"><b>${esc(a.name)}</b> — ${esc(a.text)}</p>`
    + (a.note ? `<p class="fx-ask-note">${esc(a.note)}</p>` : '')
    + `<div class="fx-ask-opts"><button type="button" class="fx-btn fx-pri" data-fx-ask="go">${esc(a.go)}</button><button type="button" class="fx-btn" data-fx-ask="skip">건너뛰기</button></div>`
    + (a.many ? '<label class="fx-ask-all"><input type="checkbox" data-fx-ask-all> 남은 것도 모두 같게</label>' : '') + '</div>';
}
function paintAsk() {
  const box = $('[data-fx-askbox]');
  if (!box) return;
  const show = !!state.ask && !state.xfer && !state.jobsOpen;
  box.hidden = !show; box.innerHTML = show ? askHtml(state.ask) : '';
  if (state.jobsOpen) paintJobs();
}
function ask(a) {
  return new Promise(resolve => {
    state.ask = {...a, all: false, resolve};
    paintDest(); paintAsk();
    root.querySelector('[data-fx-ask="go"]')?.focus({preventScroll: true});
  });
}
function answer(choice) {
  const a = state.ask;
  if (!a) return;
  const all = !!root.querySelector('[data-fx-ask-all]')?.checked;
  state.ask = null;
  a.resolve({choice, all});
  paintDest(); paintAsk();
}
// 폴더와 파일 나누기(S53-8): 폴더 중 보낼 수 없는 것(자기 안으로 등)은 한 줄로 알리고 뺀다. 파일은 그대로(각 길이 거른다).
function splitTree(rows, dest, mode) {
  const list = (rows || []).filter(Boolean), folders = list.filter(r => r.is_folder);
  const plan = xferPlan(folders, dest, mode);
  if (plan.blocked.length) notify(plan.blocked[0].reason, {error: true, record: false});
  return {files: list.filter(r => !r.is_folder), dirs: plan.ok};
}
// 받을 곳 창 [여기에 복사/옮기기].
async function destGo() {
  const x = state.xfer;
  if (!x?.dest || state.ask || state.run) return;
  const dest = x.dest, name = destNameOf(dest);
  const ran = await xferRun(x.mode, x.rows, dest, {inSheet: true});
  if (!ran) return;
  // '최근 보낸 곳'은 클라우드 폴더만 서버에 기억한다(폰·내 PC 폴더 경로는 서버로 보내지 않음).
  if (dest.source !== PH && dest.source !== PC) viewPrefs.set('files_dest_recent', pushRecentDest(recentDests(), dest, name), {rejectable: true});
}
// 보내기 한 번(복사·옮기기 공용): 막을 것 거르기 → 같은 이름 묻기(한 번, '남은 것도 모두 같게') → 200MB 넘는 것 묻기 → 차례로 보내며 전송 줄.
//   덮어쓰기는 없다: [그래도 하기]는 서버가 '이름 (2)'처럼 번호를 붙여 둘 다 둔다(공용 numberedName). 끝나면 한 줄 알림.
async function xferRun(mode, rows, dest, {inSheet = false} = {}) {
  if (state.run || state.busy) return false;
  if (pcStop(rows, dest)) return false;
  // 내 PC ↔ 클라우드(S52-41): 내 PC 파일은 문에서 읽어 올리기 길로, 클라우드 파일은 Edge media로 받아 문에 쓴다. 옮기기는 다 된 것만 원본 휴지통.
  //   S53-8 FILES-폴더째PC폰: 폴더는 폴더째 — 받는 쪽에 같은 폴더 모양을 만들고 안의 파일을 차례로(treeUp·treeDev). 파일은 지금 길 그대로.
  if (hasPc(rows) || dest?.source === PC) {
    if (inSheet) closeDest();
    P().picked.clear(); paintPicks();
    if (hasPc(rows) && dest?.source === PC) { await pcInPc(rows, dest, mode); return true; }
    const {files, dirs} = splitTree(rows, dest, mode);
    if (files.length) { if (hasPc(rows)) await pcToCloud(files, dest, mode); else await cloudToPc(files, dest, mode); }
    if (dirs.length) { if (hasPc(rows)) await treeUp(mode, dirs, dest); else await treeDev(mode, dirs, dest); }
    return true;
  }
  // 폰 → 클라우드: 폰 앱 안에서 원본을 읽어 올리기 길(upload_open, 같은 이름·200MB 묻기·전송 목록 그대로)로.
  //   클라우드 → 폰(3-③): Edge media로 받아 앱이 받을 폴더에 쓴다. S53-8: 폰 안끼리도(폰에서 읽어 받을 폴더에 새 파일로), 폴더는 폴더째.
  if (hasPhone(rows) || dest?.source === PH) {
    const okMode = mode === 'copy' || phoneMoveOk(rows, dest);
    const allPh = rows.every(r => r.source === PH);
    const up = okMode && dest?.source !== PH && allPh;
    const down = okMode && dest?.source === PH && (!hasPhone(rows) || allPh) && phoneWrite();
    if (!up && !down) { phoneStop(rows, dest); return false; }
    if (inSheet) closeDest();
    P().picked.clear(); paintPicks();
    const {files, dirs} = splitTree(rows, dest, mode);
    if (files.length) { if (up) await phoneToCloud(files, dest, mode); else await cloudToPhone(files, dest, mode); }
    if (dirs.length) { if (up) await treeUp(mode, dirs, dest); else await treeDev(mode, dirs, dest); }
    return true;
  }
  const plan = xferPlan(rows, dest, mode);
  if (!plan.ok.length) { notify(plan.reason, {error: true, record: false}); return false; }
  let destRows = [];
  try { const v = await rpc('app_cloud_list', {p_source: dest.source, p_parent_id: dest.parent}); destRows = Array.isArray(v) ? v : []; } catch { /* 모르면 묻지 않고 서버가 번호를 붙인다 */ }
  const verb = mode === 'move' ? '옮길까요' : '복사할까요';
  const same = new Set(sameNameRows(plan.ok, destRows).map(rowKey));
  const go = [], numbered = new Set(), bigGo = new Set(), sameSkip = [];
  let skipped = plan.blocked.length, sameAll = null, bigAll = null;
  const list = plan.ok;
  for (const r of list) {
    if (same.has(rowKey(r))) {
      let c = sameAll;
      if (!c) {
        const left = list.filter(y => same.has(rowKey(y))).length;
        const res = await ask({name: r.name, text: sameNameAsk(mode), go: '그래도 하기', many: left > 1});
        if (res.closed) return false;
        c = res.choice; if (res.all) sameAll = c;
      }
      if (c === 'skip') { skipped++; sameSkip.push(r); continue; }
      numbered.add(rowKey(r));
    }
    if (xferBig(r, dest)) {
      let c = bigAll;
      if (!c) {
        const res = await ask({name: r.name, text: bigAsk(r), note: XFER_BIG_HOW, go: '그래도 보내기', many: list.filter(y => xferBig(y, dest)).length > 1});
        if (res.closed) return false;
        c = res.choice; if (res.all) bigAll = c;
      }
      // [그래도 보내기]만 서버가 10MB 조각씩 이어 보낸다(2-②). [건너뛰기]는 보내지 않는다.
      if (c !== 'go') { skipped++; continue; }
      bigGo.add(rowKey(r));
    }
    go.push(r);
  }
  if (inSheet) closeDest();
  P().picked.clear(); paintPicks();
  if (plan.blocked.length) notify(plan.blocked[0].reason, {error: true, record: false});
  if (!go.length) { if (skipped) notify(xferDoneText(mode, {skipped}), {record: false}); return true; }
  // 복사·다른 저장소로 옮기기는 서버 작업표로(화면을 닫아도 서버가 잇는다). 같은 이름 [건너뛰기]도 '건너뜀' 줄로 남긴다.
  const scope = state.scope;
  const batch = mode === 'move' ? go.filter(r => r.source === dest.source) : [];
  // S52-43 ②: 원드라이브 ↔ 구글 드라이브 폴더는 화면이 펼쳐 넣는다(treeAcross). 나머지는 지금처럼 작업표·move.
  const trees = go.filter(r => r.is_folder && r.source !== dest.source);
  const toJobs = go.filter(r => !batch.includes(r) && !trees.includes(r));
  if (trees.length) {
    if (toJobs.length) {
      const items = toJobs.map(r => ({source: r.source, id: r.item_id, ...(numbered.has(rowKey(r)) ? {numbered: true} : {}), ...(bigGo.has(rowKey(r)) ? {big: true} : {})}));
      if (!(await addJobs(mode, dest, items)) || state.scope !== scope) return true;
    }
    await treeAcross(mode, trees, dest, {numbered, destRows, extra: toJobs.length});
    return true;
  }
  if (toJobs.length) {
    const skipRows = sameSkip.filter(r => mode === 'copy' || r.source !== dest.source);
    const items = [...toJobs.map(r => ({source: r.source, id: r.item_id, ...(numbered.has(rowKey(r)) ? {numbered: true} : {}), ...(bigGo.has(rowKey(r)) ? {big: true} : {})})),
      ...skipRows.map(r => ({source: r.source, id: r.item_id, skip: true}))];
    const ok = await addJobs(mode, dest, items);
    if (state.scope !== scope) return true;
    if (ok && !batch.length) { notify(`${toJobs.length}개 보내기 시작 · 아래 전송 줄을 누르면 목록`, {record: false}); return true; }
    if (!ok && !batch.length) return true;
  }
  if (!batch.length) return true;
  const run = state.run = {mode, total: batch.length, at: 1, done: 0, failed: 0, name: batch[0].name, code: '', pending: false};
  paintXfer();
  const call = async (action, body) => {
    try { return await rt().api(FN, {method: 'POST', body: {action, ...body, confirm: true}, singleFlight: false, timeoutMs: action === 'move' ? 60000 : 400000}); }
    catch (e) { run.code ||= codeOf(e); return null; }
  };
  try {
    // 같은 클라우드 안 옮기기는 move 한 번(200개씩, 남은 것은 이어서).
    let ids = batch.map(r => r.item_id);
    while (ids.length && state.scope === scope) {
      const d = await call('move', {source: dest.source, ids, to: dest.parent, ...(batch.some(r => numbered.has(rowKey(r))) ? {numbered: true} : {})});
      if (!d) { run.failed += ids.length; break; }
      await applyWrite(d, touchedFolders(batch, dest));
      const bad = (d.failed || []).length, left = Array.isArray(d.left) ? d.left : [];
      if (bad && !run.code) run.code = d.failed[0]?.error || '';
      run.failed += bad; run.done += ids.length - bad - left.length; run.at = Math.min(run.total, run.done + run.failed + 1);
      ids = left; paintXfer();
    }
  } finally {
    if (state.run === run) state.run = null;
    paintXfer(); paintBar();
  }
  if (state.scope !== scope) return true;
  const note = run.failed && run.code ? (run.code === 'kept_original' ? writeDoneText('across', {kept: true}) : writeErrorText(run.code))
    : run.code === 'kept_original' ? writeDoneText('across', {kept: true}) : run.pending ? '원드라이브가 마저 복사하는 중이에요. 끝나면 곧 목록에 보여요.' : '';
  // S51-20 ③: 같은 저장소 안 옮기기는 [되돌리기] — 옮긴 것을 원래 폴더로 다시 move(이름에 번호가 붙은 것은 빼고, 사람이 누른 것만).
  const back = mode === 'move' && run.done && !run.failed && !run.pending ? batch.filter(r => !numbered.has(rowKey(r))) : [];
  const undo = back.length ? async () => {
    const groups = new Map();
    for (const r of back) { const k = r.parent_id ?? ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
    for (const [parent, rows] of groups) {
      const d = await rt().api(FN, {method: 'POST', body: {action: 'move', source: dest.source, ids: rows.map(r => r.item_id), to: parent || null, confirm: true}, singleFlight: false, timeoutMs: 60000});
      await applyWrite(d, touchedFolders(rows, dest));
      if ((d?.failed || []).length) throw new Error(d.failed[0]?.error || 'move_failed');
    }
    return {status: 'restored'};
  } : null;
  notify(xferDoneText(mode, {done: run.done, failed: run.failed, skipped: toJobs.length ? 0 : skipped}), {error: !!run.failed, note, record: false, ...(undo ? {undo, label: `옮기기 ${back.length}개`} : {})});
  return true;
}
// ---------- 폴더째 다른 저장소로(S52-43 ② FILES-저장소사이, 원드라이브 ↔ 구글 드라이브) ----------
// 색인(app_cloud_list)으로 폴더 안을 끝까지 읽고 → 받을 곳에 같은 이름 폴더(같은 이름이면 [그래도 하기]를 고른 것만 '이름 (2)')와 안쪽 폴더를 차례로 만들고(mkdir)
// → 안의 파일을 폴더마다 전송 목록(job_add)에 넣는다(서버가 화면을 닫아도 잇고, 200MB 넘는 것은 한 번 물어 [그래도 보내기]만). 구글 문서·크기 모름은 건너뜀.
// 옮기기면 파일마다 서버가 맞춘 뒤 원본을 그 클라우드 휴지통으로 보낸다(지금 작업표 그대로). 원래 폴더는 빈 폴더로 남는다(한 줄 안내).
// S53-8 FILES-폴더째PC폰: 폴더 안 목록은 저장소마다 — 클라우드 = 색인, 내 PC = 바구니 문, 이 폰 = 앱 다리. 줄마다 _at = 그 줄이 든 폴더 id(읽은 자리).
const listIn = async (source, id) => {
  if (source === PC) return pc.list(id);
  if (source === PH) return phone.list(id);
  const v = await rpc('app_cloud_list', {p_source: source, p_parent_id: id});
  return Array.isArray(v) ? v : [];
};
async function treeWalk(f) {
  const folders = [], files = [];
  let wave = [f.item_id];
  while (wave.length) {
    const next = [];
    for (const id of wave) {
      for (const r of await listIn(f.source, id)) {
        if (!r || r.trashed) continue;
        if (r.is_folder) { folders.push({...r, _at: id}); next.push(r.item_id); } else files.push({...r, _at: id});
      }
      if (treeAcrossBig(files.length, folders.length)) return null;
    }
    wave = next;
  }
  return {folders, files};
}
async function treeMkdir(at, name) {
  const d = await rt().api(FN, {method: 'POST', body: {action: 'mkdir', source: at.source, parent: at.parent, name, confirm: true}, singleFlight: false, timeoutMs: 60000});
  const made = d?.changed?.[0];
  if (!made?.item_id) throw new Error('mkdir_failed');
  return made.item_id;
}
async function treeAcross(mode, folders, dest, {numbered = new Set(), destRows = [], extra = 0} = {}) {
  const scope = state.scope, taken = destRows.filter(d => d && !d.trashed).map(d => String(d.name));
  let doneFolders = 0, doneFiles = 0, skipped = 0;
  for (const f of folders) {
    let tree;
    state.busy = `'${f.name}' 폴더 안 파일 모으는 중`; paintBar();
    try { tree = await treeWalk(f); } catch (e) { tree = undefined; notify(`${f.name}: ${errorText(codeOf(e))}`, {error: true, record: false}); }
    finally { if (state.scope === scope) { state.busy = ''; paintBar(); } }
    if (state.scope !== scope) return;
    if (tree === undefined) { skipped++; continue; }
    if (tree === null) { notify(treeAcrossTooBigText(f.name), {error: true, record: false}); skipped++; continue; }
    // 받을 곳에서 보낼 수 없는 파일(구글 문서·크기 모름)은 건너뛰고, 200MB 넘는 것은 한 번 묻는다.
    const plan = xferPlan(tree.files, {source: dest.source, parent: '_'}, 'copy');
    skipped += plan.blocked.length;
    const bigs = plan.ok.filter(r => xferBig(r, dest));
    let bigOk = false;
    if (bigs.length) {
      const res = await ask({name: f.name, text: treeBigAsk(bigs.length), note: XFER_BIG_HOW, go: '그래도 보내기'});
      if (res.closed) return;
      bigOk = res.choice === 'go';
      if (!bigOk) skipped += bigs.length;
    }
    const send = plan.ok.filter(r => bigOk || !xferBig(r, dest));
    const name = numbered.has(rowKey(f)) ? numberedName(f.name, taken) : f.name;
    taken.push(name);
    const map = new Map();
    state.busy = `'${name}' 폴더 만드는 중`; paintBar();
    try {
      map.set(f.item_id, await treeMkdir(dest, name));
      // 부모가 먼저 오도록(treeWalk가 바깥부터 읽음) 차례로 만든다.
      for (const sub of tree.folders) map.set(sub.item_id, await treeMkdir({source: dest.source, parent: map.get(sub._at)}, sub.name));
    } catch (e) {
      if (state.scope === scope) notify(`${f.name}: ${writeErrorText(codeOf(e))}`, {error: true, record: false});
      skipped++;
      continue;
    } finally { if (state.scope === scope) { state.busy = ''; paintBar(); } }
    if (state.scope !== scope) return;
    doneFolders++;
    const groups = new Map();
    for (const r of send) { const at = map.get(r._at); if (!at) { skipped++; continue; } if (!groups.has(at)) groups.set(at, []); groups.get(at).push(r); }
    for (const [parent, rows] of groups) {
      const ok = await addJobs(mode, {source: dest.source, parent}, rows.map(r => ({source: r.source, id: r.item_id, ...(bigOk && xferBig(r, dest) ? {big: true} : {})})));
      if (state.scope !== scope) return;
      if (ok) doneFiles += rows.length; else skipped += rows.length;
    }
  }
  if (state.scope !== scope) return;
  // 받을 폴더 목록·나무를 다시 읽는다(만든 폴더가 보이게).
  await applyWrite({changed: [], removed: []}, [folderKey(dest.source, dest.parent)]);
  for (const p of panesOn()) if (p.where?.source === dest.source && (p.where.parent || null) === (dest.parent || null) && !p.query) await loadList(p, {quiet: true});
  if (!doneFolders) return;
  notify(treeDoneText(mode, {folders: doneFolders, files: doneFiles + extra, skipped}), {record: false, ...(mode === 'move' ? {note: TREE_MOVE_NOTE} : {})});
}
// ---------- 폴더째 내 PC·이 폰과(S53-8 FILES-폴더째PC폰, S52-43 ② 저장소사이와 같은 방식) ----------
// 받는 쪽에 같은 폴더 모양을 먼저 만들고(클라우드 = mkdir, 내 PC = 바구니 문 mkdir(0.5.0+), 이 폰 = 앱 mkdir) 안의 파일을 차례로 보낸다.
//   기기(내 PC·이 폰·바탕화면에서 끌어 놓은 폴더) → 클라우드(treeUp): 안의 파일을 올리기 길(upload_open → 전송 목록·올리는 중 표시)에 차례로 넣는다.
//     바이트는 그 파일을 보낼 차례가 되어서야 읽는다(upStub — 폴더째여도 화면 메모리에 한꺼번에 쥐지 않음).
//   클라우드·기기 → 기기(treeDev): 하나씩 받아 그 기기에 쓴다(전송 줄 state.run). 내 PC 안끼리는 문이 복사(pc.copy).
// 옮기기: 안의 파일이 하나도 빠짐없이 다 복사된 뒤에만 원본 파일을 그 저장소 휴지통으로(중간에 하나라도 못 하면 원본 그대로, 한 줄 알림).
//   원래 폴더는 빈 폴더로 남는다(저장소사이와 같게). 같은 이름 폴더가 받을 곳에 있으면 한 번 묻고 [그래도 하기]면 '이름 (2)'.
// 한도(폴더 하나에 파일 500개·폴더 100개, 기기에서 읽거나 기기로 받는 한 파일 1GB)를 넘으면 자르지 않고 한 줄로 알린다. 폰 쓰기 권한이 없으면 권한 안내.
// 파일 이름·경로는 서버·로그에 남기지 않는다(목록·바이트는 화면 메모리에서만 — 지금 PC·폰 길 그대로).
const DROP = 'drop';
const devWhere = source => (source === PC ? '내 PC' : source === PH ? '폰' : SOURCE_NAME[source] || '');
const treeErr = e => {
  if (e?.phoneWrite) return phoneWriteText(e.phoneWrite, {del: phone.state.del === true});
  const c = codeOf(e);
  return /^(pc|phone)_/.test(c) ? errorText(c) : writeErrorText(c);
};
// 바탕화면에서 끌어 놓은 폴더(브라우저 FileSystemEntry): 안을 끝까지 읽어 같은 모양 줄로. 파일 손잡이는 이 탭 메모리에만.
const entryFile = e => new Promise((res, rej) => e.file(res, rej));
async function entryKids(e) {
  const rd = e.createReader(), out = [];
  for (;;) {
    const part = await new Promise((res, rej) => rd.readEntries(res, rej));
    if (!part.length) return out;
    out.push(...part);
  }
}
async function dropWalk(entry) {
  const folders = [], files = [];
  let wave = [entry];
  while (wave.length) {
    const next = [];
    for (const d of wave) {
      for (const e of await entryKids(d)) {
        if (e.isDirectory) { folders.push({source: DROP, item_id: e.fullPath, name: e.name, is_folder: true, _at: d.fullPath}); next.push(e); }
        else if (e.isFile) {
          const file = await entryFile(e);
          files.push({source: DROP, item_id: e.fullPath, name: file.name, is_folder: false, size_bytes: file.size, mime: file.type || '', file, _at: d.fullPath});
        }
        if (treeAcrossBig(files.length, folders.length)) return null;
      }
    }
    wave = next;
  }
  return {folders, files};
}
// 받을 곳에 같은 이름 폴더가 있으면 한 번 묻기('남은 것도 모두 같게'). 답 null = 창을 닫음.
async function askSameFolders(folders, destRows, mode) {
  const same = new Set(sameNameRows(folders, destRows).map(rowKey)), numbered = new Set(), go = [];
  let sameAll = null, skipped = 0;
  for (const f of folders) {
    if (same.has(rowKey(f))) {
      let c = sameAll;
      if (!c) {
        const res = await ask({name: f.name, text: sameNameAsk(mode), go: '그래도 하기', many: folders.filter(y => same.has(rowKey(y))).length > 1});
        if (res.closed) return null;
        c = res.choice; if (res.all) sameAll = c;
      }
      if (c === 'skip') { skipped++; continue; }
      numbered.add(rowKey(f));
    }
    go.push(f);
  }
  return {go, numbered, skipped};
}
async function treeRead(f, scope) {
  state.busy = `'${f.name}' 폴더 안 파일 모으는 중`; paintBar();
  try { return f.source === DROP ? await dropWalk(f.entry) : await treeWalk(f); }
  catch (e) { if (state.scope === scope) notify(`${f.name}: ${errorText(codeOf(e))}`, {error: true, record: false}); return undefined; }
  finally { if (state.scope === scope) { state.busy = ''; paintBar(); } }
}
// 받을 기기에 폴더 하나 만들기 → 새 폴더 id(경로).
async function devMkdir(at, name) {
  if (at.source === PC) return pc.mkdir(at.parent, name);
  if (at.source === PH) {
    const d = await phone.op({op: 'mkdir', dir: at.parent || '', name});
    if (!d?.ok || !d.path) throw Object.assign(new Error('phone_write'), {phoneWrite: d?.error || 'write'});
    return d.path;
  }
  return treeMkdir(at, name);
}
// 파일 하나를 기기 폴더(dir)에 쓰기. 내 PC 안끼리는 문이 복사, 그 밖은 바이트를 받아 새 파일로(새로 만든 폴더라 같은 이름 없음).
async function devPut(r, to, dir) {
  if (r.source === PC && to === PC) return pc.copy(r.item_id, dir);
  const blob = await rowBlob(r, 'media');
  if (to === PC) return pc.save(dir, r.name, blob);
  const res = await phone.save(dir, r.name, blob);
  if (!res.ok) throw Object.assign(new Error('phone_write'), {phoneWrite: res.error});
}
// 옮기기 뒤 원본 파일을 그 저장소 휴지통으로. 답 = 못 보낸 개수(원본이 남음). 이 폰은 앱이 한 번에 50개까지(안드로이드 확인 창).
async function trashOriginals(source, rows) {
  if (!rows.length) return 0;
  if (SOURCES.includes(source)) return trashLanded(rows);
  let bad = 0;
  if (source === PC) { for (const r of rows) { try { await pc.trash(r.item_id); } catch { bad++; } } return bad; }
  const parts = [];
  for (const r of rows) {
    const last = parts.at(-1);
    if (last && last.length < 50 && JSON.stringify(last).length + r.item_id.length < 30000) last.push(r.item_id); else parts.push([r.item_id]);
  }
  for (const paths of parts) {
    const d = await phone.op({op: 'trash', paths});
    bad += paths.length - (d?.ok ? Math.min(paths.length, Number(d.count) || 0) : 0);
  }
  return bad;
}
// 클라우드·기기 폴더 → 기기(내 PC·이 폰) 폴더. asked = 같은 이름을 이미 물었으면 {numbered}(내 PC 안 옮기기가 다른 드라이브라 여기로 넘긴 것).
async function treeDev(mode, folders, dest, {asked = null} = {}) {
  const where = devWhere(dest.source);
  if (dest.source === PC && !pcEdit()) { notify(PC_WRITE_LATER_TEXT, {record: false}); return; }
  if (dest.source === PH && !phoneWrite()) { notify(phoneOn() && phone.state.all ? PHONE_OLD_APP_TEXT : phoneWriteText('permission'), {record: false}); return; }
  let destRows = [];
  try { destRows = await listIn(dest.source, dest.parent); } catch { /* 모르면 묻지 않는다: 같은 이름이면 폴더 만들기에서 못 함 */ }
  const pick = asked ? {go: folders, numbered: asked.numbered || new Set(), skipped: 0} : await askSameFolders(folders, destRows, mode);
  if (!pick) return;
  const scope = state.scope, taken = destRows.filter(d => d && !d.trashed).map(d => String(d.name));
  for (const f of pick.go) {
    const tree = await treeRead(f, scope);
    if (state.scope !== scope) return;
    if (tree === undefined) continue;
    if (tree === null) { notify(treeAcrossTooBigText(f.name), {error: true, record: false}); continue; }
    const sameDev = f.source === PC && dest.source === PC;
    // 보낼 수 없는 파일(구글 문서·크기 모름)·한 파일 1GB 넘는 것은 건너뛰고 한 줄로 알린다(몰래 자르지 않음).
    const plan = xferPlan(tree.files, {source: dest.source, parent: '_'}, 'copy');
    const big = plan.ok.filter(r => !sameDev && Number(r.size_bytes) > PC_FILE_MAX);
    if (big.length) notify(`${f.name}: 한 파일 1GB가 넘는 ${big.length}개는 ${where}로 받지 않아요`, {error: true, record: false});
    else if (plan.blocked.length) notify(`${f.name}: ${plan.blocked[0].reason} (${plan.blocked.length}개 건너뜀)`, {error: true, record: false});
    const send = plan.ok.filter(r => !big.includes(r)), fileSkip = plan.blocked.length + big.length;
    const name = pick.numbered.has(rowKey(f)) ? numberedName(f.name, taken) : f.name;
    taken.push(name);
    const map = new Map();
    state.busy = `'${name}' 폴더 만드는 중`; paintBar();
    try {
      map.set(f.item_id, await devMkdir(dest, name));
      for (const sub of tree.folders) map.set(sub.item_id, await devMkdir({source: dest.source, parent: map.get(sub._at)}, sub.name));
    } catch (e) {
      if (state.scope === scope) notify(`${f.name}: ${treeErr(e)}`, {error: true, record: false});
      continue;
    } finally { if (state.scope === scope) { state.busy = ''; paintBar(); } }
    if (state.scope !== scope) return;
    const landed = [];
    let failed = 0, code = '';
    if (send.length) {
      const run = state.run = {mode, total: send.length, at: 1, done: 0, failed: 0, name: send[0].name, code: '', pending: false};
      paintXfer();
      try {
        for (const r of send) {
          run.name = r.name; run.at = run.done + run.failed + 1; paintXfer();
          try { await devPut(r, dest.source, map.get(r._at)); run.done++; landed.push(r); }
          catch (e) { run.failed++; run.code ||= e?.phoneWrite ? 'w:' + e.phoneWrite : codeOf(e); }
          if (state.scope !== scope) return;
        }
      } finally {
        if (state.run === run) state.run = null;
        paintXfer(); paintBar();
      }
      failed = run.failed; code = run.code;
    }
    await phoneRefresh([dest.parent], {source: dest.source});
    // 옮기기: 하나도 빠짐없이 다 받았을 때만 원본 파일을 휴지통으로(원래 폴더는 빈 폴더로 남음).
    let kept = 0;
    const keptAll = mode === 'move' && failed > 0;
    if (mode === 'move' && !failed && landed.length) {
      kept = await trashOriginals(f.source, landed);
      if (!SOURCES.includes(f.source)) await phoneRefresh([...new Set(landed.map(r => r._at))], {source: f.source, gone: landed.map(rowKey)});
    }
    const why = code ? (code.startsWith('w:') ? phoneWriteText(code.slice(2), {del: phone.state.del === true}) : errorText(code)) : '';
    const note = keptAll ? treeDevKeptText(devWhere(f.source)) : kept ? `${kept}개는 받았지만 원본을 휴지통으로 보내지 못해 그대로 있어요` : failed ? why : mode === 'move' ? TREE_DEV_MOVE_NOTE : '';
    notify(`${name}: ${treeDevDoneText(keptAll ? 'copy' : mode, {folders: 1 + tree.folders.length, files: landed.length, failed, skipped: fileSkip})}`,
      {error: !!failed || !!kept, note: [why && keptAll ? why : '', note].filter(Boolean).join(' · '), record: false});
  }
  if (pick.skipped && !pick.go.length) notify(xferDoneText(mode, {skipped: pick.skipped}), {record: false});
}
// 기기 파일 줄 → 올리기 길의 파일. 끌어 놓은 파일은 그 손잡이 그대로, 내 PC·이 폰은 보낼 차례에 읽는다(load).
const upStub = r => r.file || {name: r.name, size: Number(r.size_bytes), type: r.mime || '', lastModified: Date.parse(r.modified_at || '') || Date.now(),
  load: async () => { const b = await rowBlob(r, 'media'); return new File([b], r.name, {type: r.mime || b.type || '', lastModified: Date.parse(r.modified_at || '') || Date.now()}); }};
// 내 PC·이 폰·끌어 놓은 폴더 → 클라우드 폴더.
async function treeUp(mode, folders, dest) {
  if (!dest?.source || !SOURCES.includes(dest.source)) return;
  let destRows = [];
  try { destRows = await listIn(dest.source, dest.parent); } catch { /* 모르면 묻지 않는다: 같은 이름이면 서버가 번호를 붙인다 */ }
  const pick = await askSameFolders(folders, destRows, mode);
  if (!pick) return;
  const scope = state.scope, taken = destRows.filter(d => d && !d.trashed).map(d => String(d.name));
  let doneFolders = 0, doneFiles = 0, skipped = pick.skipped;
  for (const f of pick.go) {
    const drop = f.source === DROP, tree = await treeRead(f, scope);
    if (state.scope !== scope) return;
    if (tree === undefined) { skipped++; continue; }
    if (tree === null) { notify(treeAcrossTooBigText(f.name), {error: true, record: false}); skipped++; continue; }
    // 보낼 수 없는 파일: 크기 모름·쓸 수 없는 이름·한 파일 한도(기기에서 읽는 것 1GB, 끌어 놓은 파일 2GB). 건너뛰고 한 줄로.
    const max = drop ? UPLOAD_MAX_BYTES : PC_FILE_MAX;
    const bad = tree.files.filter(r => !Number.isSafeInteger(Number(r.size_bytes ?? NaN)) || Number(r.size_bytes) > max || !checkFileBase(String(r.name || '')).ok);
    if (bad.length) notify(`${f.name}: ${bad.length}개는 보내지 않아요(크기를 모르거나 한 파일 ${drop ? '2GB' : '1GB'}가 넘거나 쓸 수 없는 이름)`, {error: true, record: false});
    skipped += bad.length;
    let send = tree.files.filter(r => !bad.includes(r));
    const bigs = send.filter(r => upBig({size: r.size_bytes}));
    if (bigs.length) {
      const res = await ask({name: f.name, text: treeBigAsk(bigs.length), note: UPLOAD_BIG_HOW, go: '그래도 올리기'});
      if (res.closed) return;
      if (res.choice !== 'go') { skipped += bigs.length; send = send.filter(r => !bigs.includes(r)); }
    }
    const name = pick.numbered.has(rowKey(f)) ? numberedName(f.name, taken) : f.name;
    taken.push(name);
    const map = new Map();
    state.busy = `'${name}' 폴더 만드는 중`; paintBar();
    try {
      map.set(f.item_id, await treeMkdir(dest, name));
      for (const sub of tree.folders) map.set(sub.item_id, await treeMkdir({source: dest.source, parent: map.get(sub._at)}, sub.name));
    } catch (e) {
      if (state.scope === scope) notify(`${f.name}: ${writeErrorText(codeOf(e))}`, {error: true, record: false});
      skipped++;
      continue;
    } finally { if (state.scope === scope) { state.busy = ''; paintBar(); } }
    if (state.scope !== scope) return;
    doneFolders++;
    // 옮기기 묶음: 이 폴더 안 줄이 모두 서버에서 맞춰진 뒤(upload_done)에만 원본을 휴지통으로(groupGone). 끌어 놓은 폴더는 옮기기가 없다.
    const group = mode === 'move' && !drop ? {source: f.source, left: new Set(), rows: [], failed: false, sealed: false, warned: false, trashed: false} : null;
    const groups = new Map();
    for (const r of send) { const at = map.get(r._at); if (!at) { skipped++; if (group) group.failed = true; continue; } if (!groups.has(at)) groups.set(at, []); groups.get(at).push(r); }
    for (const [parent, rows] of groups) {
      const n = await openUploads(rows.map(upStub), {source: dest.source, parent}, {group, rows});
      if (state.scope !== scope) return;
      doneFiles += n; skipped += rows.length - n;
    }
    if (group) { group.sealed = true; groupGone(group); }
  }
  if (state.scope !== scope) return;
  await applyWrite({changed: [], removed: []}, [folderKey(dest.source, dest.parent)]);
  for (const p of panesOn()) if (p.where?.source === dest.source && (p.where.parent || null) === (dest.parent || null) && !p.query) await loadList(p, {quiet: true});
  if (doneFolders) notify(treeDoneText(mode, {folders: doneFolders, files: doneFiles, skipped}), {record: false, ...(mode === 'move' ? {note: TREE_DEV_MOVE_NOTE} : {})});
  else if (skipped && !pick.go.length) notify(xferDoneText(mode, {skipped}), {record: false});
  if (doneFiles) upPump();
}
// 옮기기 묶음 하나가 다 끝났나: 모두 맞춰졌으면 원본 파일을 그 기기 휴지통으로, 하나라도 못 했으면 원본 그대로(한 번 알림).
async function groupGone(g) {
  if (!g.sealed || g.left.size || g.trashed) return;
  if (g.failed) {
    if (!g.warned) { g.warned = true; notify(treeDevKeptText(devWhere(g.source)), {error: true, record: false}); }
    return;
  }
  g.trashed = true;
  if (!g.rows.length) return;
  let bad = g.rows.length;
  try { bad = await trashOriginals(g.source, g.rows); } catch { /* 아래 한 줄 */ }
  await phoneRefresh([...new Set(g.rows.map(r => r._at))], {source: g.source, gone: g.rows.map(rowKey)});
  if (bad) notify(`올렸지만 ${devWhere(g.source)} 원본 ${bad}개는 휴지통으로 보내지 못했어요`, {error: true, record: false});
}
// 전송 줄(하단바 위): 같은 저장소 안 옮기기(state.run, 화면이 직접)가 먼저, 아니면 서버 작업표 묶음(jobStrip). 누르면 전송 목록.
function paintXfer() {
  const box = $('[data-fx-xfer]');
  if (!box) return;
  const r = state.run, s = r ? null : jobStrip(state.jobs);
  const on = !!(r || s) && !state.jobsOpen;
  box.hidden = !on;
  root.classList.toggle('fx-xfer-on', on);
  if (!on) { box.innerHTML = ''; return; }
  if (r) { box.innerHTML = `<span class="fx-xfer-bar" style="width:${xferPercent(r.done + r.failed, r.total)}%"></span><span aria-hidden="true">↗</span><b>${esc(xferLine(r.at, r.total))}</b><span class="fx-xfer-nm">${esc(r.name)}</span>`; return; }
  box.innerHTML = `<span class="fx-xfer-bar" style="width:${s.percent}%"></span><button type="button" class="fx-xfer-go" data-fx-jobs-open aria-haspopup="dialog">`
    + `<span aria-hidden="true">↗</span><b>${esc(s.text)}</b>${s.name ? `<span class="fx-xfer-nm">${esc(s.name)}</span>` : '<span class="fx-xfer-nm"></span>'}`
    + `${s.paused || !s.percent ? '' : `<span class="fx-xfer-pc">${s.percent}%</span>`}<span class="fx-xfer-open">목록 ▸</span></button>`;
}

// ---------- 전송 목록(서버 작업표) ----------
async function loadJobs() {
  clearTimeout(jobTimer);
  const scope = state.scope;
  try {
    const d = await edge('job_list');
    if (state.scope !== scope) return;
    setJobs(mergeJobs([], Array.isArray(d?.jobs) ? d.jobs : []));
  } catch { if (state.scope === scope) scheduleJobs(); /* 표가 아직 없거나 잠시 실패: 이번엔 그대로 */ }
}
function scheduleJobs() {
  clearTimeout(jobTimer);
  if (jobsActive(state.jobs) && visible()) jobTimer = setTimeout(loadJobs, JOB_POLL_MS);
}
function setJobs(list) {
  // 기기 줄(올리기)은 이 탭이 보내는 것만 '보내는 중·기다림'. 다른 탭·닫힌 화면 것은 멈춤으로 본다(H-6, 다시 고르면 이어 올림).
  list = list.map(j => (j?.origin === 'device' && !upOurs(j.id) ? deviceJobOnReopen(j) : j));
  const finished = newlyDone(state.jobs, list), wasActive = state.jobsWere;
  state.jobs = list;
  state.jobsWere = jobsActive(list);
  // 이번 묶음 = 이 화면에서 '보내는 중'으로 본 줄들. 묶음이 다 끝나면(보내는 중 → 없음) 그 줄들만 세어 한 줄 알림.
  for (const j of list) if (j.status === 'queued' || j.status === 'running') jobsSeen.add(j.id);
  paintXfer(); paintJobs();
  scheduleJobs();
  if (finished.length) jobsLanded(finished);
  if (wasActive && !state.jobsWere) {
    const s = list.filter(j => jobsSeen.has(j.id));
    jobsSeen.clear();
    const done = s.filter(j => j.status === 'done').length, failed = s.filter(j => j.status === 'failed').length;
    if (done || failed) notify(failed ? `${done ? done + '개 보냄 · ' : ''}${failed}개 못 보냄 · 전송 목록에서 까닭과 [다시]` : `${done}개 보냄`, {error: !!failed, record: false});
  }
}
// 끝난 줄: 받은 곳(·옮기기면 원래 곳) 폴더를 색인에서 다시 읽는다(서버가 끝낼 때 색인에 넣었다).
async function jobsLanded(list) {
  for (const j of list) {
    for (const [source, parent] of [[j.dest_source, j.dest_parent], ...(j.kind === 'move' ? [[j.src_source, null]] : [])]) {
      if (state.children.has(folderKey(source, parent))) loadChildren(source, parent);
    }
  }
  await Promise.all(panesOn().filter(p => p.loaded && !p.query).map(p => loadList(p, {quiet: true})));
}
async function addJobs(mode, dest, items) {
  const scope = state.scope;
  state.jobsBusy = true; paintBar();
  try {
    let made = [];
    for (let i = 0; i < items.length; i += 200) {
      const d = await rt().api(FN, {method: 'POST', body: {action: 'job_add', confirm: true, kind: mode, to_source: dest.source, to: dest.parent, items: items.slice(i, i + 200)}, singleFlight: false, timeoutMs: 60000});
      made = made.concat(Array.isArray(d?.jobs) ? d.jobs : []);
    }
    if (state.scope !== scope) return false;
    setJobs(mergeJobs(state.jobs, made));
    setTimeout(() => { if (state.scope === scope) loadJobs(); }, 600);
    return true;
  } catch (e) {
    if (state.scope === scope) notify(writeErrorText(codeOf(e)), {error: true, record: false});
    return false;
  } finally { if (state.scope === scope) { state.jobsBusy = false; paintBar(); } }
}
async function jobsDo(action, ids) {
  const scope = state.scope;
  // 올리기 줄을 멈추면 이 탭이 보내던 조각도 그 자리에서 멈춘다(파일은 쥐고 있어 [이어 올리기]는 다시 고르지 않음).
  if (action === 'job_pause') {
    const hit = id => !ids || ids.includes(id);
    up.queue = up.queue.filter(q => !hit(q.id));
    if (up.cur && hit(up.cur.id)) up.cur.ctrl.abort();
  }
  try {
    const d = await rt().api(FN, {method: 'POST', body: {action, confirm: true, ...(ids ? {ids} : {all: true})}, singleFlight: false, timeoutMs: 30000});
    if (state.scope !== scope) return;
    setJobs(mergeJobs(state.jobs, Array.isArray(d?.jobs) ? d.jobs : []));
    if (action === 'job_resume') setTimeout(() => { if (state.scope === scope) loadJobs(); }, 600);
  } catch (e) { if (state.scope === scope) notify(writeErrorText(codeOf(e)), {error: true, record: false}); }
}
function openJobs() {
  state.jobsOpen = true;
  jobsLayer ||= window.KPTURouter?.layer?.open('files-jobs', {reopen: () => { state.jobsOpen = true; paintJobs(); paintXfer(); paintAsk(); }, close: () => { jobsLayer = null; state.jobsOpen = false; paintJobs(); paintXfer(); paintAsk(); return true; }}) || null;
  paintJobs(); paintXfer(); paintAsk();
  loadJobs();
  $('[data-fx-jobs] [data-fx-jobs-close]')?.focus({preventScroll: true});
}
function closeJobs() { const l = jobsLayer; jobsLayer = null; state.jobsOpen = false; paintJobs(); paintXfer(); paintAsk(); l?.close(); }
const JOB_BTN = {pause: '멈춤', resume: '이어 하기', retry: '다시', reup: '이어 올리기'};
function jobRowHtml(j) {
  const act = jobAction(j), pc = jobPercent(j), hint = deviceHint(j, upFiles.has(j.id));
  const bar = j.status === 'running' || (j.status === 'paused' && j.sent_bytes > 0) ? `<span class="fx-job-pg" aria-hidden="true"><i style="width:${pc}%"></i></span>` : '';
  const kr = {is_folder: j.is_folder, name: j.name, mime: ''};
  return `<li class="fx-job fx-job-${esc(j.status)}" data-fx-job="${esc(j.id)}"><span class="fx-ico" data-kind="${kindOf(kr)}" aria-hidden="true">${kindIco(kr)}</span>`
    + `<span class="fx-job-t"><span class="fx-job-nm">${esc(j.name)}</span><small>${esc([jobLine(j), hint].filter(Boolean).join(' · '))}</small>${bar}</span>`
    + `<span class="fx-job-st">${esc(jobStatusText(j))}</span>`
    + (act ? `<button type="button" class="mini" data-fx-job-act="${act}" data-fx-job-id="${esc(j.id)}">${JOB_BTN[act]}</button>` : '') + '</li>';
}
function paintJobs() {
  const box = $('[data-fx-jobs]');
  if (!box) return;
  if (!state.jobsOpen) { box.hidden = true; box.innerHTML = ''; root.classList.remove('fx-jobs-open'); return; }
  box.hidden = false; root.classList.add('fx-jobs-open');
  const list = state.jobs, active = jobsActive(list), paused = list.some(j => j.status === 'paused' && j.origin !== 'device');
  const all = active ? '<button type="button" class="mini" data-fx-jobs-all="pause">모두 멈춤</button>' : paused ? '<button type="button" class="mini" data-fx-jobs-all="resume">모두 이어 하기</button>' : '';
  const asking = state.ask && !state.xfer ? askHtml(state.ask) : '';
  // 2초마다 다시 그려도 누르던 단추의 포커스를 잃지 않게(키보드·화면 읽기).
  const f = document.activeElement, keep = f && box.contains(f) ? ['data-fx-job-id', 'data-fx-job-act', 'data-fx-jobs-all', 'data-fx-jobs-close', 'data-fx-ask']
    .filter(n => f.hasAttribute(n)).map(n => `[${n}="${CSS.escape(f.getAttribute(n))}"]`).join('') : '';
  box.innerHTML = `<div class="fx-jobs-h"><span id="fxJobsTitle">${esc(jobsTitle(list))}</span>${all}<button type="button" class="mini" data-fx-jobs-close aria-label="닫기">✕</button></div>${asking}`
    + (list.length ? `<ul class="fx-jobs-list">${list.map(jobRowHtml).join('')}</ul>` : '<p class="fx-jobs-none">보낸 것이 없어요(하루 지난 것은 지워져요).</p>');
  if (keep) (box.querySelector(keep) || box.querySelector('[data-fx-jobs-close]'))?.focus({preventScroll: true});
}
// ---------- FILES-자료실로보내기(S52-26, 요청함 11/07 11:37, 시안 docs/design/mockups/files-to-library.html, 명진 11:41 '(가) 연결만') ----------
// 파일 ⋯ · 미리보기 · 여러 개 고른 줄의 [자료실로] → 자료실 등록 창(library-upload.js, 같은 칸·같은 [등록]·같은 막대·%)에 그 파일들을 넣어 연다.
// 원본은 그대로. 원드라이브·이 폰 파일은 이 화면이 바이트를 받아(원드라이브는 Edge media, 폰은 앱 다리) 자료실 Drive 폴더에 사본으로 올리고,
// 구글 드라이브 파일은 사본 없이 연결만(서버 document-actions register-drive-file이 이 작업공간 [파일] 색인·Drive 원본을 확인).
// 이미 자료실에 있는 파일은 넣지 않고 '이미 자료실에 있어요 · [보기]'.
// S53-8 ②: 폴더째 — 안의 파일(하위 폴더까지)을 모아 같은 길로(이미 있는 것은 건너뜀). 폴더 하나에 50개·합쳐 1GB까지, 넘으면 자르지 않고 한 줄.
//   내 PC 파일·폴더도(바구니 문 0.4.0+ — 문에서 읽어 사본으로).
// 새 버튼은 공용 6가지 중 작은 버튼(secondary, UI-버튼6가지)만 쓴다.
const TOLIB_BTN = '<button type="button" class="secondary" data-fx-tolib>자료실로</button>';
const LIBRARY_MAX_BYTES = 100 * 1024 * 1024;
function openLibraryDoc(id) { if (!id) return; requestLibraryDocument(id); window.KPTURouter?.go?.('library', {source: 'delegated'}); }
async function libraryReady() {
  const loader = window.KPTUViewLoader;
  if (loader?.load && !loader.isLoaded?.('library')) await loader.load('library');
  return !!(await window.__KPTU_LIBRARY_UPLOAD_READY__) && typeof window.KPTULibrary?.startUploadFromFiles === 'function';
}
async function sendToLibrary(rows) {
  const list = (rows || []).filter(Boolean), scope = state.scope;
  const pcOk = r => r.source !== PC || pc.canXfer;
  if (!list.every(pcOk)) notify('바구니 PC 앱을 새 판(0.4.0)으로 올리면 내 PC 파일도 자료실로 보내요', {record: false});
  const files = list.filter(r => !r.is_folder && pcOk(r));
  for (const f of list.filter(r => r.is_folder && pcOk(r))) {
    const tree = await treeRead(f, scope);
    if (state.scope !== scope) return;
    if (tree === undefined) continue;
    const bytesOf = t => t.files.reduce((n, r) => n + (r.source === 'gd' ? 0 : Number(r.size_bytes) || 0), 0);
    if (tree === null || tree.files.length > LIB_TREE_MAX || bytesOf(tree) > LIB_TREE_BYTES) { notify(libTreeTooBigText(f.name), {error: true, record: false}); continue; }
    if (!tree.files.length) { notify(`${f.name}: 폴더 안에 보낼 파일이 없어요`, {record: false}); continue; }
    files.push(...tree.files);
  }
  if (!files.length) return;
  const big = files.filter(r => r.source !== 'gd' && Number(r.size_bytes) > LIBRARY_MAX_BYTES);
  if (big.length) notify(`자료실은 파일당 100MB까지예요: ${big.map(r => r.name).join(', ')}`, {error: true, record: false});
  const had = files.filter(r => r.library_doc_id), rest = files.filter(r => !r.library_doc_id && !big.includes(r));
  const items = [];
  const copies = rest.filter(r => r.source !== 'gd');
  if (copies.length) { state.busy = '자료실로 보낼 파일 가져오는 중'; paintBar(); }
  try {
    for (const r of rest) {
      if (r.source === 'gd') { items.push({link: {source: 'gd', id: r.item_id}, name: r.name, size: Number(r.size_bytes) || 0, type: r.mime || ''}); continue; }
      try {
        const blob = await rowBlob(r, 'media'); // 이 폰 = 앱 다리, 내 PC = 바구니 문, 원드라이브 = Edge media
        items.push(new File([blob], r.name, {type: r.mime || blob.type || '', lastModified: Date.parse(r.modified_at || '') || Date.now()}));
      } catch (e) { notify(`${r.name}: ${errorText(codeOf(e))}`, {error: true, record: false}); }
      if (state.scope !== scope) return;
    }
  } finally { if (state.scope === scope && copies.length) { state.busy = ''; paintBar(); } }
  let out = {opened: false, already: []};
  if (items.length) {
    let ready = false;
    try { ready = await libraryReady(); } catch { ready = false; }
    if (state.scope !== scope) return;
    if (!ready) { notify('자료실을 열지 못했어요. 잠시 뒤 다시 해 주세요.', {error: true, record: false}); return; }
    out = window.KPTULibrary.startUploadFromFiles(items) || out;
  }
  const already = [...had.map(r => ({name: r.name, id: r.library_doc_id})), ...(out.already || [])];
  if (already.length) {
    const one = already.length === 1 ? already[0] : null;
    notify(one ? `이미 자료실에 있어요 · ${one.name}` : `${already.length}개는 이미 자료실에 있어요`, {record: false, ...(one ? {actions: [{label: '보기', run: ({close}) => { close(); openLibraryDoc(one.id); }}]} : {})});
  }
  if (out.opened) unpick();
}
// ---------- 올리기(FILES-통합 2-④, S49-33, 명진 결정 H-3·H-4·H-6, 시안 ⑦) ----------
// PC: 바탕화면 파일을 목록 칸(그 칸의 지금 폴더)이나 폴더 줄에 끌어 놓기 → 점선 '여기 놓으면 ○○에 올리기'. 폰·폴드: 위 줄 [올리기] → 고르기 창.
// 같은 이름은 한 번 묻기(H-3, [그래도 하기] = 서버가 '이름 (2)'로 둘 다 둠), 200MB 넘으면 한 번 묻기(H-4, 2GB까지).
// 파일마다 서버(upload_open)가 작업표 줄(기기 줄)과 그 클라우드의 이어 올리기 자리를 열어 주고, 이 화면이 그 자리로 5MB씩 직접 보낸다(파일이 서버를 거치지 않음).
// 자리 주소는 그 한 건 응답에만 오고 이 탭 메모리에만 둔다. 조각마다 서버에 보낸 바이트를 알리고(전송 목록 진행), 끝나면 서버가 클라우드에 물어 맞춘 뒤 색인에 넣는다.
// H-6: 올리는 중 화면을 숨기면 그 자리에서 멈추고(작업표 '일시 정지'), 다시 보이면 쥐고 있던 파일로 남은 조각부터. 탭을 닫으면 멈춤으로 남고,
//   다시 연 화면에서는 [이어 올리기] → 같은 파일(이름·크기)을 다시 고르면 남은 조각부터(브라우저는 닫힌 화면의 파일을 기억하지 못한다).
// 파일 손잡이(upFiles)는 이 탭 메모리에만 — 기기 저장 없음.
const upFiles = new Map();
const up = {queue: [], cur: null, pumping: false, hiddenStop: false};
// UI-올리기진행표시 ②: 이 탭이 보내는 기기 파일마다 공용 올리는 줄 하나(trackUpload). 맨 위 줄('올리는 중 n개 · 보낸 양/전체 · %')은
// 이 화면 위쪽(data-fx-uprows), 다른 화면으로 가면 하단바 위 한 줄. %는 조각(5MB) 안에서도 브라우저가 실제로 보낸 양(upload-send.mjs).
// ✕ = 그 줄 멈춤(전송 목록의 [멈춤]과 같은 서버 요청 — 받은 조각은 클라우드에 남아 [이어 올리기]로 잇는다).
// 숨김·멈춤(작업표 '일시 정지')이 되면 표시만 내린다(다시 보이면 남은 조각부터 새 표시로).
mountUploadRows(root?.querySelector('[data-fx-uprows]'), {compact: true, has: job => job.fxUp === true});
function upJob(item) {
  if (item.job && !item.job.cancelled()) return item.job;
  const job = trackUpload({file: item.file, name: item.file.name, size: item.file.size});
  job.fxUp = true; item.job = job;
  job.signal.addEventListener('abort', () => { if (item.job === job && !item.letGo) { item.job = null; jobsDo('job_pause', [item.id]); } }, {once: true});
  return job;
}
// 표시만 내린다(서버 줄은 그대로). 숨김·사람이 멈춤·실패 뒤.
function upLetGo(item, how, why = '') {
  const job = item.job; if (!job) return;
  item.job = null;
  if (how === 'done') job.done();
  else if (how === 'failed') job.fail(why);
  else { item.letGo = true; job.cancel(); item.letGo = false; }
}
let refileFor = '';
const upOurs = id => up.cur?.id === id || up.queue.some(q => q.id === id);
// 클라우드 → 폰(3-③): 파일(폴더는 xferRun이 treeDev로 — S53-8, 구글 문서·크기 모름은 xferPlan이 거름). 같은 이름은 한 번 묻고 [그래도 하기]면 앱이 '이름 (2)'로 둘 다 둔다(덮어쓰기 없음).
//   S53-8: 폰 안끼리도 같은 길(폰에서 읽어 받을 폴더에 새 파일로, 옮기기면 다 쓴 것만 원본을 폰 휴지통으로).
//   하나씩 차례로: Edge media로 받은 바이트를 앱 다리로 384KB씩 넘긴다(화면이 열린 동안). 전송 줄은 같은 저장소 옮기기와 같은 state.run.
async function cloudToPhone(rows, dest, mode = 'copy') {
  const inPhone = rows.every(r => r.source === PH);
  const plan = xferPlan(rows, dest, inPhone ? mode : 'copy');
  if (!plan.ok.length) { notify(plan.reason, {error: true, record: false}); return; }
  if (plan.blocked.length) notify(plan.blocked[0].reason, {error: true, record: false});
  let destRows = [];
  try { destRows = await phone.list(dest.parent); } catch { /* 모르면 묻지 않고 앱이 번호를 붙인다 */ }
  const same = new Set(sameNameRows(plan.ok, destRows).map(rowKey));
  const go = [];
  let sameAll = null, skipped = plan.blocked.length;
  for (const r of plan.ok) {
    if (same.has(rowKey(r))) {
      let c = sameAll;
      if (!c) {
        const res = await ask({name: r.name, text: sameNameAsk('down'), go: '그래도 하기', many: plan.ok.filter(y => same.has(rowKey(y))).length > 1});
        if (res.closed) return;
        c = res.choice; if (res.all) sameAll = c;
      }
      if (c === 'skip') { skipped++; continue; }
    }
    if (Number(r.size_bytes) > PHONE_SAVE_MAX) { notify(`${r.name}: 폰으로는 1GB까지 받아요`, {error: true, record: false}); skipped++; continue; }
    go.push(r);
  }
  if (!go.length) { if (skipped) notify(xferDoneText('copy', {skipped}), {record: false}); return; }
  const scope = state.scope, landed = [];
  const run = state.run = {mode, total: go.length, at: 1, done: 0, failed: 0, name: go[0].name, code: '', pending: false};
  paintXfer();
  try {
    for (const r of go) {
      run.name = r.name; run.at = run.done + run.failed + 1; paintXfer();
      try {
        const blob = await rowBlob(r, 'media');
        if (state.scope !== scope) return;
        const res = await phone.save(dest.parent, r.name, blob);
        if (!res.ok) throw Object.assign(new Error('phone_write'), {phoneWrite: res.error});
        run.done++; landed.push(r);
      } catch (e) { run.failed++; run.code ||= e?.phoneWrite ? 'w:' + e.phoneWrite : codeOf(e); }
      if (state.scope !== scope) return;
    }
  } finally {
    if (state.run === run) state.run = null;
    paintXfer(); paintBar();
  }
  await phoneRefresh([dest.parent]);
  // 옮기기(S52-43 ②): 폰에 다 쓴 것만 원본을 그 클라우드(폰 안끼리면 폰) 휴지통으로(확인은 moveRows가 한 번 물음).
  const kept = mode !== 'move' ? 0 : inPhone ? await trashOriginals(PH, landed) : await trashLanded(landed);
  if (mode === 'move' && inPhone && landed.length) await phoneRefresh([...new Set(landed.map(r => r.parent_id))], {gone: landed.map(rowKey)});
  const why = run.code ? (run.code.startsWith('w:') ? phoneWriteText(run.code.slice(2), {del: phone.state.del === true}) : errorText(run.code)) : '';
  const note = kept ? `${kept}개는 폰에 받았지만 원본을 휴지통으로 보내지 못해 그대로 있어요` : run.failed ? why : '';
  notify(xferDoneText(mode, {done: run.done, failed: run.failed, skipped}), {error: !!run.failed || !!kept, note, record: false});
}
// 폰 파일 → 클라우드: 파일(폴더는 xferRun이 treeUp으로 — S53-8). 한 번에 PHONE_UP_MAX개까지 폰에서 읽어 올리기 길로 넘긴다(넘으면 한 줄 알림).
const PHONE_UP_MAX = 20;
// 옮기기(S52-43 ②): 서버가 올린 파일을 맞춘 뒤(upload_done)에만 폰 원본을 안드로이드 휴지통으로(내 PC 옮기기와 같은 길, devGone).
async function phoneToCloud(rows, dest, mode = 'copy') {
  const files = rows.filter(r => !r.is_folder);
  if (!files.length) return;
  if (files.length > PHONE_UP_MAX) notify(`폰 파일은 한 번에 ${PHONE_UP_MAX}개까지 보내요. 앞 ${PHONE_UP_MAX}개만 보냅니다.`, {record: false});
  const scope = state.scope, out = [], from = new Map();
  state.busy = '폰 파일 가져오는 중'; paintBar();
  try {
    for (const r of files.slice(0, PHONE_UP_MAX)) {
      try {
        const blob = await phone.blob(r.item_id);
        const f = new File([blob], r.name, {type: r.mime || blob.type || '', lastModified: Date.parse(r.modified_at || '') || Date.now()});
        out.push(f); from.set(f, {source: PH, path: r.item_id});
      } catch (e) { notify(`${r.name}: ${errorText(codeOf(e))}`, {error: true, record: false}); }
      if (state.scope !== scope) return;
    }
  } finally { if (state.scope === scope) { state.busy = ''; paintBar(); } }
  if (out.length) await uploadFiles(out, dest, {devMove: mode === 'move' ? from : null});
}
// ---------- 내 PC ↔ 클라우드(S52-41 FILES-내PC클라우드옮기기) ----------
// 옮기기로 올리는 기기 파일(내 PC·이 폰): 작업표 줄 id → {source, path}(이 탭 메모리만). 서버가 올린 파일을 맞춘 뒤(upload_done)에만
//   원본을 그 기기 휴지통으로(내 PC = 윈도우 휴지통, 이 폰 = 안드로이드 휴지통 — 폰 앱이 파일만 받음).
const upDevMove = new Map();
async function devGone(jobId) {
  const it = upDevMove.get(jobId);
  if (!it) return;
  upDevMove.delete(jobId);
  if (it.group) { it.group.left.delete(jobId); await groupGone(it.group); return; }
  const where = it.source === PC ? '내 PC' : '폰';
  try {
    if (it.source === PC) await pc.trash(it.path);
    else { const d = await phone.op({op: 'trash', paths: [it.path]}); if (!d?.ok || !d.count) throw new Error(d?.error || 'phone_write'); }
    const dir = it.source === PC ? pcParent(it.path) : phoneParent(it.path);
    await phoneRefresh([dir], {source: it.source, gone: [rowKey({source: it.source, item_id: it.path})]});
  } catch (e) {
    notify(`올렸지만 ${where} 원본은 휴지통으로 보내지 못했어요`, {error: true, note: it.source === PC ? errorText(codeOf(e)) : phoneWriteText(e?.message, {del: phone.state.del === true}), record: false});
  }
}
// 폴더째 옮기기 묶음 안의 줄이 실패: 묶음은 원본을 지우지 않는다(다 끝나면 한 번 알림).
function devFailed(jobId) {
  const it = upDevMove.get(jobId);
  if (!it?.group) return;
  upDevMove.delete(jobId);
  it.group.failed = true; it.group.left.delete(jobId);
  groupGone(it.group);
}
// 내 PC 파일 → 클라우드: 파일(폴더는 xferRun이 treeUp으로 — S53-8), 한 번에 20개·한 파일 1GB까지. 문에서 4MB씩 읽어 지금 올리기 길(같은 이름·200MB 묻기·전송 목록·진행 표시 그대로)로.
async function pcToCloud(rows, dest, mode) {
  const plan = xferPlan(rows, dest, 'copy');
  if (!plan.ok.length) { notify(plan.reason, {error: true, record: false}); return; }
  if (plan.blocked.length) notify(plan.blocked[0].reason, {error: true, record: false});
  let files = plan.ok.filter(r => {
    if (Number(r.size_bytes) <= PC_FILE_MAX) return true;
    notify(`${r.name}: 내 PC에서는 한 파일 1GB까지 보내요`, {error: true, record: false});
    return false;
  });
  if (files.length > PC_XFER_MAX) { notify(`내 PC 파일은 한 번에 ${PC_XFER_MAX}개까지 보내요. 앞 ${PC_XFER_MAX}개만 보냅니다.`, {record: false}); files = files.slice(0, PC_XFER_MAX); }
  if (!files.length) return;
  const scope = state.scope, out = [], from = new Map();
  try {
    for (const [i, r] of files.entries()) {
      state.busy = `내 PC 파일 가져오는 중 (${i + 1}/${files.length})`; paintBar();
      try {
        const blob = await pc.read(r.item_id, {size: r.size_bytes});
        const f = new File([blob], r.name, {type: blob.type || '', lastModified: Date.parse(r.modified_at || '') || Date.now()});
        out.push(f); from.set(f, {source: PC, path: r.item_id});
      } catch (e) { notify(`${r.name}: ${errorText(codeOf(e))}`, {error: true, record: false}); }
      if (state.scope !== scope) return;
    }
  } finally { if (state.scope === scope) { state.busy = ''; paintBar(); } }
  if (out.length) await uploadFiles(out, dest, {devMove: mode === 'move' ? from : null});
}
// 내 PC 안 옮기기·복사(S52-43 ① FILES-내PC쓰기, 0.5.0+ 문): 옮기기는 파일·폴더(폴더는 같은 드라이브 안은 문이 한 번에).
//   S53-8 FILES-폴더째PC폰: 폴더 복사는 treeDev(같은 폴더 모양을 만들고 안의 파일을 문이 하나씩 복사), 다른 드라이브로 폴더 옮기기도 treeDev(다 복사된 뒤에만 원본 휴지통).
//   같은 이름은 한 번 묻고 [그래도 하기]면 문이 '이름 (2)'로 둘 다 둔다(덮어쓰기 없음). 하나씩 차례로, 끝나면 보낸 곳·받은 곳 목록을 문에서 다시 읽는다.
async function pcInPc(rows, dest, mode) {
  const plan = xferPlan(rows, dest, mode);
  const dirCopies = mode === 'copy' ? plan.ok.filter(r => r.is_folder) : [];
  const list = plan.ok.filter(r => !dirCopies.includes(r));
  if (plan.blocked.length) notify(plan.blocked[0].reason, {error: true, record: false});
  if (!plan.ok.length && !plan.blocked.length) notify(plan.reason, {error: true, record: false});
  if (list.length) await pcInPcRun(list, dest, mode);
  if (dirCopies.length) await treeDev('copy', dirCopies, dest);
}
async function pcInPcRun(list, dest, mode) {
  let destRows = [];
  try { destRows = await pc.list(dest.parent); } catch { /* 모르면 묻지 않는다: 문이 같은 이름을 거절하면 그 줄은 못 함 */ }
  const same = new Set(sameNameRows(list, destRows).map(rowKey)), numbered = new Set();
  const go = [];
  let sameAll = null, skipped = 0;
  for (const r of list) {
    if (same.has(rowKey(r))) {
      let c = sameAll;
      if (!c) {
        const res = await ask({name: r.name, text: sameNameAsk(mode), go: '그래도 하기', many: list.filter(y => same.has(rowKey(y))).length > 1});
        if (res.closed) return;
        c = res.choice; if (res.all) sameAll = c;
      }
      if (c === 'skip') { skipped++; continue; }
      numbered.add(rowKey(r));
    }
    go.push(r);
  }
  if (!go.length) { if (skipped) notify(xferDoneText(mode, {skipped}), {record: false}); return; }
  const scope = state.scope, moved = [], farDirs = [];
  const run = state.run = {mode, total: go.length, at: 1, done: 0, failed: 0, name: go[0].name, code: '', pending: false};
  paintXfer();
  try {
    for (const r of go) {
      run.name = r.name; run.at = run.done + run.failed + 1; paintXfer();
      try {
        const opt = {numbered: numbered.has(rowKey(r))};
        if (mode === 'move') { const to = await pc.move(r.item_id, dest.parent, opt); moved.push({...r, to}); if (r.is_folder) pcRenamed(r, to); }
        else await pc.copy(r.item_id, dest.parent, opt);
        run.done++;
      } catch (e) {
        // 다른 드라이브로 폴더 옮기기: 문이 한 번에 못 하니 폴더째 복사 뒤 원본 휴지통(treeDev)으로 넘긴다.
        if (mode === 'move' && r.is_folder && codeOf(e) === 'pc_other_drive') { farDirs.push(r); run.total--; }
        else { run.failed++; run.code ||= codeOf(e); }
      }
      if (state.scope !== scope) return;
    }
  } finally {
    if (state.run === run) state.run = null;
    paintXfer(); paintBar();
  }
  await phoneRefresh([dest.parent, ...moved.map(r => r.parent_id)], {source: PC, gone: moved.map(rowKey)});
  for (const r of moved) if (r.is_folder) state.children.delete(folderKey(PC, r.item_id));
  if (farDirs.length) await treeDev('move', farDirs, dest, {asked: {numbered}});
  if (!run.total) return;
  if (run.failed) { notify(xferDoneText(mode, {done: run.done, failed: run.failed, skipped}), {error: true, note: errorText(run.code), record: false}); return; }
  // S52-43 ②: 내 PC 안 옮기기는 [되돌리기] = 옮긴 것을 원래 폴더로(이름에 번호가 붙은 것은 빼고, 사람이 누른 것만).
  const back = moved.filter(r => !numbered.has(rowKey(r)));
  const undo = back.length ? async () => {
    let bad = 0;
    for (const r of back) {
      try { const to = await pc.move(r.to, r.parent_id); if (r.is_folder) pcRenamed({...r, item_id: r.to}, to); } catch { bad++; }
    }
    await phoneRefresh([dest.parent, ...back.map(r => r.parent_id)], {source: PC, gone: back.map(r => rowKey({source: PC, item_id: r.to}))});
    return bad ? false : {status: 'restored'};
  } : null;
  notify(xferDoneText(mode, {done: run.done, skipped}), {record: false, ...(undo ? {undo, label: `옮기기 ${back.length}개`} : {})});
}
// 클라우드 파일 → 내 PC 폴더: 파일(폴더는 xferRun이 treeDev로 — S53-8, 구글 문서·크기 모름은 xferPlan이 거름). 같은 이름은 한 번 묻고 [그래도 하기]면 문이 '이름 (2)'로 둘 다 둔다(덮어쓰기 없음).
//   하나씩 차례로: Edge media로 받은 바이트를 문에 4MB씩 새 파일로 쓴다(화면이 열린 동안). 옮기기면 다 쓴 것만 그 클라우드 휴지통으로.
async function cloudToPc(rows, dest, mode) {
  const plan = xferPlan(rows, dest, 'copy');
  if (!plan.ok.length) { notify(plan.reason, {error: true, record: false}); return; }
  if (plan.blocked.length) notify(plan.blocked[0].reason, {error: true, record: false});
  let destRows = [];
  try { destRows = await pc.list(dest.parent); } catch { /* 모르면 묻지 않는다: 문이 같은 이름을 거절하면 그 줄은 못 함으로 남는다 */ }
  const same = new Set(sameNameRows(plan.ok, destRows).map(rowKey)), numbered = new Set();
  let go = [], sameAll = null, skipped = plan.blocked.length;
  for (const r of plan.ok) {
    if (same.has(rowKey(r))) {
      let c = sameAll;
      if (!c) {
        const res = await ask({name: r.name, text: sameNameAsk(mode === 'move' ? 'move' : 'down'), go: '그래도 하기', many: plan.ok.filter(y => same.has(rowKey(y))).length > 1});
        if (res.closed) return;
        c = res.choice; if (res.all) sameAll = c;
      }
      if (c === 'skip') { skipped++; continue; }
      numbered.add(rowKey(r));
    }
    if (Number(r.size_bytes) > PC_FILE_MAX) { notify(`${r.name}: 내 PC로는 한 파일 1GB까지 받아요`, {error: true, record: false}); skipped++; continue; }
    go.push(r);
  }
  if (go.length > PC_XFER_MAX) { notify(`내 PC로는 한 번에 ${PC_XFER_MAX}개까지 받아요. 앞 ${PC_XFER_MAX}개만 받습니다.`, {record: false}); skipped += go.length - PC_XFER_MAX; go = go.slice(0, PC_XFER_MAX); }
  if (!go.length) { if (skipped) notify(xferDoneText(mode, {skipped}), {record: false}); return; }
  const scope = state.scope, landed = [];
  const run = state.run = {mode, total: go.length, at: 1, done: 0, failed: 0, name: go[0].name, code: '', pending: false};
  paintXfer();
  try {
    for (const r of go) {
      run.name = r.name; run.at = run.done + run.failed + 1; paintXfer();
      try {
        const blob = await rowBlob(r, 'media');
        if (state.scope !== scope) return;
        await pc.save(dest.parent, r.name, blob, {numbered: numbered.has(rowKey(r))});
        run.done++; landed.push(r);
      } catch (e) { run.failed++; run.code ||= codeOf(e); }
      if (state.scope !== scope) return;
    }
  } finally {
    if (state.run === run) state.run = null;
    paintXfer(); paintBar();
  }
  await phoneRefresh([dest.parent], {source: PC});
  // 옮기기: 내 PC에 다 쓴 것만 원본을 그 클라우드 휴지통으로(사람이 [옮기기]를 누른 것, 확인은 moveRows가 한 번 물음).
  const kept = mode === 'move' ? await trashLanded(landed) : 0;
  const why = run.code ? errorText(run.code) : '';
  const note = kept ? `${kept}개는 내 PC에 받았지만 원본을 휴지통으로 보내지 못해 그대로 있어요` : run.failed ? why : '';
  notify(xferDoneText(mode, {done: run.done, failed: run.failed, skipped}), {error: !!run.failed || !!kept, note, record: false});
}
// 기기(내 PC·이 폰)에 다 받은 클라우드 원본만 그 클라우드 휴지통으로(옮기기). 답 = 못 보낸 개수(원본이 남음).
async function trashLanded(landed) {
  let kept = 0;
  for (const g of groupBySource(landed || [])) {
    let ids = g.rows.map(r => r.item_id);
    while (ids.length) {
      const d = await write('trash', {source: g.source, ids}, '원본을 휴지통으로 보내는 중');
      if (!d) { kept += ids.length; break; }
      await applyWrite(d, touchedFolders(g.rows));
      kept += (d.failed || []).length;
      ids = Array.isArray(d.left) ? d.left : [];
    }
  }
  return kept;
}
async function uploadFiles(files, dest, {devMove = null} = {}) {
  if (!dest?.source || !SOURCES.includes(dest.source)) return;
  if (state.ask || state.busy) { notify('다른 일을 묻는 중이에요. 끝난 뒤 다시 해 주세요.', {record: false}); return; }
  const plan = uploadPlan(files, n => checkFileBase(n).ok);
  if (!plan.ok.length) { if (plan.blocked.length) notify(plan.reason, {error: true, record: false}); return; }
  if (plan.blocked.length) notify(plan.blocked[0].reason, {error: true, record: false});
  const scope = state.scope;
  let destRows = [];
  try { const v = await rpc('app_cloud_list', {p_source: dest.source, p_parent_id: dest.parent}); destRows = Array.isArray(v) ? v : []; } catch { /* 모르면 묻지 않고 서버가 번호를 붙인다 */ }
  const same = new Set(upSameName(plan.ok, destRows));
  const go = [];
  let sameAll = null, bigAll = null, skipped = 0;
  for (const f of plan.ok) {
    if (same.has(f)) {
      let c = sameAll;
      if (!c) {
        const res = await ask({name: f.name, text: sameNameAsk('up'), go: '그래도 하기', many: plan.ok.filter(y => same.has(y)).length > 1});
        if (res.closed) return;
        c = res.choice; if (res.all) sameAll = c;
      }
      if (c === 'skip') { skipped++; continue; }
    }
    if (upBig(f)) {
      let c = bigAll;
      if (!c) {
        const res = await ask({name: f.name, text: bigAsk({size_bytes: f.size}, 'up'), note: UPLOAD_BIG_HOW, go: '그래도 올리기', many: plan.ok.filter(upBig).length > 1});
        if (res.closed) return;
        c = res.choice; if (res.all) bigAll = c;
      }
      if (c !== 'go') { skipped++; continue; }
    }
    go.push(f);
  }
  if (state.scope !== scope) return;
  if (!go.length) { if (skipped) notify(`${skipped}개 건너뜀`, {record: false}); return; }
  const opened = await openUploads(go, dest, {devMove});
  if (!opened || state.scope !== scope) return;
  notify(upStartText(opened), {note: skipped ? `${skipped}개 건너뜀` : '', record: false});
  upPump();
}
// 줄을 모두 먼저 연다(전송 목록에 한 줄씩 '기다림'으로 보이게) → 부른 곳이 upPump로 차례로 보낸다. 답 = 연 줄 수.
//   group·rows(S53-8 폴더째 옮기기): 연 줄을 묶음에 넣고(rows[i] = go[i]의 원본 줄), 하나라도 못 열면 묶음은 원본을 지우지 않는다.
async function openUploads(go, dest, {devMove = null, group = null, rows = null} = {}) {
  const scope = state.scope;
  state.jobsBusy = true; paintBar();
  let opened = 0;
  try {
    for (const [i, f] of go.entries()) {
      let d;
      try {
        d = await rt().api(FN, {method: 'POST', body: {action: 'upload_open', confirm: true, to_source: dest.source, to: dest.parent, name: f.name, size: f.size,
          ...(f.type ? {mime: f.type} : {}), ...(upBig(f) ? {big: true} : {})}, singleFlight: false, timeoutMs: 60000});
      } catch (e) { if (group) group.failed = true; if (state.scope === scope) notify(`${f.name}: ${writeErrorText(codeOf(e))}`, {error: true, record: false}); continue; }
      if (state.scope !== scope) return opened;
      if (!d?.job?.id) { if (group) group.failed = true; continue; }
      opened++;
      setJobs(mergeJobs(state.jobs, [d.job]));
      if (devMove?.has(f)) upDevMove.set(d.job.id, devMove.get(f));
      if (group) { group.left.add(d.job.id); group.rows.push(rows[i]); upDevMove.set(d.job.id, {group}); }
      if (d.job.status === 'done') { applyWrite(d); devGone(d.job.id); continue; }
      upFiles.set(d.job.id, f);
      up.queue.push({id: d.job.id, file: f});
    }
  } finally { if (state.scope === scope) { state.jobsBusy = false; paintBar(); } }
  return opened;
}
// 차례로 하나씩: 서버에 '보내는 중'으로 바꾸며 자리·이어 갈 곳을 받고(upload_resume — 처음이면 0), 남은 조각을 보낸다.
async function upPump() {
  if (up.pumping) return;
  up.pumping = true;
  const scope = state.scope;
  try {
    while (up.queue.length && state.scope === scope && !up.hiddenStop) {
      const item = up.queue[0], file = item.file;
      let d;
      try {
        d = await rt().api(FN, {method: 'POST', body: {action: 'upload_resume', confirm: true, id: item.id, name: file.name, size: file.size}, singleFlight: false, timeoutMs: 60000});
      } catch (e) {
        up.queue.shift();
        notify(`${file.name}: ${writeErrorText(codeOf(e))}`, {error: true, record: false});
        loadJobs();
        continue;
      }
      if (state.scope !== scope) return;
      if (d?.job) setJobs(mergeJobs(state.jobs, [d.job]));
      if (!d?.upload) { up.queue.shift(); if (d?.changed) applyWrite(d); continue; }
      const out = await upSend(item, d.upload);
      // 숨김: 줄은 큐에 남겨 다시 보일 때 잇는다. 사람이 멈춤(큐에서 빠짐)·다른 곳에서 멈춤: 다음 줄로.
      if (out === 'stop' && up.queue[0] === item) break;
      if (up.queue[0] === item) up.queue.shift();
    }
  } finally { up.pumping = false; up.cur = null; }
}
// 조각 보내기. 'done'·'failed' = 이 줄 끝, 'stop' = 멈춤(숨김·사람이 멈춤).
async function upSend(item, slot) {
  const out = await upSendPieces(item, slot);
  if (out === 'done') devGone(item.id); // 내 PC·이 폰에서 옮긴 파일: 서버가 맞춘 뒤에만 원본을 휴지통으로
  else if (out === 'failed') devFailed(item.id); // 폴더째 옮기기 묶음이면 원본 그대로
  upLetGo(item, out === 'done' ? 'done' : out === 'failed' ? 'failed' : 'stop', out === 'failed' ? jobReason(item.failCode || 'upload_failed') : '');
  return out;
}
async function upSendPieces(item, slot) {
  const fail = async code => {
    item.failCode = code;
    try { const v = await rt().api(FN, {method: 'POST', body: {action: 'upload_progress', confirm: true, id: item.id, error: code}, singleFlight: false, timeoutMs: 30000}); if (v?.job) setJobs(mergeJobs(state.jobs, [v.job])); } catch { loadJobs(); }
    return 'failed';
  };
  // S53-8: 폴더째 올리기의 내 PC·이 폰 파일은 보낼 차례가 되어서야 바이트를 읽는다(upStub). 그사이 바뀌었으면(크기 다름) 이 줄은 못 함.
  if (item.file?.load) {
    try {
      const f = await item.file.load();
      if (f.size !== item.file.size) throw new Error('changed');
      item.file = f;
      if (upFiles.has(item.id)) upFiles.set(item.id, f);
    } catch { return fail('upload_failed'); }
  }
  const file = item.file, size = file.size, ctrl = new AbortController();
  up.cur = {id: item.id, ctrl};
  let off = Math.max(0, Number(slot.offset) || 0), tries = 0;
  const job = upJob(item);
  job.signal.addEventListener('abort', () => ctrl.abort(), {once: true});
  job.progress({loaded: off, total: size, phase: 'sending'});
  for (;;) {
    const piece = upPiece(off, size, Number(slot.chunk) || 5 * 1024 * 1024);
    if (!piece) return fail('upload_failed');
    let res;
    try {
      // 조각 하나를 실제 보낸 양을 알리며 보낸다(XMLHttpRequest — 기본으로 로그인 정보·쿠키를 싣지 않는다). 마지막 조각을 다 보낸 뒤만 '마무리 중…'.
      const last = piece.end >= size, base = piece.start;
      const r = await sendUpload(slot.url, {method: 'PUT', headers: {'Content-Range': `bytes ${piece.start}-${piece.end - 1}/${size}`},
        body: file.slice(piece.start, piece.end), size: piece.end - piece.start, timeoutMs: 0, signal: ctrl.signal,
        onProgress: p => job.progress({loaded: base + (Number(p.loaded) || 0), total: size, phase: last && p.phase === 'finishing' ? 'finishing' : 'sending'})});
      res = {status: r.status, json: async () => JSON.parse(r.text)};
    } catch {
      if (ctrl.signal.aborted) return 'stop';
      if (++tries <= 2) { await new Promise(r => setTimeout(r, 1500 * tries)); if (ctrl.signal.aborted) return 'stop'; continue; }
      return fail('upload_failed');
    }
    if (ctrl.signal.aborted) return 'stop';
    if (res.status === 308 || res.status === 202) {
      off = piece.end; tries = 0;
      let v = null;
      try { v = await rt().api(FN, {method: 'POST', body: {action: 'upload_progress', confirm: true, id: item.id, sent: off}, singleFlight: false, timeoutMs: 30000}); } catch { /* 진행 알림은 덧붙임: 다음 조각 때 다시 */ }
      if (v?.job && v.job.status !== 'running') { up.queue = up.queue.filter(q => q.id !== item.id); up.cur = null; setJobs(mergeJobs(state.jobs, [v.job])); return 'paused'; }
      if (v?.job) setJobs(mergeJobs(state.jobs, [v.job]));
      continue;
    }
    if (res.status === 200 || res.status === 201) {
      let r = null; try { r = await res.json(); } catch { /* 몸통을 못 읽으면 서버가 이름·자리로 찾는다 */ }
      try {
        const d = await rt().api(FN, {method: 'POST', body: {action: 'upload_done', confirm: true, id: item.id, ...(upResultId(r) ? {item_id: upResultId(r)} : {})}, singleFlight: false, timeoutMs: 60000});
        if (d?.job) setJobs(mergeJobs(state.jobs, [d.job]));
        upFiles.delete(item.id);
        await applyWrite(d);
        return 'done';
      } catch { return fail('upload_failed'); }
    }
    if ((res.status === 429 || res.status >= 500) && ++tries <= 2) { await new Promise(r => setTimeout(r, 2000 * tries)); continue; }
    return fail(res.status === 404 || res.status === 410 ? 'session_expired' : res.status === 507 ? 'no_space' : res.status === 429 || res.status === 503 ? 'cloud_throttled' : 'upload_failed');
  }
}
// 화면을 숨기거나 닫을 때: 지금 조각을 멈추고 서버 줄을 '일시 정지'로(닫히는 화면에서도 가도록 keepalive). 큐는 메모리에 남는다.
function upStop() {
  const ids = [up.cur?.id, ...up.queue.map(q => q.id)].filter(Boolean);
  if (!ids.length) return;
  up.hiddenStop = true;
  up.cur?.ctrl.abort();
  const r = rt(), token = r?.session?.read?.()?.access_token;
  if (!token) return;
  try {
    fetch(r.config.url + FN, {method: 'POST', keepalive: true, cache: 'no-store', headers: {apikey: r.config.key, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'},
      body: JSON.stringify({action: 'job_pause', confirm: true, ids: [...new Set(ids)].slice(0, 200)})}).catch(() => {});
  } catch { /* 닫히는 중: 서버가 3분 뒤 멈춤으로 바꾼다 */ }
}
// 다시 보일 때: 쥐고 있던 파일로 남은 조각부터.
function upShow() {
  if (!up.hiddenStop) return;
  up.hiddenStop = false;
  if (up.queue.length) upPump();
}
// [이어 올리기]: 이 탭이 파일을 쥐고 있으면 바로, 아니면 같은 파일을 다시 고르게 한다.
function reupload(id) {
  const j = state.jobs.find(x => x.id === id);
  if (!j || upOurs(id)) return;
  const f = upFiles.get(id);
  if (f && sameUpFile(j, f)) { up.queue.push({id, file: f}); upPump(); return; }
  refileFor = id;
  const inp = $('[data-fx-refile]');
  if (!inp) return;
  inp.value = '';
  notify(UPLOAD_REOPEN_TEXT, {record: false});
  inp.click();
}
function refilePicked(f) {
  const id = refileFor; refileFor = '';
  const j = state.jobs.find(x => x.id === id);
  if (!j || !f) return;
  if (!sameUpFile(j, f)) { notify(writeErrorText('file_mismatch'), {error: true, record: false}); return; }
  upFiles.set(id, f);
  up.queue.push({id, file: f});
  upPump();
}
// 끌어 놓기 받을 곳: 폴더 줄이면 그 폴더, 아니면 그 칸의 지금 폴더(최근·찾기 칸은 없음).
const upTarget = event => {
  if (drag || !Array.from(event.dataTransfer?.types || []).includes('Files')) return null;
  const row = event.target.closest?.('[data-fx-drop]');
  const i = paneOfEl(event.target);
  if (row && i >= 0) { const d = destOf(row.dataset.fxDrop); if (d && d.source !== PC && onSources().includes(d.source)) return {t: row, dest: d}; }
  const box = i >= 0 ? paneEl(state.panes[i]) : null;
  const d = box && paneDest(state.panes[i]);
  return d && d.source !== PC && onSources().includes(d.source) ? {t: box, dest: d} : null;
};
// S52-43 ③ FILES-관리자마무리: 클립보드 그림·파일 붙여넣기(Ctrl+V) = 지금 칸의 클라우드 폴더에 올리기(올리기 길 그대로 — 같은 이름·200MB 묻기·전송 목록).
//   앞서 [복사]·[잘라내기]로 잡아 둔 줄이 있으면 Ctrl+V는 그쪽(키 처리가 먼저 막음). 글자만 붙여 넣으면 건드리지 않는다(공용 paste-files.js).
//   [파일] 화면이 보이고, 지금 칸이 원드라이브·구글 드라이브 폴더(찾기·묶음 칸 아님)일 때만. 붙여 넣은 그림은 업로드 전까지 화면 메모리에만.
const pasteDest = () => { const d = hereDest(); return d && SOURCES.includes(d.source) && onSources().includes(d.source) ? d : null; };
// 붙여 넣은 그림의 이름('붙여넣은 그림 11-08 01:57.png')의 ':'는 클라우드 파일 이름에 쓸 수 없어 '.'으로('01.57').
const cloudSafe = f => (f.name.includes(':') ? new File([f], f.name.replace(/:/g, '.'), {type: f.type, lastModified: f.lastModified}) : f);
bindPaste(document, files => { const d = pasteDest(); if (d) void uploadFiles(files.map(cloudSafe), d); }, {key: 'files-view',
  canTake: () => !!root?.isConnected && root.getClientRects().length > 0 && !state.busy && !state.ask && !state.clip && !!pasteDest()});

// 미리보기 ☆ 한 개만 고친다(PDF를 그리는 칸은 다시 그리지 않음).
function paintStarOne() {
  const b = $('[data-fx-star-one]'), on = !!state.preview?.row?.starred;
  if (!b) return;
  b.innerHTML = starFace(on); b.classList.toggle('on', on);
  b.setAttribute('aria-pressed', String(on)); b.setAttribute('aria-label', on ? '별표 빼기' : '별표'); b.title = on ? '별표 빼기' : '별표';
}
// ---------- 별표(2-④): 고르기 막대·미리보기 ☆. 서버(app_cloud_stars)가 기억, 나무 '★ 별표' 줄 개수·목록에 바로 ----------
async function starRows(rows) {
  const list = (rows || []).filter(r => r && SOURCES.includes(r.source));
  if (!list.length) return;
  const on = starWant(list);
  for (const g of groupBySource(list)) {
    const ids = g.rows.map(r => r.item_id);
    const d = await write('star', {source: g.source, ids, on}, on ? '별표 넣는 중' : '별표 빼는 중', {timeoutMs: 30000});
    if (!d) return;
    for (const p of state.panes) {
      const rs = applyStars(p.rows, g.source, ids, on); if (rs !== p.rows) p.rows = rs;
      if (p.found) { const f = applyStars(p.found, g.source, ids, on); if (f !== p.found) p.found = f; }
    }
    if (state.preview && state.preview.row.source === g.source && ids.includes(state.preview.row.item_id)) { state.preview.row = {...state.preview.row, starred: on}; paintStarOne(); }
    // 폰 나무(그 자리 펼친 파일·'최근' 상자)의 ★도 같은 값으로(S51-22 나무 ⋯ 메뉴에서 별표).
    for (const m of [state.files, state.children]) for (const [k, rs] of m) { const next = applyStars(rs, g.source, ids, on); if (next !== rs) m.set(k, next); }
    if (state.recent) state.recent = applyStars(state.recent, g.source, ids, on);
  }
  paintTree();
  const work = [];
  for (const p of panesOn()) { if (p.where?.shelf === 'starred' && !p.query) work.push(loadList(p, {quiet: true})); else paintList(p); }
  if (!work.length) work.push(loadStars());
  paintBar();
  await Promise.all(work);
  notify(on ? `${list.length}개 별표` : `${list.length}개 별표 뺌`, {record: false});
}

const hereDest = (p = P()) => paneDest(p);
const destOf = key => { const [source, ...rest] = String(key || '').split(':'); return SOURCES.includes(source) || (source === PH && phoneWrite()) || (source === PC && pcWrite()) ? {source, parent: rest.join(':') || null} : null; };

// ---------- 두 칸: 켜기·지금 칸·반대 칸으로 보내기·끌어 놓기 고르기 ----------
// 지금 칸 바꾸기: 칸 안 그림은 다시 그리지 않는다(누르던 단추가 바뀌어 누름이 사라지지 않게) — 표시(fx-cur)·위 줄·막대·왼쪽 나무만.
function setCur(i) {
  if (!two() || i === state.cur || !state.panes[i]) return;
  state.cur = i;
  markCur(); paintTop(); paintBar(); paintMainTree();
}
// 한 칸으로 돌아갈 때 지금 쓰던 칸이 그 한 칸이 된다(칸 1이었으면 자리를 바꾼다). 두 칸이 될 때 오른쪽 칸이 비어 있으면 첫 위치를 연다.
function layoutChanged() {
  if (!two()) {
    if (state.cur === 1) { state.panes.reverse(); state.cur = 0; window.KPTURouter?.setPlace?.('files', placeOf(state.panes[0].where)); }
    state.panes[1].picked.clear(); state.panes[1].drop = false;
    for (const q of state.panes) q.srcOpen = false;
    state.dropAsk = null;
    // 폰 한 칸으로 돌아오면 칸 0은 그 폴더 목록(뒤로가기 = 한 단계 위·나무).
    if (solo()) { const a = state.panes[0]; if (a.where) { a.pane = 'list'; listLayerOpen(); } }
    paint();
    return;
  }
  // 폰 두 칸: 한 칸 화면의 뒤로가기 자리(목록 ⇄ 나무)는 놓는다. 칸 0이 나무 화면이었으면 첫 저장소 맨 위를 연다.
  if (listLayer) { const l = listLayer; listLayer = null; l.close(); }
  state.treeBack = null;
  if (!state.panes[0].where && state.status) goHome(state.panes[0]);
  const b = state.panes[1];
  paint();
  if (!state.status) return;
  if (b.where) { loadList(b, {quiet: true}); return; }
  const start = paneStart(1, viewPrefs.getFilesPanes?.(DEVICE), onSources(), state.panes[0].where);
  if (start) setWhere(b, startAt(b, start), {keepPreview: true});
}
function setTwo(on) {
  viewPrefs.setFilesTwo?.(DEVICE, twoValue(viewPrefs.getFilesTwo?.(DEVICE), twoLayout(WIDE.matches, PHONE.matches), on));
  closePreview();
  layoutChanged();
}
// 고르기 막대·F5·F6: 지금 칸에서 고른 것(없으면 선택한 한 줄)을 반대 칸의 지금 폴더로. 같은 이름·200MB 묻기·전송 목록은 xferRun 그대로.
function sendOpp(mode, anchor) {
  const dest = oppDest(), list = actRows();
  if (!list.length) return;
  if (!dest) { notify(`${side(state.cur ^ 1)} 칸에서 받을 폴더를 여세요`, {record: false}); return; }
  if (mode === 'move') moveRows(list, dest, anchor); else xferRun('copy', list, dest);
}
// 칸 사이로 끌어 놓았을 때 '복사 · 옮기기' 작은 고르기(시안 ⑥ drop-hint). 놓은 자리 곁에 뜬다.
function paintDropAsk() {
  const box = $('[data-fx-dropask]');
  if (!box) return;
  const a = state.dropAsk;
  if (!a) { box.hidden = true; box.innerHTML = ''; return; }
  const copyOk = xferPlan(a.rows, a.dest, 'copy').ok.length > 0, moveOk = moveTargetOk(a.rows, a.dest);
  box.hidden = false;
  box.style.left = `${Math.max(8, Math.min(a.x - 120, window.innerWidth - 268))}px`;
  box.style.top = `${Math.max(8, Math.min(a.y + 8, window.innerHeight - 120))}px`;
  box.innerHTML = `<span class="fx-drop-t">${esc(DROP_ASK_TEXT)} → <b>${esc(destNameOf(a.dest))}</b></span>`
    + `<button type="button" class="fx-btn fx-pri" data-fx-drop-go="copy"${copyOk ? '' : ' disabled'}>복사</button><button type="button" class="fx-btn" data-fx-drop-go="move"${moveOk ? '' : ' disabled'}>옮기기</button>`
    + '<button type="button" class="mini" data-fx-drop-x aria-label="놓기 그만두기">✕</button>';
}
function dropGo(mode, anchor) {
  const a = state.dropAsk;
  state.dropAsk = null; paintDropAsk();
  if (!a) return;
  if (mode === 'move') moveRows(a.rows, a.dest, anchor); else xferRun('copy', a.rows, a.dest);
}
function dropAskClose() { if (state.dropAsk) { state.dropAsk = null; paintDropAsk(); } }

// ---------- 움직이기(지금 칸) ----------
function clearQuery(p) {
  if (!p.query) return;
  clearTimeout(p.ftimer); p.query = ''; p.found = null; p.fseq++; p.ff = freshFilter();
  const s = $('[data-fx-search]'); if (s && p === P()) s.value = '';
}
function goFolder(source, id, p = P()) {
  if (!SOURCES.includes(source) && !(source === PH && phoneOn()) && !(source === PC && pcOn())) return;
  clearQuery(p);
  const parent = id || null;
  state.open.add(folderKey(source, parent));
  return setWhere(p, {source, parent});
}
function goShelf(shelf, p = P()) {
  clearQuery(p);
  return setWhere(p, {shelf});
}
function goUp() {
  const p = P(), w = p.where;
  if (!w?.source) return;
  if (!w.parent) { if (solo() && p === state.panes[0]) toTree({release: true}); return; }
  const ids = trailIds(p.trail);
  return goFolder(w.source, ids.length > 1 ? ids[ids.length - 2] : null);
}
function toggle(key, box) {
  if (state.open.has(key)) state.open.delete(key); else {
    state.open.add(key);
    const [source, ...rest] = key.split(':'), id = rest.join(':') || null;
    fillFolder(source, id);
  }
  paintTree();
  (box?.isConnected ? box : root).querySelector(`[data-fx-twist="${CSS.escape(key)}"]`)?.focus({preventScroll: true});
}
function activate(key) {
  const r = rowByKey(key);
  if (!r) return;
  if (r.is_folder) goFolder(r.source, r.item_id); else selectRow(key);
}
const paneOfEl = el => { const box = el?.closest?.('[data-fx-pane-i]'); return box && root.contains(box) ? Number(box.dataset.fxPaneI) : -1; };

// 칸을 누르면(또는 칸 안으로 키보드가 들어가면) 그 칸이 지금 칸.
root?.addEventListener('pointerdown', event => { const i = paneOfEl(event.target); if (i >= 0) setCur(i); }, true);
root?.addEventListener('focusin', event => { const i = paneOfEl(event.target); if (i >= 0) setCur(i); });
root?.addEventListener('click', event => {
  const b = event.target.closest('button');
  if (state.dropAsk && !event.target.closest('[data-fx-dropask]')) dropAskClose();
  // 칸 머리 출처 목록: 목록 밖을 누르면 닫는다(목록 안 단추는 아래에서 처리).
  if (!event.target.closest('.fx-psrc-wrap')) paneSrcClose();
  if (!b || !root.contains(b)) return;
  { const i = paneOfEl(b); if (i >= 0) setCur(i); }
  if (b.matches('[data-fx-row]')) {
    const key = b.dataset.fxRow, p = P();
    if (event.ctrlKey || event.metaKey) { event.preventDefault(); togglePick(key); return; }
    if (event.shiftKey) { event.preventDefault(); rangePick(key); return; }
    if (p.picked.size && PHONE.matches) { togglePick(key); return; }
    if (p.picked.size) unpick();
    p.anchor = key;
    activate(key); return;
  }
  if (b.matches('[data-fx-two]')) { setTwo(!two()); return; }
  if (b.matches('[data-fx-fscope]')) { const p = P(); p.ff = filterSet(p.ff, 'scope', b.dataset.fxFscope); paint(); inPane(p, `[data-fx-fscope="${p.ff.scope}"]`)?.focus({preventScroll: true}); return; }
  if (b.matches('[data-fx-fdim]')) { findDimMenu(b); return; }
  if (b.matches('[data-fx-tree-tog]')) { toggleTree(); return; }
  if (b.matches('[data-fx-pin-go]')) { pinGo(b.dataset.fxPinGo); return; }
  if (b.matches('[data-fx-pin-menu]')) { pinMenu(b); return; }
  if (b.matches('[data-fx-psrc-pin]')) { const p = P(); p.srcOpen = false; pinGo(b.dataset.fxPsrcPin, p); return; }
  if (b.matches('[data-fx-psrc-shelf]')) { const p = P(); p.srcOpen = false; goShelf(b.dataset.fxPsrcShelf, p); return; }
  if (b.matches('[data-fx-psrc]')) { const p = P(), open = !p.srcOpen; paneSrcClose(); p.srcOpen = open; paintPaneTop(p); inPane(p, open ? '[data-fx-psrc-pick]:not([disabled])' : '[data-fx-psrc]')?.focus({preventScroll: true}); return; }
  if (b.matches('[data-fx-psrc-pick]')) { paneSrcPick(P(), b.dataset.fxPsrcPick); return; }
  if (b.matches('[data-fx-pdrop]')) { const p = P(); p.drop = !p.drop; paintPaneTop(p); inPane(p, '[data-fx-pdrop]')?.focus({preventScroll: true}); return; }
  if (b.matches('[data-fx-send]')) { sendOpp(b.dataset.fxSend === 'move' ? 'move' : 'copy', b); return; }
  if (b.matches('[data-fx-drop-go]')) { dropGo(b.dataset.fxDropGo === 'move' ? 'move' : 'copy', b); return; }
  if (b.matches('[data-fx-drop-x]')) { dropAskClose(); return; }
  if (b.matches('[data-fx-mkdir]')) { makeFolder(b); return; }
  if (b.matches('[data-fx-ask]')) { answer(b.dataset.fxAsk === 'go' ? 'go' : 'skip'); return; }
  if (b.matches('[data-fx-dest-close]')) { closeDest(); return; }
  if (b.matches('[data-fx-dest-pick]')) { pickDest(b.dataset.fxDestPick, b.dataset.fxDestName || ''); return; }
  if (b.matches('[data-fx-dest-twist]')) { toggleDest(b.dataset.fxDestTwist); return; }
  if (b.matches('[data-fx-dest-mkdir]')) { destMkdir(b); return; }
  if (b.matches('[data-fx-dest-go]')) { destGo(); return; }
  if (b.matches('[data-fx-copy]')) { openDest('copy', pickedRows()); return; }
  if (b.matches('[data-fx-jobs-open]')) { openJobs(); return; }
  if (b.matches('[data-fx-jobs-close]')) { closeJobs(); return; }
  if (b.matches('[data-fx-jobs-all]')) { jobsDo(b.dataset.fxJobsAll === 'pause' ? 'job_pause' : 'job_resume'); return; }
  if (b.matches('[data-fx-job-act="reup"]')) { reupload(b.dataset.fxJobId); return; }
  if (b.matches('[data-fx-job-act]')) { jobsDo(b.dataset.fxJobAct === 'pause' ? 'job_pause' : 'job_resume', [b.dataset.fxJobId]); return; }
  if (b.matches('[data-fx-upload]')) { const inp = $('[data-fx-file]'); if (inp && hereDest()) { state.upTo = null; inp.value = ''; inp.click(); } return; }
  if (b.matches('[data-fx-star]')) { starRows(pickedRows()); return; }
  if (b.matches('[data-fx-star-one]') && state.preview) { starRows([state.preview.row]); return; }
  if (b.matches('[data-fx-cut]')) { openDest('move', pickedRows()); return; }
  if (b.matches('[data-fx-rename]')) { renameRow(pickedRows()[0], b); return; }
  if (b.matches('[data-fx-look]')) { lookDo(b.dataset.fxLook, b); return; }
  if (b.matches('[data-fx-trash]')) { trashRows(pickedRows(), b); return; }
  if (b.matches('[data-fx-unpick]')) { unpick(); return; }
  if (b.matches('[data-fx-paste]')) { const d = hereDest(); if (state.clip && d) pasteClip(d, b); return; }
  if (b.matches('[data-fx-uncut]')) { uncut(); return; }
  // FOLDER-나무새기준 ②: 폰 나무(공용 줄) — 펼치기·접기, 상자 접기, n개 더 보기, 최근 더보기, 파일 미리보기, ⋯ 그 자리 메뉴(S51-22).
  if (b.matches('[data-fx-tog]')) { toggle(b.dataset.fxTog, b.closest('.nx-tree')); return; }
  if (b.matches('[data-fx-box-tog]')) { toggleBoxShut('files', b.dataset.fxBoxTog); paintTree(); return; } // S52-14: 상자 접힘은 서버 view_prefs.box_shut(기기 종류별, box-fold.js)
  if (b.matches('[data-fx-tmore]')) { state.more.add(b.dataset.fxTmore); paintTree(); return; }
  if (b.matches('[data-fx-recent-more]')) { state.recentAll = !state.recentAll; paintTree(); return; }
  if (b.matches('[data-fx-recent-fold]')) { toggleRecentFolded('files'); paintTree(); root?.querySelector('[data-fx-recent-fold]')?.focus({preventScroll: true}); return; }
  if (b.matches('[data-fx-tfile]')) { const r = state.treeRows.get(b.dataset.fxTfile); if (r) openPreview(r); return; }
  if (b.matches('[data-fx-tmenu]')) { treeMenu(b); return; }
  if (b.matches('[data-fx-go]')) { goFolder(b.dataset.fxGo, b.dataset.fxId || null); return; }
  if (b.matches('[data-fx-shelf]')) { goShelf(b.dataset.fxShelf); return; }
  if (b.matches('[data-fx-twist]')) { toggle(b.dataset.fxTwist, b.closest('.nx-tree')); return; }
  if (b.matches('[data-fx-up]')) { const q = P(); if (solo() && q === state.panes[0]) backToTree(); else goUp(); return; }
  if (b.matches('[data-fx-src]')) { srcClick(b.dataset.fxSrc); return; }
  if (b.matches('[data-fx-pc-knock]')) { pcKnock(); return; }
  if (b.matches('[data-fx-sync]')) { sync({force: true}); return; }
  if (b.matches('[data-fx-close]')) { closePreview(); return; }
  if (b.matches('[data-fx-more-pages]')) { const p = state.preview; if (p?.doc) drawPages(p, p.shown + PDF_FIRST_PAGES); return; }
  const p = state.preview;
  if (b.matches('[data-fx-open]') && p) { openCloud(p.row); return; }
  if (b.matches('[data-fx-pc-reveal]') && p?.row?.source === PC) { pcOpen(p.row, {reveal: true}); return; }
  if (b.matches('[data-fx-down]') && p) { download(p.row); return; }
  if (b.matches('[data-fx-share]') && p) { download(p.row, {share: true}); return; }
  // 미리보기를 새로 그려도 같은 자리 단추로 초점이 돌아온다(paintStep) — ←→ 키를 이어 쓴다.
  if (b.matches('[data-fx-pv-step]')) { previewStep(Number(b.dataset.fxPvStep) < 0 ? -1 : 1); return; }
  if (b.matches('[data-fx-rename-one]') && p) { renameRow(p.row, b); return; }
  // 미리보기 [복사]·[옮기기]: 두 칸이고 반대 칸이 폴더를 열었으면 그리로 바로, 아니면 받을 곳 창.
  if (b.matches('[data-fx-cut-one]') && p) { const d = oppDest(); if (d) { closePreview(); moveRows([p.row], d, b); } else openDest('move', [p.row]); return; }
  if (b.matches('[data-fx-copy-one]') && p) { const d = oppDest(); if (d) { closePreview(); xferRun('copy', [p.row], d); } else openDest('copy', [p.row]); return; }
  if (b.matches('[data-fx-trash-one]') && p) { trashRows([p.row], b); return; }
  if (b.matches('[data-fx-library]')) { openLibraryDoc(b.dataset.fxLibrary); return; }
  if (b.matches('[data-fx-tolib-one]') && state.preview) { sendToLibrary([state.preview.row]); return; }
  if (b.matches('[data-fx-tolib]')) { sendToLibrary(pickedRows()); return; }
  if (b.matches('[data-fx-retry]')) { const q = P(); if (!state.status) enter(true); else if (q.query) refind(q); else loadList(q); }
});
// 두 손가락 손짓은 이 한 곳이 나눈다(손짓 주인 하나, 부품 folder-pinch.js).
// - FOLDER-나무새기준 ④: 폰 나무에서 펼친 폴더(또는 그 안 파일 줄) 위 벌리기 = 그 폴더만(마지막 보기 그대로), 그 폴더만 보는 중 오므리기 = 펼친 자리 그대로 나무.
// - S51-20 ①: 목록 칸(모든 폭) 위 벌리기 = 목록 → 격자 → 큰 격자, 오므리기 = 반대. 목록에서 더 오므리면(폰, 나무에서 들어온 목록) 나무로.
let pinchAt = '';
const treeFolderAt = el => el.closest('[data-fx-fold]')?.dataset.fxFold || el.closest('[data-ft-parent]')?.dataset.ftParent || (el.closest('.ft-box-head') && el.closest('[data-fx-box]') ? el.closest('[data-fx-box]').dataset.fxBox + ':' : null);
// S51-24 UI-빈칸손짓: 목록이 짧아도 아래 빈 곳까지 손짓 칸(gesture-fill.js).
fillGestureArea(root);
if (root) bindFolderPinch(root, {
  enabled: () => !state.xfer,
  folderAt: el => {
    pinchAt = '';
    if (treePane()) { const k = treeFolderAt(el); if (k) pinchAt = 'tree'; return k; }
    // S51-24: '그 폴더만' 안 하위 폴더 줄 위 벌리기 = 한 단계 더 안으로(같은 상자 모양, 돌아올 나무 자리는 그대로).
    const sub = focusBox(state.panes[0]) && el.closest('.ft-folder')?.querySelector('[data-fx-row]')?.dataset.fxRow;
    if (sub) { pinchAt = 'sub'; return sub; }
    const list = el.closest('[data-fx-list]'), i = paneOfEl(el);
    if (list && i >= 0 && state.panes[i].where && !state.panes[i].query) { pinchAt = 'list'; return 'list'; }
    return null;
  },
  onOut: key => {
    if (pinchAt === 'tree') focusTreeFolder(key);
    else if (pinchAt === 'sub') activate(key);
    else if (pinchAt === 'list') setLook(stepLook(lookNow(), 'out'));
  },
  onIn: () => {
    if (pinchAt === 'list' && lookNow() !== 'list') { setLook(stepLook(lookNow(), 'in')); return; }
    // S51-24: 폰 한 칸 목록('그 폴더만')이면 어떤 길로 들어왔든 나무로(손가락이 줄 위든 빈 곳이든).
    const p = state.panes[0]; if (solo() && p.pane === 'list') backToTree();
  }});
root?.addEventListener('dblclick', event => {
  const b = event.target.closest('[data-fx-row]');
  const r = b && rowByKey(b.dataset.fxRow);
  if (r && !r.is_folder) openCloud(r);
});
root?.addEventListener('input', event => { if (event.target.matches('[data-fx-search]')) setQuery(P(), event.target.value); });
root?.addEventListener('change', event => {
  if (event.target.matches('[data-fx-file]')) { const d = state.upTo || hereDest(), files = [...(event.target.files || [])]; state.upTo = null; event.target.value = ''; if (d && files.length) uploadFiles(files, d); return; }
  if (event.target.matches('[data-fx-refile]')) { const f = event.target.files?.[0]; event.target.value = ''; refilePicked(f); return; }
  if (!event.target.matches('[data-fx-sort]')) return;
  // 칸 위 줄의 정렬은 그 칸, 위 줄의 정렬은 지금 칸.
  const i = paneOfEl(event.target), p = i >= 0 ? state.panes[i] : P();
  p.sort = validSort(event.target.value); p.dir = p.sort === 'name' ? 'asc' : 'desc'; paintList(p);
});
// 두 칸 키(F5·F6·Tab): 이 화면이 보이고 두 칸일 때, 입력 칸 밖에서만. 포커스가 화면 안이거나 아무 데도 없을 때(body)만 가로챈다(F5 새로고침을 막는 것은 두 칸 동안만).
function twoKey(event) {
  if (!two() || !visible() || event.altKey || event.ctrlKey || event.metaKey) return false;
  const t = event.target;
  if (t?.matches?.('input,select,textarea,[contenteditable="true"]')) return false;
  if (!(t === document.body || t === document.documentElement || root.contains(t))) return false;
  if (state.xfer || state.ask || state.jobsOpen || state.dropAsk) return false;
  if (event.key === 'F5' || event.key === 'F6') {
    event.preventDefault();
    if (!state.busy && !state.run) sendOpp(event.key === 'F6' ? 'move' : 'copy', $('[data-fx-bar]') || root);
    return true;
  }
  // Tab은 목록 줄(또는 아무 데도 없을 때)에서만 칸을 바꾼다 — 위 줄·막대·칸 위 줄 단추 사이의 Tab 이동은 그대로.
  if (event.key === 'Tab' && (t === document.body || t === document.documentElement || t?.matches?.('[data-fx-row]'))) {
    event.preventDefault();
    const next = state.cur ^ 1, q = state.panes[next];
    setCur(next);
    const box = paneEl(q), rows = [...(box?.querySelectorAll('[data-fx-row]') || [])];
    (rows.find(b => b.dataset.fxRow === q.sel) || rows[0] || box?.querySelector('button,select'))?.focus({preventScroll: false});
    return true;
  }
  return false;
}
document.addEventListener('keydown', event => { if (!root.contains(event.target)) twoKey(event); });
// PC 단축키: ↑↓ 고르기 · Enter 열기(폴더는 들어가기) · Backspace 위 폴더 · / 찾기.
root?.addEventListener('keydown', event => {
  if (event.target.matches('input,select,textarea')) {
    if (event.key === 'Escape' && event.target.matches('[data-fx-search]') && event.target.value) { event.target.value = ''; setQuery(P(), ''); }
    return;
  }
  if (twoKey(event)) return;
  const p = P(), rows = [...(paneEl(p)?.querySelectorAll('[data-fx-row]') || [])];
  const mod = event.ctrlKey || event.metaKey, k = String(event.key).toLowerCase();
  if (event.key === 'Escape' && state.dropAsk) { event.preventDefault(); dropAskClose(); return; }
  if (event.key === 'Escape' && state.panes.some(q => q.srcOpen)) { event.preventDefault(); paneSrcClose(true); return; }
  if (event.key === 'F2') { const list = actRows(); if (list.length === 1) { event.preventDefault(); renameRow(list[0], event.target.closest('button') || root); } return; }
  if (event.key === 'Delete') { const list = actRows(); if (list.length) { event.preventDefault(); trashRows(list, event.target.closest('button') || root); } return; }
  if (mod && k === 'a' && rows.length) { event.preventDefault(); for (const b of rows) p.picked.add(b.dataset.fxRow); paintPicks(p); return; }
  if (mod && k === 'x') { const list = actRows(); if (list.length) { event.preventDefault(); cutRows(list); } return; }
  if (mod && k === 'c') { const list = actRows(); if (list.length) { event.preventDefault(); cutRows(list, 'copy'); } return; }
  if (mod && k === 'v') { const d = hereDest(); if (state.clip && d) { event.preventDefault(); pasteClip(d, root.querySelector('[data-fx-bar]') || root); } return; }
  if (event.key === 'Escape' && state.ask) { event.preventDefault(); answer('skip'); return; }
  if (event.key === 'Escape' && state.xfer) { event.preventDefault(); closeDest(); return; }
  if (event.key === 'Escape' && state.jobsOpen) { event.preventDefault(); closeJobs(); return; }
  if (event.key === 'Escape' && (p.picked.size || state.clip)) { event.preventDefault(); if (state.clip) uncut(); else unpick(); return; }
  if (event.key === 'Escape' && p.drop) { event.preventDefault(); p.drop = false; paintPaneTop(p); return; }
  if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !mod && state.preview && !event.target.closest('[data-fx-media]')) {
    if (previewStep(event.key === 'ArrowLeft' ? -1 : 1)) event.preventDefault();
    return;
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    if (!rows.length) return;
    event.preventDefault();
    const at = rows.findIndex(b => b.dataset.fxRow === p.sel);
    const next = rows[Math.max(0, Math.min(rows.length - 1, at < 0 ? 0 : at + (event.key === 'ArrowDown' ? 1 : -1)))];
    next.focus(); selectRow(next.dataset.fxRow, {show: WIDE.matches && !two()});
  } else if (event.key === 'Enter' && event.target.matches('[data-fx-row]')) {
    event.preventDefault();
    const r = rowByKey(event.target.dataset.fxRow);
    if (r?.is_folder) goFolder(r.source, r.item_id); else if (r) { selectRow(rowKey(r), {show: false}); openCloud(r); }
  } else if (event.key === 'Backspace' && !p.query) { event.preventDefault(); goUp(); }
  else if (event.key === '/') { event.preventDefault(); $('[data-fx-search]')?.focus(); }
});
// 폰: 꾹 누르면 고르기(길게 누르면 브라우저가 contextmenu를 보낸다).
// S51-27 UI-PC우클릭: PC 마우스 우클릭(Shift+F10·메뉴 키)은 그 줄 하나의 메뉴를 누른 자리에 연다 — 나무 줄 ⋯와 같은 항목(files-tree-menu.mjs)·
// 같은 실행(treeAct). 폴더의 '이 폴더만 보기'는 목록에서는 [열기](줄을 누른 것과 같은 폴더 들어가기). 고르기는 Ctrl·Shift 누름·폰 꾹 누르기 그대로.
root?.addEventListener('contextmenu', event => {
  const b = event.target.closest('[data-fx-row]');
  if (!b || state.busy) return;
  if (!touchDrag?.holding() && listMenu(b, event)) { event.preventDefault(); return; }
  event.preventDefault();
  // 손가락으로 누르고 있는 중이면 꾹 눌러 끌기 부품이 맡는다(떼면 고르기, 움직이면 끌기).
  if (touchDrag?.holding()) { touchDrag.armNow(); return; }
  { const i = paneOfEl(b); if (i >= 0) setCur(i); }
  togglePick(b.dataset.fxRow);
});
function listMenu(b, event) {
  const at = appMenuPoint(event, b); if (!at) return false;
  const i = paneOfEl(b); if (i >= 0) setCur(i);
  const key = b.dataset.fxRow, r = rowByKey(key);
  if (!r) return false;
  // S52-44 ⑤: 이 줄을 포함해 여러 개 골랐으면 [여러 개 받기](파일만 zip 하나로).
  const p = P(), many = p.picked.has(key) && p.picked.size > 1 ? pickedRows(p) : [];
  const items = treeMenuItems(r, {phoneWrite: phoneWrite(), pcWrite: pcWrite(), pcEdit: pcEdit(), copyPath: canCopyPath(), pinned: pinState(r), zip: many.some(x => !x.is_folder)}).map(it => (it.id === 'only' ? {...it, id: 'go', label: '열기'} : it));
  return openRowMenu(b, {key: 'list:' + key, title: r.name, items, at, note: r.source === PC && !pcWrite() ? PC_READONLY_TEXT : '',
    run: id => { if (offStop(items, id)) return; if (id === 'go') goFolder(r.source, r.item_id); else if (id === 'zip') void zipDownload(many); else void treeAct(id, r, '', b.isConnected ? b : root?.querySelector(`[data-fx-row="${CSS.escape(key)}"]`) || b); }});
}
// PC: 줄을 폴더(목록의 폴더 줄·나무의 폴더)로 끌어 놓아 옮기기. 끈 줄이 고른 것 안이면 고른 것 모두.
// 두 칸: 반대 칸(그 칸의 지금 폴더 또는 그 칸의 폴더 줄)에 놓으면 '복사 · 옮기기' 작은 고르기.
let drag = null;
root?.addEventListener('dragstart', event => {
  // S52-41 ③: 나무 폴더 줄 끌기(칸에 놓으면 [복사][옮기기], 나무의 다른 폴더에 놓으면 옮기기). 칸 번호 -1 = 나무.
  const fold = event.target.closest?.('[data-fx-fold][draggable="true"]'), fr = fold && root.contains(fold) && state.treeRows.get(fold.dataset.fxFold);
  if (fr && !state.busy) {
    drag = {pane: -1, rows: [fr]};
    event.dataTransfer?.setData('text/plain', 'files-move');
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copyMove';
    return;
  }
  const b = event.target.closest?.('[data-fx-row]');
  if (!b || state.busy) { event.preventDefault?.(); return; }
  { const i = paneOfEl(b); if (i >= 0) setCur(i); }
  const key = b.dataset.fxRow, p = P();
  if (hasPc([rowByKey(key, p)]) && !pcWrite()) { event.preventDefault?.(); return; }
  drag = {pane: state.cur, rows: (p.picked.has(key) ? [...p.picked] : [key]).map(k => rowByKey(k, p)).filter(Boolean)};
  event.dataTransfer?.setData('text/plain', 'files-move');
  if (event.dataTransfer) event.dataTransfer.effectAllowed = two() ? 'copyMove' : 'move';
});
// 놓을 곳: 폴더 줄·칸·나무 폴더(data-fx-drop), 두 칸이면 반대 칸(그 칸의 지금 폴더). any = 꾹 눌러 끌기(놓으면 늘 복사·옮기기를 고름).
const dropAt = (target, {any = false} = {}) => {
  if (!drag || !target?.closest) return null;
  const i = two() ? paneOfEl(target) : -1, cross = i >= 0 && i !== drag.pane;
  const t = target.closest('[data-fx-drop]') || (cross ? target.closest('[data-fx-pane-i]') : null);
  if (!t || !root.contains(t)) return null;
  const dest = t.dataset.fxDrop ? destOf(t.dataset.fxDrop) : paneDest(state.panes[i]);
  if (!dest || pcWhy(drag.rows, dest)) return null;
  if (drag.rows.some(r => r.is_folder && folderKey(r.source, r.item_id) === folderKey(dest.source, dest.parent))) return null;
  // 내 PC ↔ 다른 저장소면 같은 칸 안에서 놓아도 늘 [복사][옮기기]를 고른다(다른 저장소라 기본 옮기기가 없다).
  //   내 PC 안끼리(FILES-내PC쓰기, 0.5.0+ 문)는 클라우드 안처럼 같은 칸이면 기본 옮기기.
  const pcAcross = (hasPc(drag.rows) || dest.source === PC) && !(dest.source === PC && drag.rows.every(r => r.source === PC));
  if (cross || any || pcAcross) return xferPlan(drag.rows, dest, 'copy').ok.length || moveTargetOk(drag.rows, dest) ? {t, dest, rows: drag.rows, cross: true} : null;
  return moveTargetOk(drag.rows, dest) ? {t, dest, rows: drag.rows, cross} : null;
};
const dropOff = keep => {
  for (const el of root.querySelectorAll('.fx-drop-on, .fx-drop-up')) if (el !== keep) { el.classList.remove('fx-drop-on', 'fx-drop-pane', 'fx-drop-up'); delete el.dataset.fxUptext; }
};
root?.addEventListener('dragover', event => {
  // 바탕화면 파일(시안 ⑦): 점선 '여기 놓으면 ○○에 올리기'.
  const upHit = upTarget(event);
  if (upHit) {
    dropOff(upHit.t);
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    upHit.t.classList.add('fx-drop-up');
    upHit.t.dataset.fxUptext = upDropText(destNameOf(upHit.dest));
    return;
  }
  const hit = dropAt(event.target);
  dropOff(hit?.t);
  if (!hit) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = hit.cross ? 'copy' : 'move';
  hit.t.classList.add('fx-drop-on');
  hit.t.classList.toggle('fx-drop-pane', hit.t.matches('[data-fx-pane-i]'));
});
root?.addEventListener('dragleave', event => { if (!event.relatedTarget || !root.contains(event.relatedTarget)) dropOff(null); });
root?.addEventListener('drop', event => {
  const upHit = upTarget(event);
  if (upHit) {
    event.preventDefault();
    dropOff(null);
    // S53-8: 끌어 놓은 폴더는 폴더째(받을 곳에 같은 폴더 모양 + 안의 파일을 전송 목록에). 손잡이는 놓는 순간에만 읽을 수 있어 여기서 받아 둔다.
    const entries = [...(event.dataTransfer?.items || [])].map(it => it.webkitGetAsEntry?.() || null);
    const dirs = new Set(entries.map((e, i) => (e?.isDirectory ? i : -1)).filter(i => i >= 0));
    const files = [...(event.dataTransfer?.files || [])].filter((_, i) => !dirs.has(i));
    const folders = entries.filter(e => e?.isDirectory).map(e => ({source: DROP, item_id: e.fullPath, name: e.name, is_folder: true, entry: e}));
    void (async () => { if (files.length) await uploadFiles(files, upHit.dest); if (folders.length) await treeUp('copy', folders, upHit.dest); })();
    return;
  }
  const hit = dropAt(event.target);
  dropOff(null);
  drag = null;
  if (!hit) return;
  event.preventDefault();
  if (hit.cross) { state.dropAsk = {rows: hit.rows, dest: hit.dest, x: event.clientX, y: event.clientY}; paintDropAsk(); root.querySelector('[data-fx-drop-go]:not([disabled])')?.focus({preventScroll: true}); return; }
  moveRows(hit.rows, hit.dest, hit.t);
});
root?.addEventListener('dragend', () => { drag = null; dropOff(null); });
// S51-20 ③ 꾹 눌러 끌기(폰·폴드 터치, 공용 부품 touch-drag.js): 꾹 누르면 집어 들고 손가락을 따라 폴더(같은 칸·다른 칸·▾ 나무) 위에서 보라 점선,
// 놓으면 [복사][옮기기] 고르기(fx-drop-ask, PC 칸 사이 놓기와 같은 고르기). 움직이지 않고 떼면 지금처럼 고르기. 고른 것이 있으면 고른 것 모두.
// 끌다가 칸(폰 두 칸) 또는 화면 위·아래 끝이면 저절로 굴린다. 끄는 길만 새것이고 복사·옮기기는 xferRun·moveRows 그대로.
const touchDrag = bindTouchDrag(root, {
  enabled: () => !state.busy && !state.xfer && !state.ask && !state.run,
  pick: target => {
    const b = target?.closest?.('[data-fx-row]'), i = paneOfEl(b);
    if (!b || i < 0) return null;
    setCur(i);
    const key = b.dataset.fxRow, p = P(), rows = (p.picked.has(key) ? [...p.picked] : [key]).map(k => rowByKey(k, p)).filter(Boolean);
    if (!rows.length || (hasPc(rows) && !pcWrite())) return null;
    return {key, pane: i, rows, label: rows.length > 1 ? `${rows.length}개` : rows[0].name};
  },
  hold: item => togglePick(item.key),
  over: (item, el) => { drag = {pane: item.pane, rows: item.rows}; const hit = dropAt(el, {any: true}); dropOff(hit?.t); if (hit) { hit.t.classList.add('fx-drop-on'); hit.t.classList.toggle('fx-drop-pane', hit.t.matches('[data-fx-pane-i]')); } },
  drop: (item, el, x, y) => {
    drag = {pane: item.pane, rows: item.rows};
    const hit = dropAt(el, {any: true});
    dropOff(null); drag = null;
    if (!hit) return;
    state.dropAsk = {rows: hit.rows, dest: hit.dest, x, y}; paintDropAsk();
  },
  cancel: () => { drag = null; dropOff(null); },
  scroller: el => el?.closest?.('.fx[data-fx-two="phone"] .fx-listcol') || null,
});
// S52-41 ④: 고정한 폴더 순서 — ⠿ 손잡이 끌기(폰은 꾹 눌러), 키보드는 손잡이에서 ↑↓(공용 reorder-drag.js).
if (root) mountReorder(root, {listSelector: '.fx-pins[data-reorder-list]', itemSelector: '.fx-pin[data-reorder-id]', handleSelector: '.fx-pin-grip[data-reorder-handle]',
  onDrop: ({id, list, index}) => pinReorder(id, list, index), onStep: (id, dir) => pinNudge(id, dir)});
document.addEventListener('visibilitychange', () => {
  // 올리는 중 화면을 숨기면 그 자리에서 멈춤(H-6), 다시 보이면 쥐고 있던 파일로 남은 조각부터.
  if (document.visibilityState === 'hidden') upStop(); else upShow();
  if (visible()) { sync(); loadJobs(); lookLoad(); }
});
folderLook.onChange(() => { if (root && visible()) { paintTree(); paintLists(); paintBar(); } });
window.addEventListener('pagehide', upStop);

// ---------- 들어오기 ----------
async function enter(force = false) {
  resetIfOwnerChanged();
  lookLoad();
  if (entering && !force) return entering;
  entering = (async () => {
    // 내 PC 문은 저절로 한 번 두드린다(크롬 허락 창이 뜰 수 있으면 두드리지 않고 '눌러서 연결'로 둔다).
    if (!state.status || force) { paint(); await Promise.all([loadStatus(), phone.hello(), pc.usable ? pc.hello({auto: true}) : null]); }
    const place = whereOf(window.KPTURouter?.place?.('files') || {});
    const first = onSources(), a = state.panes[0];
    if (!a.where && first.length) {
      // S50-33: 주소에 자리가 있으면 그 자리. 없으면 폰은 나무(목록을 읽지 않음), PC·폴드는 켜진 첫 저장소 맨 위.
      const want = place && (place.shelf || first.includes(place.source)) ? place : null;
      if (want?.source) state.open.add(folderKey(want.source, null));
      if (want) await setWhere(a, want); else if (!solo()) await goHome(a); else paint();
    } else if (a.where) await loadList(a, {quiet: true});
    // 두 칸: 오른쪽 칸도 연다(처음이면 왼쪽과 다른 저장소의 맨 위).
    if (two()) {
      const b = state.panes[1];
      if (b.where) await loadList(b, {quiet: true});
      else { const start = paneStart(1, viewPrefs.getFilesPanes?.(DEVICE), first, a.where); if (start) await setWhere(b, startAt(b, start), {keepPreview: true}); }
    }
    paint();
    for (const s of first) if (!state.children.has(folderKey(s, null))) loadChildren(s, null);
    loadStars();
    startTimer();
    sync();
    loadJobs();
  })().finally(() => { entering = null; });
  return entering;
}
window.addEventListener('kptu:view-changed', event => {
  if (event.detail?.view === 'files') return;
  // 다른 화면으로 가면 미리보기를 놓는다(받은 그림·PDF 메모리도). 맞추기 시계는 멈춘다.
  layer = null; listLayer = null; dropPreview(); dropThumbs(); delete root?.dataset.fxPreview; clearInterval(syncTimer); clearTimeout(jobTimer);
  if (state.jobsOpen) { jobsLayer = null; state.jobsOpen = false; paintJobs(); }
  if (state.xfer) { destLayer = null; dropDest(); }
  dropAskClose();
});
window.addEventListener('kptu:view-prefs-rejected', e => {
  const paths = e.detail?.paths || [];
  if (paths.includes(`box_shut.${DEVICE}`) && state.status) paintTree(); // S52-14: 상자 접힘 저장 거절 → 서버 값으로(알림 없음)
  if (paths.includes(`${FILES_LOOK_KEY}.${DEVICE}`)) { notify('보기 크기를 저장하지 못했어요. 잠시 뒤 다시 해 주세요.', {error: true, record: false}); if (state.status) paintLists(); }
  if (paths.includes(`${FILES_TWO_KEY}.${DEVICE}`)) { notify('두 칸 켜기/끄기를 저장하지 못했어요. 잠시 뒤 다시 해 주세요.', {error: true, record: false}); if (state.status) layoutChanged(); }
  if (!paths.includes(`${FILES_SOURCES_KEY}.${DEVICE}`)) return;
  notify('출처 켜기/끄기를 저장하지 못했어요. 잠시 뒤 다시 해 주세요.', {error: true, record: false});
  if (state.status) sourcesChanged();
});
// 서버 화면 설정이 늦게 오면(두 칸 켬이 바뀌었을 수 있음) 한 번 맞춘다.
let twoSeen = null;
const twoCheck = () => { const now = two(); if (twoSeen !== null && now !== twoSeen && state.status) layoutChanged(); twoSeen = now; };
window.addEventListener('kptu:view-prefs-ready', () => { if (state.status) { twoCheck(); paintLists(); paintTree(); } });
// 접고 펼 때: 펼쳐서(폰 → 폴드) 칸 0이 비어 있으면(폰 나무 첫 화면) 첫 저장소 맨 위를 연다.
PHONE.addEventListener?.('change', () => { if (state.status) { twoCheck(); if (!solo() && !state.panes[0].where) goHome(state.panes[0]); else paint(); } });
WIDE.addEventListener?.('change', () => { if (state.status) { twoCheck(); paint(); } });
window.KPTURouter?.on?.('files', () => { enter(); });
window.KPTUFiles = {refresh: () => enter(true)};
if (window.KPTURouter?.current === 'files') enter();
})();
