> **시점 보관본:** 아래는 해당 source/검토 당시 보고다. 사진 새 CI 실패·원격 archive·현재 상태는 [CC17.5 인계서](../cc17-5-handoff.md)가 우선한다. scratch 경로와 agent/session의 새 환경 존재를 보장하지 않는다.

# 📱 폰 가능 — CC17.4 사진 #531 touch 검사 보완 보고

1. **세션:** 2026-10-13 Codex 웹, `/root/photo_writer`, sole photo implementer. 요구사항 `/workspace/scratch/cc17-4/photo-brief.md`, 저장소 AGENTS.md, 인계서 사진 section 및 photo review/roadmap을 읽었다. systematic-debugging/TDD/verification-before-completion을 적용했다. 기존 설계를 이어 test/docs-only 보완했다. subagent0, 다른 branch 수정0.

2. **시작·최종 SHA / branch / PR:** worktree `/workspace/scratch/cc17-4-photo`, branch `codex/photo-ocr-client-inactive`, 기존 Draft PR https://github.com/mj880616/work/pull/531. frozen remote source `32a3fe857e2baf47906295cb8f22e8ff3f222335`; 새 actual main `28e620c06ee0fbd508d3aca3d574b451e4d4560c`를 이미 정상 merge한 시작 `4863474717e1bcee08f81aeef28af0532f648e39`. 구현자도 fresh `git ls-remote origin refs/heads/main`으로28e620c를 확인했다. 최종 **`c5478fc19d95fbc79486e38488e4adaae4296822`**, parent4863474, 정상 단일 commit `test(basket): declare OCR disclosure touch capability`. reset/rebase/force/push/merge 없음. 인계 main에서 들어온 handoff/base64/roadmap 문서는 별도 inherited delta이며 구현자 commit의 새 변경은 아래3파일이다.

3. **원인(사실/추정):** old32 spec은390px stored OCR native disclosure의 `page.touchscreen.tap`을 실제 실행하지만 `hasTouch` capability를 선언하지 않았다. 원격 기본 context에는 capability가 없어 hosted run38450135877/job115478603445는1557/1558·1실패였다. 기존 외부 로컬 photo config의hasTouch:true가 누락을 가렸다는 인계 사실을 새 isolated config의 old-source1/1 동일 failure로 확인했다. 이는 재현된 test context 준비 누락이다. 제품 동작·Auth·서버 원인으로 추정하지 않았다. 기존 basket-clip-icon.spec.mjs의 spec-level `test.use({hasTouch:true})` 패턴과 비교한 뒤 같은 최소 수정만 했다.

4. **변경 파일:** `tests/app-e2e/basket-photo-ocr.spec.mjs`에 설명 comment와 `test.use({hasTouch:true});` 2줄만 추가했다. 기존 모든 bytes는2줄을 제거하면32 spec과 정확히 동일하다. 실제 tap2회/44px, Enter keyboard, XSS literal text/no inline image, raw newline/value, original Drive link, zero requests, overflow, errors/console assertions, timeout/skip을 모두 보존했다. `docs/basket-photo-ocr-client-review.md`는 pushed32·wholePASS·hosted1failure 및 CC17.4 local42green/new scoped review·CI pending을 구분하도록 items1/2/5/6/11/12를 갱신했다. `docs/roadmap.md`의 top current paragraph/photo row/진행 역사에 같은 결과를 기록했다. handoff는 당시 checkpoint 역사로 유지했다.

5. **실행 테스트와 결과:** spec 수정 전 faithful context에서 stored390 하나를 실행해 **1실패/1case**, exit1, 정확히 `touchscreen.tap: hasTouch must be enabled on the browser context before using the touchscreen.`를 확인했다(첫 tap, old source33행). old spec checksum이32 원본과 같은 것을 확인했다. 수정 후 동일 config의 변경 spec 전체 **42/42 passed, 46.2s, 실패0/skip0**, exit0. 실제390 touch+keyboard와1280 keyboard를 포함한다. node syntax check/diff whitespace check/byte equality 모두 exit0. 단순 color environment 경고2줄(NO_COLOR/FORCE_COLOR)은 old/new runner 로그에 있고 브라우저 console 단언을 약화하지 않았다. clean main broad 재현은 수행하지 않았다. 해당 실패를 frozen32 old spec에서 직접 재현했으며 unchanged1130 Node·인접250·로컬 broad suite 재실행은 명시적으로 금지된 범위였다. 이전1130/1130·250의235pass15fail·보완49affected49green은 역사이고 새 실행 수에 합산하지 않았다.

6. **CI:** frozen32 whole Spec/Quality PASS는 인계 provenance다. hosted1557/1558·1failure(29.7m, run38450135877/job115478603445) 및 artifact11840924243/ZIP digest `4ea26376217ca410cbc1a2135404a981be90e017eca1d94f546b3d32ac872b68`는 인계 역사로 보존하며 새로 다운로드하거나 성공으로 덮지 않았다. 새 correction scoped 독립 재검토/exact-head 전체 CI는 **미실행·대기**. 구현자는 workflow를 실행하거나 PR에 push하지 않았다. 로컬42green은 exact CI/merge/Pages 완료가 아니다.

7. **DB·production·보안:** 생산 접근·DB·Edge·Worker·Cloudflare·workflow 실행/승인0. frozen32의 `BASKET_OCR_ENABLED=false` 및 제품/Node/Auth/DB/Edge/cache/workflow bytes 동일. 784개 non-doc/non-changed-spec tracked blobs를32 원본 bytes와 실제 worktree bytes로 비교했고 불일치0이다. committed tree diff도 동일 범위에서 exit0이다. 새 production test switch/registry/권한 완화/캐시 변경 없음. 실제 schema/provider/원본/temp 보호 증거를 새로 주장하지 않는다. 적용 순서·복구·정지 지점은 기존 별도 운영 gate다.

8. **사용자 확인:** 승인된 correction/review/CI 준비에는 새 중간 확인이 필요 없다. controller가 scoped 독립 검토 후 이미 승인된 일반반영 절차를 이어간다. 실제DB/Edge/실사진proof/활성화 순서 결정 및 기존 운영 approval gate는 별도다. 기존 완료 폰3건 반복 요청 없음.

9. **남은 위험:** 로컬 system Chromium151.0.7922.173/Node24.19.0, Playwright1.55.0이며 hosted Chromium140/Node20과 다르다. 새 exact hosted 검사가 필요하다. spec-level declaration은42cases의 context에 touch capability를 명시한다(기존 clip spec 패턴). viewport/mobile emulation/timeout을 바꾸지 않았다. 실제 운영 OCR은 계속false이며 source 준비로 실사진/DB/Edge/폰 완료를 대신하지 않는다.

10. **범위 밖:** 이 wave에서 새 제품 문제를 발견하거나 수정하지 않았다. 기존 전체 notes/attachments 예산/목록 초기화·로그인 갱신 약점과 actual operational facts의 미확인은 이전 문서대로 별도다. 색 출력 경고는 harness 환경뿐이며 기능 failure0. 새 접근/비밀값 요청 없음.

11. **roadmap 갱신:** 같은 정상 commit에서 photo current row/top statement/history와 review doc의 stale remote-docs-only/whole-review-pending/unpushed-source 주장들을 정정했다. 원32 hosted failure를 보존하고 new local42green·scoped review/CI pending을 구별한다. cache bytes frozen이므로 새 cache bump는 없다. docs/cc17-4-handoff.md는 inherited historical checkpoint로 변경하지 않았다.

12. **merge 상태:** correction local committed, tracked/untracked worktree clean. **SAFE IDLE**: 실행 중인 테스트/writer 없음, 수정·commit 작업 종료. no push/merge/production. read-only static server8560(session49073)만 controller 재사용을 위해 남겼다. 다음 controller 단계는 strongest scoped review → ordinary push to same Draft531 → new exact CI → authorized guarded squash/tested-tree equality/Pages이며 본 보고는 이 후속이 끝났다고 주장하지 않는다.

## 증거·재사용 환경

- dependency: `/workspace/scratch/cc17-4/deps/node_modules`, isolated install `@playwright/test@1.55.0` (3packages). repository package/lock/install files0. 테스트 중 사용했던 local `node_modules` symlink는 제거해 clean이다. reviewer가 아래처럼 재생성할 수 있다. library에서도 같은 isolated dependency를 연결할 수 있다.
- config: `/workspace/scratch/cc17-4/photo-ci-faithful.config.mjs`; `testDir`, `outputDir`, `use.launchOptions.executablePath:'/usr/bin/chromium'`만. hasTouch/timeout overrides0. default test timeout30s·expect5s 및 CLI worker1은 hosted 설정과 같다.
- static server:8560, both WEB2_TEST_ORIGIN/APP_E2E_ORIGIN=`http://127.0.0.1:8560`; `python3 -m http.server 8560 --bind 127.0.0.1`, cwd photo worktree, read-only server session49073.
- old-source snapshot `/workspace/scratch/cc17-4/photo-old-source.spec.mjs`, SHA256 `fd3f5bf9c45ce5aba4cf10ad42528da731b79a1213d1c27f9db84c59c57d06da`.
- RED `/workspace/scratch/cc17-4/photo-old-red.log`, `/workspace/scratch/cc17-4/photo-red-results/` including failure error-context.md.
- GREEN `/workspace/scratch/cc17-4/photo-green.log`, `/workspace/scratch/cc17-4/photo-green-results/` including390/1280 native text screenshots; no overwrite of RED evidence.
- byte proof `/workspace/scratch/cc17-4/photo-byte-equality.json`, reusable `/workspace/scratch/cc17-4/photo-byte-check.py`. New spec SHA256 `62b4c41e3c232578d73de81e66ba355559843a54bad99aa82abce4496b60f77b`.

## 검사/재현 명령

이전 RED는 수정 전에 수행했고 보존된 old spec이32와 동일하다. 아래 GREEN command는 완료한 full42 명령과 같다(더 돌릴 필요는 없음).

```bash
cd /workspace/scratch/cc17-4-photo
ln -s /workspace/scratch/cc17-4/deps/node_modules node_modules
env -u FORCE_COLOR WEB2_TEST_ORIGIN=http://127.0.0.1:8560 APP_E2E_ORIGIN=http://127.0.0.1:8560 /workspace/scratch/cc17-4/deps/node_modules/.bin/playwright test basket-photo-ocr.spec.mjs --config=/workspace/scratch/cc17-4/photo-ci-faithful.config.mjs --browser=chromium --workers=1 --reporter=line
rm node_modules
node --check tests/app-e2e/basket-photo-ocr.spec.mjs
git diff --check 4863474717e1bcee08f81aeef28af0532f648e39 HEAD
git diff --exit-code 32a3fe857e2baf47906295cb8f22e8ff3f222335 HEAD -- . ':!docs/**' ':!tests/app-e2e/basket-photo-ocr.spec.mjs'
python3 /workspace/scratch/cc17-4/photo-byte-check.py
git status --porcelain
```

Old32 RED command, run before adding spec capability:

```bash
WEB2_TEST_ORIGIN=http://127.0.0.1:8560 APP_E2E_ORIGIN=http://127.0.0.1:8560 /workspace/scratch/cc17-4/deps/node_modules/.bin/playwright test basket-photo-ocr.spec.mjs --config=/workspace/scratch/cc17-4/photo-ci-faithful.config.mjs --browser=chromium --workers=1 --reporter=line --output=/workspace/scratch/cc17-4/photo-red-results --grep='stored OCR native details text retention separate cleanup original source 390'
```

Already-preserved RED avoids reverting/changing the finished branch just to repeat failure. If exact re-execution is required later, use an independent32 checkout with its own scratch config/output/server and the same no-touch/no-timeout conditions; this implementer did not create or mutate another branch.
