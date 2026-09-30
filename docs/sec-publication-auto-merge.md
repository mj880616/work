💻 PC 로컬 필요

# SEC-게시자동화: PR 관문과 게시 자동 merge

## 확인한 현재 상태 (2026-09-29)

- 시작 `main`: `74b8578c8d63597f652b973e714d9d9e61e45464` (GitHub 원격과 로컬 `origin/main` 일치).
- 저장소 API: `allow_auto_merge=false`; `main` branch protection 없음(404); ruleset 0개; Actions 기본 권한 read.
- Pages API: `build_type=legacy`, source=`main` 루트. 확인 당시 최근 빌드 SHA는 시작 `main`과 일치.
- 최근 사례: #356·#342는 날짜별 `press/` HTML·HWP, `press/archive.json`, `press/index.html`과 `tests/app-e2e/web1-press.spec.mjs`를 함께 변경. #358은 날짜별 HTML과 `press/archive.json`만 변경.
- 기존 `app-e2e-check.yml`은 `press/**`만 변경할 때 돌지 않는다. `web1-press.spec.mjs`는 Web2 보도자료 목록 연결을 확인한다. `loader-cache-check.yml`만 모든 `main` PR에 경로 필터 없이 실행된다.

## 허용 목록과 관문

자동 merge 후보는 변경 파일 **전부**가 다음 중 하나일 때뿐이다.

1. `press/archive.json`
2. `press/index.html`
3. `press/YYYY-MM-DD-slug/index.html`
4. `press/YYYY-MM-DD-slug/` 바로 아래의 `.hwp`·`.hwpx`·`.pdf` 첨부

`press/press-archive.css`, 다른 `press/` 코드, 테스트, 문서, `app/**`, `supabase/**`, `cloudflare/**`, 워크플로는 허용하지 않는다. #356·#342와 같이 테스트 파일이 섞인 PR은 수동 검토 대상이고, #358의 경로 조합은 자동 merge 후보가 된다. 테스트를 허용하면 검사를 바꾼 PR이 자신의 검사를 통과시킬 수 있어 제외한다. 경로 검사는 게시 문안의 정확성·저작권·개인정보 여부를 판단하지 않는다. `press/index.html`의 기존 inline script도 경로만으로는 구분되지 않으므로 이 파일의 변경 내용을 만드는 주체를 제한해야 한다.

`Publication gate`는 `pull_request_target`에서 **기준 `main`의 워크플로와 정책 스크립트**를 실행한다. `classify`가 GitHub PR Files API 전체 페이지와 `changed_files` 수를 대조하며, head SHA가 바뀌면 실패한다. 게시 후보의 정적 아카이브 검사와 `web1-press.spec.mjs` Playwright 검사는 후보 코드를 checkout하는 별도 `content-check` job에서 실행한다. 이 job의 토큰은 `contents:read`뿐이고 checkout 자격 증명을 저장하지 않는다. 필수 `publication-gate` job은 기준 정책만 실행하며, 분류·후보 검사 결과와 기존 `loader-cache` 및 HTML 변경 시 `audit` 성공을 확인한다. 일반 PR에 이전 auto-merge 예약이 있으면 해제를 기다린다. #362 자체는 시작 `main`에 이 워크플로가 없으므로 새 `pull_request_target` 관문을 실행할 수 없으며, 사람이 변경 파일과 기존 CI를 확인한 뒤 수동 merge해야 한다. 후보 브랜치의 정책 스크립트를 실행하는 최초 도입 예외는 제거했다.

`Publication auto merge`는 기본 브랜치에서만 읽는 `pull_request_target` 워크플로다. `opened`·`synchronize`·`reopened`마다 API로 파일 전체를 재분류한다. 작성자가 저장소 소유자이고 동일 저장소 브랜치이며 draft가 아닌 경우에만, 활성 `Main PR gate` ruleset과 저장소 auto-merge 허용을 확인하고 `--auto --merge --match-head-commit`으로 merge commit을 예약한다. `.github/**`를 포함한 허용 목록 밖 파일이 추가되거나 draft가 되면 이전 예약을 해제한다. fork 및 소유자가 아닌 작성자의 PR에는 merge 예약·해제를 하지 않는다. 쓰기 권한은 예약 job에 `contents:write`, `pull-requests:write`만 준다. 저장소 auto-merge가 꺼져 있거나 활성 ruleset이 아직 없으면 예약 없이 성공 종료하며, `build-pages`도 건너뛴다.

`Apply Web1 file dropzones`는 `main` push 또는 수동 실행 시 Web1 HTML 중 파일 업로드 입력이 있는 페이지에 helper 태그를 삽입하고, 변경이 있으면 `main`에 직접 커밋·push한다. 현재 `press/**` HTML에는 파일 업로드 입력이 없고 첨부는 다운로드 링크다. 게시 후보의 `publication-content.test.mjs`가 모든 `press/**/*.html`에서 업로드 입력이 없는지 확인하므로 자동 merge 경로에 이 워크플로의 명시 실행은 필요 없다. 활성 `Main PR gate`는 직접 push를 막으므로 이 워크플로를 임의로 호출해 게시 후 파일을 고치는 방식도 쓰지 않는다. 다른 `main` push 워크플로 중 `Sync public page metadata`는 `p/**` 메타데이터용이고 `press/**`를 트리거 경로로 쓰지 않는다. 나머지 `main` push 검사는 게시 파일을 수정하지 않거나 게시 경로를 대상으로 하지 않는다. Pages 게시에는 아래 명시적 빌드 API가 필요하다.

GitHub ruleset 조회 API는 ruleset 수정 권한이 없는 토큰에 우회자 목록을 반환하지 않는다. 예약 job은 최소 권한을 유지하므로 우회자 없음은 설정 적용자가 GitHub 화면·관리자 API에서 확인해야 한다.

Pages는 현재 legacy 브랜치 빌드다. [GitHub 문서](https://docs.github.com/en/actions/concepts/security/github_token)에 따르면 `GITHUB_TOKEN`으로 만든 커밋은 Pages 빌드를 트리거하지 않는다. 따라서 별도 `build-pages` job이 해당 head의 merge를 확인한 뒤 [Pages 빌드 API](https://docs.github.com/en/rest/pages/pages#request-a-github-pages-build)를 호출하고 빌드 완료와 `main` SHA를 확인한다. 이 job만 `pages:write`를 갖는다. Pages 실패 시 workflow가 실패하며 운영자가 확인해야 한다.

## 설정 적용: 이 PR merge 이후 별도 승인

이 문서와 PR은 저장소 설정을 바꾸지 않는다. 적용 시 GitHub 화면에서 아래 순서대로 진행한다.

1. 이 PR의 merge와 `main` 반영, `publication-gate` 검사 이름을 확인한다.
2. **Settings → Rules → Rulesets → New branch ruleset**: 이름 `Main PR gate`; Active; 대상 `main`; Bypass list 비움(관리자 포함); Require a pull request before merging(승인 수 0); Require status checks to pass의 `publication-gate`(GitHub Actions 앱, 확인한 integration ID 15368); Block force pushes; Restrict deletions. Require branches to be up to date는 끈다(기준 main이 바뀌어도 게시 PR 자동 merge가 멈추지 않게 함). Merge commit 허용, merge queue·linear history는 켜지 않는다. 저장된 규칙은 `docs/main-pr-gate-ruleset.json`과 대조한다.
3. Ruleset이 Active이고 우회자가 없는지 확인한 다음 **Settings → General → Pull Requests → Allow auto-merge**를 켠다. **Allow merge commits**도 켜져 있어야 한다.
4. 그 후 ChatGPT GitHub 쓰기를 다시 켜는 경우 대상은 이 저장소만 선택한다. GitHub 화면에서 **계정 프로필 → Settings → Applications → Installed GitHub Apps → ChatGPT → Configure** 순서로 열고, Repository access가 **Only select repositories → 이 저장소**인지 확인한다. 같은 화면의 Repository permissions를 펼쳐 **Workflows 쓰기 권한 없음**을 필수 조건으로 확인한다. PR 생성에 필요한 권한은 Contents read/write(브랜치·파일), Pull requests read/write(PR 생성), Metadata read이며 Administration, Workflows, Pages, Actions, Secrets, Environments 권한은 부여하지 않는다. 권한 변경 요청이 보이면 승인 전에 Workflows가 추가되지 않았는지 다시 확인한다. GitHub App 권한 구성이 이 조합을 지원하지 않으면 쓰기를 켜지 말고 실제 요청 권한을 재검토한다. ChatGPT PR이 소유자 계정 명의가 아닌 경우 자동 merge 대상이 되지 않으므로 작성자 형태를 시험 PR에서 확인한다.

CLI로 설정할 경우, **별도 승인 뒤에만** 저장소 루트에서 `gh api -X POST repos/mj880616/work/rulesets --input docs/main-pr-gate-ruleset.json`을 실행하고 반환된 ruleset ID를 기록한다. 이어 `gh api -X PATCH repos/mj880616/work -F allow_auto_merge=true`를 실행한다. 설정 적용 직전에 현재 ruleset·기존 보호·auto-merge 값을 다시 조회해야 한다. 이 명령은 이번 PR에서 실행하지 않는다.

긴급 중지: PR 화면의 **Disable auto-merge**로 예약된 게시 PR을 해제하고, **Settings → General → Pull Requests**에서 Allow auto-merge를 끈다. 보호 규칙 자체가 운영을 막는 긴급 상황은 사용자가 **Settings → Rules → Rulesets → Main PR gate → Edit → Enforcement: Disabled**로 일시 해제할 수 있다. 이때 `main` 직접 push 보호도 사라지므로 작업 후 Active로 되돌린다. API 복구는 기록한 ruleset ID에 `PUT /repos/mj880616/work/rulesets/{id}`로 `enforcement=disabled`를 설정하거나, `PATCH /repos/mj880616/work`에 `allow_auto_merge=false`를 보낸다. 기존 자동 merge 예약은 PR별로 해제 여부를 확인한다.

## 설정 후 실제 시험 계획

1. 소유자 계정·동일 저장소 브랜치에서 실제 게시 문안의 작은 변경 PR을 만든다. `publication-gate`와 `Loader cache version check`를 확인하고, 사람이 merge를 누르지 않아도 merge commit으로 병합되는지 확인한다. `build-pages`의 Pages build 상태·SHA와 공개 URL을 확인한다.
2. 게시 PR에 `docs/` 파일을 뒤늦게 추가하는 별도 시험 PR에서는 auto-merge 예약이 해제되고 관문이 예약 해제를 기다린 뒤 성공하는지 확인한다. 이 PR은 게시하지 않고 수동으로 닫는다.
3. fork·소유자 외 작성자 PR에서는 예약 job이 쓰기 동작을 하지 않는지 확인한다. ChatGPT가 만든 PR의 실제 작성자·head 저장소를 확인한다.

설정 적용 전에는 자동 merge와 Pages 재빌드의 실제 동작을 검증할 수 없다. `allow_auto_merge=false`와 ruleset 부재 상태에서 새 예약 job은 성공 종료하고 Pages job은 실행하지 않는다. #362의 기존 `pull_request` 검사 결과는 수정 후 `pull_request_target` 관문을 검증하지 못하므로, 설정을 켜기 전에 merge 후 새 시험 PR에서 관문 job의 출처·head SHA·결과를 확인한다.

## 남은 위험

- 개인 저장소의 필수 검사 설정은 GitHub Actions 앱과 **검사 이름**을 지정하지만 워크플로 파일 경로를 고정하지 않는다. PR이 `.github/**`를 바꾸면 후보 브랜치의 다른 `pull_request` 워크플로가 같은 이름의 검사를 만들 수 있다. 중복 검사 이름은 병합 판정을 모호하게 할 수 있다. 기준 브랜치의 `pull_request_target` 관문, `.github/**` 자동 merge 제외, ChatGPT 앱 Workflows 쓰기 금지로 자동 경로를 좁히지만, 소유자 또는 다른 쓰기 권한자가 워크플로를 바꾼 PR을 만드는 상황까지 저장소 내부 설정만으로 완전히 막지는 못한다. **`.github/**` 변경 PR은 사람이 diff와 실제 검사 run의 워크플로 경로·기준 ref를 확인한 뒤 수동 merge**한다. 조직·기업 규칙에서 제공하는 required workflow는 개인 저장소의 이번 설정에 포함되지 않는다.
- 경로 검사만으로 본문 품질이나 `press/index.html` inline script의 의미를 검증하지 못한다. 좁은 경로 허용과 소유자 PR 제한을 함께 적용한다.
- GitHub에서 검사·예약 해제 이벤트가 지연되면 자동 merge가 늦어질 수 있다. 일반 PR 관문은 이전 예약이 없어질 때까지 대기해 잘못된 자동 merge를 막는다.
- Pages API 요청·빌드는 merge 뒤 작업이다. 빌드가 실패하면 merge는 되돌아가지 않고 실패 workflow에서 운영자가 재빌드·복구를 판단한다.
- `main` 보호는 ruleset 활성화 전까지, 자동 merge는 저장소 Allow auto-merge 활성화 전까지 효력이 없다.

## 기존 49개 워크플로 트리거·경로 필터 조사

아래 `PR`은 `main` 대상 pull_request, `push main`은 main push, `push *`는 브랜치 제한이 없는 push, `수동`은 workflow_dispatch다. `자신`은 그 행의 워크플로 YAML 경로다. 별도 표시가 없으면 적힌 경로들이 `paths` 포함 필터이며 `paths-ignore`는 없다. 각 파일의 이벤트별 경로 목록이 동일한 경우 한 번만 적었다.

| 워크플로 | 트리거 | 경로 필터 |
| --- | --- | --- |
| `app-e2e-check.yml` | PR, push main, 매일 21:00 UTC, 수동 | `app/**`, `p/**`, `tests/app-e2e/**`, 자신 |
| `app-smoke-check.yml` | PR, push main, 수동 | `app/**`, `cloudflare/**`, `p/**`, `supabase/functions/meeting-ai-draft/**`, `tests/domain/bokdoong-router.test.mjs`, `tests/domain/web2-pwa-registration.test.mjs`, `tests/meeting-draft-parser.test.mjs`, 자신 |
| `arsenal-archive-check.yml` | PR | `personal/arsenal-match-archive/**`, 자신 |
| `authz-security-check.yml` | PR, push *, 수동 | `supabase/**`, `tests/security/**`, `tests/auth-handoff/**`, 자신 |
| `browser-storage-audit.yml` | PR, push main, 수동 | `**/*.html`, `**/*.js`, `**/*.mjs`, `**/*.ts`, `**/*.tsx`, `**/*.jsx`, 자신 |
| `build-android-app.yml` | PR, push *, 수동 | `android-app/**`, `app/app-icon.svg`, 자신 |
| `build-windows-app.yml` | 수동 | 없음 |
| `bump-rail-1007-controls-v2.yml` | push *, 수동 | 자신 |
| `bump-rail-1007-controls-v3.yml` | push *, 수동 | 자신 |
| `cloudflare-worker-deploy.yml` | push main, 수동 | `cloudflare/**`, 자신 |
| `collaboration-ownership-check.yml` | PR, push main | `app/**`, `android-app/**`, 자신 |
| `fix-sanbyeol-layout.yml` | push *, 수동 | 자신 |
| `install-rail-1007-controls.yml` | push *, 수동 | `assets/rail-1007-controls.js`, 자신 |
| `install-rich-copy.yml` | push *, 수동 | `assets/rich-copy.js`, 자신 |
| `install-social-images.yml` | push *, 수동 | 자신 |
| `kptu-author-samples.yml` | push *, 수동 | `analysis/kptu-corpus/contact-authors-2023-2026.json`, `scripts/kptu_author_sample.py`, 자신 |
| `kptu-contact-authors.yml` | push *, 수동 | `scripts/kptu_contact_authors.py`, 자신 |
| `kptu-contact-candidates.yml` | push *, 수동 | `scripts/kptu_contact_candidates.py`, 자신 |
| `kptu-contact-selected.yml` | push *, 수동 | `scripts/kptu_contact_selected.py`, 자신 |
| `kptu-contact-target-genres.yml` | push *, 수동 | `scripts/kptu_contact_target_genres.py`, 자신 |
| `kptu-corpus-build.yml` | push *, 수동 | `scripts/kptu_corpus_collect.py`, 자신 |
| `kptu-corpus-extract.yml` | push *, 수동 | `scripts/kptu_corpus_extract.py`, `analysis/kptu-corpus/selected-180.json`, 자신 |
| `kptu-corpus-features.yml` | push *, 수동 | `scripts/kptu_corpus_features.py`, `analysis/kptu-corpus/text/**`, 자신 |
| `kptu-corpus-select.yml` | push *, 수동 | `scripts/kptu_corpus_select.py`, 자신 |
| `kptu-corpus-validate.yml` | push *, 수동 | `scripts/kptu_validate_corpus.py`, 자신 |
| `kptu-deep-digest.yml` | push *, 수동 | `scripts/kptu_build_deep_digest.py`, 자신 |
| `kptu-deep-sample.yml` | push *, 수동 | `scripts/kptu_deep_sample.py`, `analysis/kptu-corpus/selected-180.json`, 자신 |
| `kptu-hwp-contacts-full.yml` | push *, 수동 | `scripts/kptu_hwp_contacts_year.py`, 자신 |
| `kptu-hwp-contacts.yml` | push *, 수동 | `scripts/kptu_hwp_contacts.py`, 자신 |
| `kptu-user-archive-match.yml` | push *, 수동 | `scripts/kptu_match_user_archive.py`, 자신 |
| `kptu-valid-deep-sample.yml` | push *, 수동 | `scripts/kptu_build_valid_deep_sample.py`, 자신 |
| `kptu-writer-samples.yml` | push *, 수동 | `analysis/kptu-corpus/contact-authors-hwp-full.json`, `scripts/kptu_writer_samples.py`, 자신 |
| `loader-cache-check.yml` | PR | 없음. 모든 PR에서 실행 |
| `package-pyhwp.yml` | push *, 수동 | 자신 |
| `private-rail-forum-state-e2e.yml` | PR, push main | `private-rail/forum-0929/**`, `tests/app-e2e/private-rail-forum-state.spec.mjs`, 자신 |
| `profile-single-render-check.yml` | PR, push main | `app/profile-settings.js`, `app/profile-settings.css`, `app/loader-v2.js`, `app/styles.css`, `tests/app-e2e/profile-workplaces*`, 자신 |
| `public-workspace-auth-e2e.yml` | PR, push main | `app/**`, `tests/app-e2e/public-workspace-auth.spec.mjs`, 자신 |
| `router-ready-e2e.yml` | PR | `app/app-router.js`, `app/app.js`, `app/loader-v2.js`, `app/index.html`, `tests/app-e2e/app-initial-paint.spec.mjs`, 자신 |
| `runtime-recovery-e2e.yml` | PR, push *, 수동 | `app/runtime-client.js`, `app/library-upload.js`, `app/calendar-persistence.js`, `tests/app-e2e/runtime-client-fixture.html`, `tests/app-e2e/runtime-recovery.spec.mjs`, `tests/app-e2e/calendar-persistence-race-fixture.html`, `tests/app-e2e/calendar-persistence-race.spec.mjs`, `tests/app-e2e/library-upload-failure-fixture.html`, `tests/app-e2e/library-upload-failure.spec.mjs`, 자신 |
| `suborganization-filters-e2e.yml` | PR, push main | `app/suborganizations.js`, `app/suborganizations.css`, `app/workplace-detail.js`, `app/workplace-detail.css`, `app/workplace-report.js`, `app/loader-v2.js`, `app/view-loader.js`, `app/styles.css`, `app/myspace-return.js`, `app/my-work.html`, `app/app.js`, `tests/app-e2e/suborganization-filters-*`, 자신 |
| `sync-public-page-meta.yml` | PR, push main, 매 5분, 수동 | `p/index.html`, `p/public-post.js`, `scripts/generate-public-pages.mjs`, `scripts/public-page-meta.mjs`, `scripts/public-page-meta.test.mjs`, 자신 |
| `task-visibility-observer-check.yml` | PR, push main | `app/task-layout.js`, `app/loader-v2.js`, `app/task-assignment-visibility.js`, 자신 |
| `team-member-overview-e2e.yml` | PR, push main | `app/**`, `tests/app-e2e/nonmember-access.spec.mjs`, `tests/app-e2e/access-request-push.spec.mjs`, `tests/app-e2e/solo-shell.spec.mjs`, 자신 |
| `update-2in1-labor-meeting-0911.yml` | 수동 | 없음 |
| `update-2in1-labor-meeting-0913.yml` | push * | 자신 |
| `web1-file-dropzone.yml` | push main, 수동 | 없음. 모든 main push에서 실행 |
| `web1-password-recovery-check.yml` | PR | `app/public-page-auth.js`, `app/public-page-editor.js`, `tests/app-e2e/public-page-password-recovery.spec.mjs`, 자신 |
| `web2-one-shot-schema-authz.yml` | 수동 | 없음 |
| `workplace-detail-static-check.yml` | PR, push main | `app/workplace-detail.js`, `app/workplace-detail.css`, `app/workplace-report.js`, `app/styles.css`, `app/loader-v2.js`, `app/view-loader.js`, 자신 |
