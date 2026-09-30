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

`Check Web1 file dropzones`는 모든 `main` 대상 PR에서 읽기 전용으로 추적 중인 Web1 HTML을 검사한다. 파일 업로드 입력이 있는데 `/work/assets/file-dropzone.js` helper가 빠졌으면 실패하고, 누락 파일과 추가할 태그를 로그로 안내한다. 브랜치 파일을 고쳐 PR을 다시 올려야 한다. 과거 `Apply Web1 file dropzones`가 `main`에 직접 만든 커밋은 2026-09-13 13:36 UTC의 `de091ceb` 1건(HTML 2개 수정)이다. 이제 `main` 직접 push와 `workflow_dispatch`를 제거한다. 현재 `press/**` HTML에는 업로드 입력이 없고 첨부는 다운로드 링크다. 게시 후보의 `publication-content.test.mjs`도 `press/**/*.html`의 업로드 입력을 금지하므로 두 검사는 충돌하지 않는다. 게시 허용 목록에는 검사 스크립트나 워크플로가 없어서 이 파일을 바꾼 PR은 자동 예약 대상도 아니다. Pages 게시에는 아래 명시적 빌드 API가 필요하다.

GitHub ruleset 조회 API는 ruleset 수정 권한이 없는 토큰에 우회자 목록을 반환하지 않는다. 예약 job은 최소 권한을 유지하므로 우회자 없음은 설정 적용자가 GitHub 화면·관리자 API에서 확인해야 한다.

Pages는 현재 legacy 브랜치 빌드다. [GitHub 문서](https://docs.github.com/en/actions/concepts/security/github_token)에 따르면 `GITHUB_TOKEN`으로 만든 커밋은 Pages 빌드를 트리거하지 않는다. 따라서 별도 `build-pages` job이 해당 head의 merge를 확인한 뒤 [Pages 빌드 API](https://docs.github.com/en/rest/pages/pages#request-a-github-pages-build)를 호출하고 빌드 완료와 `main` SHA를 확인한다. 이 job만 `pages:write`를 갖는다. Pages 실패 시 workflow가 실패하며 운영자가 확인해야 한다.

## Actions 이벤트 정책 조사 (2026-09-30)

[GitHub 발표](https://github.blog/changelog/2026-09-17-workflow-execution-protections-in-github-actions-generally-available/)와 [보안 문서](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target)에 따르면, 적용 가능한 이벤트 정책이 없는 공개 저장소의 `pull_request_target` 기본 차단은 현재 평가 모드이고 2026-11-02에 시행된다. [설정 문서](https://docs.github.com/en/actions/how-tos/administer/control-workflow-execution)는 개인 계정의 공개 저장소 관리자도 저장소 단위 workflow execution protections를 쓸 수 있다고 명시한다. 이벤트·actor 허용 목록은 함께 적용되며 워크플로 경로별 대상 지정이 가능하다. 개인 계정 화면의 새 정책 Enforcement는 `Active`·`Disabled`만 제공한다. 사용자 지정 정책의 `Evaluate`는 GitHub Enterprise Cloud 전용이다. 현재 저장소의 정책 조회 API `GET /repos/mj880616/work/actions/policies`는 0건을 반환하며, GitHub 화면도 정책 0건을 표시한다. `Policy insights`는 Enterprise 안내만 표시해 이 저장소의 두 실행이 차단 예정인지 개별 기록을 확인할 수 없었다. 이는 기본 차단 적용 대상이라는 공식 규칙과 구분한다.

적용안: **Settings → Actions → Policies → New policy**에서 `publication-gate.yml`과 `publication-auto-merge.yml` 두 경로만 지정한다. `Restrict events`는 `pull_request_target`만, `Restrict actors`는 사용자 `mj880616`만 허용하고 `Active`로 저장한다. [REST API](https://docs.github.com/en/rest/actions/policies)의 `POST /repos/mj880616/work/actions/policies`로도 저장소 정책을 만들 수 있다. 이 정책은 두 워크플로에만 적용하며 일반 `pull_request`·`push` CI를 막지 않는다. `workflow_dispatch`를 제한하려면 그 이벤트를 쓰는 민감한 워크플로 경로를 별도 정책으로 지정하고 소유자만 허용한다. 전체 워크플로에 소유자 제한을 걸면 다른 정상 CI 실행도 막으므로 사용하지 않는다.

API 적용 시 제안 본문(이번 PR에서는 실행하지 않음, 사용자 ID는 공개 API에서 확인한 `172895968`):

```json
{
  "name": "Owner-only publication pull_request_target",
  "enforcement": "active",
  "conditions": {
    "workflow_path": {
      "include": [".github/workflows/publication-gate.yml", ".github/workflows/publication-auto-merge.yml"],
      "exclude": []
    }
  },
  "rules": [
    {"type": "restrict_action_events", "parameters": {"allowed_events": ["pull_request_target"]}},
    {"type": "restrict_actions_actors", "parameters": {"allowed_actors": [{"id": 172895968, "type": "User"}]}}
  ]
}
```

현재 자동 예약 스크립트는 PR 작성자가 `mj880616`이고 같은 저장소 브랜치일 때만 후보로 인정한다. 이번까지 조회한 PR의 작성자는 소유자였지만, **ChatGPT가 앞으로 만든 PR의 `actor`·PR 작성자·head 저장소는 미확인**이다. GitHub App 또는 bot으로 기록되면 소유자 전용 정책에서 관문 자체가 막힐 수 있고, 정책에 bot을 추가하더라도 기존 작성자 조건 때문에 자동 예약 대상이 아니다. 따라서 ChatGPT actor를 추측해 정책에 허용하지 않는다. 권한을 다시 켜기 전에 별도 무해한 PR로 실제 `actor`와 작성자를 확인하고, 필요하면 정책과 관문을 별도 검토한다. `Workflows` 쓰기 권한은 부여하지 않는다.

## 설정 전 관문 실동작 시험 (2026-09-30)

- [시험 A #363](https://github.com/mj880616/work/pull/363): `press/index.html`의 화면에 보이지 않는 주석 1줄만 변경. [Publication gate run 36670238890](https://github.com/mj880616/work/actions/runs/36670238890)에서 `publication=true`, `autoEligible=true`, `content-check`·`publication-gate` 성공. [Auto merge run 36670239077](https://github.com/mj880616/work/actions/runs/36670239077)의 `reserve`는 설정 부재로 예약 없이 성공, `build-pages` 건너뜀. PR API `auto_merge=null` 확인.
- [시험 B #364](https://github.com/mj880616/work/pull/364): 허용 목록 밖 `docs/sec-publication-probe-b.md` 한 파일만 변경. [Publication gate run 36670305552](https://github.com/mj880616/work/actions/runs/36670305552)에서 `publication=false`, `outside`가 해당 문서 1개, `content-check` 건너뜀, `publication-gate` 성공. [Auto merge run 36670305582](https://github.com/mj880616/work/actions/runs/36670305582)의 `reserve` 성공·예약 없음, `build-pages` 건너뜀. PR API `auto_merge=null` 확인.
- 두 PR 모두 검사 종료 후 merge 없이 닫고 원격·로컬 시험 브랜치를 삭제했다. 정책이 아직 없으므로 이 결과는 기본 평가 모드에서의 관문 동작만 증명한다. **Active 정책 적용 뒤 같은 A·B 시험을 반복해 actor 허용과 이벤트 허용을 확인해야 한다.**

## 설정 적용: 이 PR merge 이후 별도 승인

이 문서와 PR은 저장소 설정을 바꾸지 않는다. 적용 시 GitHub 화면에서 아래 순서대로 진행한다.

0. 이 PR을 검토해 승인한 뒤 merge하고, 변경된 첨부칸 검사와 `publication-gate`가 `main`에 반영됐는지 확인한다. 복구: 새 워크플로·스크립트 변경만 별도 PR로 되돌린다.
1. **Actions 이벤트 정책**: Settings → Actions → Policies → New policy → 두 publication 워크플로 경로 선택 → Restrict events=`pull_request_target` → Restrict actors=`mj880616` → Enforcement=`Active`로 저장한다. Policies 화면과 `GET /repos/mj880616/work/actions/policies`에서 두 경로·두 규칙을 재확인한다. 복구: 정책을 Disabled로 바꾸거나 삭제한다. 그러면 기본 차단 시점 이후 관문도 막힐 수 있으므로 동시에 게시 자동화를 중지하고 원인을 해결한다.
2. **정책 시험**: 소유자의 같은 저장소 브랜치로 아래 A·B 시험 PR을 열어 `Publication gate` 실행 출처와 결론, `Publication auto merge` 예약 없음, Pages 건너뜀을 확인한다. 다른 actor의 PR은 정책 차단 가능성을 별도 확인한다. 실패하면 ruleset을 적용하지 않고 정책 경로·actor·이벤트를 바로잡는다. 복구: 시험 PR을 닫고 브랜치를 삭제한다.
3. **main ruleset**: Settings → Rules → Rulesets → New branch ruleset → 이름 `Main PR gate`; Active; 대상 `main`; Bypass list 비움(관리자 포함); Require a pull request before merging(승인 수 0); Require status checks to pass의 `publication-gate`(GitHub Actions 앱, 확인한 integration ID 15368); Block force pushes; Restrict deletions. Require branches to be up to date는 끈다(기준 main이 바뀌어도 게시 PR 자동 merge가 멈추지 않게 함). Merge commit 허용, merge queue·linear history는 켜지 않는다. 저장 뒤 `docs/main-pr-gate-ruleset.json`과 대조하고 PR이 필수 검사 없이 merge되지 않는지 확인한다. 복구: 긴급 시 Enforcement Disabled로 바꾸고 직접 push 보호가 사라진 상태를 인지한다.
4. **Allow auto-merge**: Settings → General → Pull Requests → Allow auto-merge 활성화. Allow merge commits도 켜져 있는지 확인한다. 저장소 API `allow_auto_merge=true` 확인. 복구: 예약된 PR마다 Disable auto-merge, 이어 저장소 Allow auto-merge 해제.
5. **자동 게시 시험 PR**: 소유자·같은 저장소 브랜치의 실제 게시 문안 PR로 자동 merge 예약, 필수 검사 성공, merge commit, `build-pages`의 완료·SHA·공개 URL을 확인한다. 실패 시 새 예약을 해제하고, 이미 merge됐다면 변경을 되돌리는 PR과 Pages 재빌드를 검토한다.
6. **ChatGPT PR 권한**: 계정 프로필 → Settings → Applications → Installed GitHub Apps → ChatGPT → Configure에서 Repository access를 Only select repositories → 이 저장소로 제한한다. Repository permissions에서 **Workflows 쓰기 없음**을 확인한다. PR 생성에는 Contents read/write, Pull requests read/write, Metadata read가 필요하며 Administration, Workflows, Pages, Actions, Secrets, Environments 권한은 부여하지 않는다. 권한 구성이 이를 지원하지 않으면 활성화하지 않는다. 무해한 PR로 실제 actor·작성자·head 저장소와 관문 실행 여부를 확인한다. 복구: 앱의 저장소 접근을 제거하고 열린 자동 merge 예약을 해제한다.

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
| `web1-file-dropzone.yml` | PR | 없음. 모든 main 대상 PR에서 읽기 전용 검사 |
| `web1-password-recovery-check.yml` | PR | `app/public-page-auth.js`, `app/public-page-editor.js`, `tests/app-e2e/public-page-password-recovery.spec.mjs`, 자신 |
| `web2-one-shot-schema-authz.yml` | 수동 | 없음 |
| `workplace-detail-static-check.yml` | PR, push main | `app/workplace-detail.js`, `app/workplace-detail.css`, `app/workplace-report.js`, `app/styles.css`, `app/loader-v2.js`, `app/view-loader.js`, 자신 |
