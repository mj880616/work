# 자료실 제목 되돌리기 — 뜻 있는 파일 이름으로 (데이터 고침, 실행 직전 정지)

- 원장 행: LIB-파일이름제목(남은 일: 이미 AI가 바꾼 제목을 되돌릴지). 명진 결정 2026-11-03 11:57 "추천대로" = **뜻 있는 파일 이름인 자료만 파일 이름(확장자 뺀 것)으로 되돌린다.**
- 이 PR(S48-61)은 SQL을 준비만 하고 **실행하지 않는다**. 실행은 커맨드센터(CC)가 한다(AGENTS.md 6·7절, 운영 데이터 변경 = 정지 지점).
- 표 구조·권한·RLS·함수 변경이 아니라 `public.app_documents` 행의 제목 고침이다. 그래서 `supabase_migrations.schema_migrations` 기록 행을 넣지 않는다. 백업 표 하나를 `private` 스키마(API로 열리지 않음)에 만들고 `revoke`한 뒤, 확인이 끝나면 지운다.
- SQL Editor에서는 조각마다 새 쿼리 창(+)에 붙여 넣고, 첫 줄·마지막 줄(`commit;`)·대상 프로젝트를 확인한 뒤 실행한다.
- 공개 저장소이므로 이 문서에는 실제 제목·파일 이름을 적지 않는다. 확인 SQL 결과(개인 업무 내용 포함)는 SQL Editor 화면과 CC 보고에만 둔다.

## 일상어 3줄

- **무엇이 바뀌나**: 자료실에서 AI가 본문 첫 줄·표지로 바꿔 버린 제목 가운데, 올린 파일 이름이 뜻 있는 이름(예: `주간보고_1102.hwpx`)인 자료만 제목을 그 파일 이름(`주간보고 1102`)으로 되돌린다. 명진이 직접 고친 제목, 뜻 없는 파일 이름(`scan_0001`, `IMG_2025…`, `최종`, `251020` 등)인 자료는 그대로 둔다.
- **잘못되면 어떤 일이 생기나**: AI 제목이 더 알아보기 쉬웠던 자료도 파일 이름 제목으로 바뀐다(목록에서 찾던 제목이 달라짐). 자료 파일·날짜·분류·연결은 바뀌지 않는다.
- **되돌리는 방법**: 고치기 전에 만든 백업 표(`private.lib_title_restore_backup_20261103`)에서 옛 제목·옛 칸 기록을 그대로 되돌린다(아래 되돌리기 SQL). 고친 뒤 명진이 직접 다시 고친 제목은 되돌리기에서도 건드리지 않는다.

## 대상 규칙 (코드와 같은 규칙)

판정은 공용 모듈 `app/library-file-name.mjs`(Edge 사본 `supabase/functions/_shared/library-file-name.mjs`)와 같다. 이 모듈을 올릴 때 제목(`library-files`)·AI 자동 정리(`ai-assist` `library-fill.ts`의 `titleFromText`·`needsTidy`)·화면이 함께 쓴다.

| 조건 | SQL에서 | 코드에서 |
| --- | --- | --- |
| AI가 제목을 쓴 자료 | `field_origin->>'title' = 'ai'`(자료실 AI 자동 정리) **또는** `classification_note like '파일명 단서 부족%'`(옛 올리기에서 본문으로 제목을 뽑음, 칸 기록 없음) | `library-fill.ts`, `library-files/index.ts`의 `classificationNote` |
| 사람이 정한 제목은 뺌 | `field_origin->>'title' = 'user'`, `classification_note = '사용자 수정'`, `classification_note like '사용자 입력 제목%'` 제외 | `library-fill.ts` `legacyUserFields`·`readOrigin` |
| 파일 이름이 있음 | 확장자(점 뒤 1~8자)를 뗀 이름이 비어 있지 않음 | `fileBaseName` |
| 뜻 있는 파일 이름 | 이름을 NFKC·소문자로 바꾸고 글자가 아닌 것(숫자·기호·띄어쓰기)으로 나눈 낱말 중에 **흔한 낱말 목록에 없고 1~2자 영문 조각도 아닌 낱말이 하나라도** 있음 | `isMeaninglessName`의 반대 |
| 되돌릴 제목 | 확장자를 뗀 이름을 NFKC로, 밑줄을 띄어쓰기로, 겹친 띄어쓰기를 하나로 | `fileNameTitle`(지금 올릴 때 쓰는 제목과 같음) |
| 이미 같은 제목은 뺌 | 띄어쓰기·`_ - . ( ) [ ]`를 빼고 소문자로 비교해 같으면 제외 | `library-fill.ts` `squash` |

- 흔한 낱말 목록은 `GENERIC_NAME_WORDS`를 그대로 옮겼다. 시험 `tests/security/lib-title-restore-sql.test.mjs`가 이 문서의 SQL 목록이 코드 목록과 같은지 확인한다(어긋나면 실패).
- "글자"는 코드의 `\p{L}`을 SQL 문자 범위로 옮긴 것이다: 영문, 라틴 확장, 그리스·키릴 문자, 한글(자모·호환 자모·음절), 한자(기본·확장 A), 히라가나·가타카나. 운영 자료 이름에서 이 밖의 문자(예: 아랍·타이 문자)는 쓰이지 않는다고 보고, 확인 SQL 0의 표본에서 판정이 이상한 줄이 있으면 실행을 멈춘다.
- 휴지통에 있는 자료(`deleted_at`이 있는 자료)도 같은 규칙으로 고친다(되살렸을 때 같은 제목이 보이도록).
- 칸 기록: 되돌린 자료는 `field_origin`에서 `title` 기록을 뺀다. 지금 뜻 있는 파일 이름으로 올린 자료와 같은 상태다(올릴 때 정한 제목, AI 기록 없음). 파일 이름이 뜻 있으므로 AI 자동 정리는 앞으로도 제목을 건드리지 않는다(`titleFromText` = false).
- 자료실의 옛 '자동 정리 되돌리기' 기록(`public.app_library_tidy_backups`)은 건드리지 않는다.

## 확인 SQL 0 (읽기 전용, 고치기 전)

```sql
-- 0-1) 건수: 어디서 바뀐 제목인지 × 뜻 있는 파일 이름인지 × 이미 파일 이름과 같은지
with words as (
  select unnest(array['img','image','images','imgs','dsc','dscn','dscf','pxl','mvimg','vid','video','photo','photos','pict','picture','pic','scan','scanned','scanner','document','doc','docx','file','files','untitled','new','screenshot','screen','shot','capture','download','downloads','attachment','temp','tmp','kakaotalk','kakao','talk','copy','wa','am','pm','note','notes','memo','final','draft','스캔','제목','없음','제목없음','새문서','무제','새','문서','사진','이미지','첨부','첨부파일','붙여넣은','화면','캡처','스크린샷','카카오톡','복사본','사본','오전','오후','파일','이름','한글','자료','회의자료','최종','최종본','확정','수정','수정본','완성','완성본']::text[]) as word
), docs as (
  select d.id, d.title, d.created_at,
         case when d.field_origin ->> 'title' = 'ai' then 'ai_fill' else 'upload_content' end as changed_by,
         btrim(regexp_replace(coalesce(d.file_name, ''), '\.[^.]{1,8}$', ''), E' \t\r\n') as base
  from public.app_documents d
  where coalesce(d.field_origin ->> 'title', '') <> 'user'
    and coalesce(d.classification_note, '') <> '사용자 수정'
    and coalesce(d.classification_note, '') not like '사용자 입력 제목%'
    and (d.field_origin ->> 'title' = 'ai' or coalesce(d.classification_note, '') like '파일명 단서 부족%')
), judged as (
  select x.*,
         exists (
           select 1 from regexp_split_to_table(lower(normalize(x.base, NFKC)), '[^A-Za-zÀ-ÖØ-öø-ɏͰ-ϿЀ-ӿᄀ-ᇿぁ-ゖゝ-ゟァ-ヺー-ヿㄱ-ㆎ㐀-䶿一-鿿가-힣]+') w
           where w <> '' and w not in (select word from words) and w !~ '^[a-z]{1,2}$'
         ) as meaningful,
         btrim(regexp_replace(regexp_replace(normalize(x.base, NFKC), '_+', ' ', 'g'), '\s+', ' ', 'g')) as new_title
  from docs x
  where x.base <> ''
)
select changed_by, meaningful,
       count(*) as docs,
       count(*) filter (where lower(regexp_replace(normalize(coalesce(title, ''), NFKC), '[\s_.()\[\]-]+', '', 'g'))
                            = lower(regexp_replace(normalize(new_title, NFKC), '[\s_.()\[\]-]+', '', 'g'))) as already_same
from judged
group by changed_by, meaningful
order by changed_by, meaningful;
```

```sql
-- 0-2) 표본: 되돌릴 자료 앞뒤 10건(지금 제목 → 되돌릴 제목). 결과는 화면·CC 보고에만, 문서·PR에 옮기지 않는다.
with words as (
  select unnest(array['img','image','images','imgs','dsc','dscn','dscf','pxl','mvimg','vid','video','photo','photos','pict','picture','pic','scan','scanned','scanner','document','doc','docx','file','files','untitled','new','screenshot','screen','shot','capture','download','downloads','attachment','temp','tmp','kakaotalk','kakao','talk','copy','wa','am','pm','note','notes','memo','final','draft','스캔','제목','없음','제목없음','새문서','무제','새','문서','사진','이미지','첨부','첨부파일','붙여넣은','화면','캡처','스크린샷','카카오톡','복사본','사본','오전','오후','파일','이름','한글','자료','회의자료','최종','최종본','확정','수정','수정본','완성','완성본']::text[]) as word
), docs as (
  select d.id, d.title, d.file_name, d.created_at,
         case when d.field_origin ->> 'title' = 'ai' then 'ai_fill' else 'upload_content' end as changed_by,
         btrim(regexp_replace(coalesce(d.file_name, ''), '\.[^.]{1,8}$', ''), E' \t\r\n') as base
  from public.app_documents d
  where coalesce(d.field_origin ->> 'title', '') <> 'user'
    and coalesce(d.classification_note, '') <> '사용자 수정'
    and coalesce(d.classification_note, '') not like '사용자 입력 제목%'
    and (d.field_origin ->> 'title' = 'ai' or coalesce(d.classification_note, '') like '파일명 단서 부족%')
), judged as (
  select x.*,
         exists (
           select 1 from regexp_split_to_table(lower(normalize(x.base, NFKC)), '[^A-Za-zÀ-ÖØ-öø-ɏͰ-ϿЀ-ӿᄀ-ᇿぁ-ゖゝ-ゟァ-ヺー-ヿㄱ-ㆎ㐀-䶿一-鿿가-힣]+') w
           where w <> '' and w not in (select word from words) and w !~ '^[a-z]{1,2}$'
         ) as meaningful,
         btrim(regexp_replace(regexp_replace(normalize(x.base, NFKC), '_+', ' ', 'g'), '\s+', ' ', 'g')) as new_title
  from docs x
  where x.base <> ''
), targets as (
  select * from judged
  where meaningful and new_title <> ''
    and lower(regexp_replace(normalize(coalesce(title, ''), NFKC), '[\s_.()\[\]-]+', '', 'g'))
     <> lower(regexp_replace(normalize(new_title, NFKC), '[\s_.()\[\]-]+', '', 'g'))
)
(select 'newest' as part, changed_by, file_name, title as current_title, new_title, created_at from targets order by created_at desc limit 10)
union all
(select 'oldest', changed_by, file_name, title, new_title, created_at from targets order by created_at asc limit 10);
```

```sql
-- 0-3) 뜻 없는 이름이라 그대로 둘 자료 표본 10건(판정 확인용). 여기에 뜻 있는 이름이 섞여 있으면 멈추고 CC가 판정을 다시 본다.
with words as (
  select unnest(array['img','image','images','imgs','dsc','dscn','dscf','pxl','mvimg','vid','video','photo','photos','pict','picture','pic','scan','scanned','scanner','document','doc','docx','file','files','untitled','new','screenshot','screen','shot','capture','download','downloads','attachment','temp','tmp','kakaotalk','kakao','talk','copy','wa','am','pm','note','notes','memo','final','draft','스캔','제목','없음','제목없음','새문서','무제','새','문서','사진','이미지','첨부','첨부파일','붙여넣은','화면','캡처','스크린샷','카카오톡','복사본','사본','오전','오후','파일','이름','한글','자료','회의자료','최종','최종본','확정','수정','수정본','완성','완성본']::text[]) as word
), docs as (
  select d.id, d.title, d.file_name, d.created_at,
         btrim(regexp_replace(coalesce(d.file_name, ''), '\.[^.]{1,8}$', ''), E' \t\r\n') as base
  from public.app_documents d
  where coalesce(d.field_origin ->> 'title', '') <> 'user'
    and coalesce(d.classification_note, '') <> '사용자 수정'
    and coalesce(d.classification_note, '') not like '사용자 입력 제목%'
    and (d.field_origin ->> 'title' = 'ai' or coalesce(d.classification_note, '') like '파일명 단서 부족%')
)
select x.file_name, x.title as current_title, x.created_at
from docs x
where x.base <> ''
  and not exists (
    select 1 from regexp_split_to_table(lower(normalize(x.base, NFKC)), '[^A-Za-zÀ-ÖØ-öø-ɏͰ-ϿЀ-ӿᄀ-ᇿぁ-ゖゝ-ゟァ-ヺー-ヿㄱ-ㆎ㐀-䶿一-鿿가-힣]+') w
    where w <> '' and w not in (select word from words) and w !~ '^[a-z]{1,2}$')
order by x.created_at desc
limit 10;
```

멈출 조건: 0-1의 `meaningful = true`이고 `already_same`이 아닌 건수가 0이면 고칠 것이 없으므로 끝. 0-2·0-3 표본에서 판정이 이상하면 실행하지 않고 CC가 원인을 본다.

## 고침 1 — 백업 + 제목 되돌리기

```sql
begin;
create table if not exists private.lib_title_restore_backup_20261103 (
  id uuid primary key,
  workspace_id uuid not null,
  old_title text,
  old_field_origin jsonb not null,
  new_title text not null,
  backed_at timestamptz not null default now()
);
revoke all on table private.lib_title_restore_backup_20261103 from public, anon, authenticated;

with words as (
  select unnest(array['img','image','images','imgs','dsc','dscn','dscf','pxl','mvimg','vid','video','photo','photos','pict','picture','pic','scan','scanned','scanner','document','doc','docx','file','files','untitled','new','screenshot','screen','shot','capture','download','downloads','attachment','temp','tmp','kakaotalk','kakao','talk','copy','wa','am','pm','note','notes','memo','final','draft','스캔','제목','없음','제목없음','새문서','무제','새','문서','사진','이미지','첨부','첨부파일','붙여넣은','화면','캡처','스크린샷','카카오톡','복사본','사본','오전','오후','파일','이름','한글','자료','회의자료','최종','최종본','확정','수정','수정본','완성','완성본']::text[]) as word
), docs as (
  select d.id, d.workspace_id, d.title, d.field_origin,
         btrim(regexp_replace(coalesce(d.file_name, ''), '\.[^.]{1,8}$', ''), E' \t\r\n') as base
  from public.app_documents d
  where coalesce(d.field_origin ->> 'title', '') <> 'user'
    and coalesce(d.classification_note, '') <> '사용자 수정'
    and coalesce(d.classification_note, '') not like '사용자 입력 제목%'
    and (d.field_origin ->> 'title' = 'ai' or coalesce(d.classification_note, '') like '파일명 단서 부족%')
), judged as (
  select x.*,
         exists (
           select 1 from regexp_split_to_table(lower(normalize(x.base, NFKC)), '[^A-Za-zÀ-ÖØ-öø-ɏͰ-ϿЀ-ӿᄀ-ᇿぁ-ゖゝ-ゟァ-ヺー-ヿㄱ-ㆎ㐀-䶿一-鿿가-힣]+') w
           where w <> '' and w not in (select word from words) and w !~ '^[a-z]{1,2}$'
         ) as meaningful,
         btrim(regexp_replace(regexp_replace(normalize(x.base, NFKC), '_+', ' ', 'g'), '\s+', ' ', 'g')) as new_title
  from docs x
  where x.base <> ''
)
insert into private.lib_title_restore_backup_20261103 (id, workspace_id, old_title, old_field_origin, new_title)
select j.id, j.workspace_id, j.title, j.field_origin, j.new_title
from judged j
where j.meaningful and j.new_title <> ''
  and lower(regexp_replace(normalize(coalesce(j.title, ''), NFKC), '[\s_.()\[\]-]+', '', 'g'))
   <> lower(regexp_replace(normalize(j.new_title, NFKC), '[\s_.()\[\]-]+', '', 'g'))
on conflict (id) do nothing;

update public.app_documents d
   set title = b.new_title,
       field_origin = d.field_origin - 'title'
  from private.lib_title_restore_backup_20261103 b
 where d.id = b.id
   and d.title is not distinct from b.old_title
   and coalesce(d.field_origin ->> 'title', '') <> 'user';
commit;
```

- 백업에 넣은 자료만, 그리고 백업 뒤 제목이 그대로인 자료만 고친다(그 사이 사람이 고친 제목은 건드리지 않음).
- `app_documents`의 기존 트리거(작업공간 연결 검사 등)는 제목·칸 기록만 바뀌므로 영향이 없다.

## 확인 SQL 1 (읽기 전용, 고친 뒤)

```sql
select count(*) as backed_up,
       count(*) filter (where d.title = b.new_title and not (d.field_origin ? 'title')) as restored,
       count(*) filter (where d.title is distinct from b.new_title) as not_restored
from private.lib_title_restore_backup_20261103 b
join public.app_documents d on d.id = b.id;
```

기대: `backed_up`이 확인 SQL 0-1의 "뜻 있음·아직 다름" 건수와 같고, `restored = backed_up`, `not_restored = 0`. 이어서 확인 SQL 0-1을 다시 돌려 `meaningful = true` 줄이 모두 `already_same`과 같아졌는지 본다(백업 뒤 사람이 고친 자료가 있으면 그 수만큼 차이 남).

화면 확인(명진 또는 CC): 자료실 목록에서 표본 몇 건의 제목이 파일 이름으로 보이는지.

## 되돌리기 SQL

```sql
begin;
update public.app_documents d
   set title = b.old_title,
       field_origin = b.old_field_origin
  from private.lib_title_restore_backup_20261103 b
 where d.id = b.id
   and d.title = b.new_title
   and not (d.field_origin ? 'title');
commit;
```

- 고친 뒤 명진이 다시 직접 고친 제목(칸 기록 `user`)은 되돌리지 않는다.

## 정리 (확인이 끝나고 되돌릴 일이 없을 때, CC 판단)

```sql
begin;
drop table if exists private.lib_title_restore_backup_20261103;
commit;
```

## 실행 순서 (CC)

1. 확인 SQL 0-1·0-2·0-3 → 결과를 보고 멈출 조건 확인.
2. 고침 1 → 확인 SQL 1 → 확인 SQL 0-1 다시.
3. 자료실 화면에서 표본 확인. 문제가 있으면 되돌리기 SQL.
4. 일주일쯤 뒤 정리 SQL.

## 검증 (이 PR, 운영 DB에는 실행하지 않음)

- 빈 PostgreSQL 16(UTF8)에 같은 칸 모양의 `public.app_documents`를 만들고, 뜻 있음·뜻 없음·전각·라틴 외 문자·확장자 없음 등 파일 이름 26개 × 제목 출처 7가지(AI 정리·옛 본문 제목·사람 제목·올릴 때 입력·옛 사용자 수정·파일 이름 그대로·이미 같은 제목)로 182행을 넣은 뒤 확인 0 → 고침 1 → 확인 1 → 되돌리기 → 정리를 차례로 돌렸다.
- 고친 결과가 같은 입력을 `app/library-file-name.mjs`(`isMeaninglessName`·`fileNameTitle`)와 `library-fill.ts`의 비교 규칙으로 계산한 기대값과 모두 같았고, 되돌리기 뒤 모든 행이 고치기 전과 같았다.
- `tests/security/lib-title-restore-sql.test.mjs`: 낱말 목록이 코드와 같은지, 쓰기 조각이 `begin;`…`commit;`인지, 백업 표가 `private`·권한 회수인지, 사람 제목 제외 조건이 모든 조각에 있는지.
