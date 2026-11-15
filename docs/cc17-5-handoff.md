# 📱 폰 가능 — CC17.5 인계 (2026-10-14)

사용자가 현 상황 보고와 CC17.5 인계서 작성을 요청했다. 기존 개발 목표를 취소한 것은 아니다. CC17.5는 이 문서·[원장](roadmap.md)·실제 원격 상태부터 다시 확인하고 이어간다. 이전 채팅, scratch, agent, server 세션이 남아 있다고 가정하지 않는다.

## 현재 상태부터 보고

- 사진 #531의 touch 설정 누락은 보완·독립 검토·관련 42개 검사를 통과했다. 그러나 **새 전체 CI도 1557/1558, 다른 검사 1개 실패**여서 병합하지 않았다. 새 실패 원인은 아직 확정하지 않았다. 실제 사진 읽기는 계속 꺼져 있다.
- 자료실 삭제 안내와 두 화면의 계정·화면 전환 보호는 **구현·222/222 검사·독립 Spec/Quality 승인**까지 완료했다. 소스 보존 브랜치에 저장했으며 **캐시 통합·전체 검사·최종 CI·main 반영은 아직 없다.**
- #533은 최종 자료실 제품 PR로 쓸 **문서 준비 Draft**다. 아직 그 PR에 소비자 제품 소스를 push하지 않았다. 문서 PR의 성공을 제품 승인으로 쓰지 않는다.
- 서버 적용·사진 실사용·활성화·자료실 B 등록·Worker 운영 적용은 진행하지 않았다. 완료된 폰 3건을 다시 요구하지 않는다.

## 역할·승인 범위

[AGENTS.md](../AGENTS.md)가 규칙 원문이다. [승인된 통합 계획](web2-work-plan-20261012.md)과 기존 위임을 유지한다. CC는 제품 코드를 직접 쓰지 않고 구현자·독립 검토자를 같은 대화에서 운영하며 문서·순서·검증·승인된 일반 병합을 맡는다. 정해진 범위의 수정·검사·재검토·일반 merge를 다시 허락받지 않는다. 실제 DB/Edge/Cloudflare/production 변경·기능 활성화에는 기존 별도 gate가 남는다.

한 제품 브랜치의 writer는 하나다. active writer의 HEAD를 이동하지 않는다. SAFE IDLE에서만 actual main을 normal merge하고 제품 충돌은 구현자에게 돌린다. force/reset/rebase·미커밋 덮어쓰기·검사 약화·무근거 전체 재시도는 하지 않는다. meaningful RED→GREEN·독립 spec/quality·정확한 최종 head CI→expected-head guarded ordinary squash→전체 tested-tree 동일성→Pages 확인 순서다. 새 방의 기존 agent/session 재사용을 가정하지 않는다. 현재 기존 구현자·검토자는 모두 작업 종료·SAFE IDLE다.

## 2026-10-14 04:06 UTC 이후 새 원격 대조

조회 당시 actual main은 `28e620c06ee0fbd508d3aca3d574b451e4d4560c`였다. 이 인계 문서 PR의 후속 병합이 있으면 main은 더 새로워지므로 **시작 때 반드시 다시 fetch**한다. 로컬 `/workspace/work`의 `work`도 28e620c였으며 최신으로 고정하지 않는다.

| 대상 | 정확한 상태 |
| --- | --- |
| 사진 #531 | Draft/open·미병합. `codex/photo-ocr-client-inactive` 원격/로컬 `c5478fc19d95fbc79486e38488e4adaae4296822`, tree `9b3cdc507897bd8d5fc3a0263b70fa9681dcded0`. |
| 자료실 검토 완료 소스 | 새 보존 브랜치 **`codex/library-delete-ui-task2-reviewed`** 원격 `de094a54131be55e39fa8439004a63c49845228c`, tree `ecda964110febb27bd4e94ec4faa302bba481f62`. PR/main/Pages/최종 통합 완료가 아닌 Task2 archive다. |
| 기존 helper archive | `codex/library-delete-ui-prep` **원격은 여전히 a1c07713ca464ac3e1d98a5d8a4119b629f08f6f**다. 같은 이름의 이전 로컬 브랜치는 de094a다. 이름만 보고 원격도 최신 소비자 구현이라고 착각하지 않는다. |
| 자료실 #533 | Draft/open·미병합. `codex/library-delete-ui` 원격/문서 전용 로컬 `6459e3ab5841a8846e8a27d4ff97968fa05d9c3b`. 28e620c 부모의 문서 1파일뿐이다. |
| Worker #529 | 기존 `cf6bf0189208c4104ffbb80930d2c6a060fde511` source 승인과 별개로 운영 predecessor/version/복구·승인 미확인. 이번에 수정·병합하지 않았다. merge가 자동 Worker 배포를 유발하므로 끼워 넣지 않는다. |

#528/#530의 완료·Pages와 #532 인계 보존은 기존 기록을 유지한다. 이번 CC17.4에서 사진/자료실 제품을 main에 병합하거나 Pages에 게시한 적은 없다. 진행 중이라고 보고했던 사진 CI는 아래 재조회 결과로 갱신한다. 응답 종료 후 후속 작업이 자동으로 계속된다고 약속하지 않는다.

## 사진 #531 — 새 실패가 다음 첫 작업

32a3fe8의 최초 hosted 실패는 `touchscreen.tap`의 hasTouch 미선언이었다. actual main28을 문서만 normal merge한 `4863474717e1bcee08f81aeef28af0532f648e39`에서, frozen32와 같은 old spec으로 faithful context RED 1/1을 재현했다. `basket-photo-ocr.spec.mjs`에 comment와 `test.use({hasTouch:true});` **두 줄만** 추가한 c547은 관련 42/42(46.2초), scoped 독립 SpecPASS/QualityPASS·지적0이다. 제품·Node·Auth·DB·Edge·cache·workflow 784파일 bytes는32와 같다. [구현 보고](cc17-5-evidence/photo-c547-report.md)·[독립 검토](cc17-5-evidence/photo-c547-review.md).

새 exact c547 run **38458680140**, job **115507953817**, pull_request/attempt1은 2026-10-13 20:25 UTC에 failure로 종료됐다. 전체 **1557/1558·1실패(27.3분)**, check **19성공·2정상skip·1실패**다. 새 사진 spec의 touch 사례는 통과했다. 새 실패는:

> `tests/app-e2e/basket-linked-display.spec.mjs:134:46` — blocked Back during classification preview keeps route-owned history without an editor
>
> `page.evaluate: Execution context was destroyed, most likely because of a navigation.`
>
> `historyStack`의112행 `page.evaluate`,135행 호출. 내부113행은 calendar/basket lazy load다.

실패 spec은 actual main28과 c547에서 **byte 동일**임을 확인했다. 이것만으로 기존 문제·간헐 오류·사진 제품 원인이라고 확정하지 않는다. **새 실패의 clean-main/수정본 재현·원인 진단·보완·재검토는 아직 하지 않았다.** whole suite blind retry도 하지 않았다. 새 담당은 main과 c547에서 정확한 실패 경로·실제 navigation/URL/session/loader와 artifact를 좁게 대조하고, 원인 확인 뒤 같은 writer에게 complete fix bundle을 준다. 변화가 없던1130 Node·인접250 전체를 이유 없이 반복하지 않는다. 불가피한 제품 변경은 원인·범위·캐시 연쇄·새 검토를 명시한다.

원격 artifact **11846841144**, `app-e2e-report`, **4,950,600 bytes**, API digest **`6324ed3d84a879db2ca5b0ee8ab1361329c257b6d1b3833828ce6bdae1eb364d`**, 만료 예정2027-01-11이다. download file reference를 취득했지만 **로컬 ZIP bytes/hash 대조·추출은 아직 하지 않았다**. 다운로드 ref의 짧은 만료 URL을 영구 링크로 쓰지 말고 GitHub artifact ID로 다시 회수한다. 원로그는 현재 scratch의 `photo-c547-hosted-failure.log`에 보존했다. 원32의 실패 run38450135877/artifact11840924243와 이번 c547 실패를 혼동하지 않는다.

c547의 보완·독립 승인과 로컬42 GREEN은 새 전체 CI 실패를 대체하지 않는다. #531은 새 정확한 head의 CI가 통과하기 전 Draft·미병합 유지한다. `BASKET_OCR_ENABLED=false`는 계속 유지한다.

## 자료실 Task2 — 완료한 구현을 다시 시작하지 않기

helpera1c에 원래50b의 checksum 확인된 WIP patch를 복구한 로컬 commit은 `cc8c7e4168180f49d5272a2695713e02afe3ed85`다. 원50b commit 자체를 복구했다고 주장하지 않는다. de094a의 a1c 대비 변경은 **2consumer + 기존3browser spec, 정확히5파일**이다. helper와 repository Node95파일(Web2 93+별도 archive2)은 frozena1c다. [12항목 구현 보고](cc17-5-evidence/library-task2-de094a-report.md)·[새 독립 검토](cc17-5-evidence/library-task2-de094a-review.md).

구현은 기존 범위를 따른다: consumer별 ephemeral active-token Set, 실제 session owner·context/module owner/workspace/epoch/nonempty token 일치, immutable 초기 ID·검증한 registration 사본, lookup/import/confirm/response/notice/OAuth await·navigation·catch guards. 관측한 B/null/emptytoken·route departure/return·meeting a11y deactivate/activate는 영구 취소다. same-required-route source=session+validscope와 같은 owner validtoken rotation만 benign이다. luEditView·기존 edit/attempt Maps·Auth/router/runtime-client/server/schema는 바꾸지 않았다. luApi는 refreshSession:false와 epoch를 전달하며 실제401은 deletePOST1/authrefresh0/replay0, 기존 일반401 recovery와 upload one-argument reconnect는 유지한다. 관측 없는 숨은 history 복원이나 already-sent 요청 취소·서버 멱등성을 주장하지 않는다.

최종 같은3파일 **222/222(2.9분, 실패·skip0)**, immutable-ID focused10/10(7.6초), 독립 SpecPASS/QualityPASS·중요 지적0이다. 독립 fresh 기존17/17 및 별도 scratch 경계9/9는 별도 실행이며222와 고유 수로 합산하지 않는다. mutable row가 held import 도중 doc0→doc1로 바뀌는 실제4RED 후 validated registration snapshot으로 고쳤다. helper74/74+이전 독립6/6(420조합)은 역사 근거다.

실패 이력도 유지한다: 이전방96요구RED·추가24(4control/17assertion/3관측timeout), 이번 narrow4RED·13RED·추가6RED 중2invalidworkspace setup, 첫18/20, 안정된 첫 전체212/218(4filter setup assertion+2upload hidden-modal timeout), ID6control/4genuineRED→10GREEN→최종222GREEN. 한때20/20라고 조기 보고한 것은18/20로 정정했다. 최종 검사는 실제 DOM/router/a11y/runtime/consumer를 사용하고 OAuth native navigation을 관측한다. localcache는 소비자 settlement 직후·filter 복구 전에 확인해 재조회가 optimistic removal을 가리지 않게 했다. fullshell 제외 fixture는 실제 운영 identity 증거가 아니다.

## 다음 Task3 — 아직 실행 안 됨

1. 사진 실패 진단·필요 보완·검토·exact CI→guarded 일반 squash·tested-tree equality·Pages를 먼저 마친다. 인계 문서 main 반영은 사진 제품 반영의 대체가 아니다.
2. source de094a와 writer SAFE IDLE을 확인하고 **실제 사진 main**을 normal merge한다. 원격 #533 문서 stub6459도 normal merge해 최종 source가 그 자손이 되게 한다. 이미 로컬 `codex/library-delete-ui`가 별도 worktree에 체크아웃돼 있을 수 있으므로 branch 이동·reset으로 덮지 않는다. 필요하면 새 작업 브랜치를 de094a에서 만들고 마지막에 최종 HEAD를 remote `codex/library-delete-ui`로 **normal fast-forward push**한다. 원 a1c archive와 de094a archive는 보존한다.
3. 같은 구현자가 helper 버전·모든 소비자·view-loader→loader-v2→app/index/modulepreload와 정확 기대값을 통합한다. Task2의 의도적 미갱신 캐시는 공개 반영 준비 완료가 아니다.
4. 실제 Web2 Node inventory95파일(scripts5/root22/auth11/domain5/edge2/security50; 별도 personal archive2는 범위 밖)을 기준으로 전체 Node·실제 PG/Deno-backed 검사·필수 실제 workflow static/security/storage·cache/graph·필요 인접 browser를 한 번 검증한다. 최종 case 수는 실행 결과로 확정한다. 기존1130이나222를 새 통합 전체 결과로 대체하지 않는다.
5. [준비된 Task3 브리프](cc17-5-evidence/library-task3-brief.md)를 새 환경에 맞게 읽고 source review doc·원장을 #533과 같은 PR에서 갱신한다. 새 whole final spec/quality review→정확한 최종 source push/CI→guarded ordinary squash→tree equality→Pages다. Task2 PASS만으로 최종 통합 승인을 생략하지 않는다.

이 순서는 기존 승인 그대로다. B등록·신규 API/RPC·library-files _shared·권한 확대를 섞지 않는다.

## 운영 gate와 실제 미확인 사실

[운영 사실 검토본](cc17-5-evidence/operations-fact-review.md)은 source만 읽은 구체 검토본이며 실행 승인이 아니다. 실제 DB·PGversion/ACL/trigger/history·네 함수 predecessor 전체SHA/version/JWT·provider/owner proof는 미확인이다. basket-files/drive-summary/document-actions와 일정 저장 보호 google-calendar를 구별하며 마지막 함수는 OCR dependency가 아니다. #529도 별도다.

사용자 version SELECT(PG>=16)→snapshot/precheck→main migration20261013034836 user dry-run→전후 원상태 대조→별도 apply/backup/postcheck 순서를 유지한다. 한 OCR key라도 사용한 뒤에는 unused rollback 대신 원본·글·attempt/temp/cleanup 보존/forward fix다. AI는 production 접속·키·DBwrite·Supabase 로그인·운영 workflow dispatch/승인·Edge 배포를 하지 않는다. no db push/migration repair.

proof-before-activation과 normal UI false의 순환은 여전히 미결이다. 정상 수동 먼저(automatic off)/정상 전체 먼저/현 hold의 명시적 순서 결정과 검토된 source·복구가 필요하며 어느 활성화 안도 승인되지 않았다. 폰 경로B의 자료write금지, standalonefactorylauncher 미채택, shared native registry 유지, 새 rawfetch/debugroute 금지를 지킨다. metadata/version/md5와 실제 bytehash, DELETE204 ack+DB same-attempt deleted와 fresh post-delete GET absence를 각각 구별한다.

옛 SQL9 `library-schema-preflight.select.sql`과 옛 owner proof packet은 이번 새 workspace에 없었다. SQL9 hash `fb5a15e5ad84b4e7beabb929d71f96875a9b2dd036f9d4c2527af636c2ffdb0d`는 옛 인계 기록이며 이번 bytes 대조 결과가 아니다. 복구/실행됐다고 쓰지 않는다. 실제 schema·effective privilege·custom function·등록 request 계약 없는 B등록은 hold다.

## workspace·증거·다른 환경 복구

현재 경로는 존재 확인 뒤에만 사용한다: photo `/workspace/scratch/cc17-4-photo` c547, library `/workspace/scratch/cc17-4-library` de094a, #533 doc `/workspace/scratch/cc17-4-library-pr`6459, journal/brief/report/logs `/workspace/scratch/cc17-4/`. 새 room에서 old agent ID/session/server 생존을 가정하지 않는다. 독립 reviewer의 temporary symlink는 제거됐고 세 작업공간은 clean이다.

재사용 환경(있을 때만): Node24.19/Playwright1.55/systemChromium151.0.7922.173, hosted140/Node20과 구별. deps, deps-scripts(acorn8.15), deps-pg(17.6/pg8.16.3), deps-deno(Deno2.9.6)는 scratch 아래다. photo8560/library8123이며 두 `APP_E2E_ORIGIN`/`WEB2_TEST_ORIGIN`을 반드시 일치시킨다. runtime fixture는8123을 쓴다. faithful photo config는 touch/timeout override 없고 spec이 touch를 선언한다. library config는 testDir/output/executable/hasTouch만이며 timeout/retry override가 없다.

다른 workspace는 GitHub의 정확한 photo c547·자료실 **새 Task2 archive de094a**·#533 docstub6459를 fetch하면 소스를 회수할 수 있다. 새 보고·독립 검토·Task3 브리프·운영 packet은 이 문서 옆 `cc17-5-evidence/`에 보존해 옛 scratch가 없어도 읽을 수 있게 했다. 이 문서 PR의 12항목/검사/병합·게시 결과는 해당 PR 본문과 현재 채팅의 최종 보고를 따른다.
