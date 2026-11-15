# 20261028010000_onedrive_photo_index

무엇이 바뀌나: 원드라이브 사진의 '목록'(사진 이름·찍은 날짜·어느 폴더에 있는지)과 하위 폴더 목록(켜짐·꺼짐)을 서버에 적어 둘 새 표 2개가 생기고, 원드라이브 연결 표에 '어디까지 받았는지'를 적는 칸 5개가 붙습니다. 사진 파일 자체는 저장하지 않습니다. 화면은 아직 이 표를 쓰지 않아 겉으로 달라지는 것은 없습니다.
잘못되면: 사전·시험 적용·사후 확인 중 하나라도 어긋나면 멈추고 아무것도 바뀌지 않습니다. 적용 뒤 문제가 생겨도 지금 Edge·화면은 이 표를 쓰지 않으므로 일기·사진 올리기는 그대로입니다.
되돌리는 법: (Edge 새 판을 배포했다면 먼저 이전 판으로 되돌린 뒤) 짝 rollback을 SQL Editor 새 창에서 실행해 새 표 2개·새 칸 5개·기록 1행만 지웁니다. 지워지는 것은 원드라이브에서 다시 받을 수 있는 목록 사본과 폴더 켜짐 설정뿐입니다.

## 권한
- 세 표 모두 RLS 켬, 정책 없음, authenticated·anon·PUBLIC 권한 없음(기존 연결 표와 같은 방식). 화면은 Edge `onedrive-photos`를 거쳐서만 읽고 바꾼다.
- 새 표 2개: service_role `select·insert·update·delete`만(비우기·참조·트리거 없음). 여러 행을 한 번에 넣고 바꾸는 upsert가 모든 칸 update를 요구하므로 표 단위 update를 준다(연결 표와 달리 토큰이 없다).
- 연결 표: service_role에 새 칸 5개 고치기 권한만 더한다. 넣기 칸·workspace_id 고치기 권한은 그대로 없음.
- 사전·사후 확인 SQL은 `pg_catalog`만 읽는다(`information_schema` 쓰지 않음).

## 적용 순서
1. 이 DB PR merge → 승인형 DB workflow apply(version `20261028010000_onedrive_photo_index`).
2. Edge PR(`feat/onedrive-index-edge`) merge → Edge `onedrive-photos` 배포(verify_jwt 기존 값 유지).
3. 화면 세션(폴더 켜기·끄기, 색인 진행 표시).
