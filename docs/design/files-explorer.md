# 파일 탐색기 설계 (FILES-클라우드탐색기, S48-12)

📱 폰 가능 — 이 문서는 설계·조사와 정적 시안만 담는다. 앱 코드·DB·Edge·워크플로 변경 없음. SQL 초안도 넣지 않는다(DB PR에서 짝 파일 5개로).

- 작성: 2026-11-02, Claude Code 웹(작업 세션 S48-12). 기준 main `3945862`.
- 요청: 요청함 `[11/01 23:17] 새 메뉴 '파일'`(명진 결정 F1~F5 모두 추천안 "ㅇ", 11/01 23:21). 함께 본 것: `[11/01 23:16] 사진 [폴더] — 구글 드라이브 폴더 보기를 원드라이브 방식으로 통일`(접수 PHOTO-드라이브폴더통일).
- 시안: [mockups/files-explorer.html](mockups/files-explorer.html)(PC 1440 · 폰 412, 파일 이름은 모두 가짜).
- 표기: [사실] = 저장소 코드·migration에서 직접 확인, [추정] = 공개 API 문서 기억·짐작(이 세션에서 다시 확인 못 함). 웹 세션이라 production·운영 DB는 보지 않았다.
- 공개 저장소: 실제 파일·폴더 이름, 계정, 토큰은 문서·시안·코드에 쓰지 않는다.

## 0. 이미 정해진 것 (F1~F5, 11/01 23:21)

| 번호 | 결정 |
| --- | --- |
| F1 | 메뉴 이름 '파일' |
| F2 | 범위: 원드라이브 + 구글 드라이브. 폰 저장소는 나중 |
| F3 | 먼저: 보기·검색·미리보기·옮기기·올리기 → 그다음: 클라우드 사이 옮기기·같은 파일 |
| F4 | PC 우선. 폰은 보기·검색·열기·공유 위주 |
| F5 | 운영자 기능(서버 허용표) |

## 1. 요약과 추천

1. **빠른 까닭 = 서버 색인**. 두 클라우드의 파일 목록(이름·부모 폴더·크기·바뀐 날·종류·해시)을 Web2 DB 색인 표에 미리 두고, 화면은 색인에서 바로 그린다. 폴더 이동·정렬·검색은 클라우드를 부르지 않는다. 바뀐 것만 따라가는 길(원드라이브 delta, 구글 changes)로 색인을 갱신한다. 파일 **본문은 열 때만** 원본에서 받는다. 색인에 내용은 넣지 않는다.
2. **새 Edge 함수 `cloud-files` 하나**(`verify_jwt=true`). 사진 함수(`onedrive-photos`·`gdrive-photos`)를 넓히지 않는다 — 두 함수의 보안 경계는 "고른 사진 폴더 안만"이라 파일 전체 탐색과 경계가 다르다. 토큰 읽기·Graph·Drive 호출 코드는 `_shared/`로 옮겨 함께 쓴다(복사 금지).
3. **새 OAuth 권한은 필요 없다** [사실]. 원드라이브는 이미 `Files.ReadWrite offline_access User.Read`(`onedrive-photos/graph.ts:3`), 구글은 이미 `https://www.googleapis.com/auth/drive`(`public-policy-drive`가 요청, `gdrive-photos`가 `scopeHas`로 확인). 넓히는 것은 OAuth 범위가 아니라 **우리 함수 코드의 경계**(사진 폴더 → 드라이브 전체)이고, 그래서 새 기능 키 `files`로 운영자 작업공간에만 연다.
4. **지우기는 그 클라우드의 휴지통으로만**, 영구 삭제·휴지통 비우기·외부 공유 링크 만들기는 함수에 아예 넣지 않는다. 폰 '공유'는 파일을 받아 폰 공유 창으로 넘기는 것(클라우드 공유 링크 아님).
5. **폴더 나무는 사진과 같은 부품**. PHOTO-드라이브폴더통일이 사진의 원드라이브·구글 폴더 나무를 한 부품으로 모으므로, 파일 메뉴는 그 부품을 그대로 쓴다(그 PR 뒤에 줄 세움).
6. PR은 8개로 나눈다(6절). DB(②)·Edge(③) 직전에 정지.

## 2. 지금 있는 것 (사실, 저장소 기준)

| 무엇 | 어디 | 이번에 쓰는 법 |
| --- | --- | --- |
| 원드라이브 연결 | 표 `app_onedrive_connections`(refresh_token·scope·고른 폴더), Edge `onedrive-photos`(owner만 확인, 기능 키 검사 없음) | 같은 연결·같은 토큰을 `cloud-files`가 service role로 읽음. 연결 표에는 칸을 더하지 않음(photo-menu.md 2.2와 같은 원칙) |
| 원드라이브 사진 색인 | `app_onedrive_folders`·`app_onedrive_photos`, 연결 표의 `delta_link`·`next_link`·`index_lock_until`, Graph delta·10분 지나면 화면이 부를 때 조금씩 받기(`SYNC_STALE_MS`) | 같은 방식(잠금·쪽 나눠 받기·시간 상한)을 파일 색인에 씀. 사진 색인과 delta 커서는 따로 둠 |
| 구글 드라이브 연결 | `public_policy_drive_config` id=1 하나(운영자 작업공간 `kptu-work`). `gdrive-photos` 네 겹 검사: 로그인 → owner → `app_my_features()`에 기능 키 → `app_operator_feature_workspace()`가 연결 작업공간과 같음 | 같은 네 겹 검사를 기능 키 `files`로. 쓰기는 `confirm:true`일 때만(같은 규칙) |
| 구글 사진 색인 | `app_gdrive_sync`·`app_gdrive_folders`·`app_gdrive_photos`. changes 토큰 없음, 켠 폴더를 다시 훑음 | 파일 전체에는 다시 훑기가 너무 큼 → **changes 토큰**을 새로 씀(4절) |
| 운영자 허용표 | `public.app_operator_features`(RLS 켬·정책 없음·API 역할 권한 없음), 키 `calls`·`telegram`·`gdrive_photos`(check 제약) | 키 `files`를 check 제약에 더하는 migration 필요(SQL로만 넣음) |
| 폴더 나무 모양 | `app/folder-tree.css` `.nx-tree`(노트·사진 공용), 계산 `photos-model.mjs` `photoFolderRows`·`photoFolderTrail`·`photoMoveTargets` | PHOTO-드라이브폴더통일에서 그리기까지 한 부품으로 모은 뒤 재사용 |
| 파일 종류·열기 | `app/library-tree.js` `fileKindOf`·`KIND_ORDER`, `app/file-actions.js` `clickKind`, `app/file-rename.js`, `app/library-move-picker.js` `createMovePicker` | 종류 판정·이름 바꾸기 편집기·옮길 곳 고르기를 다시 씀(저장 길만 `cloud-files`로) |
| 미리보기 | 앱 안 PDF·오피스 미리보기 **없음**(Drive 보기로 엶). HWP는 `app/hwp-frame.js`(rhwp 0.8.7 sandbox iframe) | 사진·HWP는 기존 부품, PDF·오피스는 5절 |
| 자료실 | `app_documents.file_id`(Drive id)·`previous_files`, 폴더 `app_drive_settings.library_folder_id`·`basket_folder_id` | 구글 파일 id가 `app_documents.file_id`와 같으면 '자료실' 표시. 파일 안 글자는 `app_documents.extracted_text`(ready만)를 그대로 검색 |
| 선택·끌기 | 사진 선택 모드 공용 부품, `reorder-drag.js` | 여러 개 고르기·끌어 옮기기에 재사용 |

## 3. 권한 경계

- **누가**: 운영자 작업공간 owner만. `cloud-files`는 매 요청마다 ① 로그인 확인 ② owner ③ 로그인 토큰으로 `app_my_features()`에 `files` ④ (구글) `app_operator_feature_workspace('files')`가 Drive 연결 작업공간과 같음 ⑤ (원드라이브) 그 작업공간의 `app_onedrive_connections` 행. 화면 숨김은 권한이 아니다 — 메뉴는 `app_my_features()`에 `files`가 있을 때만 그리되, 막는 것은 서버다.
- **무엇을**: 사용자 본인 연결의 드라이브 전체(내 파일). 구글 '공유 문서함'(남이 공유한 파일)은 1단계 색인에서 뺀다(`'me' in owners` 또는 내 드라이브 부모 기준, [추정] 결정 Q6). 공유 드라이브(팀 드라이브)도 뺀다.
- **새 범위**: 없음(1절 3). 만약 원드라이브 휴지통 되살리기를 앱 안에서 하려면 `Files.ReadWrite.All`이 필요 [사실, photo-menu.md 2.3] → **하지 않는다**. 되살리기는 각 클라우드 화면에서(Q1).
- **함수에 넣지 않는 것**: 영구 삭제(`files.delete`·Graph permanentDelete), 휴지통 비우기, 공유 링크·권한 만들기(Graph `createLink`·`invite`, Drive `permissions.create`), 소유자 바꾸기. 시험(`tests/security/`)에서 이 호출 문자열이 함수 코드에 없음을 검사한다.
- **쓰기 규칙**: 이름 바꾸기·새 폴더·옮기기·휴지통은 `confirm:true` 한 번 + 한 번에 최대 200개. 자동·예약 쓰기 없음. 휴지통으로 보내기는 화면에서 '되돌리기는 원드라이브/구글 드라이브 휴지통에서' 한 줄을 확인 창에 보임.
- **색인 표**: RLS 켬. 화면은 owner 읽기만(정책: `private.app_is_workspace_owner(workspace_id)` + `private.app_workspace_has_feature(workspace_id,'files')`). 쓰기는 service role(`cloud-files`)만. anon·PUBLIC 권한 없음.
- **토큰**: 서버에서만. 화면에는 토큰·임시 받기 주소를 오래 남기지 않는다. 올리기(5절)만 예외로 클라우드가 준 한 파일짜리 올리기 주소를 화면이 쓴다 — 그 주소는 그 파일 하나에만 쓰이고 몇 시간 안에 끝난다 [추정]. 로그·PR에 남기지 않는다.

## 4. 목록 불러오기·갱신 (캐시 지우기 해결 금지)

### 4.1 색인 표 (DB PR에서 확정)

| 표 | 칸(요지) |
| --- | --- |
| `app_cloud_sync` | workspace_id, source(`od`/`gd`), cursor(원드라이브 deltaLink / 구글 changes pageToken), next_page(처음 훑기 이어 받기), index_done_at, synced_at, lock_until, last_error |
| `app_cloud_items` | workspace_id, source, item_id, parent_id, name, is_folder, mime, size_bytes, modified_at, created_at, hash(원드라이브 sha1/quickXor, 구글 md5), web_url 없음(열 때 계산), trashed 여부, 기본키 (workspace_id, source, item_id) |
| `app_cloud_stars` | workspace_id, source, item_id, created_at — 별표는 색인과 따로(색인 행은 다시 만들어질 수 있음) |

폴더 장수(파일 수)는 표에 저장하지 않고 RPC가 `parent_id`로 센다(Q3).

### 4.2 처음 훑기와 따라가기

- **원드라이브**: `/me/drive/root/delta`를 쪽마다 받아 넣고, 끝나면 deltaLink를 커서로 둔다. 이후 커서로 바뀐 것만 [사실: 사진 쪽이 같은 API를 씀].
- **구글**: 처음은 `changes.getStartPageToken`을 먼저 받아 두고 `files.list`(q `'me' in owners and trashed=false`, 필요한 칸만, pageSize 1000)로 끝까지 훑은 뒤, 그 토큰으로 `changes.list`(`restrictToMyDrive=true`·`includeRemoved=true`)를 따라간다 [사실: Drive v3 `changes.list` 문서 2026-11-02 확인 — pageSize 최대 1000, `nextPageToken`·`newStartPageToken`은 만료되지 않음, `restrictToMyDrive`는 내 드라이브 나무만]. 토큰이 거절되면(400·410) 그 출처만 처음부터 다시 훑는다(③ `cloud-files` 구현).
- 한 번 부를 때 시간 상한(8초)·쪽 상한, `lock_until`로 겹침 막기, 남으면 `next_page`에 이어 받기 — 사진 색인과 같은 틀.

### 4.3 화면이 최신을 아는 길

1. 메뉴를 열면 색인에서 바로 그린다(기다림 없음). 맨 위 줄에 '방금 맞춤 / n분 전 맞춤' 작게.
2. 동시에 `cloud-files ?action=sync`를 부른다. `synced_at`이 2분보다 오래됐을 때만 실제로 클라우드를 부른다(Q2). 응답은 **바뀐 행 목록**이고, 화면은 그 행만 고쳐 그린다(전체 다시 그리기·늦게 덮어쓰기 없음).
3. 화면이 열려 있는 동안 2분마다, 그리고 창으로 돌아올 때(visibilitychange) 2번을 반복.
4. Web2에서 한 쓰기(이름·옮기기·휴지통·올리기)는 함수가 클라우드 응답으로 **같은 요청 안에서 색인을 고치고** 고친 행을 돌려준다 → 화면은 그 행으로 바로 그림.
5. 밤 예약(하루 1번)이 커서 따라가기 + 처음 훑기 미완 이어 받기를 한다(Q2, 비밀 헤더 방식은 `drive-summary` 예약과 같게).
6. 커서가 만료되면(원드라이브 410 resyncRequired, 구글 토큰 무효) 그 출처만 처음 훑기를 다시 한다. 다시 훑는 동안에도 기존 색인으로 보이고, 끝나면 남은 옛 행을 지운다.

화면 쪽 메모리 보관은 그 화면이 열린 동안만이다. 로컬 스토리지·IndexedDB에 목록을 두지 않는다(한 기기 저장 금지). 마지막 탭·정렬·미리보기 칸 열림 같은 화면 설정은 기존 서버 화면 설정에 둔다.

### 4.4 미리 받기

- 폴더를 열면 그 폴더 사진·PDF 앞 30개의 썸네일만 미리 받는다(`cloud-files ?action=thumb`, 원드라이브 thumbnails / 구글 thumbnailLink를 서버가 중계).
- 목록에서 위아래로 고를 때 다음 1개 파일의 미리보기를 미리 받는다(PC). 본문 원본은 미리 받지 않는다.

### 4.5 검색

- 이름 검색: 색인에서(두 클라우드 함께, 폴더 경로 표시). 입력하는 대로 200ms 쉬고 찾기. DB 쪽 trigram 색인은 DB PR에서 판단.
- 파일 안 글자: 1단계는 자료실이 이미 읽어 둔 글자(`app_documents.extracted_text`)만, 구글 파일 id가 같은 것에 '글자 맞음' 표시(Q7). 새로 본문을 읽어 저장하는 것은 하지 않는다(내용을 색인에 넣지 않는다는 원칙).

## 5. 미리보기·열기·올리기

| 종류 | 미리보기(오른쪽 칸 / 폰 전체 화면) |
| --- | --- |
| 사진·동영상 | 기존 `photo-view` 부품. 받기는 `cloud-files` 중계 |
| PDF | 1단계: 클라우드 보기 화면 새 창(지금 자료실과 같음). 2단계: 앱 안 PDF 보기(고정 버전 라이브러리, 저장소 안 폴더로 둠 — 외부 주소 부르지 않음) |
| HWP·HWPX | 기존 rhwp 보기(`hwp-frame.js`) 읽기 전용 |
| 오피스(docx·xlsx·pptx) | 원드라이브: Graph `/content?format=pdf` 변환 받기 [사실: Graph `driveitem-get-content-format` 문서 2026-11-02 확인 — 개인 계정 위임 권한 `Files.Read` 이상(이미 받은 `Files.ReadWrite`로 됨), 302로 몇 분짜리 사전 인증 주소를 줌, 원본 확장자 doc·docx·dot·dotx·dotm·ppt·pptx·pps·ppsx·xls·xlsx·xlsm·odt·odp·ods·rtf 등]. 구글: 구글 문서류는 `files.export` PDF(내보내기 상한 10MB), 업로드된 오피스 파일은 클라우드 보기 새 창(Q4·F4) |
| 글·CSV·HTML | 앞 200KB를 받아 글로 보임(HTML은 기존 칸막이 sandbox) |
| 그 밖 | 이름·크기·바뀐 날·경로만, [열기]·[받기] |

- **열기**: 클라우드 보기 주소(원드라이브 webUrl, 구글 webViewLink)를 함수가 그때 받아 새 창. 
- **올리기(PC 끌어 놓기)**: 함수가 그 클라우드의 이어 올리기 자리(원드라이브 createUploadSession, 구글 resumable)를 열어 주고, 화면이 파일을 조각으로 직접 보낸다(Edge 요청 크기 한계를 피함) [추정 — ③ 세션에서도 확인 못 함. 특히 구글 resumable 주소를 서버가 열면 브라우저 조각 보내기가 CORS로 막힐 수 있다. ⑥ 세션이 실제로 시험하고, 막히면 대안: (1) 서버가 세션을 열 때 `Origin`에 Web2 주소를 넣어 연다, (2) 그래도 막히면 조각을 Edge가 중계(조각 하나는 Edge 요청 한계 안, 느림)]. 끝나면 함수가 색인에 넣음. 같은 이름이 있으면 '이름 (2)'로.
- **옮기기**: 같은 클라우드 안은 부모 바꾸기(빠름). 클라우드 사이(⑦)는 서버가 받아 보내고 크기·해시를 맞춘 뒤 원본을 휴지통으로 — 한 번에 1개·최대 크기 상한(Q8).

## 6. 화면 구성

- **PC(1440)**: 왼쪽 나무(240) · 가운데 목록 · 오른쪽 미리보기(320, 접기). 나무 맨 위 묶음 [최근] [별표] [큰 파일] 다음 '원드라이브 n'·'구글 드라이브 n' 두 뿌리. 목록 머리: 위치 줄(`원드라이브 › 문서 › 2026`) · 검색 칸 · 정렬 · 보기(목록/격자). 목록 칸: 이름 · 바뀐 날 · 크기 · 종류(아이콘). 줄 높이 28px, 큰 버튼·카드 없음. 고르면 머리 자리가 '3개 골라짐 · 옮기기 · 이름 · 휴지통 · ✕' 한 줄로 바뀜.
- **단축키(PC)**: Enter 열기, Backspace 위 폴더, F2 이름, Delete 휴지통(확인), Ctrl/⌘+A 모두, Shift·Ctrl 클릭 여러 개, `/` 검색, 화살표 이동, Space 미리보기 켜고 끄기.
- **폴드(펼침, 약 880)**: 나무 + 목록 두 칸, 미리보기는 목록 위 덮는 칸(뒤로가기로 닫힘).
- **폰(412)**: 한 칸. 맨 위 위치 줄(누르면 위 단계로) + 검색. 탭 [최근] [폴더] [별표], 좌우 밀기로 탭 이동. 줄 누르면 미리보기 전체 화면, 길게 누르면 고르기. 미리보기 아래 작은 줄: [열기] [공유] [⋯](별표·이름·옮기기·휴지통). 뒤로가기 = 이전 화면. 팝업은 하단바 위로.
- 자료실 파일은 줄 끝에 작은 '자료실' 글자, ⋯에 [자료실에서 보기]. 다른 파일 ⋯에는 [자료실에 넣기]·[업데이트로 보내기](⑥, S49-9 이름 통일 — 옛 [정리함에 넣기]).
- 빈 폴더: 목록 자리에 '빈 폴더' 한 줄만. 처음 훑는 중: 맨 위 줄 '목록 맞추는 중 · 1,240개'.

## 7. PR 나누기 순서

| 순서 | PR | 바뀌는 곳 | 정지 |
| --- | --- | --- | --- |
| 0 | (앞) PHOTO-드라이브폴더통일 — 폴더 나무 한 부품 | `app/photos.js`·`app/gdrive-photos.js`·`app/photos.css` | — |
| ① | 이 PR: 설계·시안 | 문서만 | — |
| ② | DB: 기능 키 `files`(check 제약), `app_cloud_sync`·`app_cloud_items`·`app_cloud_stars`, RLS·읽기 RPC(목록·폴더 장수·검색) | migration 짝 파일 5개 | **DB 적용 직전** |
| ③ | Edge `cloud-files` 읽기: status·sync·list 보조·thumb·media 중계·open-url. `_shared`로 토큰·Graph·Drive 코드 옮김(사진 함수 동작 바뀌지 않음 시험) | `supabase/functions/cloud-files/`, `_shared/` | **첫 배포 직전**(`first_deploy=true`, `verify_jwt=true`, 5절 표 등록) |
| ④ | 화면 ①: 메뉴 '파일', 세 칸·폰 한 칸, 나무·목록·정렬·검색·최근·큰 파일·자료실 표시, 갱신 구조(4.3) | `app/files.js`·`app/files.css`·`app/files-model.mjs`, `menu-model.mjs` | — |
| ⑤ | 미리보기 + 쓰기: 이름·새 폴더·같은 클라우드 옮기기·휴지통, 여러 개 고르기·끌어 옮기기, 단축키 | `cloud-files` 쓰기 action, `app/files*.js` | **Edge 배포 직전** |
| ⑥ | 올리기(PC 끌어 놓기) + 별표 + [자료실에 넣기]·[업데이트로 보내기] | 같은 파일들 | **Edge 배포 직전** |
| ⑦ | 클라우드 사이 옮기기, 같은 파일 보기(해시) | 같은 파일들 | **Edge 배포 직전** |
| ⑧ | 밤 예약 갱신 workflow | `.github/workflows/cloud-files-sync.yml` | 비밀값 등록은 명진 |

②·③은 서로 앞뒤(③이 ② 표를 씀). ④는 ③ 배포 뒤. ⑤~⑦은 같은 파일을 만지므로 한 줄로.

## 8. 명진이 고를 것 (추천 ★)

| 번호 | 질문 | 고를 것 |
| --- | --- | --- |
| Q1 | 원드라이브에서 지운 파일은 어디로? | ★ 원드라이브 자체 휴지통(되살리기는 원드라이브 화면에서) / 사진처럼 'Web2 휴지통' 폴더로 옮겼다가 30일 뒤 휴지통 |
| Q2 | 목록을 얼마나 자주 맞출까? | ★ 화면 열 때·2분마다 바뀐 것만 + 밤에 한 번 / 화면 열 때만 |
| Q3 | 폴더 옆 숫자는? | ★ 그 폴더에 바로 든 파일 수(사진과 같게) / 하위 폴더까지 모두 |
| Q4 | 오피스 파일 미리보기 | ★ 클라우드가 PDF로 바꿔 준 것을 오른쪽 칸에 / 미리보기 없이 [열기]만 |
| Q5 | 메뉴 자리 | ★ 자료실 바로 아래 / 사진 옆 |
| Q6 | 구글 '공유 문서함'(남이 나에게 공유한 파일)도 보일까? | ★ 1단계는 내 드라이브만 / 함께 보임(읽기만) |
| Q7 | 파일 안 글자 검색 | ★ 자료실이 이미 읽은 글자만 / 파일 메뉴도 새로 읽어 저장(AI·저장 비용 늘어남) |
| Q8 | 클라우드 사이 옮기기 크기 상한 | ★ 한 번에 1개, 200MB까지 / 상한 없이(오래 걸리면 실패할 수 있음) |
| Q9 | 폰 첫 화면 | ★ 최근 파일 / 맨 위 폴더 |

## 8.1 명진 결정 (11/02 16:26, 모두 ★)

F1 원드라이브 자체 휴지통 / F2 열 때 + 2분마다 바뀐 것만 + 밤 한 번 / F3 바로 든 파일 수 / F4 오피스는 PDF로 오른쪽 칸 / F5 자료실 바로 아래 / F6 1단계 내 드라이브만 / F7 자료실이 이미 읽은 글자만 / F8 클라우드 사이 한 번에 1개·200MB / F9 폰 첫 화면 최근 파일.

## 8.2 구현 기록 (S48-12b, ②·③)

- ② DB `20261102160000_cloud_files_index`: 기능 키 `files`(gdrive_photos = calls 작업공간에만 1행), 표 `app_cloud_sync`(화면 못 읽음, 상태는 Edge `status`)·`app_cloud_items`·`app_cloud_stars`(owner + files일 때 authenticated select만, 쓰기 service_role만), 읽기 함수 `app_cloud_list(source, parent_id)`(폴더 옆 숫자 = 바로 든 파일 수)·`app_cloud_trail(source, item_id)`(위치 줄)·`app_cloud_find(query, shelf, limit)`(이름 + 자료실 ready 글자 / recent·big·starred). 모두 SECURITY INVOKER. 내 드라이브 맨 위에 바로 든 항목은 `parent_id` null(뿌리 폴더 자체는 넣지 않음).
- ③ Edge `cloud-files`(verify_jwt=true, 첫 배포 전): `status`·`sync`·`thumb`·`media`·`preview`·`open-url`. 원드라이브는 delta 하나로 처음 훑기·따라가기(410이면 다시 훑기), 지운 폴더는 아래까지 색인에서 뺌. 구글은 휴지통이면 `trashed` 표시, 내 것이 아니게 되거나 지워지면 뺌. 중계는 그림·동영상·소리·PDF·글만 그 종류로, 나머지(HTML 등)는 받기(attachment)로만.
- 토큰 코드: 사진 함수(`onedrive-photos`·`gdrive-photos`)를 다시 배포하지 않도록 이번에는 `_shared`로 옮기지 않고, 상수·검사 함수만 두 사진 함수에서 import했다(복사 없음). 토큰 받기 몇 줄은 `cloud-files`에 따로 있다 — 사진 함수를 고칠 다음 기회에 `_shared`로 모은다(발견사항).

## 8.3 구현 기록 (S48-45, ⑤·⑦ 쓰기)

- Edge `cloud-files` 쓰기 action 5개(모두 `confirm:true`, 대상은 그 작업공간 색인 안·휴지통 아님, 결과 줄을 같은 요청 안에서 색인에 반영):
  `rename`(같은 폴더 같은 이름 거절) · `mkdir` · `move`(같은 클라우드, 1~200개, 4개씩 동시·40초 안, 남은 것은 `left`로 돌려주고 화면이 이어 부름, 폴더를 자기 아래로 금지)
  · `trash`(F1: 원드라이브 `DELETE /me/drive/items/{id}` = 원드라이브 휴지통, 구글 `trashed:true`. 폴더면 색인에서 그 아래까지 뺌)
  · `across`(F8: 파일 1개·200MB, 구글 문서류·폴더 안 됨. 원본을 받는 대로 이어 올리기 10MiB 조각으로 보내며 MD5·SHA-1을 세고,
  보낸 크기 = 원본 크기 = 새 파일 크기, 원본 색인 해시·새 파일 해시가 맞을 때만 원본을 휴지통으로. 안 맞으면 새 것을 휴지통으로 보내고 원본은 그대로).
- 이름 규칙은 자료실 이름 고치기와 같은 `_shared/file-rename-name.mjs`(화면도 같은 파일로 미리 막음).
- 화면: 고르기(PC Ctrl·⌘·Shift, 폰 꾹 누르기) → 위 한 줄 막대(옮기기·이름·휴지통·✕), 옮기기는 잘라 붙이기([옮기기] → 폴더 열기 → [여기로 옮기기])와
  PC 끌어 놓기(목록 폴더 줄·나무 폴더), 미리보기 아래 [이름]·[옮기기]·[휴지통], [새 폴더]. 휴지통·클라우드 사이 옮기기는 확인 창 한 번(되돌리는 곳 안내).
  단축키 F2·Delete·Ctrl+A·Ctrl+X·Ctrl+V·Esc.
- 남은 것: ⑥ 올리기·별표·[자료실에 넣기]·[업데이트로 보내기], ⑦의 '같은 파일 보기'(해시), ⑧ 밤 예약.
- 위험: 200MB 옮기기는 Edge 한 번 실행 시간(요금제 한도) 안에 끝나야 한다. 넘으면 새 파일이 덜 만들어진 채 실패하고 원본은 그대로다(원본을 먼저 지우지 않음).

## 9. 범위 밖 발견사항

- `onedrive-photos`는 owner만 보고 기능 키 검사가 없다 [사실]. 원드라이브 연결은 작업공간마다라 지금은 문제가 아니지만, 다른 사람이 쓰기 시작하면(MULTI ②) 다시 볼 일. 이번에는 고치지 않음.
- `gdrive-photos`는 changes 토큰 없이 켠 폴더를 다시 훑는다 [사실]. 파일 색인이 생기면 사진 색인이 파일 색인을 읽게 바꿀 수 있음(나중 판단, 이번 범위 아님).
