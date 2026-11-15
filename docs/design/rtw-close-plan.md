💻 PC 로컬 필요 — 커맨드센터 운영 작업(Cloudflare·Edge, 읽생기 저장소). 확인 SQL(4단계)만 📱 폰 경로 C 가능

# 읽생기 사이트 닫기 계획 (RTW 닫기, 2026-11-10)

- 명진 결정(2026-11-10 09:41, Web1 삭제 계획 Q6): **읽생기 사이트(`read.bokdoong.com`)를 지금 닫는다. 읽생기 데이터(`rtw_*` 표)는 지우지 않고 보관한다.**
- 이 문서는 닫는 정확한 방법·순서·되돌리기만 적는다. **이 PR은 아무것도 닫지 않는다**(Cloudflare·Edge·비밀값·DB 변경 없음). 실제 닫기는 커맨드센터가 한다.
- 바탕: `docs/design/domain-move.md` 3.0절(③-0), `docs/design/rtw-note-unify-investigation.md` 4절·6절(읽생기 끄기 정리 목록), `docs/bokdoong-domain.md`, `docs/web2-env6b-edge-source.md` 5절.
- AGENTS.md 5절: `rtw_*` 표·정책·함수·관련 Edge 함수는 Web2·Web1 작업으로 바꾸지 않는다. 그래서 아래 2·3단계는 이 저장소 작업이 아니라 **커맨드센터의 운영 작업**이고, 데이터·비밀값은 건드리지 않는다.

## 1. 지금 어디서 서비스되나 (저장소·문서로 확인한 것)

| 무엇 | 어디 | 근거 |
| --- | --- | --- |
| `read.bokdoong.com`(와 시험 주소 `read-test.bokdoong.com`) | Cloudflare **Worker `rtw-router`**(읽생기 저장소 `mj880616/read-think-write`가 배포)의 Custom Domain. 2026-09-28 공용 Worker에서 분리 | `docs/bokdoong-domain.md` 표, 원장 RTW-Worker분리(#346), `rtw-note-unify-investigation.md` 6절 2번 |
| 이 저장소의 공용 Worker `bokdoong-router` | read 주소를 **다루지 않음**(`cloudflare/wrangler.toml`의 routes는 `bokdoong.com`·`work`·`desk`·`arsenal`뿐). 시험이 고정: `tests/domain/bokdoong-router.test.mjs`의 read 호스트 → 404 | 이 저장소 |
| 화면 파일 | 읽생기 저장소의 GitHub Pages(`mj880616.github.io/read-think-write/`). `rtw-router`가 이것을 가져와 보여 줌 | `docs/bokdoong-domain.md` |
| ChatGPT 글 추가 통로 | Edge 함수 **`rtw-personal-write`**(v2, verify_jwt=false). GPT Action `addPersonalItem` → `POST /functions/v1/rtw-personal-write`, 헤더 `x-rtw-write-key`를 비밀값 `RTW_PERSONAL_WRITE_KEY`와 비교 → service role로 `rtw_*`에 **추가만** | `rtw-note-unify-investigation.md` 4.1절, `docs/web2-env6b-edge-source.md` 5절 28행 |
| 그 밖의 읽생기 Edge 함수 | `rtw-ai-read`, `rtw-beta-status`, `rtw-claim-personal-owner`, `rtw-delete-account`, `rtw-recommend`(이미 410), `rtw-url-import` | 같은 문서 6절 4번 |

- 이 저장소에는 `rtw-*` 함수 소스가 없다(`supabase/functions/`에 없음). 원본은 읽생기 저장소에 있다.
- 실행 때 커맨드센터가 Cloudflare 대시보드(Workers & Pages → `rtw-router` → Settings → Domains & Routes)에서 read 두 주소가 정말 `rtw-router`에 붙어 있는지 다시 확인한다(문서와 운영이 다르면 멈추고 보고).

## 2. 비밀값 — 지우지 않는다

- **같은 Supabase 프로젝트의 Edge 비밀값은 모든 함수가 함께 쓴다.** Web2와 읽생기가 한 프로젝트를 쓰므로 비밀값 하나를 지우면 그것을 읽는 Web2 함수도 멈춘다.
- 확인 결과(2026-11-10 이 저장소 `supabase/functions` 전수 검색): `OPENAI_API_KEY`를 **Web2 함수 10개가 읽는다** — `ai-assist`, `collector-feed`, `document-ai-index`, `library-files`, `meeting-ai-draft`, `meeting-ai-ingest`, `meeting-transcribe`, `news-feed`, `outside-feed`, `page-ai-draft`. `SUPABASE_URL`·`SUPABASE_SERVICE_ROLE_KEY`·`SUPABASE_ANON_KEY`도 Web2가 쓴다.
- 이 저장소 함수 중 `RTW_`로 시작하는 비밀값(`RTW_PERSONAL_WRITE_KEY`, `RTW_AI_MODEL`)을 읽는 곳은 없다. 그래도 **이번 닫기에서는 어떤 비밀값도 지우거나 바꾸지 않는다**(명진 지시, AGENTS.md 1절: 비밀값 변경은 대시보드 정지 지점). 읽생기 전용 비밀값 정리는 나중에 읽생기 함수를 지울 때 따로 결정한다.

## 3. 닫는 순서

| 단계 | 할 일 | 누가·어디서 | 정지 지점 | 되돌리기 |
| --- | --- | --- | --- | --- |
| 0 | 백업 확인: 오늘 날짜 `db-backup-daily` 성공(`scripts/ops/backup-db.mjs`의 `public` 스키마 전체라 `rtw_*` 포함). 데이터는 지우지 않지만 확인만 | 커맨드센터, GitHub Actions 기록 | 없음 | 해당 없음 |
| 1 | **ChatGPT 글 추가 끊기**: `rtw-personal-write`를 **삭제하지 않고 "항상 410" 판으로 재배포**(추천) — 요청을 읽지 않고 `{"error":"읽생기는 운영을 마쳤습니다"}` 410만 돌려줌. DB·비밀값을 읽지 않음, verify_jwt=false 그대로 | 커맨드센터: 읽생기 저장소에 작은 PR → merge → 그 저장소의 배포 방식으로 **이 함수 하나만**(`--prune` 금지). 배포 전 `functions list`로 현재 version·verify_jwt 기록, 배포 후 version 증가·POST 410·OPTIONS 확인 | ★Edge 배포 | 이전 운영 소스(읽생기 저장소의 배포 전 커밋 SHA를 기록)로 같은 함수 재배포. 소스가 저장소에 있으므로 되돌릴 수 있음 |
| 1′ | (대안) 함수 삭제 | 명진이 대시보드에서(AGENTS.md 1절: Edge 삭제는 대시보드) | ★Edge 삭제 | 저장소 원본으로 같은 이름·같은 verify_jwt 신규 배포. **삭제 전 운영본 내려받기** |
| 2 | **사이트 닫기**: `rtw-router` Worker를 "모든 주소에 '더 이상 운영하지 않는 페이지입니다' 한 줄, 410, `X-Robots-Tag: noindex, nofollow, noarchive`, `Cache-Control: no-store`"로 바꿔 배포(이 저장소 `bokdoong-router`의 Web1 안내와 같은 모양). Custom Domain(`read`·`read-test`)은 **그대로 둔다** — 해제하면 주소가 아예 안 열리고(DNS 오류) 되돌리기가 길어짐 | 커맨드센터: 읽생기 저장소 Worker 소스 PR → 그 저장소 Worker 배포 workflow(또는 wrangler). 배포 확인: `https://read.bokdoong.com/`·임의 경로가 410 안내 | ★Cloudflare | Cloudflare 대시보드 `rtw-router` → Deployments → 이전 버전으로 Rollback(즉시), 또는 Worker 소스 revert PR |
| 3 | GPT 쪽: ChatGPT 화면에서 "읽생기 글 추가" GPT의 작업(Action) 삭제 또는 GPT 비공개 정리 | 명진(ChatGPT 화면, 로그인 필요) — 선택. 1단계로 서버가 이미 막으므로 급하지 않음 | 없음 | 같은 Action 다시 추가 |
| 4 | 확인: Web2 AI 기능 하나(예: 회의 AI 정리 또는 [AI 묻기])가 그대로 되는지, `rtw_*` 행 개수가 닫기 전과 같은지(select만) | 커맨드센터(읽기 전용 확인 SQL, 폰 경로 C 방식으로 명진이 실행 가능) | 없음 | 해당 없음 |

- 순서 이유: 들어오는 쓰기 문(1)을 먼저 막고 화면(2)을 닫는다. 1·2는 서로 독립이라 하나가 실패해도 다른 하나는 그대로다.
- **하지 않는 것**: `rtw_*` 표·함수·정책 삭제, 비밀값 삭제·변경, Auth 사용자(지인 계정) 삭제, Supabase Auth Redirect URL 정리, 읽생기 저장소 archive, GitHub Pages 끄기. 모두 나중에 따로 결정(`rtw-note-unify-investigation.md` 6절 목록).
- 다른 읽생기 함수(`rtw-ai-read` 등)는 화면이 닫히면 부를 곳이 없다. 지금은 그대로 두고(삭제는 되돌리기 원본 확인 뒤 별도), 필요하면 1단계와 같은 "항상 410" 판으로 하나씩.

## 4. 일상어 3줄

- **무엇이 바뀌나**: 읽생기 사이트(read.bokdoong.com)를 열면 "더 이상 운영하지 않는 페이지입니다" 한 줄만 보이고, ChatGPT에서 읽생기로 글 넣기가 막힌다. 읽생기에 쌓인 글은 지우지 않고 그대로 보관한다.
- **잘못되면**: 비밀값을 건드리면 Web2의 AI 기능(회의 정리·자료 요약·뉴스 등)이 멈출 수 있다 — 그래서 비밀값은 전혀 손대지 않는다. Worker 배포가 잘못되면 읽생기 주소가 오류 화면을 보일 뿐 Web2에는 영향이 없다(다른 Worker).
- **되돌리는 방법**: Cloudflare에서 `rtw-router`를 이전 버전으로 되돌리면 사이트가 바로 다시 열린다. 글 추가 통로는 읽생기 저장소의 이전 소스로 함수를 다시 배포한다. 데이터는 지우지 않았으므로 그대로다.

## 5. 범위 밖으로 남는 것 (보고만)

- `personal/portal/index.html`에 읽생기 카드·`read.bokdoong.com` 파비콘 주소가 남아 있다. 포털은 `bokdoong.com/`이 Web2로 넘어가 이미 안 보이는 화면이고, 정리는 포털 C1(DOMAIN-주소이전 ① C1) 몫이다.
- `android-app`의 `ShellRulesTest.kt`가 `read.bokdoong.com`을 "앱 밖 주소" 예로 쓴다. 시험 문자열일 뿐 동작 영향 없음.
- 원장 RTW-3(`rtw-personal-write` 비밀값·권한 점검)은 1단계로 쓰기 문이 막히면 위험이 줄어든다. 원장 상태 정리는 커맨드센터.
