# 📱 폰 가능 — CC 17.4 인계 (2026-10-13)

사용자가 CC17.3 대화 길이와 응답 중단을 우려해 인계를 준비했다. 작업을 취소하거나 방향을 바꾼 것이 아니다. CC17.4는 이 문서와 최신 원장·원격 source·실행 결과부터 대조하고 같은 승인 범위를 이어간다. 다른 대화 원문을 읽을 수 있다고 가정하지 않는다.

## 사용자에게 보고할 현재 상태

- 저장·다시 열기 보완 #528은 검사·반영·게시 확인까지 완료했다.
- 사진 글자 읽기 #531은 비활성 소스 구현·독립 검토가 완료됐으나 전체 검사1558개 중1개가 실패해 반영을 보류했다. 실패 로그는 모바일 touch 검사 설정 누락을 명시한다. 실제 사진 읽기는 아직 꺼져 있다.
- 자료실 삭제 안내의 공통 helper는 구현·독립 검토 완료다. 소비자 연결 전 요구 검사에서 문제를 재현했고, 그 검사 중간본을 저장했다. 두 화면의 제품 구현은 아직 시작하지 않았다.
- 다음은 사진 시험 설정 보완과 자료실 소비자 구현·검토·검사다. 실제 DB/Edge 적용·사진 실사용·활성화·자료 등록은 별도 gate가 남는다.

## 계속 맡겨진 범위와 역할

기준 규칙은 [AGENTS.md](../AGENTS.md), 원장은 [roadmap.md](roadmap.md), 기존 승인·순서는 [작업 계획](web2-work-plan-20261012.md)이다. 사용자는 방향이 정해진 작업의 인간 개입을 최소화하도록 맡겼다. 같은 방에서 CC가 내부 구현/검토 담당을 운영한다. CC는 제품 코드를 직접 쓰지 않으며 문서·순서·검토·승인된 일반 병합을 맡는다. routine 수정·테스트·독립 검토·일반 merge를 다시 허락받지 않는다. 기존 승인된 범위를 새 기능/운영 승인으로 확대하지 않는다.

사용자가 새 방에서 상태를 묻는 동안에도 기존 목표를 유지한다. 한국어 일상어로 완료·남은 일을 먼저 보고한다. 진행 메시지는60초를 넘기지 않으며 큰 로그/명령/실패 사례 이름을 사용자에게 쏟지 않는다. 인계 뒤 작업을 자동으로 계속하는 백그라운드 실행이 있다고 약속하지 않는다.

한 제품 브랜치의 writer는 하나다. active writer의 HEAD를 CC가 이동하지 않는다. SAFE IDLE 뒤에만 새 actual-main을 normal merge하며 product 충돌은 구현자에게 돌린다. force/reset/미커밋 덮어쓰기/불필요한 clean-green broad test 반복은 금지다. 새 수정은 meaningful RED→GREEN, 독립 spec/quality 검토, exact-final-head CI 뒤 expected-head guarded ordinary squash·Pages 확인이다.

## 실제 원격·완료 근거

인계 전 fresh fetch로 actual main은 `cbdb03f5a784afb0c91c42c682b8e8a5bf4f0f1a`였다. 새 main을 시작 시 다시 조회한다. `/workspace/work`의 로컬 HEAD9235를 최신으로 쓰지 않는다.

| 항목 | 정확한 source/결과 |
| --- | --- |
| #528 저장 보호 | final source `252c2eb8a8408c4b7da8589efa805b092d1d7b2f`, 독립 승인; exactCI16workflow 성공/21check성공·2정상skip, 전체1516/1516(26.5분) run38436393002/job115431375270. squash main `201a5a4fa70cf3384d6ab5c40ee3b4270e3be3f5`, entire tested-tree equality 확인. Pages38440612292 build/deploy/report 성공. |
| #530 문서 | source `f4179e103441273ac320e4625fb0ffbf6c9e0597`, 독립 fact/spec/quality 승인, docCI 성공. squash maincbdb와 전체 tree 동일. Pages38441822994 전체3job 성공. |
| #531 사진 | branch `codex/photo-ocr-client-inactive`, exact remote `32a3fe857e2baf47906295cb8f22e8ff3f222335`, basecbdb, Draft/open,27파일1278추가48삭제. final whole SpecPASS/QualityPASS; default `BASKET_OCR_ENABLED=false`. 새32 전체CI는1557/1558·1실패, 병합/Pages 없음. |
| #529 Worker | source `cf6bf0189208c4104ffbb80930d2c6a060fde511`, source review 승인이나 actual predecessor/version/recovery/운영 승인 미확인. Draft 유지. merge가 main push 자동Worker배포를 유발하므로 일반 문서/앱 merge에 끼워 넣지 않는다. |

완료한 폰3건은 홈 두 항목 제거, 조직 최근 날짜, 바구니 목록 새로고침이다. 반복 요구하지 않는다. 새 저장 보호/사진/자료실 폰 확인은 이3건의 완료로 대체하지 않는다.

## 사진 #531 — 확정된 실패와 다음 순서

run `38450135877`, job `115478603445`, event pull_request/attempt1,1558cases/1worker;29.7분1557pass/1fail. 나머지14PR workflows 및 publication/dropzone/cache gate는 성공이다. 실패는 `tests/app-e2e/basket-photo-ocr.spec.mjs:28`의 `stored OCR native details text retention separate cleanup original source 390`,33행 `page.touchscreen.tap`이다. 로그의 정확한 오류:

> touchscreen.tap: hasTouch must be enabled on the browser context before using the touchscreen.

이 새 spec은 touch context를 자체 선언하지 않는다. hosted 기본 context는 hasTouch:false이며 로컬 외부 photo config의 hasTouch:true가 누락을 가렸다. 제품 원인으로 추측하거나 whole suite를 blind retry하지 않는다. **아직 source 보완을 하지 않았다.**

실패 artifact11840924243,4848585bytes, SHA256 `4ea26376217ca410cbc1a2135404a981be90e017eca1d94f546b3d32ac872b68`를 공개digest와 다운로드ZIP 대조하고108entries를 안전하게 추출했다. 원로그와 원artifact를 보존한다.

다음 담당은 실제 새 main을 fetch하고 photo writer SAFE IDLE32를 확인한다. 새 main이 문서뿐이면 normal merge로 받아들이고 source tree 영향/문서 검토를 분리한다. 기존 photo writer에게 **test/docs only** complete fix bundle을 준다: 해당spec에 실제 touch capability를 명시하고, CI와 같은 touch override 없는 context에서 old-source failure를 좁게 확인한 뒤 변경한 전체42cases를 검증한다. 44px/tap2회·keyboard/XSS/원문/원본/zero-request 단언·timeout/skip를 유지한다. 제품/Node/Auth/DB/Edge/cache/workflow bytes는 frozen32와 동일해야 한다. 결과·역사·roadmap/docs를 같은 source commit에 기록하고 strongest final reviewer가32..new delta를 scoped re-review한다. 이후 같은 Draft531에 normal push→새exactCI→green일 때 guarded squash→tested-tree equality→Pages다. unchanged1130Node/250인접은 다시 돌려 성공 수를 덮지 않는다.

사진 이전 검증:95Node files1130/1130,439cache refs/27changed,17실제static/security/storage블록,Deno2entry,functions-only8module46980B. 인접250 최초235pass/15fail(2옛malformedPDF fixture,13다른APP_E2E_ORIGIN8123 연결 거부)을 보존했고 유효noOCR PDF/두origin8560으로 동일49affectedcases49/49. 단일250green/235+49새unique로 쓰지 않는다. source fixes5a→eb0→1ee→0f→ac8(취소된scope 복귀/표시attempt 혼동/unknownauthority/cleanup 문구)는 최종 검토에서 해결됨; 재시작하지 않는다.

## 자료실 A — 인계 checkpoint와 다음 순서

local `/workspace/scratch/cc17-3-library-delete-ui`, branch `codex/library-delete-ui-prep`. helper checkpoint `a1c07713ca464ac3e1d98a5d8a4119b629f08f6f`, 실제basecbdb. 변경은 `app/document-delete.js`와 `tests/document-delete.test.mjs`뿐. focused74/74, 독립74/74+scratch6/6(420현대응답조합), Spec/QualityPASS. 기존7baseline 통과와 새requirement73RED는 구분한다.

helper는 coherent modern3fields만 Drive 보존/휴지통/missing/no_file 사실을 안내하고 legacyoktrue는 Drive결과미확인이다. unknown/partial/malformed/error는false·check-first·event/optimisticrow 없음. 기존 API option `refreshSession:false`와epoch/current guard·owning pendinglock을 사용한다. boolean/event/role 계약은 보존. maybeReconnect 두번째context `{isCurrent,expectedSessionEpoch}`는 소비자 callback 내부 await/navigation까지 전달해야 한다.

소비자 제품 `app/library-upload.js`/`app/meeting-round-detail.js`는 아직 a1c/base와 동일하다. 새requirement browser3spec만 인계WIP에 들어간다. 첫96/96fail은 사전 요구RED이며96제품회귀가 아니다. actual owner/token mismatch에서confirm/POST, held lookup/import/response 후session/route복귀 stalePOST/notice, luApi의refreshSession/epoch누락을 재현했다. tokenrotation은 기존1POST/event를 유지한 뒤 새epoch 옵션 단언에서 실패했다. OAuth actual native navigation1(예상0)도 관측했고 synthetic sink hold/oldpage settlement timeout은 harness 문제로 분리해 보존한다. **소비자 구현/GREEN/Task2 approval/전체CI는 없다.** 최종WIP SHA/원격 보존 위치는 이 문서 끝의 checkpoint record를 따른다.

Task2 이어서 구현할 source는 위2consumer와 필요한 기존 material-selection-delete/runtime-recovery/library-row-list spec만이다. helper/Node frozen, 공통cache/docs/broad검사는photo actual-main 반영 뒤 SAFE IDLE sync/Task3에서 한다. runtime-client/Auth/server/schema/B등록 변경은 없다. 실제HTTP400 runtime은server code/phase를 버리므로 conservativeunknown을 검증한다. actual401 deletePOST1/authrefresh0/replay0; luApi falseoption 전달, epoch/currentscope unavailable0POST. 일반 runtime401 recovery/upload reconnect는 보존한다.

최소 lifetime:각consumer ephemeral active-token Set; 최초 ID/nonemptyowner/workspace/epoch·meetingID/requestepoch captured immutable, checkpoint/event에서 mismatch면영구remove. actual session.read().user와ctx/moduleowner agreement 기존edit helper 재사용+nonemptytoken. sameowner validtoken rotation을 pin하지 않는다. actual view departure/return, meeting detail a11ydeactivate/activate는 editor없어도token취소. **same-required-route source=session +validscope/token 이벤트만 benign**이며 luEditView 비교는 추가하지 않는다(기존edit listener가benign notification에도증가). sessionB/null/emptytoken→A복귀를관측하면취소는되살아나지않는다. 관측없는동일최종상태의숨은history를복원한다고주장하지않는다. 기존edit/attempt Maps/Auth/routing은수정하지않는다.

Full shell은B/null변경시 reload하므로 unchangedctx/epoch case는 실제runtimefixture에actualDOM/router/a11y/consumer module을조합하여분리한다. 실제normal-app401/400/결과/list검사는별도로유지하며 fixture를실운영증거로쓰지않는다. 제품 함수복제/productiontestswitch없음. passed reconnect ctx를 library innerdrive-startawait/navigation/catchalert까지검사하고 uploadonearg계약보존. deferred pre-send는0POST, already-sent response는1POST의latepresentation0으로구분한다.

Task2 settledtests/GREEN→commit/12report/SAFEIDLE→fresh독립 spec/quality review. 새finding은completebundle 한wave로samewriter, scoped rereview. 그다음 실제photo main normal sync→Task3 캐시helperv/모든consumers/view-loader/loader/app/index/preload/exactexpectations→actualNode inventory/필수static/security/adjacent 한번→전체review/정확CI/일반merge/Pages. B등록과source준비·운영보호를구별한다.

## 마지막 운영 묶음 — 추측 금지와 준비된 검토본

cloud는production접근/토큰/DBwrite/Supabase로그인/Edge배포/workflow실행·승인을하지않는다. 기존 사용자버튼만 쓴다. DBversion SELECT(PG>=16)→snapshot/precheck대조→main migration20261013034836의userdry-run→원상태대조→apply/backup/postcheck대조. 한OCRkey라도사용하면exactunusedrollback 대신 원본·글·attempt/temp/cleanup기록보존/forwardfix다. no dbpush/migrationrepair.

실제현재 source/predecessor전체SHA/version/JWT가미확인인4함수는 basket-files/drive-summary/document-actions/google-calendar다. 마지막1개는#521/1c일정보호이지OCRdependency가아니다. 역사basket-filesv2/drive-summaryv7SHA를현재rollback으로채우지않는다. 함수별 기존workflow first_deployfalse/JWTkeep/unauth401/OPTIONS200or204·현재versionincrease 확인이며 AI실행불가다. 실schema/customtriggers/FK/정확등록request계약없는자료실B등록은hold.

실사진proof-before-activation과normalUIfalse의순환은아직미결이다. AGENTS phoneB 진단북마크자료write금지는유지한다. 새운영launcher/rawfetch/debug route는만들지않았다. 초기standalonefactorylauncher 제안은현재sharedregistry와맞지않아미채택으로대체했다. 마지막검토본은 정상수동먼저(automatic계속off)/정상전체먼저/현hold 선택지의explicit순서변경과정확source·복구·운영facts를준비해야한다. 어느안도승인되지않았으며 지금기능을켜지않는다.

원본get/version/md5전후대조와temp검증→GoogleDELETE204ack+DBsameattemptdeleted를freshpostdeleteGETabsence로과장하지않는다. ocr-status는DBonly, alreadydeletedreconcile은Driveaccess전에storedreturn. 원본링크열림도bytehashproof와구별한다.

## 기존 workspace 사용 시 복구 자료

`/workspace/scratch/cc17-3-save-plan/progress.md` 전체journal, photo-final-review.md, photo-task3b-report.md, library-delete-helper-report.md, library-delete-task1-review.md, library-delete-task2-report.md, library-delete-ui-plan.md, library-delete-task2-brief.md, owner-photo-proof-decision-packet.md를읽는다. 파일존재를확인하지않고기억한경로/세션ID를실행하지않는다.

catalog복사용library-schema-preflight.select.sql은9SELECT-only, hash `fb5a15e5ad84b4e7beabb929d71f96875a9b2dd036f9d4c2527af636c2ffdb0d`; notes/independentstaticreview와함께보존. exactOIDconstraints/fullindexes/allsourceincomingFK/ownerRLS/defaults/triggers/policies/rawACL이다. 별도PG>=16먼저, 실제schema/effectiveprivileges/customfunctionbehavior의증거아님. 옛8query는historicalonly이며packetlink는새SQL로수정·scopedreviewaddressed. 실제운영실행없음.

기존정적server:photo8560 session91572,library8123 session86745. 기존deps3symlinks는save528provisioneddirs,Deno2.9.6별도PATH,Node24.19/Playwright1.55/systemChromium151(hosted140). libraryconfig는testDir/output/executable/touch만,timeoutoverride없음. photo-ci32-faithful.config.mjs는touchoverride없이testDir/output/executable만이며다음좁은재현용이다. Both WEB2_TEST_ORIGIN/APP_E2E_ORIGIN를반드시맞춘다; runtime-recoveryfixturehard8123. 다른workspace에서는세션/설치/scratch존재를가정하지않고필요환경만준비한다. 생산키요청금지.

새room은새역할이므로기존agent가계속돌고있다고가정하지않는다. 필요한 writer/reviewer를기존승인대로delegate하되한productwriter와safeidle규칙을유지한다. completedagent의send_message는새turn을시작하지않으므로후속작업은followup_task로한다.

## Checkpoint record

자료실 writer는SAFE IDLE에서test-only WIP `50b6818e9d017234ee36dd991b0047d58725d257`를committed/trackedclean으로반환했다. 제품2consumer/helper/Node는a1c와byte동일이고diff는기존browser3spec뿐이다. 추가focused24는4양성controlpass·17Assertionfail·3old-page settlement timeout으로나눈다. OAuthsinkhold 진단·중단counts는합산하지않는다. GREEN/구현완료/CI없음.

다른workspace복구용으로 **검토된helper a1c만** `origin/codex/library-delete-ui-prep`에보존한다. normalbrancharchive이며PR/main/Pages/운영적용이나cache통합완료가아니다. WIPtest3files는실행경로에publish하지않고 [정확한차이의base64보관본](cc17-4-library-delete-task2-wip.patch.base64)으로저장했다. decodedpatch는37,806bytes, SHA256 `7f56b545cd5f8d02151534c05bfd4973cd995c0293671924c9ec671d300c172c`다. unifieddiff의빈context한칸을정확히보존하면서문서diff whitespace오류를피하려고문서보관형식만base64로했다. 새workspace는a1c branch를fetch하고이파일을scratch에서base64decode한뒤hash·`git apply --check` 확인후적용한다. 이patch는**미완성신규요구RED**, 최종source승인이나즉시merge대상이아니다. 실제최신main이문서뿐인지확인하고SAFE IDLE normalmerge/전용writer를통해계속한다.

portable인계묶음에는원본50b까지의gitbundle와scratchplan/report/review/실패로그/artifact를넣어exactcommit·증거도복구할수있게한다. 다른workspace에서원래scratch/agent/session이남아있다고가정하지않는다. 인계문서PR·검사상태는그PR본문의12항목을따른다.
