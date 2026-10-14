> **시점 보관본:** 아래는 해당 source/검토 당시 보고다. 사진 새 CI 실패·원격 archive·현재 상태는 [CC17.5 인계서](../cc17-5-handoff.md)가 우선한다. scratch 경로와 agent/session의 새 환경 존재를 보장하지 않는다.

# 📱 폰 가능 — CC17.4 운영 사실 검토본 (실행 승인 아님)

2026-10-13. 읽기 전용 source 검토와 scratch 문서 작성만 수행했다. 제품·서버·SQL·workflow 변경, production 접속/토큰 취급, dispatch/환경 승인, push/merge는 하지 않았다. Task2/Task3 제품 source 검토를 대체하지 않는다.

## 근거와 source 범위

- 규칙: `/workspace/work/AGENTS.md` §§1, 3, 6–8. 순서·미결 사항: `docs/cc17-4-handoff.md`의 “마지막 운영 묶음”, `docs/web2-work-plan-20261012.md` §§1c, 2, 3, 공통 운영 조건.
- 이 검토의 main source는 `28e620c06ee0fbd508d3aca3d574b451e4d4560c`. GitHub `git ls-remote`로 이 시점의 `refs/heads/main`을 다시 확인했다. photo branch도 `c5478fc19d95fbc79486e38488e4adaae4296822`로 확인했다. photo 제품은 이 frozen source의 기본 비활성을 검토했다. 이 관측은 미래 실행 시점의 최신 main/배포 source 확인을 대신하지 않는다.
- DB 준비 #516: `a9ba4a1de1799b18908dde00500e3b4f6df977df`; 서버/사본 준비 #522: `9342d225f87499048e905c17ac8223d5c9cba62d`; 자료실 원본 보호 서버 #523: `e2f1cb56f23371aeb18a29017ff62433ee214e68`; 일정 저장 보호 #521: `73fee330b42ca3b62f6d9ba55c33722a095741e6`은 문서에 기록된 병합 source다. 병합은 해당 변경의 실제 DB 적용/Edge 배포/OCR 성공/폰 확인을 뜻하지 않는다.
- 현재 workflow 원문: `.github/workflows/db-migration-apply.yml`, `.github/workflows/edge-function-deploy.yml`; DB 실행 원문: `scripts/ops/db-workflow.mjs`, `db-migration-plan.mjs`, `db-migration-run.mjs`, `db-query.mjs`; 운영 설명: `docs/ops-db-workflow.md`.
- 원래 `/workspace/scratch/cc17-3-save-plan/owner-photo-proof-decision-packet.md`와 `library-schema-preflight.select.sql`은 이 workspace에 없다. 복구하거나 실행 가능한 것으로 주장하지 않는다. SQL9의 알려진 hash `fb5a15e5ad84b4e7beabb929d71f96875a9b2dd036f9d4c2527af636c2ffdb0d`는 handoff 기록일 뿐 여기서 bytes를 재검증한 결과가 아니다. 옛 SQL8을 대체 증거로 사용하지 않는다.

## 준비된 것과 아직 필요한 실제 사실

| 범위 | source에서 확인한 준비 | 실제 실행 전에 필요한 미확인 값/증거 |
| --- | --- | --- |
| DB | version `20261013034836`, name `basket_photo_ocr_db`; 아래 짝 파일·INVOKER RPC·제약/복구 guard | 실제 PG version/UTF8, migration history, 생성 역할/default ACL/role membership, 전체 schema/owner RLS/ACL, app_notes trigger, 기존 CHECK/RPC, OCR key count, 원문 version/행 hash, 사용자 dry-run/apply run/attempt/source SHA/결과, 실제 backup 이름·행 수·사후 대조 |
| Edge | 함수별 source와 기존 승인형 버튼·JWT keep·사후 검사 | 각 함수의 실제 현재 배포 source 전체 SHA(다음 배포의 predecessor/rollback ref), 현재 version/verify_jwt/updated_at, 선택한 새 전체 SHA와 독립 검토/격리 의존성, 실행 승인·run/attempt, 배포 뒤 version/JWT/HTTP 결과 |
| Google provider | 기존 `drive.file`, Drive formats GET, JPEG/PNG→Google Docs import, text/plain export 검증 코드 | 해당 실제 연결에서 importFormats/exportFormats 지원, 비공개 폴더·원본/임시 권한·download/delete capability, 실제 새/기존 사진의 인식·상한·원문 보존·정리 결과. 지원 map은 OCR 품질/실사용 성공 증명이 아님 |
| 화면/활성화 | photo c547의 `app/basket-ocr.js`에 `BASKET_OCR_ENABLED=false`; 정상 manual/upload 소비자는 공용 runtime 사용 | photo 실제 반영/Pages/제공 source, 선택할 실행 순서와 승인된 source·복구, 실제 owner proof, 별도 활성화 PR/정확 head 검사/게시·폰 확인. 현재 어느 활성화 안도 승인되지 않음 |
| 자료실 B 등록 | 같은 Drive ID의 메타정보 등록 방향, 원본 보호 준비 source | 실제 exact OID/constraints/full indexes/incoming FK/defaults/triggers/policies/raw ACL 및 effective privileges/custom function behavior, 정확 등록 request 계약, 실제 보호 배포·확인. 확보 전 hold |

실제 RPC는 `public.app_basket_update_attachment_ocr(uuid,timestamptz,jsonb,jsonb)`, 빈 search_path, PUBLIC/anon/service_role 명시 revoke 후 authenticated EXECUTE 준비다. service_role fallback은 없다. capability의 null-input RPC probe는 정확한 거절 응답을 확인할 뿐 실제 source/ACL/상속 전체를 증명하지 않는다.

## DB 준비 파일과 실행 순서

기준 원문: `docs/20261013034836_basket_photo_ocr_db.recovery.md`. 적용 파일은 `supabase/migrations/20261013034836_basket_photo_ocr_db.sql`. 다음 파일은 모두 `docs/20261013034836_basket_photo_ocr_db` 접두사에 붙는다: `.version-check.sql`, `.snapshot.sql`, `.precheck.sql`, `.dry-run.postcheck.sql`, `.postcheck.sql`, `.rollback.sql`, `.recovery.sql`, `.preserve.sql`, `.summary.md`.

무엇이 바뀌나: 기존 사진 첨부에 인식 글과 처리·정리 상태를 보관할 DB 준비다.
잘못되면: 첨부 저장·상태 갱신이 거절될 수 있고, 글이 바뀌면 이전 AI 검토를 다시 확인해야 한다.
되돌리는 법: 사용 전에는 정확한 새 함수·제약만 되돌리고, 사용 후에는 글·정리 기록을 보존한 채 새 실행을 끄고 forward fix한다.

1. 실행 직전에 actual main/선택 source 전체 SHA, migration version/name·파일 해시·복구 짝을 새로 고정한다. DB 버튼은 branch main만 허용하고 plan이 main SHA를 기록하며 run은 그 SHA를 checkout한다. 실행 파일이 dry-run 뒤 바뀌면 변경 파일로 dry-run부터 다시 검토한다.
2. 사용자가 SQL Editor에서 독립 version SELECT를 먼저 실행한다. 결과 불명/없음 또는 `server_version_num < 160000`이면 뒤 catalog 조회·dry-run/apply/rollback을 진행하지 않는다. PG17.6 격리 검증은 실제 운영 version이나 PG16 전체 검증을 대신하지 않는다.
3. snapshot/precheck를 저장·대조한다. 모든 예/아니오 항목은 예, OCR key count 0, finite updated_at, UTF8, public의 동명 CHECK 정확히 하나/정확한 검증된 옛 app_notes CHECK, 새 동명 RPC 0, owner RLS 유지가 필요하다. noninternal app_notes trigger가 있으면 호환 검증 전 중단하며 자동 제거하지 않는다. 특히 무조건 updated_at을 올리는 trigger는 상태-only 갱신 계약과 맞지 않는다. 지원 밖 role/default ACL/grant option/member 경계도 guard 대상이다.
4. 커맨드센터 승인 → 사용자가 `db-migration-apply.yml` mode `dry-run`, version `20261013034836`, branch main 실행 → plan의 정확 SHA/원문/끝 `rollback;` 확인 → 사용자 `production-edge` 승인. dry-run은 원문 마지막 commit만 rollback으로 바꾸며 백업을 만들지 않는다. AI가 버튼/승인을 수행하지 않는다.
5. SQL 취소·history 부재와 precheck 전후 동일 item/value 집합, 선택된 dry-run 원래 상태 검사 결과를 각각 확인한다. snapshot의 notes/links 전체 행 hash·ACL/정책·기존 confirm/summary RPC·trigger도 별도로 대조한다. workflow 집계/구조 성공은 전체 DB 동일성 증명이 아니다. baseline NULL은 수동 확인 필요이며 자동 주입하지 않는다. `verification: incomplete`는 CLI exit 1이고 apply 준비 완료가 아니다.
6. 그 대조와 적용 승인이 끝난 뒤 사용자 apply를 별도 실행/승인한다. 새 plan의 SHA/해시/끝 `commit;`/백업 SQL을 확인한다. apply 직전 별도 transaction으로 `ops_backup."20261013034836_app_notes_<실제 run_id>"` CTAS 자료 사본·행 수를 확인하며 백업/확인 실패 시 적용 요청을 보내지 않는다. 현재 실제 backup 존재는 미확인이다.
7. apply의 exact version/name history와 postcheck의 정확한 신규 RPC source/서명/ACL/CHECK·기존 RPC 존재, 원래 snapshot의 자료/기존 경계를 대조한다. 수동 대조 전 DB 준비 적용 완료라고 하지 않는다. HTTP 200 또는 한 단계 성공만으로 commit/전체 성공을 판정하지 않는다.
8. 백업은 제약/인덱스/RLS/시퀀스/소유권을 복원하는 완전한 백업이 아니다. 백업 commit 뒤 다른 쓰기가 가능하다. 백업은 자동 삭제/덮어쓰기하지 않고 같은 run_id 재실행은 이름 충돌한다. 응답 유실·강제 종료·사후 검사 실패는 자동 재시도/rollback 없이 실제 상태를 확인한다. `supabase db push`/`migration repair`는 계속 금지다.

사용 전 rollback은 **모든 첨부에 OCR key가 전혀 없는 상태**에서만 가능하다. unread/reading/empty만 있어도 사용 후다. lock 아래 정확한 현 CHECK 정의/검증 상태·RPC 본문/서명/반환/설정/소유자/ACL·history version/name/statements를 준비 source와 대조하고, 변경됐으면 `PHOTO_OCR_ROLLBACK_CHANGED`, OCR key가 있으면 `OCR_DATA_PRESERVATION_REQUIRED`로 거절한다. 일치 시 정확한 새 RPC DROP·옛 CHECK 복원·그 history만 제거하며 데이터/CASCADE/기존 confirm/summary를 지우지 않는다.

사용 후에는 rollback/옛 네 필드 CHECK/OCR key 삭제로 되돌리지 않는다. 활성화됐다면 새 실행 비활성 PR, recovery 집계와 사용자 관리 비공개 preserve 결과 보관, 원본·인식 글·attempt·known temp·cleanup 기록을 유지한 문제별 forward fix다. preserve SELECT는 replay/덮어쓰기 SQL이 아니다. 생성 불명은 새 UUID/import로 재생성하지 않는다. 공개 문서/Actions/채팅에 글·행 내용을 붙이지 않는다.

## 네 함수의 준비와 역사 기록

| 함수 | 이번 운영 묶음의 역할 | 역사 기록 (현재 상태/rollback 확정값 아님) |
| --- | --- | --- |
| basket-files | OCR capability/status/read/reconcile/cleanup, caller INVOKER RPC, 원본·임시 문서 검증 | v2, JWT false, source `4bd2f719e55aebd813c95b014ee5c0725ccb3753` (#479, 사용자 보고) |
| drive-summary | 저장 OCR text를 기존 Drive 읽기용 사본에 포함 | v7, JWT false, source `39f1dfec9cd978f9ea5e7c94bca120fb16a0a84e`; run `38295381165` attempt2에 v6→v7/POST401/OPTIONS204 기록. attempt1 내부500. 당시 rollback은 v6 `e1d74835f62a4a15e8c35905475c6869ebb4c973`였음 |
| document-actions | 자료 등록 삭제 때 바구니 원본 Drive 보존, 나머지 Drive 결과 구분 | 오래된 §5 표 v4/JWT true. 실제 현재 source SHA는 미확인 |
| google-calendar | #521/1c의 일정 이동·일부 저장 보호와 연결 RLS | 오래된 §5 표 v15/JWT false. **OCR dependency가 아님**; 실제 현재 source SHA는 미확인 |

출처는 `docs/web2-env6b-edge-source.md` §5, `basket-files/README.md`, work-plan/roadmap이다. README의 옛 단계 문구와 과거 표를 현재 metadata보다 우선하지 않는다. 특히 v6를 다음 drive-summary rollback으로 쓰지 않으며, v7/v2도 새 실제 대조 없이 채우지 않는다.

함수별 기존 사용자 Edge workflow만 사용한다: 커맨드센터 승인 → 사용자 dispatch → `production-edge` 승인, `first_deploy=false`, `verify_jwt=keep`, `expect_unauth_401=true`. 정확한 새 ref와 **직전 실제 배포 source 전체 SHA**를 승인 전에 기록해야 한다. `functions list`는 version/JWT/updated_at만 제공하며 predecessor source SHA는 제공하지 않는다. 배포 전 exactly-one 현 함수/valid metadata, 배포 뒤 version 증가/JWT 동일/POST401/OPTIONS200 또는204를 각각 대조한다. 실패 검증은 이미 실행한 배포를 취소하지 않는다. Edge 복구는 검증된 predecessor SHA로 같은 사용자 버튼·새 승인이다. 자료실 B 등록은 UI source 준비로 운영 보호 완료를 대신하지 않는다.

## proof-before-activation의 미결 선택

정해진 순서는 DB/Edge → 실제 owner 원본 보존·인식·임시 정리 proof → 별도 활성화 PR이다. 반면 정상 source c547은 공통 `BASKET_OCR_ENABLED=false`로 manual/read와 업로드 뒤 자동 read가 막혀 있다. 실제 owner proof의 정상 경로/승인된 순서 변경이 미결이다. AGENTS 폰 경로 B 북마크는 자료 생성/수정/삭제를 금지하므로 쓰기 OCR를 여기에 넣을 수 없다.

| 앞서 남긴 선택지 | 명시적으로 해결해야 할 순서/준비 | 승인 상태 |
| --- | --- | --- |
| 정상 수동 먼저, automatic 계속 off | normal manual을 proof보다 먼저 허용하는 순서 변경과 automatic 분리의 검토된 source/복구가 필요. 현 공통 flag만 켜면 업로드 자동 read도 열리므로 이 안이 구현돼 있다고 말할 수 없음 | 미승인 |
| 정상 전체 먼저 | manual+새 업로드 read를 proof보다 먼저 여는 순서 변경, 정확 활성 source/검사·복구와 실제 확인 범위가 필요 | 미승인 |
| 현재 hold | 정상 새 OCR off 유지. 기존 준비·제품 검사와 미래 운영 facts 정리는 가능하지만 실제 OCR proof/활성화 완료는 아님 | 미승인 선택지; 현 source는 off |

초기 standalone `createBasketOcr({enabled:true})` factory launcher는 미채택/대체된 제안이다. c547의 `app/basket-ocr-runtime.js`는 runtime WeakMap당 하나의 native authority와 공용 flight/attempt/outcome registry를 둔다. `app/basket.js`와 `app/basket-upload.js`는 `basketOcrFor`를 공유한다. 별도 factory는 이 lifetime을 우회하므로 실행 경로로 되살리지 않는다. 새 launcher/raw fetch/debug route/인증 우회는 준비하지 않았다. 이 검토본은 어느 안도 권고·승인·실행하지 않는다.

## 원본 보존·정리 증거의 정확한 한계

- source `supabase/functions/_shared/drive-ocr.ts`의 `source()`는 원본 metadata GET으로 ID/MIME/name/size/owner/비공개 부모·권한/canDownload/version을 검증하고, `create()`는 원본 `alt=media` GET bytes의 JPEG/PNG signature·크기를 검사하여 import한다. 원본 write/move/delete는 이 흐름에 없다. `basket-files/ocr.ts`는 text export 뒤 원본 metadata를 다시 GET하여 version과 md5Checksum의 전후 일치를 비교한다. md5는 optional metadata이며 양쪽 부재도 비교를 통과한다. 별도 원본 binary digest를 계산하지 않는다. marker `source_hash`는 **원본 ID 문자열의 SHA256**이며 이미지 bytes hash가 아니다.
- 따라서 코드의 GET/metadata/version/md5 전후 비교, 실계정에서 원본이 열리는 확인, 별도 실제 원본 byte hash의 전후 대조는 다른 증거다. 링크 열림/GET 성공을 byte 불변 proof로 쓰지 않는다. 이 검토에는 실제 원본 bytes/hash/provider 실행 증거가 없다.
- temp는 원본과 다른 ID/Google Docs MIME/owner-only 권한/폴더/note-workspace-attempt-source/version-stamp marker를 검증한 뒤 export/DELETE한다. `remove()`는 metadata/`canDelete` 검증 뒤 **DELETE HTTP204 acknowledgement**만 받으며 fresh post-delete GET을 수행하지 않는다.
- 그 ack 뒤 DB same-attempt CAS로 `cleanup_state=deleted`를 기록한다. 현 원문 CAS 충돌 시 최신 같은 attempt/temp ID의 cleanup-only 상태만 기록하고 OCR text를 새 원문에 자동 확정하지 않는다. DB 저장 불명은 ID/attempt를 보존하며 deleted 확정으로 확대하지 않는다.
- `ocr-status`는 DB-only 조회다. 이미 `cleanup_state=deleted`이고 state done/empty/failed인 reconcile/cleanup은 Drive token/access보다 먼저 저장 결과를 반환한다. 이 두 경로는 fresh Drive absence 검사가 아니다.
- **DELETE204 ack + DB same-attempt deleted ≠ fresh post-delete GET absence.** 실제 부재 관측이 없으면 그 부재를 기록하지 않는다. 실제 부재를 확인할 승인된 경로도 아직 결정/제공되지 않았다. 생성 정확히 한 번이나 직접 INVOKER writer 전체의 원격 검증 보장을 주장하지 않는다.

## 남은 사항

현재 unresolved는 실제 DB/Edge/predecessor metadata·provider/owner proof·자료실 B 실제 schema/계약, 원래 packet/SQL9 bytes의 부재, 승인되지 않은 proof/활성화 순서다. 이 문서는 source 준비를 검토 가능한 운영 초안으로 묶었으며 실행 허가나 production 성공 확인이 아니다. 미래 운영 직전에 actual latest source와 실제 현 상태를 새로 확인해야 한다.
