# 바구니 PC드롭 (BASKET-PC드롭)

윈도우 PC에서 글·사진·파일을 Web2 바구니로 던지는 작은 프로그램. 설계: [docs/design/basket-pc-drop.md](../docs/design/basket-pc-drop.md). 보관 상태인 `windows-app/`와 별개의 새 폴더다.

## 지금 상태: 1차 시험판 A단계 + B단계(구글 로그인) + C단계(설치형·자동 업데이트·자동 실행)

| 있음 | 없음(다음 단계) |
| --- | --- |
| 트레이 아이콘, 붙여넣기 창(Ctrl+V → 미리보기 → 메모 한 줄 → Ctrl+Enter) | 구석 반응·위젯(3단계) |
| 클립보드 단축키 기본 Ctrl+`(숫자 1 왼쪽 키), 트레이 메뉴 [단축키 바꾸기]로 Ctrl+Q·Ctrl+Space 선택(누를 때만 읽음) | |
| 우클릭 [보내기](트레이 메뉴에서 켜고 끔) | |
| 보낸 기록·대기열 창, 작은 알림 | |
| 구글 로그인·로그아웃·로그인 상태 표시(B단계) | |
| 오프라인 대기열(2GB 상한, 성공 즉시 삭제, 7일 지나면 버릴지 확인) | |
| 설치 파일(`BasketDropApp-win-Setup.exe`)·자동 업데이트·윈도우 시작 시 자동 실행(C단계) | |

로그인하지 않았거나 로그인이 만료된 동안 보낸 것은 "로그인이 필요해요" 상태로 PC에 보관되고, 로그인하면 순서대로 나간다.

## 로그인 (B단계)

- 시스템 기본 브라우저에서 Supabase 구글 로그인 → PKCE(`code_verifier`/`code_challenge`) + 루프백 돌려받기(`http://127.0.0.1:<고정 후보 포트>/basket-drop/<일회용 state>`). 코드·state는 한 번 쓰면 수신기가 닫힌다(`LoopbackReceiver`). 이전 `auth-handoff`/`kptuwork://` 방식은 쓰지 않는다.
- **Supabase Auth 허용 주소(Redirect URLs)에 아래 항목이 있어야 로그인이 된다**(읽생기와 공유하는 설정이라 사용자가 대시보드에서 직접 추가, PR 본문 참고). 후보 포트는 `LoopbackReceiver.DefaultPorts`:
  - `http://127.0.0.1:47615/basket-drop/*`, `http://127.0.0.1:47616/basket-drop/*`, `http://127.0.0.1:47617/basket-drop/*`
- 보관: Windows 자격 증명 관리자(`BasketDrop/Supabase`)에 **새로고침 토큰 하나만**. 접근 토큰은 메모리에만, 만료 60초 전에 갱신(한 번에 한 번만 갱신).
- 로그아웃: 이 PC의 저장된 로그인을 지우고, 토큰에 세션 번호가 있을 때만 서버에 `scope=local`(이 세션 하나) 로그아웃을 요청한다. 세션 번호가 없으면 서버가 계정 전체를 로그아웃시키므로 호출하지 않는다.
- 소유자 확인: 로그인 직후 소유자 행이 보이는지 읽어 보고 아니면 저장하지 않고 안내한다. 이것은 안내용이고, 실제 권한 판정은 서버(RLS·`basket-files` 소유자 확인)가 한다.

## 단축키

- 기본은 Ctrl+`(숫자 1 왼쪽 키). 윈도우의 키 코드(VK_OEM_3)로 등록하므로 한국어·영어 배열 모두 같은 물리 키다.
- 트레이 메뉴 [단축키 바꾸기]에서 Ctrl+`·Ctrl+Q·Ctrl+Space 중 고른다(조합 키만). 고른 값은 `%LocalAppData%\BasketDrop\settings.json`에 저장된다.
- 다른 프로그램이 이미 쓰는 키라 등록이 안 되면 알림으로 알리고 이전 키를 그대로 쓴다.
- 등록은 윈도우 `RegisterHotKey`만 쓴다. 키 입력 전체를 지켜보는 방식(저수준 키보드 훅)은 쓰지 않고, 클립보드는 단축키를 누를 때만 읽는다(테스트로 고정).

## 설치·업데이트·자동 실행 (C단계)

- 도구: Velopack(자체 포함 배포). 관리자 권한 없이 `%LocalAppData%\BasketDropApp`에 설치된다. 데이터(대기열·기록·설정·로그)는 `%LocalAppData%\BasketDrop`로 설치 폴더와 분리되어, 업데이트·재설치·제거에도 남는다. 로그인은 자격 증명 관리자에 있어 업데이트·재설치 뒤에도 유지된다.
- 코드 서명은 하지 않는다. 설치 파일을 처음 실행하면 윈도우 SmartScreen 경고가 한 번 뜬다(알려진 감수 사항).
- 업데이트: 시작 20초 뒤(이후 12시간마다) 이 저장소의 릴리스 중 태그가 정확히 `basket-pc-vX.Y.Z`인 것만 확인한다(초안·시험판 제외, 가장 높은 버전). 새 판은 내려받으며 해시를 검사하고, 다음에 프로그램을 켤 때 적용된다. 바로 쓰려면 트레이 메뉴의 [새 버전으로 다시 시작]. 어느 단계든 실패하면 지금 쓰는 판이 그대로 남는다.
- 믿는 범위: 이 저장소의 릴리스 파일과 GitHub의 파일 서버뿐이다(`UpdatePolicy`, 시험으로 고정). `releases/latest`와 다른 태그·다른 저장소는 받지 않는다. 서명이 없어서 해시 목록과 파일이 같은 릴리스에 있으므로, 안전은 저장소 쓰기 권한·태그 보호·릴리스 승인에 기댄다.
- 시작 시 자동 실행: 기본 켬. 현재 사용자 `Run` 항목(관리자 권한 불필요)이며 트레이 메뉴 [윈도우를 켤 때 자동 실행]으로 끄고 켠다. 켤 때마다 현재 설치 경로로 다시 맞춘다. 윈도우 설정 [앱 > 시작 프로그램]에서 끈 것은 다시 켜지 않는다. 설치한 프로그램에서만 동작하며 개발 빌드는 등록하지 않는다.
- 제거: 시작 항목·우클릭 [보내기] 항목·저장된 로그인을 지운다. 대기열·기록 폴더는 남긴다.
- 새 판 내기: 아래 "새 판 내기"를 따른다. 사용자가 하는 일은 **태그 하나 만들기**뿐이고, 빌드·설치 파일·Release 만들기·파일 올리기는 `Basket PC release` workflow가 한다. 비밀값은 이 실행의 자체 토큰 외에 없다.

## 새 판 내기

태그 `basket-pc-vX.Y.Z`(예: `basket-pc-v0.1.2`)가 만들어지면 `Basket PC release` workflow가 저절로 시작한다. 태그는 **main에 이미 들어간 커밋**에만 만든다(아니면 workflow가 멈춘다). 먼저 올릴 변경이 main에 merge되어 있어야 한다.

### 가장 쉬운 길: GitHub 웹 (PC·폰 모두 가능)

1. 저장소 페이지 오른쪽의 [Releases] → [Draft a new release]를 누른다.
2. [Choose a tag]에 새 태그 이름 `basket-pc-v0.1.2`를 입력하고 `Create new tag: basket-pc-v0.1.2 on publish`를 고른다. 이름은 반드시 `basket-pc-v` + 숫자.숫자.숫자 모양이다. 이전 판보다 큰 번호로 한다.
3. [Target]은 `main`으로 둔다.
4. 제목·설명은 비워 둬도 된다(workflow가 채운다).
5. 아래의 **[Set as a pre-release] 체크를 켠다.** 파일이 올라오기 전의 빈 Release가 사용 중인 프로그램의 업데이트에 보이지 않게 하는 안전장치다. 이 체크 없이 [Set as the latest release]를 쓰지 않는다.
6. [Publish release]를 누른다. (초안으로 저장만 하면 태그가 만들어지지 않아 시작되지 않는다.)
7. 저장소 [Actions] 탭 → `Basket PC release` 실행을 연다. `verify`는 자동으로 끝나고, `release`가 **승인 대기**로 멈추면 [Review deployments] → `basket-pc-release` 체크 → [Approve and deploy]를 누른다.
8. 15~20분쯤 뒤 [Releases]에 설치 파일(`BasketDropApp-win-Setup.exe`)이 붙은 공개 Release가 보이면 끝이다. workflow가 pre-release 표시를 풀고 공개한다. 사용 중인 프로그램은 12시간 안에 새 판을 받는다.

### PC에서 명령으로

main 최신 커밋에서 `git tag basket-pc-v0.1.2` 후 `git push origin basket-pc-v0.1.2`. 이 경우 빈 Release가 없어서 workflow가 직접 만든다. 7번 승인부터는 같다.

### 실패했을 때

- `verify` 실패("Tag must look like…" / "not on main"): 태그 이름이나 커밋을 고쳐야 한다. 잘못 만든 태그는 GitHub의 Releases에서 해당 Release를 지우고 태그도 지운 뒤 다시 만든다.
- `release` 중간 실패: 공개 전에 멈추므로 사용자에게 보이지 않는다. 같은 실행을 [Re-run failed jobs]로 다시 돌린다(남은 초안은 workflow가 지우고 새로 만든다).
- 같은 번호로 이미 파일이 올라간 공개 Release가 있으면 workflow가 거절한다. 새 번호로 낸다.
- 이 흐름 전체에서 서명은 하지 않는다(위 "코드 서명" 참고). 승인자(`basket-pc-release` environment)와 태그 보호(`basket-pc-tags`)는 그대로 유지한다.

## 구조

- `src/BasketDrop.Core` — 화면과 무관한 논리(대기열, 전송, 상태 전이, 제한). 윈도우 없이 테스트된다.
- `src/BasketDrop` — WinForms 트레이 프로그램(.NET 10).
- `tests/BasketDrop.Tests` — 자동 테스트(가짜 서버 포함, 운영 호출 없음).

기존 바구니 길을 그대로 쓴다: 파일 → `functions/v1/basket-files`(파일 하나씩), 글만 → REST `app_notes`. 서버·DB·Edge·Supabase 설정은 바꾸지 않는다. 공개용 키만 쓰며 서버 전용 키는 없다.

## 지키는 규칙

- 저장되었는지 모르는 건(`Unknown`)은 자동으로 다시 보내지 않는다. 사용자가 [다시 보내기]를 눌러야 한다.
- 로그에는 고정 코드와 개수만 쓴다(`LogCode`). 토큰·파일 이름·글은 로그·대기열·보낸 기록·명령 인자에 남지 않는다.
- 클립보드는 `ClipboardReader.cs` 한 곳에서만, 단축키·붙여넣기 때만 읽는다(테스트로 고정).
- 우클릭 [보내기]가 넘기는 것은 파일 경로뿐이며 이름 있는 파이프는 현재 윈도우 사용자만 연다.

## 빌드·시험

```powershell
dotnet test basket-pc/tests/BasketDrop.Tests
dotnet run --project basket-pc/src/BasketDrop
```

개발 빌드(`dotnet run`)는 설치판이 아니므로 자동 업데이트와 시작 시 자동 실행 등록을 하지 않는다.

PC에서 직접 확인하는 순서는 PR 댓글에 있다.
