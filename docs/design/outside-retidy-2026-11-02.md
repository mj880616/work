# 사회운동 Now 이미 들어간 글 다시 정돈 — 데이터 고침 (실행 직전 정지)

- 원장 행: OUTSIDE-노동묶음·정돈(OUTSIDE-제목·게시날짜 합침). 이 PR(S48-4)에서 준비만 하고 **실행하지 않는다**. 실행은 커맨드센터가 Edge `outside-feed` 재배포 뒤에 한다(AGENTS.md 6·7절, 운영 데이터 변경 = 정지 지점).
- 이것은 표 구조를 바꾸는 migration이 아니라 수집한 글 행 고침이다(표·권한·RLS·함수 변경 없음). 그래서 `supabase_migrations.schema_migrations` 기록 행을 넣지 않는다. 백업 표 하나를 `private` 스키마(API로 열리지 않음)에 만들고, 확인이 끝나면 지운다.
- 실행 순서: ① Edge `outside-feed` 재배포(새 정돈 규칙) → ② 확인 SQL 0 → ③ 고침 1(백업 + 제목 꼬리표 정돈) → ④ 확인 SQL 1 → ⑤ 고침 2(노동당 글 다시 읽기) → ⑥ 다음 예약 실행(08:07·13:07·18:07) 뒤 확인 SQL 2. 고침 3은 선택.
- SQL Editor에서는 조각마다 새 쿼리 창(+)에 붙여 넣고, 첫 줄·마지막 줄(`commit;`)·대상 프로젝트를 확인한 뒤 실행한다.

## 일상어 3줄

- **무엇이 바뀌나**: 사회운동 Now에 이미 들어간 글 제목 앞의 '[성명]'·'[논평]' 같은 꼬리표를 떼고, 노동당 글은 지운 뒤 다음 예약 읽기 때 새 규칙(제목 한 줄·진짜 게시 날짜)으로 다시 들어오게 한다.
- **잘못되면 어떤 일이 생기나**: 제목이 원래보다 짧아지거나, 노동당 글이 다음 예약 읽기 전까지(최대 반나절) 잠깐 안 보인다. 첫 쪽에서 밀려난 노동당 옛 글은 다시 들어오지 않을 수 있다(노동당은 11/01부터 읽기 시작해 거의 모두 첫 쪽 글).
- **되돌리는 방법**: 고치기 전에 만든 백업 표(`private.outside_retidy_backup_20261102`)에서 옛 제목·옛 노동당 글을 그대로 되돌린다(아래 되돌리기 SQL).

## 확인 SQL 0 (읽기 전용, 고치기 전)

```sql
-- 단체별: 전체 글, 게시 날짜 모름, 제목 100자 넘음, 제목 앞 종류 꼬리표
select source_key,
       count(*) as posts,
       count(*) filter (where published_at is null) as no_date,
       count(*) filter (where char_length(title) > 100) as long_title,
       count(*) filter (where title ~ '^\s*[\[<(【〈「《（][^]>)】〉」》）]{0,28}(성명|논평|보도\s?자료|기자\s?회견|입장|브리핑|발언|논설|칼럼|규탄|결의문|호소문|선언)[^]>)】〉」》）]{0,28}[]>)】〉」》）]') as tagged
from public.app_outside_posts
group by source_key
order by source_key;
```

## 고침 1 — 백업 + 제목 앞 종류 꼬리표 떼기 (모든 국내 글)

```sql
begin;
create table if not exists private.outside_retidy_backup_20261102 as
  select * from public.app_outside_posts where false;
insert into private.outside_retidy_backup_20261102
  select p.* from public.app_outside_posts p
  where p.lang = 'ko'
    and (p.source_key = 'laborparty'
         or p.title ~ '^\s*[\[<(【〈「《（][^]>)】〉」》）]{0,28}(성명|논평|보도\s?자료|기자\s?회견|입장|브리핑|발언|논설|칼럼|규탄|결의문|호소문|선언)[^]>)】〉」》）]{0,28}[]>)】〉」》）]')
    and not exists (select 1 from private.outside_retidy_backup_20261102 b where b.id = p.id);
revoke all on table private.outside_retidy_backup_20261102 from public, anon, authenticated;
update public.app_outside_posts p
   set title = btrim(regexp_replace(p.title, '^\s*[\[<(【〈「《（][^]>)】〉」》）]{0,28}(성명|논평|보도\s?자료|기자\s?회견|입장|브리핑|발언|논설|칼럼|규탄|결의문|호소문|선언)[^]>)】〉」》）]{0,28}[]>)】〉」》）]\s*', ''))
 where p.lang = 'ko'
   and p.title ~ '^\s*[\[<(【〈「《（][^]>)】〉」》）]{0,28}(성명|논평|보도\s?자료|기자\s?회견|입장|브리핑|발언|논설|칼럼|규탄|결의문|호소문|선언)[^]>)】〉」》）]{0,28}[]>)】〉」》）]\s*\S';
commit;
```

- 종류(kind)는 이미 꼬리표로 정해 둔 값이 남아 있으므로 그대로다(화면 '성명·논평·보도자료' 칸).
- 꼬리표만 있고 뒤에 글자가 없는 제목은 건드리지 않는다(마지막 `\S` 조건, 빈 제목 금지 — DB 검사 1~500자).

## 확인 SQL 1 (읽기 전용)

```sql
select count(*) as backed_up from private.outside_retidy_backup_20261102;
select source_key, count(*) filter (where lang = 'ko' and title ~ '^\s*[\[<(【〈「《（][^]>)】〉」》）]{0,28}(성명|논평|보도\s?자료|기자\s?회견|입장|브리핑|발언|논설|칼럼|규탄|결의문|호소문|선언)[^]>)】〉」》）]{0,28}[]>)】〉」》）]\s*\S') as still_tagged,
       count(*) filter (where char_length(title) = 0) as empty_title
from public.app_outside_posts group by source_key order by source_key;
```

기대: `still_tagged`·`empty_title` 모두 0(꼬리표뿐이고 뒤에 글자가 없는 제목은 그대로 둔다).

## 고침 2 — 노동당 글 다시 읽기 (제목·부제·본문 앞부분이 한 덩어리로 들어간 글)

```sql
begin;
-- 고침 1에서 노동당 글은 모두 백업 표에 들어 있다(본문 문장 행은 글 행을 지우면 함께 지워지고, 다시 읽을 때 새로 만든다).
delete from public.app_outside_posts
 where source_key = 'laborparty'
   and id in (select id from private.outside_retidy_backup_20261102);
commit;
```

- 다음 예약 실행이 첫 쪽 글(최대 20건, 한 번에 8건씩)을 새 규칙으로 다시 넣는다. 노동당은 하루 3번 예약 때만 읽는다(바로 읽기 없음, 명진 결정 11/01 21:08).

## 고침 3 (선택) — 날짜 모름 글 다시 읽기

화면은 이제 게시 날짜를 모르는 글을 '오늘'이 아니라 맨 아래 '날짜 모름' 묶음에 둔다(받은 시각을 게시 시각으로 쓰지 않음). 그래서 이 고침은 꼭 필요하지 않다. 새 날짜 읽기(목록 같은 줄 날짜 칸 → 글 쪽 메타·작성일)로 날짜를 채우고 싶을 때만, 최근 이틀 안에 처음 들어온 날짜 모름 글을 지워 다시 읽게 한다.

```sql
begin;
insert into private.outside_retidy_backup_20261102
  select p.* from public.app_outside_posts p
  where p.lang = 'ko' and p.published_at is null and p.fetched_at >= '2026-11-01T00:00:00+09:00'
    and not exists (select 1 from private.outside_retidy_backup_20261102 b where b.id = p.id);
delete from public.app_outside_posts
 where lang = 'ko' and published_at is null and fetched_at >= '2026-11-01T00:00:00+09:00';
commit;
```

## 확인 SQL 2 (다음 예약 실행 뒤, 읽기 전용)

```sql
select source_key, count(*) as posts, count(*) filter (where published_at is null) as no_date,
       max(char_length(title)) as longest_title, max(fetched_at) as last_fetched
from public.app_outside_posts where source_key in ('laborparty', 'kgreens')
group by source_key;
select last_ok_at, last_error from public.app_outside_sources where source_key = 'laborparty';
```

기대: 노동당 글이 다시 들어오고 `longest_title`이 100 이하, `last_error`가 비어 있음.

## 되돌리기 SQL

```sql
begin;
-- 고침 1: 옛 제목으로
update public.app_outside_posts p set title = b.title
  from private.outside_retidy_backup_20261102 b
 where p.id = b.id and p.title is distinct from b.title;
-- 고침 2·3: 지운 글을 그대로 다시(다시 읽어 같은 주소 글이 이미 있으면 건너뜀). 본문 문장 행은 되돌리지 않는다(글 펼치기는 '본문 없음').
insert into public.app_outside_posts
  select b.* from private.outside_retidy_backup_20261102 b
  where not exists (select 1 from public.app_outside_posts p where p.id = b.id or (p.workspace_id = b.workspace_id and p.url = b.url))
on conflict do nothing;
update public.app_outside_posts p set has_body = false
  from private.outside_retidy_backup_20261102 b
 where p.id = b.id and not exists (select 1 from public.app_outside_sentences s where s.post_id = p.id);
commit;
```

## 정리 (확인이 끝나고 되돌릴 일이 없을 때)

```sql
begin;
drop table if exists private.outside_retidy_backup_20261102;
commit;
```
(위 SQL은 2026-11-02 작업 세션에서 빈 PostgreSQL 16에 같은 모양의 두 표를 만들어 고침 1·2·3·되돌리기·정리를 차례로 돌려 확인했다 — 운영 DB에는 실행하지 않음.)
