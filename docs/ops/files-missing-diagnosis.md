# [파일] 파일·폴더가 다 안 나올 때 — 운영 읽기 확인 (FILES-다안나옴, S48-65)

📱 폰 경로 C(읽기 전용 select만). 운영 DB 쓰기 없음. 결과의 파일·폴더 이름은 문서에 쓰지 않는다(숫자만).

웹 세션은 운영을 볼 수 없어 원인을 사실로 확정하지 못했다. 코드 확인으로 **쪽 넘김·이어 받기·시간 상한 끊김은 정상**임을 시험으로 확인했다(5쪽 드라이브를 시간 상한으로 끊어 여러 번에 나눠 받아도 끝까지 훑음). 아래 숫자로 빠지는 곳을 가른다.

## 1. 색인 상태 (원드라이브 od / 구글 gd)

```sql
select source, index_done_at, synced_at, scan_started_at, (next_page is not null) as has_next_page,
       (cursor is not null) as has_cursor, last_error, lock_until
from public.app_cloud_sync order by source;
```

## 2. 색인에 든 수

```sql
select source, is_folder, trashed, count(*) as n
from public.app_cloud_items group by 1,2,3 order by 1,2,3;
```

## 3. 폴더별 바로 든 파일 수 (화면 숫자와 대조)

```sql
select p.source, p.item_id, count(c.*) filter (where not c.is_folder and not c.trashed) as files,
       count(c.*) filter (where c.is_folder and not c.trashed) as folders
from public.app_cloud_items p
left join public.app_cloud_items c on c.workspace_id = p.workspace_id and c.source = p.source and c.parent_id = p.item_id
where p.is_folder and not p.trashed and p.parent_id is null
group by 1,2 order by 1, files desc;
```

## 4. 부모가 색인에 없는 떠돌이 줄 (공유받은 폴더 아래 등)

```sql
select i.source, count(*) as orphans
from public.app_cloud_items i
where i.parent_id is not null
  and not exists (select 1 from public.app_cloud_items p where p.workspace_id = i.workspace_id and p.source = i.source and p.item_id = i.parent_id)
group by 1;
```

## 읽는 법

- `index_done_at` 비어 있음 또는 `has_next_page` = true → 처음 훑기가 아직 안 끝남(①).
- 끝났는데 2번의 파일 수가 서비스 웹보다 확실히 적음 → 서버 쪽(Edge `cloud-files` 색인) 확인.
- 구글만 적고 4번에 떠돌이가 많음 → '내 소유만'(F6)이 원인(③). 명진 결정: 공유받은 파일도 넣을지.
- 원드라이브 파일이 0인데 폴더만 있음 → Graph 응답 모양 문제 가능성. 표본 폴더 하나의 실제 파일 수와 대조 필요.

## 이 PR이 하는 것

Edge `cloud-files`에 읽기 전용 동작 `folder`를 더했다. 화면이 폴더를 열 때(폴더마다 한 번) 그 폴더만 클라우드에서 직접 읽어 색인에 합치고, 새로 찾은 줄이 있으면 목록을 다시 읽는다. 색인에 빠진 파일이 있어도 폴더를 열면 채워진다. 클라우드에는 쓰지 않는다.
