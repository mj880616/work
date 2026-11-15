# Web2 공개 경로 배포 순서

원칙: Expand → Deploy → Verify → Contract. GitHub Pages는 main 병합 직후 자동 배포되므로, 새 정적 코드가 요구하는 API를 먼저 추가한다. 운영 데이터 삭제, 익명 테이블 전체 조회권한 재개방, 권한 완화는 하지 않는다.

## 순서와 확인

1. 기존 meeting-ai-draft v3, meeting-ai-ingest v6, meeting-files v3의 비공개 백업 및 SHA-256을 재확인한다. meeting-files의 기존 `verify_jwt=false`를 복구 설정에 유지한다.
2. 운영 DB에 `20260920120000_public_single_post_prepare.sql`, `20260920121000_project_public_view.sql`만 순서대로 적용한다. 둘 다 additive다. 현재 운영 Web1/Web2와 기존 공개 URL 7건, 로그인·비로그인 화면을 확인한다. 이 단계에서 기존 익명 테이블 접근은 그대로다.
3. PR #169를 main에 병합한다. main CI 및 GitHub Pages 배포가 완료된 뒤 `/p/<slug>/`, `/p/?slug=...`, 기존 공개 URL 7건, 공개 프로젝트/하위페이지, 비공개 직접 URL, 로그인 내부 화면을 확인한다. 새 정적 코드의 원본과 공개 View도 확인한다.
4. 새 정적 화면이 정상일 때만 `20260920122000_public_single_post_cutover.sql`을 적용한다. 이는 기존 익명 테이블 조회와 구 공개 RPC 실행권한을 회수하는 마지막 DB contract다. 기존 URL 7건, 공개/비공개 RPC, 직접 테이블 접근 차단을 즉시 확인한다.
5. Edge Function 세 개를 기존 승인 절차대로 하나씩 배포하고 함수마다 인증·인가 smoke test를 한다. 실패한 함수는 해당 백업 버전만 복구한다.
6. 전체 production smoke test를 마친다.

`project_public_view`는 `app_spaces`, `app_project_blocks`, `app_project_sections`, `app_workspaces`, `auth.uid()` 및 기존 `private.app_can_*_space` helper를 사용한다. `public_single_post_cutover`가 제거하는 게시글 정책, 익명 테이블 권한, 구 공개 RPC에 의존하지 않는다. SQL 본문은 이전 검증 후보와 동일하고 파일명 순서만 변경한다.

## 단계별 복구

| 상태 | 복구 경로 |
| --- | --- |
| A: 기존 static + 기존 DB | 변경 없음. |
| B: 기존 static + additive 2개 | `20260920121000_project_public_view.sql` rollback 후 `20260920120000_public_single_post_prepare.sql` rollback. 기존 데이터/ID는 보존한다. |
| C: 새 static + additive 2개 | cutover를 실행하지 않는다. main/Pages를 이전 static으로 복구한 뒤 확인한다. 필요하면 B의 역순 additive rollback을 실행한다. |
| D: 새 static + cutover | `20260920122000_public_single_post_cutover.sql`의 보안 유지 rollback만 사용한다. 넓은 익명 테이블 권한과 구 RPC 권한은 되살리지 않는다. 이 단계 이후 prepare rollback은 사용하지 않는다. 프로젝트 공개 API를 중단할 때만 project rollback을 사용한다. |

각 rollback SQL은 내용을 삭제하지 않고 새 진입점의 실행권한만 회수하거나 안전한 공개 reader를 유지한다. 실제 적용 전 상태별 로컬 합성 데이터 검증을 통과해야 한다.
