# 📱 폰 가능 · 연결보기 2차 합성 화면

실제 app 로더·화면 모듈 + 모의 인증/합성 API 데이터로 촬영했다. 실업무 원문·요약·운영 ID·인증정보를 포함하지 않는다. 정상 통합 흐름 콘솔 오류0.

| 화면 | 390px | 1280px |
| --- | --- | --- |
| 목적지별 기록 요약 승인 | [미리보기](basket-summary-preview-390.png) | [미리보기](basket-summary-preview-1280.png) |
| 담당조직 연결 기록 | [조직](basket-linked-organization-390.png) | [조직](basket-linked-organization-1280.png) |
| 프로젝트 접힌 연결 목록 펼침 | [프로젝트](basket-linked-project-390.png) | [프로젝트](basket-linked-project-1280.png) |
| 수정 뒤 이번 주 조직 기록 | [홈](basket-linked-home-390.png) | [홈](basket-linked-home-1280.png) |

실행: `playwright test --config=/tmp/basket-ui-playwright.config.mjs basket-link-integration.spec.mjs`.
4/4 통과: 두 폭 통합·보관 원문 열기, 늦은 저장 뒤 홈 갱신, 불명 결과 확인 중 화면 전환 뒤 홈 갱신.
[계약·검증·Drive 조사·운영 순서](../../basket-link-view-ui-review.md).
