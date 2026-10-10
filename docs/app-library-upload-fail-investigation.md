# APP-자료실업로드실패 조사 — 2026-10-10

초기 조사에서는 앱 원인을 확정하지 못해 정지했다. 05:25 사용자 실기기 사실과 명시적인 A/B 변경 요청을 받아 같은 브랜치에서 재개했다. **현재 구현·검증·되돌림 기준은 아래 「05:25 재개 — 회의자료 대조와 A/B」절**이다. 그 앞의 기록은 변경 전 조사 시점의 결과다.

## 기준과 사용자 관측

- Codex 웹. 원격 main을 새로 fetch: `669c6087b19eeec666e1b82feeb632f6cf25c9b3` (#459 merge 포함).
- 브랜치: `codex/app-library-upload-fail`. 최종 코드 SHA도 같은 값.
- 사용자 관측: 삼성 Android에서 삼성 인터넷·Chrome 모두 1쪽 PDF 실패. 2.7MB, Wi-Fi·모바일 데이터, 다운로드 폴더 파일, 프로젝트 없음에서도 실패. 화면은 `unknown_network` 문구.
- 사용자 제공 서버 기록: OPTIONS 200 두 건, POST 없음. 새로고침 뒤에는 새로운 OPTIONS도 없음. 운영 Edge v13·verify_jwt=false·오류 0건이라는 제공 사실을 기준으로 조사했으며 운영에 접속하지 않았다.
- 브라우저 내부 예외라는 설명은 아직 추정이다. OPTIONS 200만으로 CORS 성공을 뜻하지 않으며, Edge Invocation에 POST가 없다는 것만으로 브라우저가 POST를 생성하지 않았는지도 단정할 수 없다.

## 모의 환경과 확인 결과

설치 Chromium 151.0.7922.173, Playwright 1.55.0. 390px는 Pixel 7 Android Chrome user agent·터치·모바일 context, 1280px는 데스크톱 context. 실제 Android OS·파일 제공자·네트워크·운영 TLS는 에뮬레이션하지 않는다.

실제 `/app/?view=library`·loader·team·library·runtime 소스를 실행했다. 정적 HTTP 서버는 소스를 바꾸지 않고 응답할 때 Supabase API 주소만 로컬 HTTP 모의 서버 주소로 대체했다. 로컬 API는 저장소 `library-files`의 CORS 허용 원문(Origin `*`, Headers `authorization, x-client-info, apikey, content-type`, Methods `GET, POST, OPTIONS`)을 사용했다. **최종 실행에는 `page.route`·`route.fulfill`·`route.abort`가 없다.** 서버가 요청 본문을 끝까지 읽은 뒤 기록한 POST를 세었다.

| 조건 | 390px | 1280px |
| --- | --- | --- |
| 디스크 경로에서 선택한 유효한 1쪽 PDF → 저장 | POST 1건, 성공 | POST 1건, 성공 |
| 디스크 경로에서 선택한 약 2.7MB의 유효한 PDF → 저장 | POST 1건, 성공 | POST 1건, 성공 |
| 위 파일의 한글·공백 파일명, 한글·이모지·줄바꿈 설명 | multipart 전체 도착 | multipart 전체 도착 |
| HTTP 503 실패 | POST 1건, busy 해제 | POST 1건, busy 해제 |
| 503 뒤 새 파일 선택 → 저장 | 추가 POST 1건, 성공 | 추가 POST 1건, 성공 |
| POST 응답의 CORS 허용 Origin을 의도적으로 제거 | POST 1건 도착, 화면 unknown | POST 1건 도착, 화면 unknown |
| 위 network_error 뒤 새 파일 선택 → 저장 | 추가 POST 1건, 성공 | 추가 POST 1건, 성공 |

각 폭에서 UI 업로드 6건, 합계 12건이 서버에 도착했다. 정상 조건에서 첫 업로드마다 정확히 1건이며 실패 뒤 새 파일도 정확히 1건이다. 실제 File을 넣은 FormData, 유효한 헤더, fetch 진입 때 `signal.aborted === false`를 확인했다. 프로젝트는 없음이다.

## 후보별 사실과 한계

| 후보 | 확인 사실 | 판단·남은 한계 |
| --- | --- | --- |
| 저장 버튼의 다른 처리기 | 실제 앱 초기화 뒤 `saveDocumentBtn.onclick`은 `luUploadOrOriginal(original)`이며 파일 선택 후 library-files POST가 도착했다. team의 자료 메타데이터 POST 경로로 빠지지 않았다. | 정상 초기화 경합 원인 재현 안 됨. 운영에서 실제 로드된 버전은 미확인. |
| 헤더의 허용되지 않는 문자 | 업로드 헤더에는 파일명·자료명·설명이 들어가지 않는다. fixed apikey와 session의 Bearer token을 사용한다. 정상 모의 session의 헤더는 유효했다. | 세션 토큰의 운영 값은 읽지 않았다. 아래 잘못된 헤더 주입은 기전 확인일 뿐 실제 원인이 아니다. |
| URL | 코드의 고정 Supabase 주소 + `/functions/v1/library-files`다. 사용자 입력으로 URL을 만들지 않는다. | 운영의 실제 request URL·redirect·차단 상태 확인 필요. |
| FormData/File 읽기 | 디스크에서 고른 두 PDF 모두 multipart 전체가 도착했다. 파일명·설명은 UTF-8 multipart 본문이며 header 값이 아니다. | Playwright 파일 선택은 실제 Android 파일 제공자 URI·권한·File lifetime을 재현하지 않는다. 디스크 파일을 선택 후 변경한 실험도 성공했지만 Android File 읽기를 배제하는 근거로 사용할 수 없다. |
| signal | 업로드 함수는 외부 signal을 넘기지 않는다. runtime이 요청마다 새 AbortController를 만들고, 최종 정상 UI 흐름의 signal은 모두 미중단이었다. | 실기기의 시간 경과·페이지 lifecycle은 미확인. timeout·AbortError는 코드상 `timeout`으로 분류되어 이번 `network_error`와 구별된다. |
| mutationKey의 이전 요청 재사용 | 동일 FormData를 동시 2회 호출하면 POST 1건으로 묶였다. 동일 FormData가 503으로 종료된 뒤 순차 2회 호출하면 POST 2건이었다. UI 실패 뒤 새 파일도 성공했다. | 종료되지 않은 동일 메타데이터 파일은 설계대로 묶일 수 있다. 파일 내용 자체는 키에 포함하지 않는다. 이것은 기존 공용 동작이며 이번 원인으로 확인되지 않아 수정하지 않았다. |
| luUploading·unknown 상태 | 503·network_error 후 disabled·aria-busy가 해제됐다. 새 파일 선택은 entries를 pending으로 교체해 unknown 확인창 없이 업로드됐다. | 같은 unknown 파일 재전송에는 기존 중복 등록 확인이 남는다. 기존 spec도 해당 동작을 확인한다. |
| 10월 변경 이력 | `luUploadRequest`, `luUploadOrOriginal`, `luSetSelectedFiles`, `luUploadFailure`는 `747fd93`, `78b5d3d`, `87515aa`, `b4ff944`, `669c6087`에서 각각 동일하다. runtime 파일도 전부 blob `bd14a1b61afcfefe7fc1e0a4833bec3a686abd37`로 동일하다. | 나열된 변경은 업로드 본문·헤더·fetch·중복 묶기 경로를 바꾸지 않았다. |

`747fd93`의 runtime 변경은 성공 후 저장 알림과 refreshSession 옵션 추가다. 자료실 업로드는 해당 옵션을 지정하지 않으며 fetch 전송 조건은 그대로다. `78b5d3d`는 reload 초안 보호·dialog 알림, `87515aa`는 목록·메뉴, `b4ff944`는 머리표, #459는 회의 연결 자료 목록 숨김이다.

## 같은 문구를 만드는 별도 기전 실험

아래는 **의도적으로 잘못된 입력·응답을 주입한 실험**이며 운영 원인 재현으로 분류하지 않는다. 두 폭 모두 같은 결과였다.

| 주입 조건 | 서버 기록 | runtime cause |
| --- | --- | --- |
| session Bearer 값에 비 Latin-1 문자를 넣음 | OPTIONS 0·POST 0 | `TypeError`: `Failed to execute 'fetch' on 'Window': Failed to read the 'headers' property from 'RequestInit': String contains non ISO-8859-1 code point.` |
| runtime API 주소를 문법이 깨진 URL로 바꿈 | OPTIONS 0·POST 0 | `TypeError`: `Failed to execute 'fetch' on 'Window': Failed to parse URL from http://[/functions/v1/library-files` |
| 새 API origin의 OPTIONS 200에서 authorization·apikey 허용 헤더를 빼버림 | OPTIONS 1·POST 0 | `TypeError`: `Failed to fetch`; 브라우저 `net::ERR_FAILED` |
| POST 응답에서 허용 Origin을 빼버림 | POST 1 도착 | `TypeError`: `Failed to fetch`; 브라우저 `net::ERR_FAILED` |

OPTIONS status가 200이어도 응답의 허용 Origin·Headers·Methods 검사가 실패하면 POST는 전송되지 않는다. preflight 캐시가 유효하면 OPTIONS 없이 POST를 시도할 수도 있다. 따라서 제공 기록만으로 헤더 구성 예외·파일 읽기·CORS·전송 계층 중 하나를 특정할 수 없다. 저장소 Edge 소스의 허용 값은 정상 모의 요청을 통과시켰으며 서버 코드는 수정하지 않았다.

## 기존 E2E가 놓치는 조건

- `library-upload-failure-fixture.html`은 `KPTURuntime.api`를 통째로 가짜 함수로 바꾼다. 업로드 호출과 UI 복구는 확인하지만 실제 runtime·native fetch·CORS·OS File 읽기는 확인하지 않는다.
- `library-project-catalog.spec.mjs`·`library-row-list.spec.mjs`는 실제 runtime을 쓰지만 Supabase를 `page.route`로 가로챈다. 최종 조사와 달리 실제 서버의 OPTIONS·POST 도착을 증명하지 못한다.
- 이번 가로채기 방식의 초기 실험에서는 교차 출처 로컬 서버에도 OPTIONS가 0건이었다. 가로채기를 제거하니 OPTIONS가 실제 관측됐고, 의도적으로 CORS 허용 헤더를 누락했을 때만 OPTIONS 200·POST 0이 확인됐다. 초기 가로채기 실행을 CORS 성공 근거로 쓰지 않는다.
- 메모리·자동화 File은 Android 다운로드 제공자의 선택·읽기 권한·수명과 다르다. 실행 통과가 운영 실패를 부정하지 않는다.

원인 미확정 정지 조건 때문에 영구 회귀 spec은 추가하지 않았다. 요청한 POST 개수·새 파일 재시도 확인은 임시 조사 스크립트에서 실행했다. 기존 테스트 삭제·약화·skip·재시도 설정 변경은 없다.

## 화면에 cause를 노출하지 않는 실기기 확인

기존 `RuntimeError`는 이미 원래 예외를 `e.cause`에 보존한다. 자료실 catch의 콘솔 경고는 바깥 오류만 출력하므로 cause가 보이지 않는 것이 현재 한계다. 진단을 위한 앱 변경 없이 PC의 Chrome 원격 디버깅(`chrome://inspect`)에서 같은 Android Chrome 탭을 검사할 수 있다. 이는 후속 **PC·실기기 작업**이며 이번 클라우드 세션에서 수행하지 않았다.

1. Network의 Preserve log를 켜고 파일 선택 → 저장 1회를 기록한다. Console의 CORS 설명과 Network의 OPTIONS 응답 허용 Origin·Headers·Methods, POST 생성 여부·실패 이유·Initiator를 함께 확인한다. 인증 header·토큰·파일 본문을 공유하지 않는다.
2. Sources의 `library-upload.js` catch에서 조건 `e?.code === 'network_error'`로 중단하거나 caught exception 중단을 사용한다. 원래 예외의 `e.cause?.name`, `e.cause?.message`, 바깥 `e.code`만 확인한다. 화면 문구는 변경하지 않는다.
3. `TypeError: Failed to fetch`만 나오면 원인 확정이 아니다. Network/CDP `Network.loadingFailed.errorText`와 CORS 설명을 대조한다. 파일 읽기 관련 `ERR_UPLOAD_FILE_CHANGED`·`ERR_FILE_NOT_FOUND`, CORS, DNS/TLS, 차단 관련 오류 중 실제 기록이 있는 것을 다음 조사 근거로 삼는다.
4. 실제 요청 URL과 로드된 `library-upload.js?v=20`, `runtime-client.js?v=7`, `view-loader.js?v=107`, `loader-v2.js?v=340`, `app.js?v=228`을 확인한다. 앱 source의 헤더 생성 위치에는 파일 정보를 넣는 코드가 없다. 헤더 오류가 확인되면 값 대신 header 이름·검증 실패 여부만 기록한다.
5. 실패 직후 저장 버튼 busy 해제·파일 표시 상태를 확인하고 새 파일 선택 후 한 번 더 기록한다. Android File 읽기는 원격 중단점에서 실제 선택 File의 `arrayBuffer()` 성공 여부를 검사할 수 있다. 원본 파일은 바꾸지 않는다. 이 확인의 통과만으로 native fetch가 쓰는 시점의 읽기까지 보장되지는 않는다.

우선 남은 확인은 실기기의 원래 cause·CORS 응답/전송 실패 이유·실제 로드 버전·Android 파일 제공자다. 두 브라우저에서 실패하므로 삼성 인터넷 전용 차단 기능은 우선순위를 낮춘다. 앱 코드 원인·서버 원인·실기기 전용 원인 어느 것도 확정하지 않았다.

## 검증과 한계

- 관련 Chromium spec 58/58 통과: library-upload-failure, library-project-catalog, library-row-list(#459 포함), runtime-recovery. 설치 Chromium 사용, workers=1, retries=0.
- Node 360/360 통과: `tests/*.test.mjs tests/security/*.test.mjs tests/domain/*.test.mjs scripts/*.test.mjs` (loader-cache checker 테스트 포함).
- app-smoke workflow의 정적 18단계 통과, HTTP smoke 통과. HTTP 단계의 첫 실행은 이미 떠 있는 8123 서버와 충돌해 종료 trap이 실패했다. 기존 임시 서버를 종료한 뒤 동일 HTTP 단계를 실행하여 exit 0을 확인했다. 앱 실패가 아니다.
- loader-cache: 기준·최종 코드 SHA 비교 통과, 운영 참조 383개. 첫 working-tree 실행은 임시 node_modules 디렉터리 symlink를 파일로 읽어 EISDIR가 발생했다. 임시 symlink를 제거한 뒤 최종 working-tree 검사도 변경 문서 2개·운영 참조 383개로 통과했다. 앱 파일이 바뀌지 않아 캐시 버전 상승은 해당 없음.
- 최종 모의 실행에서 두 폭 각각 sandboxed iframe의 `navigator.serviceWorker` 접근 예외 2건이 별도로 관측됐다. 업로드는 성공했고 업로드 fetch 오류가 아닌 배경 예외다. 이번 범위에서 수정하지 않았다. 운영에서 같은 예외가 나는지는 미확인이다.
- 초기 socket 강제 단절 실험에서는 UI fetch 1회에도 서버 POST 개수의 기대값이 맞지 않아 최종 검증에서 별도 조건(응답 CORS 실패)으로 구분했다. transport 자체 동작과 앱 재시도를 혼동하지 않는다. 운영 POST 0의 근거로 쓰지 않는다.
- 임시 재현 코드·서버 기록은 `/tmp/library-upload-tools/investigate.mjs`, `evidence.json`, `records.json`에 보존했다. 영구 CI spec이 아니다.
- 앱·Edge·DB·RLS·migration·Cloudflare·운영·환경 설정 변경 없음. 공용 runtime의 다른 API 영향 없음. CI 실행·PR 생성·merge 없음.

초기 로컬 원장은 APP 정지와 LIB merge 기록을 보충했었다. 재개 요청의 「다른 행은 고치지 않는다」에 따라 이번 PR에서는 LIB 행을 원격 main 원문으로 복원하고 APP 행만 갱신한다.


## 05:25 재개 — 회의자료 대조와 A/B

새로 fetch한 origin/main은 여전히 `669c6087b19eeec666e1b82feeb632f6cf25c9b3`이다. 기존 브랜치를 계속 사용하며 기준이 동일하여 rebase가 필요 없었다.

사용자 실기기 제공 사실: 같은 폰·브라우저·네트워크에서 회의자료 업로드는 성공하고 자료실은 매번 OPTIONS 200만 기록된다. 운영 Code 탭의 library-files CORS는 저장소와 같고 meeting-files도 동일한 허용 헤더 목록을 쓴다. 이를 원격 확인 자료로 기록했으며 Codex가 운영에 접속한 것은 아니다.

### 변경 전 실제 코드의 차이

| 항목 | 회의자료: team.js api → meeting-files | 자료실: luUploadRequest → runtime.api → fetchWithTimeout |
| --- | --- | --- |
| URL | 고정 Supabase HTTPS origin + `/functions/v1/meeting-files` | 같은 기본 origin + `/functions/v1/library-files` |
| native fetch 옵션 | `method`, `headers`, `body` | 위 옵션 + `cache: no-store`, 새 controller의 `signal` |
| credentials / mode / keepalive / redirect | 생략: same-origin / cors / false / follow 기본값 | 동일한 기본값 |
| 작성 헤더 | apikey, Authorization(Bearer session); FormData이므로 Content-Type 미지정 | 동일. 파일명·자료 입력값은 헤더에 넣지 않음 |
| FormData | file, meeting_id, 선택 시 project_id | file; 값이 있으면 title, category, source, document_date, tags, project_id, description. 다중 파일은 title 제외 |
| 호출 직전 | 공용 session.ensure 후 최신 session 읽기 | 같은 ensure. 추가로 mutationKey/flight map에서 동일 요청 묶기 |
| File 본문 | 선택 File을 FormData에 그대로 append | 동일. 별도 File 읽기/변환 없음 |
| 업로드 시간 제한 | 별도 제한 없음 | 기존 `luUploadTimeoutMs`: 90초 + 올림 MB당 4초, 최대 10분 |
| fetch 예외 | 원래 예외 전달 | RuntimeError timeout/network_error로 정규화, cause 보존 |
| HTTP 실패·401 | 일반 Error, HTTP status metadata·401 재전송 없음 | status/code/retryable 보존; 401은 공용 refresh 후 인증 재시도 1회 |
| 성공 후 | 회의·자료 목록 reload, documents-changed/meetings-changed 등 | runtime api-saved 메타데이터와 epoch guard, 자료 목록 조회·렌더, documents-changed |

URL·FormData의 차이는 기능별 계약이며 그대로 유지했다. CORS preflight는 본문 필드 값을 검사하지 않는다. 현재 자료실 입력 필드나 서버가 원인이라고 확정할 근거는 발견되지 않았다. runtime의 signal·cache·중복 묶기 중 어느 것이 실기기 실패에 기여했는지도 미확정이다.

### 출국 전 기준 대조

출국이 10월 4일 저녁이라는 제공 사실에 맞춰 **10월 4일 18:00 KST 직전 first-parent main**을 조회했다: `a11e6b035a6723346632d729d0418106b6e292b3` (#405 merge, 17:08 KST). 실제 폰에 마지막으로 로드됐던 SHA는 알 수 없으므로 이 값을 마지막 정상 사용 SHA로 단정하지 않는다.

이 커밋과 현재 `669c6087`의 `luUploadRequest`, `luUploadOrOriginal`, `luSetSelectedFiles`, `luUploadFailure`는 각각 전체 함수 원문이 동일하다. runtime 파일 전체도 blob `bd14a1b61afcfefe7fc1e0a4833bec3a686abd37`로 동일하며 team의 api 함수도 동일하다. 출국 이후 #419(배포 알림)·#421(자료실 목록)·#443(머리표)·#459(회의자료 목록 숨김)는 업로드 요청 생성 경로를 바꾸지 않았음을 직접 확인했다.

### 이번 구현과 의도적인 차이

자료실 업로드 전송 함수 하나만 native `fetch(url,{method:'POST',headers,body:fd})`로 바꿨다. 회의자료와 동일하게 signal·cache·추가 전송 옵션을 넣지 않는다. 공용 runtime.api의 중복 묶기를 통과하지 않으며 UI의 기존 luUploading 잠금은 유지한다. 파일 선택·FormData 필드·URL·실패 분류·목록 표시·회의자료 경로는 그대로다.

회복 기능까지 회의자료의 일반 Error로 낮추지 않았다. 공용 session.ensure/refresh/read와 RuntimeError를 재사용하고 기존 status/code/retryable·cause를 유지했다. 정상 업로드는 POST 1건이다. 네트워크·시간 초과 실패에는 재전송하지 않는다. 기존 401 인증 회복만 refresh 성공 때 POST를 1회 더 보내므로 이 경우 총 2건이며, 회복 실패는 기존 session 분류다.

`luUploadTimeoutMs` 원문과 계산값은 그대로다. signal을 제거하는 A/B 목적 때문에 **시간 제한은 Promise.race로 결과 대기를 끝내며 native fetch를 취소하지 않는다**. 기존처럼 unknown 상태와 중복 재전송 확인을 유지한다. 늦은 성공 응답은 해당 호출의 저장 신호·성공 UI로 바뀌지 않는다. 요청이 계속 살아 있으므로 시간 초과 후 서버가 저장할 가능성은 남는다.

성공 후 기존 runtime과 같은 api-saved(path·POST·빈 fields/action·projectLinked·epoch)만 발행한다. 계정 epoch 변경 시 발행하지 않는다. 문서명·파일 본문·응답 데이터는 신호에 넣지 않는다. 기존 luUploadOrOriginal의 목록 재조회·documents-changed는 그대로며 drive-summary가 두 기존 신호를 구독하므로 프로젝트 연결 Drive 요약 갱신을 유지한다.

공용 runtime-client.js·team.js·Edge·DB·RLS·migration·Cloudflare는 변경하지 않았다. 캐시는 library-upload21 → view-loader108 → loader-v2341 → app229 → index로 올렸으며 기대값 spec과 smoke workflow만 같은 값으로 맞췄다.

### 추가 검사의 의미

`library-upload-transport.spec.mjs`는 native HTTP 모의 API와 교차 출처 fixture를 사용하며 Playwright 요청 가로채기가 없다. 390px는 Pixel 7 Android Chrome context, 1280px는 데스크톱이다. 기존 원격 main의 자료실 소스를 baseline으로 실행한 결과와 후보 결과를 비교한다.

- 각 폭에서 CORS OPTIONS 및 서버가 전체 본문을 받은 POST 정확히 1건, multipart 한글 필드, 회의자료와 동일한 fetch 옵션, 시간 제한 94000ms, api-saved와 documents-changed 각각 1회를 검사한다.
- 네트워크·timeout·401·413·503·Drive 424·403·400·504의 화면 문구·상태·error code/status/retryable을 변경 전과 비교한다. 실패 후 새 파일이 다시 POST 1건으로 성공하는지도 검사한다(401은 세션 회복 실패로 로그인 필요).
- 기존 401 refresh 성공의 POST 2건·refresh 1건·save 신호 1건을 별도로 검사한다.
- 새 deadline 뒤 늦은 응답이 unknown을 유지하고 성공 신호를 보내지 않는지, 계정 변경 뒤 api-saved metadata가 발행되지 않는지 검사한다.
- 시간 초과 검사는 테스트에서 실제 94000ms timer 인자를 관측하고 150ms로만 단축한다. 운영 시간 계산값·실패 기준은 바꾸지 않는다.
- 기존 업로드 fixture는 같은 실패 계획·assertion을 유지하면서 native-fetch 모의 경계를 추가했다. 기존 spec·assertion 삭제·약화·skip은 없다.

변경 전에 신규 fetch 옵션 검사가 두 폭 모두 `cache: no-store`·signal 존재 때문에 실패하는 것을 확인했다. 이는 전송 방식 변경의 회귀 검사이며 **운영 오류를 재현한 검사는 아니다**. 구현 뒤 검증 수치는 아래 최종 기록에 적는다. 초기 추가 테스트의 401 mock 조건식 오류·OPTIONS까지 refresh 횟수에 포함한 계수 오류·describe device 설정 오류는 테스트 harness에서 바로잡았으며 제품 코드의 회귀로 분류하지 않는다. 읽기 전용 별도 리뷰에서 Critical/Important 발견 없음.

### 폰 판정과 되돌림

**폰 확인으로 해결 여부 판정, 미해결 시 되돌림 후 귀국 뒤 PC 실기기 확인.** 지금 원인을 확정하거나 운영 해결 완료로 보고하지 않는다. 확인 항목은 직접 자료실 1쪽 PDF·2.7MB PDF·프로젝트 없음, 실제 POST 도착, 성공 목록 표시, 회의자료 인접 기능 유지다.

미해결이면 자료실 luUploadRequest를 기준 main 구현으로 되돌리는 후속 PR을 준비하고, 바뀐 파일의 cache chain은 당시 최신 값에서 다시 올린다. 공용 runtime·회의자료·서버는 바꾸지 않는다. 단순 과거 캐시 문자열 회귀로 배포 캐시 검사를 우회하지 않는다. 이후 원격 Chrome에서 원래 cause·Network/CORS·File 읽기·실제 모듈 버전을 확인한다.

### 최종 로컬 검증

- 설치 Chromium151·Playwright1.55·workers=1·retries=0: 관련 spec **152/152 통과**(2.1분). 새 native HTTP 검사 26개 포함. 파일: library-upload-transport, library-upload-failure, library-project-catalog, library-row-list, runtime-recovery, meeting-entry, startup-performance, calendar-hotfix, task-layout-groups. 전체 E2E 로컬 실행은 요청 범위 밖이라 수행하지 않았다.
- Node **360/360 통과**, fail/skip 0. `node --test tests/*.test.mjs tests/security/*.test.mjs tests/domain/*.test.mjs scripts/*.test.mjs`.
- app-smoke의 정적 18단계·HTTP smoke 통과. 변경 전 코드에서 시작한 신규 fetch 옵션 검사 2개 실패를 확인했으며 최종 관련 spec은 모두 통과했다.
- 캐시 기대값 spec·loader-cache 검사 통과. 운영 참조 383개 확인.
- 최초 PR CI의 저장소 감사는 신규 fixture의 직접 세션 저장 1줄을 지적했다. fixture가 공용 `session.write`로 모의 로그인을 설정하도록 바꾸고 로그인으로 증가한 epoch=1을 정확히 검사한다. 감사 규칙 변경 없이 로컬 감사와 native HTTP 26/26 재검사 통과.
- 별도 읽기 전용 리뷰: Critical/Important 발견 없음. 앱·테스트 임시 디버깅 코드 없음; 모의 서버·관측 wrapper는 테스트 파일에만 있다.
- PR CI는 PR 본문·댓글의 최종 head SHA 기록으로 확인한다. 폰 판정 전에는 운영 해결 완료로 취급하지 않는다.

PR: [#460](https://github.com/mj880616/work/pull/460), branch `codex/app-library-upload-fail`. 최종 head의 CI 결과는 PR 본문·댓글에 기록한다. merge하지 않는다.

## 폰 진단 북마크

📱 폰 경로 B. 원본은 `scripts/diag/library-upload-diag.js`, 한 줄 북마크는 `scripts/diag/library-upload-diag.bookmarklet.txt`다. 원격 `origin/main`을 새로 fetch한 시작 SHA는 `38a3217abf95b33c2c14434590b449676c9e3f08`(#465 merge)이다. Codex는 운영에 실행하지 않는다. 커맨드센터의 줄 단위 검토 후 사용자가 폰에서 실행하며, 상세 실행 절차는 커맨드센터가 안내한다.

앱 모듈의 내부 선택 파일에는 접근할 수 없어 패널의 **파일 고르기**로 다시 선택한다(`multiple`). **진단 시작** 후 선택 순서대로 각 파일의 T0~T7을 하나씩 실행한다. 시험마다 60초 제한, 자동 재시도·세션 갱신 없음. 제한 초과나 닫기 때 현재 작업을 중단하고 이후 시험을 실행하지 않아 요청이 겹치지 않는다. T5 읽기 실패는 기록하고 T6만 미실행하며 T7은 계속한다. 환경 설정 오류는 요청 전 종료한다.

| 시험 | 입력·기대 응답 | 목적 |
| --- | --- | --- |
| T0 | 로그인 세션 예/아니오, 앱 fetch 래퍼 예/아니오, 파일 이름 길이·크기·type·lastModified, 첫 1바이트 읽기 | 앱 환경·파일 제공자 읽기 확인. 래퍼 판별은 현재 `auth-bootstrap.js`의 `rawFetch`·`/auth/v1/user` 특징을 사용하며 다른 래퍼까지 판별하지 않는다. |
| T1 | library-files: 파일 없이 무작위 project_id → 400 `file_missing` | 파일 본문과 무관한 인증·요청 경로 확인 |
| T2 | library-files: 10바이트 생성 Blob, `diag.pdf` → 404 `project_not_found` | 작은 multipart 본문의 전송 기준 |
| T3 | library-files: 선택 파일과 같은 크기의 생성 Blob, `diag.pdf` → 404 | 크기·업링크와 실제 파일 핸들 분리 |
| T4 | library-files: 선택한 실제 File 그대로 → 404 | 핵심 재현. 헤더 이름 `apikey`, `Authorization`만 한 번 표시 |
| T5 | library-files: 실제 파일 전체를 arrayBuffer로 읽어 만든 사본, 같은 이름·type → 404 | 원본 파일 핸들과 메모리 사본 비교. 읽기 실패는 요청 전 오류로 기록 |
| T6 | library-files: T5 사본의 전송 이름만 `diag.pdf` → 404 | 파일명 영향 분리 |
| T7 | meeting-files: T4와 같은 실제 File, 무작위 meeting_id → 403 | 같은 파일·다른 함수 비교 |

모든 POST는 새 `crypto.randomUUID()`로 만든 project_id 또는 meeting_id를 반드시 포함한다(T1도 project_id 포함). 파일이 있으면 FormData의 첫 필드는 file이다. 실존 ID나 앱의 프로젝트·회의 선택값을 읽지 않는다. library-files는 `getUser → formData 전체 수신 → 파일 검사 → 없는 project_id의 404`, meeting-files는 `formData → 없는 meeting_id의 403`에서 Drive·DB 쓰기 전에 종료된다. **0바이트는 400, 100MB 초과는 413**으로 ID 검사보다 먼저 거절되어 기대 404/403의 예외다. 무작위 UUID는 존재 여부 조회로 확인하지 않으며 충돌 가능성은 극히 낮지만 수학적으로 0은 아니다.

주소·apikey·세션은 `window.KPTURuntime`에서 읽고 앱과 같은 `window.fetch`를 호출한다. 두 함수 외 호출·인증 refresh·외부 스크립트·저장소/쿠키 쓰기는 없다. 진단 제한용 AbortController와 다른 주소 이동 방지용 `redirect: error`를 추가하므로 앱의 무제한 native fetch 옵션과 완전히 같지는 않다. 앱 fetch 래퍼가 바꾼 응답을 관측하며, 원본 서버 code가 래퍼에 의해 빠질 수 있다.

### 결과 해석

아래의 “성공”은 **기대 거절 응답을 브라우저가 받은 것**을 뜻한다. 업로드 생성 성공(2xx)을 뜻하지 않는다. 추정은 후속 확인의 방향이며 원인 확정이 아니다.

| 결과 패턴 | 해석·다음 대조 |
| --- | --- |
| T1부터 응답 없이 실패 | 파일과 무관한 요청 자체·환경 문제 후보. 401이면 세션 만료 등 인증 문제를 먼저 확인 |
| T2 성공·T3 실패 | 크기·업링크 문제 후보. 413과 시간 초과를 구분하고 생성 Blob 메모리 부족 가능성도 확인 |
| T2 성공·T4 실패·T5 성공 | 선택 파일 핸들·파일 제공자 문제 후보 |
| T4 실패·T5 실패·T6만 성공 | 파일 이름 문제 후보(T5 읽기 성공·POST 시도였는지 확인) |
| T0 첫 바이트 실패 또는 T5 읽기 실패 | 파일 읽기/접근 문제 후보. T5 요청 미시도와 네트워크 실패를 구분 |
| T7 성공·T4 실패 | library-files 쪽 경로·응답·전송 차이 후보 |
| T1~T7 기대 응답 도착 | 이 진단 조건에서 전송 성공. 실제 앱 입력·기기 상태와 차이는 남음 |
| 60초 제한 초과 | 이후 시험 중단. 서버가 본문을 받았는지는 별도 대조 필요 |

표와 복사 결과는 시험별 시작 UTC(초)·소요 ms·브라우저 응답 도착·HTTP status·JSON code·오류 name/message/cause(name/message/code)를 포함한다. T0·T5에서 파일을 읽는 오류도 기록한다. 파일 이름 원문·응답 본문·헤더 값·토큰은 포함하지 않고, 오류나 code에 비밀값이 섞여도 출력 전에 가린다. 결과 복사가 실패하면 선택 가능한 textarea를 제공한다. 닫기는 패널과 현재 실행을 정리한다. 파일 제공자나 브라우저가 취소를 무시할 수 있어 제한 초과 뒤 늦은 응답은 결과를 바꾸지 않는다. 취소된 실제 작업이 끝날 때까지 페이지 전체 잠금이 남아 재선택·북마크 재실행으로도 요청을 겹칠 수 없다. T3는 최대 64KiB 초기 버퍼와 Blob 합성으로 생성하며 T5 전체 사본은 폰 메모리를 사용한다. 앱/OS 강제 종료는 60초 타이머로 막을 수 없다.

### Invocations 대조

커맨드센터가 사용자의 결과에서 파일 번호·T번호·시작 UTC·소요시간·함수 이름을 기준으로 library-files(T1~T6), meeting-files(T7)의 해당 구간을 대조한다. 패널의 새 무작위 ID는 요청별 대조 보조 정보이며 서버 로그에 ID가 있을 때만 매칭한다. OPTIONS와 POST를 따로 센다. preflight는 캐시될 수 있어 시험마다 OPTIONS가 생기지 않을 수 있다. 응답 도착 “아니오”는 브라우저가 응답을 받지 못했다는 뜻으로, POST 미생성이나 서버 미도착을 단정하지 않는다. POST가 있는데 브라우저는 실패하면 응답/CORS·전송 중단을 확인하고, OPTIONS만 있으면 preflight 이후 본문 전송을 확인한다. 요청 시작부터 본문 수신까지 시간이 걸릴 수 있으므로 UTC 시작~종료 주변을 함께 확인한다.

원본과 북마크의 동일성·허용 경로·무작위 ID·금지 API 및 순차 전송/오류/비밀값 가림 검사는 `tests/security/library-upload-diag.test.mjs`에 있다. 재생성: `node scripts/diag/generate-library-upload-bookmarklet.mjs`, 동일성 검사: 같은 명령에 `--check`. 운영 원인은 사용자의 실기기 결과와 Invocations 대조 전까지 미확정이다.

### 작성 검증

- Node 전체 `node --test tests/*.test.mjs tests/security/*.test.mjs tests/domain/*.test.mjs scripts/*.test.mjs`: 378/378 통과(새 진단 검사 11개 포함), 실패·skip 0. 기준 main은 367/367 통과. 생성 스크립트 `--check` 통과.
- 설치 Chromium 151.0.7922.173·Playwright 1.57.0, 로컬 교차 출처 HTTP 모의 서버만 호출했다. 원본 평가뿐 아니라 생성된 `javascript:` URL 자체를 실행했다. 390px·1280px에서 multiple 선택(작은 PDF·2.7MB, 한글·공백 파일명) 각각 T0~T7 16행·POST 14건·기대 응답 통과. 390px 응답 CORS 실패·redirect 거절 조건 각각 POST 7건·후속 시험 계속, redirect 목적지 호출 0건. 합계 POST 42건, 서버 최대 동시 요청 1건, 페이지 오류 0건. 헤더 값 제외 복사 fallback·닫기 확인. 임시 검증 소스/증거는 `/tmp/library-diag-browser.mjs`, `/tmp/library-diag-browser-evidence.json`에만 두었다.
- Node에서 실제 선택 File 객체 보존·UUID 중복 없음·파일 읽기 실패·60초 제한·abort 무시 시 재선택/재열기 차단·늦은 요청 방지·비밀값 가림을 검사했다. 시험 제한은 테스트에서 타이머만 단축해 검증했다.
- 최초 PR CI의 보안 검사에서 새 검사의 Acorn import가 `ERR_MODULE_NOT_FOUND`로 실패했다. 보안 workflow는 parser 설치 없이 실행하므로, 새 정적 검사를 Node 기본 구문 검사·소스/리터럴 경계 검사로 변경하고 의존성 미설치 상태의 11/11 통과를 확인했다. workflow는 변경하지 않았다.
- 실제 Android 파일 제공자·운영 TLS·실기기 메모리·네트워크 및 삼성 인터넷은 이 검증으로 재현하지 못한다. 앱·Edge·DB·workflow·운영 변경 없음. 앱 로더가 이 파일을 불러오지 않아 캐시 버전 갱신은 해당 없음.

진단 북마크 PR: [#466](https://github.com/mj880616/work/pull/466), branch `codex/app-library-upload-diag`. merge하지 않는다.

## 원인 확정·수정 — 2026-10-10

### 폰 진단 사실

사용자가 제공한 #466 실기기 결과와 서버 Invocations 대조: Android Chrome, 다운로드 폴더의 2.7MB PDF.

- T0 첫 1바이트 읽기는 성공했다.
- 선택한 File 원본을 FormData에 넣은 T4(library-files)·T7(meeting-files)는 약 0.5초에 `TypeError: Failed to fetch`로 끝났고 서버 POST는 각각 0건이었다.
- 같은 File을 `arrayBuffer()`로 읽고 `new File([buffer], 원래 이름, {type, lastModified})`로 만든 사본은 T5·T6에서 정상 도착했다. 같은 크기의 생성 Blob(T3)도 도착했다. “도착”은 진단용 기대 거절 응답 수신을 뜻하며 운영 자료 생성은 아니다.

확정된 실패 지점은 **선택 파일 원본을 요청 본문으로 직접 보내는 경로**다. 이 대조에서 네트워크·크기·이름·서버·인증은 원인이 아니다. Android 파일 제공자/Chrome 내부의 구체적인 결함 코드는 확인하지 않았으며 추정으로 단정하지 않는다. 이전의 회의자료 성공 제보와 원인 미확정 기록은 당시 조사 이력으로 보존하고, 현재 판정은 이 절을 기준으로 한다. Codex가 운영에 접속한 것은 아니다.

### 수정 방식

기준은 새로 fetch한 `origin/main`의 `d514d9203cf27ca7e6813ff6873f5724256c6f7a`(#466 merge), 브랜치는 `codex/upload-file-copy`다.

공통 함수는 `app/runtime-client.js`의 `KPTURuntime.copyUploadFile`에 한 번만 둔다. 자료실·새 회의·회의 상세가 이미 이 런타임을 사용하고 먼저 로드하므로 별도 모듈/로딩 의존성 없이 재사용한다. 세 전송 루프에서 해당 파일을 보내기 직전에만 사본을 만들고 이름·type·lastModified를 유지한다. 사본/ArrayBuffer를 업로드 entry나 전역에 저장하지 않는다. 이전 파일 요청이 끝난 다음 파일을 읽는 순차 방식이며, 파일별 FormData의 file 참조도 finally에서 해제한다. 원본 선택 File은 기존 실패 표시·선택 취소 흐름에 필요한 기간만 유지한다. 브라우저가 전송 중 내부에 유지하는 본문과 실제 GC 시점은 앱이 제어하지 못한다.

읽기 실패는 `file_read_failed`로 구분하고 **“파일을 읽지 못했습니다. 파일을 다시 선택해 주세요.”**를 표시한다. 해당 파일의 업로드 요청은 0건이고 다음 파일은 계속 처리한다. 자료실은 `entry.retry=false`로 재선택 전 재전송을 막고, 회의자료는 기존 파일별 실패 표시·사용자 재시도 흐름을 따른다. 새 회의 결과 자체는 기존처럼 저장되며 자료 읽기 실패 문구를 결과 알림에도 남긴다. 원본 전송 fallback·자동 재시도는 추가하지 않는다.

100MB 제한, 자료실 크기별 timeout 및 오류 분류, #460 native fetch 옵션과 기존 401 인증 회복은 유지한다. 서버 함수·Edge·DB·RLS·Cloudflare·workflow는 수정하지 않고 `scripts/diag`를 보존한다. 진단 북마크 사용 후 사용자 삭제 확인은 원장 SEC-보안정리에서 추적한다.

캐시 버전은 runtime·세 모듈에서 상위 loader·app.js·index.html(modulepreload 포함)까지 올리고 기존 E2E의 버전 기대값을 함께 갱신한다. `app-smoke-check.yml`의 고정 버전 기대값은 workflow 변경 금지 때문에 유지하며, 결과와 충돌은 PR에 보고한다.

### 수정 검증

- Node: `node --test tests/*.test.mjs tests/security/*.test.mjs tests/domain/*.test.mjs scripts/*.test.mjs` **380/380 통과**, 실패·skip 0. 구현 전 기존 검사 378/378 통과. 새 공통 함수 검사 2개는 사본 객체의 독립성·동일 bytes/name/type/lastModified와 읽기 실패 code/message/retryable/cause를 확인한다.
- 설치 Chromium 151.0.7922.173, Playwright 1.55.0, workers=1, retries=0. `material-selection-delete` **32/32 통과**(새 검사 18개 포함): 자료실·새 회의·회의 상세 각각 390/1280px에서 원본과 다른 File 전송, 이름·type·lastModified·크기 유지, 첫 요청 대기 중 다음 파일 읽기 0회, 읽기 실패 파일 POST 0건·정확한 문구·다음 정상 파일 계속 처리. 자료실 읽기 실패는 재선택 전 재전송 0회와 재선택 후 복구도 확인한다. 새 회의에서 부모 회의 저장은 기존대로 유지하며 “0건”은 파일 업로드 요청 기준이다.
- 관련 기존 spec 10개 **156/156 통과**: `library-upload-failure`, `library-upload-transport`, `library-project-catalog`, `library-row-list`, `runtime-recovery`, `meeting-entry`, `startup-performance`, `task-layout-groups`, `calendar-hotfix`, `private-rail-forum-state`. 합계 Chromium **188/188 통과**. 기존 timeout·network·HTTP 오류 분류, native fetch 옵션·401 인증 회복·늦은 응답, 선택 취소·저장 잠금·자료 삭제·회의 회귀를 유지한다. 기존 검사를 삭제하거나 약화하지 않았다.
- loader-cache 검사: 시작 SHA 대비 **20개 변경 파일, 운영 참조 385개 통과**. runtime의 직접 참조가 있는 `app/login/index.html`, `app/my-work.html`, `private-rail/forum-0929/index.html`도 캐시 값만 올렸다. 새 앱 의존성은 추가하지 않았다. `scripts/diag/generate-library-upload-bookmarklet.mjs --check` 통과, 진단 소스 변경 없음.
- 기존 app-smoke 단계의 로컬 실행은 **20단계 중 18 통과·2 실패**(HTTP 34경로 포함). 실패는 `Check recursive app dependency graph`와 `Check public and authenticated app boundaries`의 옛 team/view-loader/library/meeting-detail 버전 고정값 때문이다. 같은 두 단계는 시작 SHA를 archive한 clean main에서 통과했다. 앱 캐시 상승으로 발생한 검사 기대값 충돌이며, workflow 변경 금지에 따라 우회·삭제·수정하지 않았다. PR CI에서도 별도 확인하고 merge 전 커맨드센터가 해결 여부를 판단해야 한다.
- 실제 Android 파일 제공자·실기기 메모리·운영 전송은 모의 Chromium 검사로 재현하지 못한다. merge 후 같은 폰·PDF로 세 화면의 실제 도착을 확인해야 한다. 대용량은 한 파일의 ArrayBuffer와 사본, 브라우저 본문 처리 메모리를 추가로 사용하므로 최대치에서 메모리 부담은 남는다. 운영 DB·Edge·workflow 실행·merge는 하지 않았다.

수정 PR: [#467](https://github.com/mj880616/work/pull/467), branch `codex/upload-file-copy`. workflow 고정 버전 검사 충돌이 남아 draft 상태이며 커맨드센터 확인 전 merge하지 않는다.
