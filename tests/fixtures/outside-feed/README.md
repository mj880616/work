# outside-feed 읽기 시험 표본

OUTSIDE-바깥성명 ③(`supabase/functions/outside-feed`)의 단체별 목록 읽기 시험용 표본이다. 네트워크 없이 `tests/security/outside-feed.test.mjs`가 쓴다.
모두 **지어낸 것**이다: 제목·글 번호·본문은 실제 글이 아니고, 각 단체 게시판의 링크 모양(주소 규칙)만 설계 1절 조사 결과에 맞췄다.
실제 사이트의 HTML 구조와 다르면 첫 실행에서 `last_error=parse_empty`로 드러난다(그때 표본과 규칙을 함께 고친다).
