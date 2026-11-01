# outside-feed 읽기 시험 표본

OUTSIDE-바깥성명 ③(`supabase/functions/outside-feed`)의 단체별 목록 읽기 시험용 표본이다. 네트워크 없이 `tests/security/outside-feed.test.mjs`가 쓴다.
모두 **지어낸 것**이다: 제목·글 번호·본문은 실제 글이 아니고, 각 단체 게시판의 링크 모양(주소 규칙)만 설계 1절 조사 결과에 맞췄다.
실제 사이트의 HTML 구조와 다르면 첫 실행에서 `last_error=parse_empty`로 드러난다(그때 표본과 규칙을 함께 고친다).

2026-11-01(OUTSIDE-막힌단체): 진보당(`javascript:js_board_view` 링크·제목 칸), 사회진보연대(`nid`), 플랫폼C(첫 화면 카드) 표본은 실제 목록의 링크 모양에 맞춰 다시 지었다(제목·번호는 여전히 지어낸 것).

2026-11-01(OUTSIDE-읽기고침·요약·순서): 실제 글 쪽 모양에 맞춘 표본을 더했다(글자는 모두 지어낸 것) — `socialism-list-2026-11.html`·`socialism-article.html`(메뉴·옆 칸 링크, 첫 `<article>`이 공유 단추 칸), `kptu-list-2026-11.html`·`kptu-article.html`·`kptu-article-image-only.html`(ASP.NET form 안 `publishList_write`, 첨부 이름·수정·삭제 줄), `jinboparty-article.html`(머리 칸 + `content_box`), `jacobin-article.html`(겹친 `<article>` + `po-bo__content` 여러 칸).

2026-11-01(OUTSIDE-막힌단체, 노동당·노동자연대·사회주의자): 사회주의자는 사이트 피드 대신 공개 텔레그램 채널 웹 미리보기를 읽으므로 `socialist.xml`을 빼고 `socialist-telegram.html`(t.me/s/<채널> 칸 모양만 맞춘 지어낸 글: 사이트 글 주소가 든 글·사진뿐인 글·다른 채널 글·공지 글)을 더했다.
