> **시점 보관본:** 아래는 해당 source/검토 당시 보고다. 사진 새 CI 실패·원격 archive·현재 상태는 [CC17.5 인계서](../cc17-5-handoff.md)가 우선한다. scratch 경로와 agent/session의 새 환경 존재를 보장하지 않는다.

# CC17.4 Library deletion Task2 — source checkpoint report

Status: committed source checkpoint, full changed-browser bundle GREEN, SAFE IDLE. Independent Task2 approval/review, integration, exact-final-head CI, merge, and Pages are not claimed.

1. Session
   Codex cloud delegated sole product writer. `/workspace/scratch/cc17-4-library`; local static origin `http://127.0.0.1:8123`. No subagents or production access.

2. Source / branch / PR
   Reviewed helper base `a1c07713ca464ac3e1d98a5d8a4119b629f08f6f`. Start restored RED WIP `cc8c7e4168180f49d5272a2695713e02afe3ed85`, branch `codex/library-delete-ui-prep`; restored patch, not original `50b6818e9d017234ee36dd991b0047d58725d257` commit. Final SHA `de094a54131be55e39fa8439004a63c49845228c`, tree `ecda964110febb27bd4e94ec4faa302bba481f62`. Commit preserves the tested final source; tracked clean. Actual remote main read `28e620c06ee0fbd508d3aca3d574b451e4d4560c`; active branch was not synced. Controller owns Draft #533; this Task2 source was not pushed.

3. Cause (fact / inference)
   Fact: both consumers omitted immutable lifetime guards and expected session epoch; library `luApi` dropped `refreshSession:false`. Existing callbacks could confirm/send or present results after observed session/route restoration; custom library reconnect did not carry the helper context into its drive-start await/navigation/catch.
   Harness facts: old-page settlement cannot survive native OAuth document replacement. The unused synthetic sink hold was removed, completion observation moved to runner bindings, and OAuth waits accept recorded real native navigation/request or completion while retaining zero-navigation assertions. Runtime context.set rejects an invalid replacement and retains the prior valid context; two new probes initially tested that retained valid state by mistake. They were corrected through the actual context.read snapshot without weakening zero-POST assertions.
   No claim of detecting an unobserved hidden history transition with identical final state.

4. Files
   Product: `app/library-upload.js`, `app/meeting-round-detail.js`. Browser specs: existing `material-selection-delete.spec.mjs`, `runtime-recovery.spec.mjs`, `library-row-list.spec.mjs`. Per-consumer ephemeral active-token Sets capture owner/workspace/session epoch/document ID and meeting/request epoch. Mismatch permanently removes the token. Same-owner nonempty token rotation is valid; only same-required-route source=session with valid actual scope is benign. Existing edit/attempt Maps and Auth/router implementations unchanged. Shared helper lock/boolean/event/role behavior remains frozen.

5. Tests / evidence
   Provenance from handoff: prior 96/96 failures are new requirement RED, not product regressions. Additional prior 24 = 4 control pass / 17 assertion failures / 3 old-page observation timeouts. Original scratch reports/logs were unavailable and were not invented or rerun in bulk.
   This session baseline narrow harness run: 4 assertion failures / 0 observation timeouts. Settled harness representative RED: 13 assertion failures / 0 observation timeouts, covering normal-app real-runtime 401/400 separately from fixture consumer lifecycle. Additional RED: 6 assertion failures (two workspace setup probes later identified as invalid harness evidence; four genuine snapshot-empty/negative-epoch failures). First focused implementation run: 18 pass / 2 workspace-harness assertion failures, not 20 GREEN. Stable initial full run: 212/218 pass, four retained-row filter assertion failures and two upload fixture hidden-modal timeouts (4.2min, exit1). Actual library route entry resets filter to general and hides meeting rows; no late delete alerts/events occurred. Tests now capture local cache IDs at consumer settlement before restoring actual chip selection, retaining the DOM row assertion without letting later GET mask optimistic removal. Upload fixture uses actual DOM/a11y modal activation; shell bootstrap remains excluded. New immutable-registration boundary run: 6 harness controls pass / 4 genuine RED assertion failures (wrong doc-1 POST after doc-0 capture). Both consumers freeze the validated registration before helper import. Focused GREEN:10/10 (7.6s, exit0). Final whole three-file GREEN:222/222, exit0,2.9min; no exclusions/skips/retry/timeout expansion. Syntax checks all five changed JS/spec files and diff whitespace check pass.
   Stable initial inventory218 = row/menu15 + material/upload/normal-app72 + runtime/fixture131. Final inventory222 =15+72+135 after four immutable-ID cases. All three changed browser files run whole, one worker, no skip/exclusion/timeout override.
   Browser Node versions: Node v24.19.0; @playwright/test1.55.0; system Chromium151.0.7922.173 (Debian13). CI bundled Chromium differs (140); CI is not claimed. Dependency reuse `/workspace/scratch/cc17-4/deps/node_modules`; scratch config changes only testDir/outputDir/executablePath/hasTouch.
   Both APP_E2E_ORIGIN and WEB2_TEST_ORIGIN exactly match8123, including runtime fixture hard-coded origin. Fixture combines actual runtime/DOM/router/a11y/consumer modules; excludes shell Auth reload behavior, and is not represented as production identity evidence. Normal app login, 401/400 transport, confirmed/unknown results, and list evidence remain separate.
   Every browser command prefixed `APP_E2E_ORIGIN=http://127.0.0.1:8123 WEB2_TEST_ORIGIN=http://127.0.0.1:8123`, uses `node node_modules/@playwright/test/cli.js test --config=/workspace/scratch/cc17-4/library-task2.config.mjs --workers=1 --reporter=line`.
   Log/selection evidence:
   - `library-harness-baseline.log`: runtime grep guarded OAuth await390 / OAuth session snapshot390 / same owner valid token rotation390; 4 assertion failures.
   - `library-red.log`: runtime + material grep entry actual owner390 / snapshot null390 / rotation390 / OAuth390 / integration401/400390 / a11y390; 13 assertion failures.
   - `library-extra-red.log`: runtime grep negative epoch390 / context workspace390 / snapshot empty390; 6 assertion failures, of which2 workspace setups are excluded as invalid RED evidence.
   - `library-focused-green.log`: focused20, 18pass/2workspace setup failure. Includes shared runtime forwarding assertion; preserves historical premature progress correction.
   - `library-full-green.log`: whole three files,212/218; six named harness setup failures described above.
   - `library-row-id-red.log`: runtime grep initial registration ID / sent response.*library / one argument reconnect;6pass/4wrong-ID assertionfail.
   - `library-row-id-green.log`: same selection10/10 after immutable registration snapshot fix.
   - `library-final-green.log`: final whole three-file run222/222,2.9min,exit0.
   Exact command forms (all include the environment prefix above):
   `node node_modules/@playwright/test/cli.js test --config=/workspace/scratch/cc17-4/library-task2.config.mjs runtime-recovery.spec.mjs --grep 'guarded OAuth await.*390|OAuth session snapshot.*390|same owner valid token rotation.*390' --workers=1 --reporter=line` (baseline4).
   `node node_modules/@playwright/test/cli.js test --config=/workspace/scratch/cc17-4/library-task2.config.mjs runtime-recovery.spec.mjs material-selection-delete.spec.mjs --grep 'entry refuses actual owner.*390|import observed snapshot null.*390|same owner valid token rotation.*390|guarded OAuth await.*390|OAuth session snapshot.*390|integration 401.*390|integration 400 phases.*390|a11y deactivate.*390' --workers=1 --reporter=line` (RED13).
   `node node_modules/@playwright/test/cli.js test --config=/workspace/scratch/cc17-4/library-task2.config.mjs runtime-recovery.spec.mjs --grep 'unavailable shared runtime (negative epoch|context workspace).*390|import observed snapshot empty.*390' --workers=1 --reporter=line` (RED6, two invalid setups excluded).
   `node node_modules/@playwright/test/cli.js test --config=/workspace/scratch/cc17-4/library-task2.config.mjs runtime-recovery.spec.mjs material-selection-delete.spec.mjs --grep 'entry refuses actual owner.*390|import observed snapshot (null|empty).*390|same owner valid token rotation.*390|guarded OAuth await.*390|OAuth session snapshot.*390|integration 401.*390|integration 400 phases.*390|a11y deactivate.*390|unavailable shared runtime (negative epoch|context workspace).*390|library mutations use' --workers=1 --reporter=line` (first focused18/20).
   `node node_modules/@playwright/test/cli.js test --config=/workspace/scratch/cc17-4/library-task2.config.mjs runtime-recovery.spec.mjs --grep 'initial registration ID|sent response.*library|one argument reconnect' --workers=1 --reporter=line` (RED6pass/4fail then GREEN10).
   `node node_modules/@playwright/test/cli.js test --config=/workspace/scratch/cc17-4/library-task2.config.mjs runtime-recovery.spec.mjs material-selection-delete.spec.mjs library-row-list.spec.mjs --workers=1 --reporter=line` (stable first218 then final222).
   `node node_modules/@playwright/test/cli.js test --config=/workspace/scratch/cc17-4/library-task2.config.mjs runtime-recovery.spec.mjs material-selection-delete.spec.mjs library-row-list.spec.mjs --list --reporter=json` (final inventory).
   Config has no timeout/retry override. All logs stored under `/workspace/scratch/cc17-4/`. `node --check app/library-upload.js`, `node --check app/meeting-round-detail.js`, `git diff --check`: pass. Source proof `/workspace/scratch/cc17-4/library-scope-proof.json`; final browser listing `/workspace/scratch/cc17-4/library-inventory.json` confirms15+72+135=222.

6. CI
   Not run or claimed for Task2. No broad suite claimed. Exact-final-head CI follows independent review and Task3 integration.

7. DB / production / security
   No DB/Edge/server/schema/Auth/runtime-client/B-registration changes, no new persistence or authority store, no production access/writes, no deploy/merge/push. Scope proof compares every changed tracked path against a1c: only five allowlisted files. All 95 repository-wide tracked *.test.mjs/*.test.js files unchanged (Web2 93: scripts5/root20/auth11/domain5/edge2/security50; unrelated archive2). Earlier88 label covered only tests/; helper byte equality verified (SHA256323b07e4a1c904dc9806c9531a9347623be7636628121ce38fff70c1ef57db7f on both). Node tests frozen, not rerun as new evidence. Guarded deletion rejects unavailable API/epoch/scope/access token before confirm/POST; uses actual session owner + module/context owner agreement. No direct fallback deletion transport.

8. User / controller checks
   No new design or operation approval requested. Controller to arrange independent Task2 spec/quality review. Future Task3/CI/merge/Pages remain separate gates.

9. Remaining risk
   Cache versions intentionally unchanged for this authorized unpublished source checkpoint; not deployment-ready. Task3 must integrate cache chain after actual photo-main SAFE IDLE sync. Real runtime HTTP400 loses server code/phases: conservative unknown remains required. Stale pre-send =0POST/0late alerts; stale already-sent =1POST/0late presentation/event/optimistic removal. No server idempotency or hidden-history guarantee added.

10. Out of scope
    Production operation packet, OCR activation, B registration, runtime-client/Auth/server/schema, broad/cache inventory, other save behavior unchanged. Normal runtime401 retry and upload one-argument reconnect contracts preserved and tested separately.

11. Roadmap
    No repository docs/roadmap edits authorized for Task2. Controller owns #533 docs stub; final Task3 roadmap/docs must use #533.

12. Merge / handoff
    No push/merge/Pages. Final commit `de094a54131be55e39fa8439004a63c49845228c`. SAFE IDLE; git status is clean, no active product writers or test runs. Static library server8123 may be reused. Dependency symlink was removed after validation; `/workspace/scratch/cc17-4/deps/node_modules` remains available for later linking. No main sync was performed while active. Controller owns independent review and subsequent authorized Task3 sync/integration.
