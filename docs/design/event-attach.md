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
