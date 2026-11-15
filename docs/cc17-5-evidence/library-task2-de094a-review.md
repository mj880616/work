> **시점 보관본:** 아래는 해당 source/검토 당시 보고다. 사진 새 CI 실패·원격 archive·현재 상태는 [CC17.5 인계서](../cc17-5-handoff.md)가 우선한다. scratch 경로와 agent/session의 새 환경 존재를 보장하지 않는다.

# Library deletion Task 2 — independent spec and quality review

**Spec: PASS. Quality: PASS.** This verdict applies only to the authorized, unpublished Task 2 source checkpoint at **`de094a54131be55e39fa8439004a63c49845228c`**, tree `ecda964110febb27bd4e94ec4faa302bba481f62`, reviewed against helper baseline `a1c07713ca464ac3e1d98a5d8a4119b629f08f6f`.

No actionable correctness, authorization-boundary, concurrency, or test-integrity finding remains in this Task 2 delta. No source changes are requested. This is not approval of deployment, integration, CI, merge, or Task 3 completion.

Review performed independently on 2026-10-13 in `/workspace/scratch/cc17-4-library`. The writer was SAFE IDLE. Read the review brief, Task 2 requirements, writer's 12-field report, current `/workspace/work/AGENTS.md`, worktree AGENTS, and the library sections of `/workspace/work/docs/cc17-4-handoff.md`. The two AGENTS files are byte-identical. Read-only remote-main observation returned `28e620c06ee0fbd508d3aca3d574b451e4d4560c`; no branch synchronization was performed.

## Findings

None. There are no P0/P1/P2/P3 findings to assign file locations or corrective work to. The remaining integration and evidence limits below are planned gates, not hidden passes or newly discovered product defects.

## Spec and code review evidence

| Requirement | Exact-source evidence and assessment |
| --- | --- |
| Scope discipline | Entire `a1c..de094a` delta has exactly five paths: `app/library-upload.js`, `app/meeting-round-detail.js`, and the three allowed existing browser specs. 453 insertions / 15 deletions. Shared helper, runtime-client, Auth, router, a11y implementation, server/schema, B registration, cache versions, and repository docs are unchanged. |
| Initial authority and immutable identity | `library-upload.js:225–243` and `meeting-round-detail.js:64–80,134–140` require the shared API/read/context interfaces, nonempty string owner/workspace/access token, actual session owner agreement with module and context owners, and a nonnegative integer session epoch. Library reuses `luEditScope` at line 179; meeting reuses `mrdEditScope` at line 134. Empty IDs return before confirmation. The active token freezes the original ID/scope; the validated registration is copied and frozen before the helper import. Helper body/event primitives are therefore read from that initial snapshot rather than the mutable cached row. |
| Lookup scope | Library's uncached GET at line 237 carries the captured epoch, `singleFlight:false`, requested ID and workspace filters. It checks the request lifetime after the await, then checks both returned ID and workspace before import/confirm. Meeting checks its supplied row's ID/workspace before import. Wrong-ID behavior was independently exercised in a browser. |
| Permanent cancellation | The per-consumer Sets hold only ephemeral pending lifetimes. `luDeleteCurrent` / `mrdDeleteCurrent` remove mismatched tokens; all later checks require Set membership, so observed restoration cannot revive them. Session listeners also inspect supplied `session` and `epoch` snapshots, covering invalid event snapshots even when the current runtime has already returned to the original state. |
| Route/dialog lifetime | Only the required current route with `source:'session'` and valid actual scope is benign. Every other observed view event invalidates the pending token. Meeting additionally checks initial meeting ID, workspace, request epoch, visible modal state, and modal meeting ID; a11y dialog-opened and dialog-closed events clear tokens even without an editor. Existing edit/attempt Maps and existing routing/Auth behavior remain unchanged. |
| Valid rotation | No access-token string is pinned. Nonempty same-owner token rotation at the same scope/epoch survives the allowed session route notification. `luEditView` is not used by deletion. Independent OAuth rotation control preserved one delete POST, one drive-start, and one native navigation. |
| Checkpoints and presentation | Library checks before lookup/import/helper and after every relevant await; import and outer error notices are current-only. Meeting checks before registration/import/helper, suppresses stale import errors, and releases its token/button in `finally`. The frozen helper already checks before/after confirmation, after transport response/error, after alerts, around reconnect, before event dispatch, and at return. A stale pre-send attempt produces zero delete POSTs; a stale already-sent attempt leaves its one POST but suppresses subsequent consumer notices, documents-changed events, and optimistic cache removal. |
| Runtime transport | `library-upload.js:12` now preserves `refreshSession:false` and the epoch when forwarding to the shared runtime. Guarded deletion cannot choose the fallback transport when shared runtime/scope is unavailable. Meeting passes options through `mrdApi` unchanged. Actual normal-app 401 checks for both consumers independently passed with one POST, zero refresh requests, zero replay, and the session notice. Actual HTTP400 phase-bearing responses remain conservative unknown because RuntimeError discards those server fields. |
| Reconnect | `library-upload.js:22–23` accepts the helper's optional context, checks lifetime around confirmation, forwards epoch into drive-start, checks after its inner await before native navigation, and suppresses stale catch alerts. Deletion confirmation requests checking the list/original state after reconnection. The existing upload one-argument path retains its existing wording/default refresh and native-navigation behavior. Meeting continues to use the frozen helper reconnect implementation. |
| Lock and roles | Both consumers invoke the same frozen helper with captured epoch/current guard; meeting still passes its role and library retains its custom role checks. No owning-lock, boolean return, event shape, or role-policy change. Fresh duplicate/rerender checks for both consumers produced one delete POST. The existing button guard remains in meeting. |
| Result semantics | Normal-app tests retain modern preserved/trashed/already_trashed/missing/no_file and legacy behavior, plus malformed/network/HTTP error cases. Legacy means registration deleted with Drive outcome unconfirmed; unknown results do not emit the documents-changed event or remove rows optimistically. Existing menu/list assertions were updated to handle the intended success alert, not removed. |

The shared helper is byte-identical to `a1c`; SHA256 on both is `323b07e4a1c904dc9806c9531a9347623be7636628121ce38fff70c1ef57db7f`. Independently enumerated all 95 tracked `*.test.mjs` / `*.test.js` files and compared their bytes to the baseline: **zero changed**. Inventory is 93 Web2 files (scripts 5, tests root 20, auth-handoff 11, domain 5, edge-isolation 2, security 50), plus 2 unrelated archive files. None of those Node tests were rerun or counted as fresh evidence.

## Test-harness quality review

Read the complete changed browser-test delta, including the `cc8c7e4..de094a` harness repairs. The runtime fixture composes actual runtime, app DOM, router, a11y, consumer modules, and shared helper. Its observer appendages expose cache/settlement only; they do not reproduce product deletion logic or add production test switches. It deliberately excludes shell Auth reload behavior and is not provider identity or production evidence.

The native OAuth target is still reached through real `location.href` behavior and observed by both CDP `Page.frameRequestedNavigation` and Playwright request events. Moving settlement observation into the runner avoids losing it when native navigation destroys the old page. Allowing settlement OR observed native navigation/request to end the wait does not waive any stale-navigation assertion: the subsequent zero-navigation/zero-request checks remain. Positive controls require the real navigation and request.

The four library retained-row checks capture cache IDs at consumer settlement before restoring the actual route's filter; the later DOM check therefore cannot hide a stale optimistic removal behind a GET. The upload fixture activates the real existing DOM/a11y modal to supply the shell behavior intentionally omitted by that fixture. Unavailable context tests mutate the actual context snapshot because `context.set` correctly rejects invalid replacements. These repairs fix the observation/setup rather than weakening the expected outcomes.

No new skip, exclusion, soft assertion, retry, or timeout expansion was found. Review configs contain only testDir, outputDir, executablePath and the existing touch capability. Baseline timeout-related tests/assertions remain unchanged.

## Fresh independent verification

**17/17 selected existing cases passed (13.2 s, exit 0), plus 9/9 additional scratch browser boundary cases passed (6.4 s, exit 0).** These are separate runs; they are not a fresh full 222-case run.

The 17 existing cases include four actual normal-app 401/HTTP400 checks (both consumers), the normal same-owner runtime 401 recovery control, and twelve fixture consumer cases covering snapshot-empty cancellation, stale sent response/cache retention, stale OAuth, invalid epoch, rerender duplicates, upload reconnect, and immutable initial ID.

The nine independent scratch cases exercise both consumers after native confirmation and native success-alert return, an observed epoch-mismatch/restoration at held import for both consumers, library lookup returning the wrong ID, valid same-owner rotation during pending library OAuth, and meeting a11y deactivate/reactivate during pending OAuth. They use the existing actual-module fixture wiring and wrappers around the real native dialogs to inject the boundary event after dismissal. No production deletion implementation was copied or changed.

Commands ran from `/workspace/scratch/cc17-4-library`. Each browser command used both origins set to `http://127.0.0.1:8123`:

```sh
APP_E2E_ORIGIN=http://127.0.0.1:8123 WEB2_TEST_ORIGIN=http://127.0.0.1:8123 node /workspace/scratch/cc17-4/deps/node_modules/@playwright/test/cli.js test --config=/workspace/scratch/cc17-4/library-review-boundaries/existing.config.mjs runtime-recovery.spec.mjs material-selection-delete.spec.mjs --grep 'integration (401|400 phases).*390|initial registration ID.*390|guarded OAuth await.*390|OAuth session snapshot.*390|sent response route cycle.*library 390|rerender duplicate.*390|one argument reconnect.*390|guarded same-owner 401|import observed snapshot empty.*390|unavailable shared runtime negative epoch.*390' --workers=1 --reporter=line

APP_E2E_ORIGIN=http://127.0.0.1:8123 WEB2_TEST_ORIGIN=http://127.0.0.1:8123 node /workspace/scratch/cc17-4/deps/node_modules/@playwright/test/cli.js test --config=/workspace/scratch/cc17-4/library-review-boundaries/boundary.config.mjs boundary.spec.mjs --workers=1 --reporter=line

APP_E2E_ORIGIN=http://127.0.0.1:8123 WEB2_TEST_ORIGIN=http://127.0.0.1:8123 node /workspace/scratch/cc17-4/deps/node_modules/@playwright/test/cli.js test --config=/workspace/scratch/cc17-4/library-review-boundaries/existing.config.mjs runtime-recovery.spec.mjs material-selection-delete.spec.mjs library-row-list.spec.mjs --list --reporter=json
```

Fresh listing confirms **15 library-row-list + 72 material-selection-delete + 135 runtime-recovery = 222**, with no listing errors. Evidence:

- `/workspace/scratch/cc17-4/library-review-focused.log`
- `/workspace/scratch/cc17-4/library-review-boundary.log`
- `/workspace/scratch/cc17-4/library-review-inventory.json`
- `/workspace/scratch/cc17-4/library-review-boundaries/boundary.spec.mjs` and the two review configs

`node --check` passed separately for all five changed JS/spec files. `git diff --check a1c07713ca464ac3e1d98a5d8a4119b629f08f6f..HEAD` passed. Independently checked exact HEAD/tree, five-path allowlist, frozen helper and Node bytes, and equality of static-server `library-upload.js` bytes with the reviewed file. Node is v24.19.0, Playwright 1.55.0, system Chromium 151.0.7922.173 (Debian 13); hosted CI Chromium differs.

Initial reviewer listing failed solely because the writer had removed the dependency symlink; `NODE_PATH` does not resolve this ESM import. It executed zero tests. A temporary `node_modules` symlink to the provided dependency directory fixed resolution. It was removed after review. No product/spec/Node source was edited; final worktree status is clean.

## Preserved writer evidence and limits

Read the writer's final full-run log: **222/222 passed, 2.9 minutes**. Its exact-source checksums match the reviewed files; the independent fresh inventory and scoped executions corroborate that source. This review did not rerun that entire bundle.

The historical logs retain their actual outcomes: harness baseline 4 failures; focused requirement RED 13 failures; extra RED 6 failures with two invalid context-setup probes excluded as valid RED evidence; first implementation run 18 pass / 2 setup failures; first full run 212 pass / 6 failures (four filter setup assertions and two hidden-upload-modal timeouts); immutable-ID probe 6 controls pass / 4 genuine wrong-ID failures; corrected immutable-ID probe 10/10; final 222/222. Those earlier failures are not rewritten as successes. The prior 96/96 requirement RED and 24-case handoff (4 controls / 17 assertion failures / 3 observation timeouts) remain historical provenance, not newly executed evidence.

Cache-chain versions intentionally remain unchanged under the authorized unpublished Task 2 scope. Task 3 must follow photo actual-main SAFE IDLE integration and still owns cache/docs changes, final Node/static/security/adjacent inventory and required verification, overall final review, exact-head CI, and subsequent authorized merge/Pages. Photo CI is still pending in this review's task context. No CI, push, merge, deployment, production access, DB action, or operation approval occurred here.

The lifetime guarantees cover observed events and checked current state, not an unobserved hidden transition returning to identical state. A request already sent may have committed server work; stale UI suppression does not claim cancellation, rollback, or idempotency. The HTTP400 boundary remains conservative unknown. With those explicit scope limits, this Task 2 source is suitable to proceed to the controller's next integration gate.
