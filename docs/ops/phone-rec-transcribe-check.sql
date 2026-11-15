-- MTG-폰녹음전사(요청함 10/30 15:29) 운영 확인용 읽기 전용 SQL. select만, 고치는 문 없음.
-- 실행: Supabase SQL Editor 새 쿼리 창(+)에 붙여 넣고 실행 → 결과 캡처. 커맨드센터가 배포 전·후로 한 번씩 돌린다.
-- 보는 것: 최근 3일 녹음 구간·전사 작업의 상태·실패 코드·형식·크기·길이·조각 수만.
-- 소리·전사 글·파일 이름·Drive id·토큰·사람 id는 보지 않는다(녹음 번호는 앞 8자만).

-- ① 녹음 구간(조각을 이어 붙인 단위)과 그 전사 작업
select
  left(r.session_id::text, 8)                 as rec_no,      -- 같은 녹음끼리 묶어 보기용(앞 8자)
  r.segment_no,
  r.status                                    as seg_status,  -- recording|closed|combined|empty|failed
  r.error_code                                as seg_error,
  r.mime_type,
  coalesce(array_length(r.piece_ids, 1), 0)   as pieces,
  r.size_bytes                                as seg_bytes,
  r.duration_sec                              as seg_sec,
  r.pieces_trashed_at is not null             as pieces_trashed,
  j.status                                    as job_status,  -- uploaded|running|done|failed
  j.error_code                                as job_error,   -- 배포 전: gemini_failed|drive_failed|failed|interrupted / 배포 후: gemini_upload|gemini_timeout|gemini_file_failed|gemini_rejected|bad_format …
  j.mime_type                                 as job_mime,
  j.size_bytes                                as job_bytes,
  j.duration_sec                              as job_sec,
  j.model,
  to_char(r.created_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI') as started_kst,
  to_char(j.finished_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI') as job_finished_kst
from public.app_meeting_recordings r
left join public.app_meeting_transcribe_jobs j on j.id = r.job_id
where r.created_at > now() - interval '3 days'
order by r.created_at desc, r.segment_no
limit 50;

-- ② 전사 작업 실패 코드 모아 보기(파일 올려 전사 길 포함, 형식별)
select
  j.mime_type,
  j.status,
  coalesce(j.error_code, '-')                 as error_code,
  count(*)                                    as jobs,
  min(j.size_bytes)                           as min_bytes,
  max(j.size_bytes)                           as max_bytes,
  min(j.duration_sec)                         as min_sec,
  max(j.duration_sec)                         as max_sec
from public.app_meeting_transcribe_jobs j
where j.created_at > now() - interval '3 days'
group by 1, 2, 3
order by 1, 2, 3;

-- 읽는 법
-- - seg_bytes = job_bytes 이고 pieces ≈ 분 수, seg_sec ≈ 녹음 길이면 조각 올리기·잇기는 정상(바이트 잇기는 원본과 같음, 시험 tests/meeting-recording-ogg.test.mjs).
-- - job_error가 gemini_failed(배포 전 코드)면 Gemini 단계 실패: 배포 뒤 [다시]를 누르고 다시 돌려 새 코드(gemini_*·bad_format)로 원인을 본다.
-- - 배포 뒤 Edge 로그(meeting-transcribe)의 'meeting-transcribe: ogg opus <쪽> <초> <고친 granule> <첫 granule 초> …' 줄에서
--   첫 granule 초가 크게(수천 초 이상) 나오면 안드로이드 녹음기 시계 문제가 사실로 확인된 것(로그에는 수만 있음).
