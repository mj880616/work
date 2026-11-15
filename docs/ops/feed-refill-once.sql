-- NEWS-전면개편 P2c(S51-15): 본문 다시 뽑기(Edge 예약 입구 action=refill)를 CC가 SQL Editor에서 손으로 부르는 파일.
-- ★ SQL Editor(폰 경로 C) 전용 ★ — net·vault를 써서 승인형 DB workflow는 쓰지 않는다. 표·칸·정책·권한·함수·예약(cron)은 바꾸지 않는다.
-- 앞 조건: news-feed·outside-feed를 S51-15 커밋으로 배포한 뒤(그 전에는 refill이 400 UNKNOWN_ACTION).
-- 순서: ① 건수 확인(읽기 전용) → 한 줄 보고 → ② 부르기(한 번에 매체·단체 2~3개, 사이트가 다르면 함께 가능) → 2~3분 뒤 ③ 결과 → 남은 것(remaining>0)이 있으면 ②를 다시.
-- 한 번 부를 때 사이트마다 20개까지(REFILL_PER_SOURCE), 최근 30일(REFILL_DAYS), 요청 사이 2초. 지우지 않고 블록 줄만 고친다(merge).
-- 값은 어디에도 찍지 않는다: 금고 값(열쇠·주소)은 ②의 안쪽에서만 읽어 요청 헤더·주소에 넣고, select 결과 칸에는 없다. 응답(③)에는 건수·코드만 있다.
-- 아래 '지금 판' 목록은 카탈로그(_shared/news-catalog.ts·outside-catalog.ts)의 규칙 판과 같아야 한다(tests/security/feed-refill.test.mjs가 고정).
--   텔레그램(justice·socialist)·robots 예외(kptu·laborparty)는 Edge가 다시 뽑지 않으므로 목록에서 뺐다.


-- ===== ① 건수 확인(읽기 전용): 다시 뽑을 줄 수 — 블록 없음 / timeout / 옛 판 실패 =====
with cur(key, rule) as (values
  ('news-labortoday', 'news-labortoday@3'),
  ('news-beminor', 'news-beminor@2'),
  ('news-pressian', 'news-pressian@3'),
  ('news-psi', 'news-psi@1'),
  ('news-itf', 'news-itf@1'),
  ('news-labourstart', 'news-labourstart@1')
)
select 'news' as feed, c.key,
       count(*) filter (where b.id is null) as no_row,
       count(*) filter (where b.reason = 'timeout') as timeout,
       count(*) filter (where b.state <> 'ok' and b.rule is distinct from c.rule and b.reason is distinct from 'timeout') as old_rule
  from cur c
  join public.app_news_items i on i.source_key = c.key and i.lane = 'media' and i.created_at >= now() - interval '30 days'
  left join public.app_feed_bodies b on b.news_item_id = i.id
 group by c.key
union all
select 'outside', c.key,
       count(*) filter (where b.id is null),
       count(*) filter (where b.reason = 'timeout'),
       count(*) filter (where b.state <> 'ok' and b.rule is distinct from c.rule and b.reason is distinct from 'timeout')
  from (values
  ('kctu', 'kctu@1'),
  ('kmwu', 'kmwu@2'),
  ('kfsu', 'kfsu@2'),
  ('hakbi', 'hakbi@3'),
  ('kgreens', 'kgreens@1'),
  ('jinboparty', 'jinboparty@1'),
  ('pssp', 'pssp@1'),
  ('ws', 'ws@1'),
  ('platformc', 'platformc@1'),
  ('leftall', 'leftall@1'),
  ('socialism', 'socialism@1'),
  ('jacobin', 'jacobin@1'),
  ('labornotes', 'labornotes@1'),
  ('redpepper', 'redpepper@1'),
  ('socialistworker', 'socialistworker@1')
  ) as c(key, rule)
  join public.app_outside_posts p on p.source_key = c.key and p.fetched_at >= now() - interval '30 days'
  left join public.app_feed_bodies b on b.outside_post_id = p.id
 group by c.key
 order by 1, 2;


-- ===== ② 부르기: 아래 values 칸에 이번에 부를 것만 남긴다(함수 이름, 키). 결과로 요청 번호(request_id)만 돌려준다 =====
with k as (select s.decrypted_secret as v from vault.decrypted_secrets s where s.name = 'web2_feed_cron' limit 1),
     u as (select s.decrypted_secret as v from vault.decrypted_secrets s where s.name = 'web2_feed_project_url' limit 1),
     src(fn, key) as (values
       ('news-feed', 'news-pressian'),
       ('outside-feed', 'hakbi')
     )
select src.fn, src.key,
       net.http_post(
         url := u.v || '/functions/v1/' || src.fn || '?action=refill',
         body := jsonb_build_object('source', src.key),
         params := '{}'::jsonb,
         headers := jsonb_build_object('Content-Type', 'application/json',
                      case when src.fn = 'outside-feed' then 'x-outside-feed-cron-secret' else 'x-news-feed-cron-secret' end, k.v),
         timeout_milliseconds := 150000) as request_id
  from src, k, u
 where src.fn in ('news-feed', 'outside-feed')
   and length(k.v) >= 32
   and u.v ~ '^https://[a-z0-9]{20}\.supabase\.co$';


-- ===== ③ 결과(읽기 전용): ②가 돌려준 요청 번호를 넣는다. 응답은 건수·코드만(done·deferred·remaining·status) =====
select h.id as request_id, h.status_code,
       (h.content::jsonb) ->> 'source' as source,
       (h.content::jsonb) ->> 'status' as status,
       (h.content::jsonb) ->> 'done' as done,
       (h.content::jsonb) ->> 'deferred' as deferred,
       (h.content::jsonb) ->> 'remaining' as remaining,
       (h.content::jsonb) ->> 'error' as error,
       h.timed_out
  from net._http_response h
 where h.id = any (array[0]::bigint[])  -- ← ②의 request_id들로 바꾼다
 order by h.id;
