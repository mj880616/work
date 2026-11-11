# CAL-일정첨부 — 일정에 사진·파일 붙이기

요청함 'Web2 요청함 2' ■ CAL-일정첨부(접수 11/11 11:11, 명진 "1~3 좋아"). 시안 `docs/design/mockups/event-attach.html`(#2374).

## 1. 원본 위치

- 일정 = Google Calendar, 자료 원문 = Drive(원본 위치 원칙 그대로).
- 파일은 내 작업공간 Drive `자료실 › 일정 첨부` 폴더에 한 번만 올린다(할 일 첨부의 `자료실 › 할 일 첨부`와 같은 길, `_shared/drive-upload.ts`).
- 일정에는 Google 캘린더의 '첨부'(events `attachments`, `supportsAttachments=true`)로 붙인다. 그래서 Google 캘린더 앱의 같은 일정에도 첨부가 보인다.
- **Web2 표는 두지 않는다**(CC 판단 칸): 어느 일정에 어느 파일이 붙었는지는 Google 일정의 `attachments`가 원본이다. 할 일 첨부는 Google 할 일에 첨부 칸이 없어 표(`app_task_attachments`)가 원본이었지만, 일정은 Google에 구조화된 첨부 칸이 있어 같은 사실을 두 곳에 두지 않는다. 그래서 DB 변경이 없다.
- 기기 저장 없음: 고른 파일은 그 탭 메모리에만 있다가 올라간다.

## 2. 서버(`supabase/functions/google-calendar`)

인증·작업공간 소유자 확인·verify_jwt(false, 코드 인증)는 그대로. Google 요청 범위(scope)는 넓히지 않는다 — 일정 쪽은 지금 있는 `calendar.events`, 파일 쪽은 작업공간 Drive 연결(자료실과 같은 길)만 쓴다.

| 요청 | 하는 일 |
| --- | --- |
| `GET event`·`events` | 일정마다 `files`(Drive 첨부만, `drive_file_id`·`file_name`·`mime_type` 세 칸) |
| `POST ?action=attach-file`(multipart: `calendar_id`·`event_id`·`file`) | 일정 확인(25개 한도) → Drive 올리기 → 일정 첨부 쓰기. Google이 확실히 거절하면 이번에 올린 파일만 지운다 |
| `POST {action:'detach-file'}` | [빼기] 일정에서만 뗀다. Drive 파일은 남는다 |
| `POST {action:'trash-file'}` | [삭제] 떼고, 다른 Web2 기록(자료·할 일 첨부·노트)이 같은 파일을 쓰지 않으면 `일정 첨부` 폴더의 이 앱 파일만 Drive 휴지통으로(30일 안 되살림) |
| `POST {action:'restore-file'}` | [되돌리기] 휴지통에서 꺼내고 다시 붙인다(`일정 첨부` 폴더의 내 파일만) |
| `POST {action:'rename-file', base}` | 이름 수정: 확장자는 그대로, Drive 이름과 일정 첨부 이름을 함께(`일정 첨부` 폴더의 내 파일만) |
| `GET ?action=file-photo&calendarId&eventId&fileId&size` | 작은 그림·크게 보기: 그 일정에 붙어 있는 내 사진만 공용 줄인 그림(`_shared/drive-photo.ts`)으로 |

- 화면이 보낸 id는 믿지 않는다: 매번 내 Google 캘린더 토큰으로 그 일정을 다시 읽어 그 파일이 붙어 있는지 확인한다.
- 일정 쓰기는 읽은 판(etag)일 때만 한다(`If-Match`). 그 사이 다른 기기·Google 앱에서 바뀌었으면 한 번 다시 읽어 다시 쓴다(남의 변경을 지우지 않음).
- 공유 범위를 넓히지 않는다: Drive 공유 설정을 건드리지 않는다. 같이 쓰는 캘린더의 상대에게는 첨부 이름만 보이고 열리지 않는다(명진 확인 11:10).
- 일정을 지워도 Drive 파일은 남는다(`delete-event`는 Drive를 건드리지 않음).

## 3. 알고 둘 것

- Google 캘린더 연결 계정과 작업공간 Drive 연결 계정이 다르면, 일정의 첨부는 Drive 연결 계정의 파일을 가리킨다(캘린더 계정으로는 열리지 않을 수 있음). 명진은 두 연결이 같은 계정이라 해당 없음.
- Google 캘린더 앱에서 같은 Drive 파일을 다른 일정에도 붙였다면, 한 일정에서 [삭제]하면 그 파일이 휴지통으로 가 다른 일정의 첨부도 열리지 않는다(Web2가 모든 일정을 뒤질 수 없음). [빼기]는 영향 없음.

## 4. 화면(PR B, `app/event-files.js`)

- 일정 창(`app/calendar-interactions-v2.js` `#ciGoogleModal`) [메모] 바로 아래 `#ciGoogleFiles`(담당조직 칸은 그 다음). 일정 창이 뜨는 곳(달력 월·주·목록, 그날 창, 홈 오늘 일정)은 모두 이 창 하나라 같은 칸이다.
- 사진(jpeg·png·webp·gif)은 72px 작은 그림(서버 `file-photo` small, 공용 `img-slot.js` 칸), 누르면 크게 보기(공용 `photo-view.js`, large). 다른 파일은 이름 한 줄(누르면 Drive에서 열기).
- 줄 끝 ⋯(공용 `row-more.js`): 크게 보기·열기 / 내려받기 / 이름 수정(공용 `file-rename.js` target `event`) / 빼기 / 삭제(공용 `file-trash.js` target `event`, [되돌리기] 포함).
- [붙이기]: 할 일 첨부의 고르기 칸(`task-files.js` `mountNewTaskFilePick`)을 그대로 쓴다(폰: 사진 선택·찍기·파일, PC: 끌어 놓기·붙여넣기). 고른 파일은 탭 메모리에만 있고, 창을 닫으면 버린다.
- [변경사항 저장]: 일정 저장이 확인되면 고른 파일을 일정마다 하나인 뒤 줄(`createAttachQueue`, 노트·업데이트 첨부와 같은 부품)에 넘기고 창을 닫는다. 올리는 중 표시·끝 알림·[다시 올리기]는 공용 `upload-progress.js`. 결과를 모르는 실패는 저절로 다시 보내지 않는다.
- 새 일정 만들기 창(`app/calendar-plus.js` `#eventModal`): 일정 모드에도 같은 고르기 칸. 일정이 만들어지면(create-event) 그 일정에 같은 뒤 줄로 올린다.
- 옛 서버(일정에 `files` 칸이 없음)면 칸을 두지 않는다 — 배포 순서: Edge 먼저, 화면 나중.

## 5. 남은 것 — 요청 6번 '사업 보고로 넘기기'(다음 PR)

이 두 PR에는 넣지 않았다. 계획:

- 쓰기 창(`team.js` `KPTUReportEntry.open({event})`) 사진 칸 아래 '일정에 붙인 사진 n · 넣으려면 누르기'(시안 ③). 일정 첨부 중 사진만, 처음엔 안 고른 상태. 작은 그림은 이 PR의 `file-photo`를 그대로.
- 저장하면 고른 사진만 '같은 Drive 원본을 가리키는 자료 행'으로 그 사업 보고에 잇는다(올리기·복사 없음). 서버는 document-actions의 `registerDriveDocument`(바구니 첨부·[파일] 등록이 쓰는 길)를 재사용하고, 그 파일이 내 일정의 첨부인지는 내 캘린더 토큰으로 확인한다(새 action).
- 지킬 것: 일정 첨부 [삭제]는 이미 '자료가 같은 파일을 쓰면 Drive에 남김'을 본다(이 PR). 반대로 사업 보고 쪽에서 그 자료를 지울 때 일정이 같은 파일을 쓰는지는 서버가 알 수 없으므로, 그 자료 지우기는 자료 행만 지우고 Drive 원본은 두는 규칙을 함께 정해야 한다.
