# 바구니 PC드롭 (BASKET-PC드롭)

윈도우 PC 트레이에서 로그인·자동 실행·자동 업데이트를 맡고, Web2 [파일] 화면이 이 PC를 볼 수 있게 하는 작은 프로그램(글·사진·파일을 바구니로 보내는 입구 4개 — 클립보드 단축키·붙여넣기 창, 우클릭 [보내기], 화면 구석 던지기 칸, 바탕화면 칸 — 는 S54-13에서 없앴다. 폰 앱의 공유 보내기는 그대로). 설계: [docs/design/basket-pc-drop.md](../docs/design/basket-pc-drop.md). 보관 상태인 `windows-app/`와 별개의 새 폴더다.

## 지금 상태

| 있음 | 없음 |
| --- | --- |
| 트레이 아이콘, 구글 로그인·로그아웃·로그인 상태 표시(B단계) | 글·사진·파일을 바구니로 보내는 입구(S54-13에서 삭제) |
| 설치 파일(`BasketDropApp-win-Setup.exe`)·자동 업데이트·윈도우 시작 시 자동 실행(C단계) | |
| 웹2에서 이 PC 보기, 내 PC ↔ 클라우드 복사·옮기기, 내 PC 안 쓰기(아래 각 절) | |
| 예전 판이 대기열에 남긴 항목 보내기: 새로 담는 길은 없고, 로그인하면 남은 것만 자동으로 나간다. 남은 것이 있을 때만 트레이 메뉴에 [예전에 담아 둔 항목 보기]가 나타난다 | |

### 입구 4개를 없앤 뒤 (S54-13)

- 없앤 것: 클립보드 단축키·붙여넣기 창(트레이 [단축키 바꾸기] 포함), 우클릭 [보내기](`바구니 PC드롭.lnk`), 화면 구석 던지기 칸, 바탕화면 칸. 코드와 트레이 메뉴 모두 지웠다(끄기·숨김이 아님).
- 이미 설치된 PC: 업데이트 뒤 **첫 실행 때 한 번**(`LegacyEntries.CleanOnce`, 결과는 `settings.json`의 `LegacyEntriesCleaned`에 기억) 사용자 SendTo 폴더의 `바구니 PC드롭.lnk` 하나를 지우고, 대기열이 비어 있으면 낡은 보낸 기록 파일(`history.json`)을 지운다. 단축키·구석 칸·바탕화면 칸은 프로그램이 켜져 있는 동안에만 있었으므로 디스크에 남은 것이 없고, 설정 파일의 `Hotkey`·`Corner`·`DesktopTile*` 값은 다음 저장 때 저절로 빠진다. 윈도우 시작 항목은 남는 기능(자동 실행)이라 그대로 둔다.
- 대기열에 남은 항목은 지우지 않는다. 로그인하면 기존 보내기 길(`QueueProcessor`)이 보내고, 7일 넘게 못 보낸 것은 기록 창에서 사용자가 보내거나 버린다. 시작할 때 남은 개수를 알림으로 알린다.
- 프로그램 인자: 이제 아무것도 읽지 않는다(예전 우클릭 [보내기]가 파일 경로를 넘기던 길을 없앴다).

## 로그인 (B단계)

- 시스템 기본 브라우저에서 Supabase 구글 로그인 → PKCE(`code_verifier`/`code_challenge`) + 루프백 돌려받기(`http://127.0.0.1:<고정 후보 포트>/basket-drop/<일회용 state>`). 코드·state는 한 번 쓰면 수신기가 닫힌다(`LoopbackReceiver`). 이전 `auth-handoff`/`kptuwork://` 방식은 쓰지 않는다.
- **Supabase Auth 허용 주소(Redirect URLs)에 아래 항목이 있어야 로그인이 된다**(읽생기와 공유하는 설정이라 사용자가 대시보드에서 직접 추가, PR 본문 참고). 후보 포트는 `LoopbackReceiver.DefaultPorts`:
  - `http://127.0.0.1:47615/basket-drop/*`, `http://127.0.0.1:47616/basket-drop/*`, `http://127.0.0.1:47617/basket-drop/*`
- 보관: Windows 자격 증명 관리자(`BasketDrop/Supabase`)에 **새로고침 토큰 하나만**. 접근 토큰은 메모리에만, 만료 60초 전에 갱신(한 번에 한 번만 갱신).
- 로그아웃: 이 PC의 저장된 로그인을 지우고, 토큰에 세션 번호가 있을 때만 서버에 `scope=local`(이 세션 하나) 로그아웃을 요청한다. 세션 번호가 없으면 서버가 계정 전체를 로그아웃시키므로 호출하지 않는다.
- 소유자 확인: 로그인 직후 소유자 행이 보이는지 읽어 보고 아니면 저장하지 않고 안내한다. 이것은 안내용이고, 실제 권한 판정은 서버(RLS·`basket-files` 소유자 확인)가 한다.

## 웹2에서 이 PC 보기 (0.3.0, 1단계: 보기·열기만)

Web2 [파일] 화면이 이 PC의 드라이브·폴더를 볼 수 있게, 바구니 앱이 **이 PC 안에서만 열리는 작은 문**을 연다. 설계: [docs/design/files-pc-drive.md](../docs/design/files-pc-drive.md). Web2 화면 쪽('내 PC' 출처)은 시안을 고른 뒤 따로 만든다.

- 켜고 끄기: 트레이 메뉴 [웹2에서 이 PC 보기](체크 표시). **기본 꺼짐**(결정 D1). 켜 두어도 이 앱이 로그아웃 상태면 문이 닫힌다(메뉴에 '로그인하면 열려요').
- 문: `127.0.0.1`의 47620 → 47621 → 47622 중 비어 있는 첫 번호(로그인용 47615~47617과 다름). 같은 와이파이의 다른 기기에서는 보이지 않고, 윈도우 방화벽 예외도 만들지 않는다.
- 받는 요청: `Host`가 정확히 `127.0.0.1:<번호>`이고 `Origin`이 Web2 주소(`https://desk.bokdoong.com`·`https://work.bokdoong.com`·`https://bokdoong.com`) 중 하나와 정확히 같은 것만. 그리고 요청마다 Web2 로그인 토큰을 받아 Supabase `auth/v1/user`로 누구인지 확인하고, **이 앱에 로그인한 사람과 같을 때만** 답한다(확인 결과는 토큰 해시로 5분만 메모리에 둠, 토큰 자체는 저장·기록 안 함). 크롬의 '로컬 네트워크 접근' 미리 묻기에는 `Access-Control-Allow-Private-Network: true`로 답한다.
- 할 수 있는 일(`PcDoor.cs`): `GET /v1/hello`, `GET /v1/drives`(고정·이동식 드라이브), `GET /v1/list?path=`(폴더 목록, 5000개까지), `POST /v1/open`·`/v1/reveal`(`{"path":...}`). **쓰기·옮기기·지우기는 없다**(다음 단계, 휴지통으로만).
- 안 보이는 곳(`PcPath.cs`, 직접 경로로 와도 거절): 드라이브 바로 아래 `Windows`·`Program Files`·`Program Files (x86)`·`ProgramData`·`$Recycle.Bin`·`System Volume Information`·`Recovery` 등, 모든 사용자의 `AppData`, 이 앱의 자기 폴더, 숨김·시스템 속성 항목, 연결점·바로 가기 링크(따라가지 않음). 경로는 `C:\a\b` 모양만 받고 `..`·네트워크 경로·장치 이름·`:` 스트림은 디스크를 보기 전에 거절한다.
- 열기: 문서·사진·영상 등 정해진 종류만 그 PC의 기본 프로그램으로 연다. 실행 파일(.exe·.bat·.ps1 등)과 모르는 종류는 **실행하지 않고 탐색기에서 위치만** 보여 준다. 폴더는 탐색기로 연다.
- 서버로 가는 것: 토큰 확인 요청 하나뿐. 파일 이름·경로·목록은 서버로 가지 않고 로그에도 쓰지 않는다(로그는 고정 코드와 HTTP 상태 숫자만).

### 0.4.0: 내 PC ↔ 클라우드 복사·옮기기 (FILES-내PC클라우드옮기기)

- Web2 [파일]에서 사람이 누른 복사·옮기기만 받는다. 바이트는 그 PC의 브라우저가 나른다(PC → 클라우드는 지금 올리기 길, 클라우드 → PC는 Edge `media`로 받아 이 문에 씀). 문 검사(127.0.0.1·Host·Origin·매 요청 같은 계정 토큰)는 그대로다.
- 새 길(`PcDoor.cs` → `PcTransfer.cs`): `GET /v1/read?path=&at=&len=`(한 번에 4MB까지, 머리 `X-Pc-Size`), `POST /v1/write/start {dir,name,size}` → `POST /v1/write/piece?id=&at=`(바이트, 4MB까지, 순서대로만) → `POST /v1/write/finish {id,numbered}` / `POST /v1/write/cancel {id}`, `POST /v1/trash {path}`(옮기기 뒤 원본, 파일만).
- 쓰기 규칙: 받을 폴더도 보기와 같은 검사(`PcFiles.Find`)를 지난다. 새 파일은 그 폴더의 숨긴 조각 파일 `~basket-<무작위>.part`에 쓰고, 크기가 맞을 때만 이름을 준다. **있는 파일을 덮어쓰거나 지우지 않는다**: 같은 이름이면 화면이 먼저 묻고, [그래도 하기]면 '이름 (2)'. 실행 파일(.exe·.bat·.ps1 등)은 받지 않는다. 한 파일 2GB까지, 10분 동안 이어지지 않은 조각 파일은 지운다(자기 조각 파일만).
- 휴지통: 윈도우 휴지통으로만(`SHFileOperation` + 되돌리기 허용). 휴지통에 둘 수 없는 드라이브면 윈도우가 먼저 묻는다. 폴더는 보내지 않는다.
- 로그: 쓰기·휴지통이 끝난 횟수만(고정 코드). 이름·경로는 쓰지 않는다.
- 고정한 폴더(FILES-폴더고정, `PcPins.cs`): `GET /v1/pins`·`POST /v1/pins {pins:[...]}` — Web2 [파일]의 '내 PC' 고정 폴더 경로를 **이 PC 안**(이 앱 데이터 폴더 `pc-pins.json`)에만 둔다. 서버·브라우저 저장소에는 가지 않는다. 안 보이는 곳·`..`·네트워크 경로는 받지 않고, 12개까지.

### 0.5.0: 내 PC 안 이름 바꾸기·새 폴더·옮기기·복사·휴지통 (FILES-내PC쓰기)

- Web2 [파일]의 내 PC 줄도 클라우드와 같은 메뉴로 다룬다. 사람이 누른 것만 받고, hello의 `can`에 `edit`가 붙는다. 문 검사(127.0.0.1·Host·Origin·매 요청 같은 계정 토큰)는 그대로다.
- 새 길(`PcDoor.cs` → `PcEdit.cs`): `POST /v1/rename {path,name}` · `POST /v1/mkdir {dir,name}` · `POST /v1/move {path,dir,numbered}` · `POST /v1/copy {path,dir,numbered}`(파일만) → 답 `{path}`(새 경로).
- 규칙: 모든 경로는 보기와 같은 검사(`PcFiles.Find`)를, 새 이름은 받기와 같은 검사(`PcTransfer.NameCheck`: 한 이름, 프로그램 이름 거절)를 지난다. **있는 것을 덮어쓰거나 지우지 않는다**: 같은 이름이면 거절(화면이 먼저 묻고 [그래도 하기]면 `numbered`로 '이름 (2)'). 드라이브는 이름·옮기기·휴지통 대상이 아니다. 폴더는 같은 드라이브 안에서만 옮기고(다른 드라이브면 `other_drive`), 자기 안으로는 옮기지 않는다. 복사는 파일만.
- 휴지통: 이 판부터 폴더도 윈도우 휴지통으로 보낸다(드라이브는 거절, 화면이 한 번 묻는다). 영구 지우기는 없다.
- 로그: 끝난 횟수만(고정 코드 `DoorEdited`). 이름·경로는 쓰지 않는다.

## 설치·업데이트·자동 실행 (C단계)

- 도구: Velopack(자체 포함 배포). 관리자 권한 없이 `%LocalAppData%\BasketDropApp`에 설치된다. 데이터(대기열·기록·설정·로그)는 `%LocalAppData%\BasketDrop`로 설치 폴더와 분리되어, 업데이트·재설치·제거에도 남는다. 로그인은 자격 증명 관리자에 있어 업데이트·재설치 뒤에도 유지된다.
- 코드 서명은 하지 않는다. 설치 파일을 처음 실행하면 윈도우 SmartScreen 경고가 한 번 뜬다(알려진 감수 사항).
- 업데이트: 시작 20초 뒤(이후 12시간마다) 이 저장소의 릴리스 중 태그가 정확히 `basket-pc-vX.Y.Z`인 것만 확인한다(초안·시험판 제외, 가장 높은 버전). 새 판은 내려받으며 해시를 검사하고, 다음에 프로그램을 켤 때 적용된다. 바로 쓰려면 트레이 메뉴의 [새 버전으로 다시 시작]. 어느 단계든 실패하면 지금 쓰는 판이 그대로 남는다.
- 믿는 범위: 이 저장소의 릴리스 파일과 GitHub의 파일 서버뿐이다(`UpdatePolicy`, 시험으로 고정). `releases/latest`와 다른 태그·다른 저장소는 받지 않는다. 서명이 없어서 해시 목록과 파일이 같은 릴리스에 있으므로, 안전은 저장소 쓰기 권한·태그 보호·릴리스 승인에 기댄다.
- 시작 시 자동 실행: 기본 켬. 현재 사용자 `Run` 항목(관리자 권한 불필요)이며 트레이 메뉴 [윈도우를 켤 때 자동 실행]으로 끄고 켠다. 켤 때마다 현재 설치 경로로 다시 맞춘다. 윈도우 설정 [앱 > 시작 프로그램]에서 끈 것은 다시 켜지 않는다. 설치한 프로그램에서만 동작하며 개발 빌드는 등록하지 않는다.
- 제거: 시작 항목·(예전 판이 만든) 우클릭 [보내기] 항목·저장된 로그인을 지운다. 대기열·기록 폴더는 남긴다.
- 새 판 내기: 아래 "새 판 내기"를 따른다. 사용자가 하는 일은 **태그 하나 만들기**(또는 커맨드센터가 workflow를 시작했을 때는 **승인 한 번**)뿐이고, 빌드·설치 파일·Release 만들기·파일 올리기는 `Basket PC release` workflow가 한다. 비밀값은 이 실행의 자체 토큰 외에 없다.

## 새 판 내기

시작하는 길은 두 가지다. ① 태그 `basket-pc-vX.Y.Z`(예: `basket-pc-v0.1.2`)가 만들어지면 `Basket PC release` workflow가 저절로 시작한다. ② 커맨드센터(또는 사용자)가 같은 workflow를 직접 시작한다(아래 "커맨드센터가 시작하는 길"). 태그는 **main에 이미 들어간 커밋**에만 만든다(아니면 workflow가 멈춘다). 먼저 올릴 변경이 main에 merge되어 있어야 한다.

### 가장 쉬운 길: GitHub 웹 (PC·폰 모두 가능)

1. 저장소 페이지 오른쪽의 [Releases] → [Draft a new release]를 누른다.
2. [Choose a tag]에 새 태그 이름 `basket-pc-v0.1.2`를 입력하고 `Create new tag: basket-pc-v0.1.2 on publish`를 고른다. 이름은 반드시 `basket-pc-v` + 숫자.숫자.숫자 모양이다. 이전 판보다 큰 번호로 한다.
3. [Target]은 `main`으로 둔다.
4. 제목·설명은 비워 둬도 된다(workflow가 채운다).
5. 아래의 **[Set as a pre-release] 체크를 켠다.** 파일이 올라오기 전의 빈 Release가 사용 중인 프로그램의 업데이트에 보이지 않게 하는 안전장치다. 이 체크 없이 [Set as the latest release]를 쓰지 않는다.
6. [Publish release]를 누른다. (초안으로 저장만 하면 태그가 만들어지지 않아 시작되지 않는다.)
7. 저장소 [Actions] 탭 → `Basket PC release` 실행을 연다. `verify`는 자동으로 끝나고, `release`가 **승인 대기**로 멈추면 [Review deployments] → `basket-pc-release` 체크 → [Approve and deploy]를 누른다.
8. 15~20분쯤 뒤 [Releases]에 설치 파일(`BasketDropApp-win-Setup.exe`)이 붙은 공개 Release가 보이면 끝이다. workflow가 pre-release 표시를 풀고 공개한다. 사용 중인 프로그램은 12시간 안에 새 판을 받는다.

### 커맨드센터가 시작하는 길 (사용자는 승인만)

커맨드센터 세션은 태그를 만들 수 없어서(프록시) workflow를 직접 시작한다. 먼저 올릴 변경이 main에 merge되어 있어야 한다.

1. 커맨드센터가 `Basket PC release` workflow를 **main**에서 시작한다. 입력 `version`에 `0.2.0`처럼 숫자.숫자.숫자만 쓴다(`basket-pc-v`는 붙이지 않는다). 사람이 직접 하려면 [Actions] → `Basket PC release` → [Run workflow] → Branch는 `main` → version 입력.
2. `verify`가 main 최신 커밋을 기준으로 입력 모양, 같은 번호의 태그가 이미 있는지를 확인한다(문제 있으면 승인 요청 전에 멈춘다).
3. 사용자는 `release`가 **승인 대기**로 멈추면 [Review deployments] → `basket-pc-release` 체크 → [Approve and deploy]를 누른다. 이것이 사용자가 하는 일의 전부다.
4. 승인 뒤 `release`가 확인한 그 커밋에 `basket-pc-v<version>` 태그를 만들고(이미 있으면 거절), 빌드·설치 파일·Release 만들기·파일 올리기를 이어서 한다. 태그 보호(`basket-pc-tags`)는 그대로이며, 이 태그 생성이 두 번째 실행을 일으키지는 않는다.

main이 아닌 가지에서 시작하면 workflow가 거절한다.

### PC에서 명령으로

main 최신 커밋에서 `git tag basket-pc-v0.1.2` 후 `git push origin basket-pc-v0.1.2`. 이 경우 빈 Release가 없어서 workflow가 직접 만든다. 7번 승인부터는 같다.

### 실패했을 때

- `verify` 실패("Tag must look like…" / "not on main"): 태그 이름이나 커밋을 고쳐야 한다. 잘못 만든 태그는 GitHub의 Releases에서 해당 Release를 지우고 태그도 지운 뒤 다시 만든다.
- `release` 중간 실패: 공개 전에 멈추므로 사용자에게 보이지 않는다. 같은 실행을 [Re-run failed jobs]로 다시 돌린다(남은 초안은 workflow가 지우고 새로 만든다).
- 같은 번호로 이미 파일이 올라간 공개 Release가 있으면 workflow가 거절한다. 새 번호로 낸다.
- 이 흐름 전체에서 서명은 하지 않는다(위 "코드 서명" 참고). 승인자(`basket-pc-release` environment)와 태그 보호(`basket-pc-tags`)는 그대로 유지한다.

## 구조

- `src/BasketDrop.Core` — 화면과 무관한 논리(남은 대기열 보내기, 로그인, 이 PC 문, 상태 전이, 제한). 윈도우 없이 테스트된다.
- `src/BasketDrop` — WinForms 트레이 프로그램(.NET 10).
- `tests/BasketDrop.Tests` — 자동 테스트(가짜 서버 포함, 운영 호출 없음).
- `icon/basket-icon.svg` — 아이콘 원본 그림 하나(노동조합+ 아이콘 J10: 올리브 바탕·흰 '노조'·노랑 '+', Web2 아이콘 `app/app-icon.svg`와 같은 그림). `scripts/app-icon/build-app-icons.py`가 만들며, 16·20·24에서는 글자만 굵은 작은 판을 쓴다. `python3 basket-pc/tools/make-icon.py`(Pillow만 필요)가 `src/BasketDrop/app.ico`(프로그램·설치 파일·시작 메뉴·창), 트레이 상태 아이콘 3개(`tray-pending.ico` 보낼 것 대기 중 = 오른쪽 아래 주황 점, `tray-signedout.ico` 로그인 필요 = 흐린 회색, `tray-signedout-pending.ico` 둘 다), `icon/png/` 크기별 PNG, `docs/design/basket-pc-icon-preview.png` 미리보기를 다시 만든다. 그림을 바꾸면 `scripts/app-icon/build-app-icons.py`를 고쳐 돌린 뒤 이 스크립트를 돌려 결과 파일을 함께 커밋한다.
- 트레이 그림·툴팁은 `TrayStatus`(Core)가 대기열 상태와 로그인 상태에서 정하고 `TrayApp.RefreshTray` 한 곳에서만 바꾼다. 따로 저장하는 상태는 없다.

남은 항목을 보내는 길은 기존 바구니 길 그대로다: 파일 → `functions/v1/basket-files`(파일 하나씩), 글만 → REST `app_notes`. 서버·DB·Edge·Supabase 설정은 바꾸지 않는다. 공개용 키만 쓰며 서버 전용 키는 없다.

## 지키는 규칙

- 저장되었는지 모르는 건(`Unknown`)은 자동으로 다시 보내지 않는다. 사용자가 [다시 보내기]를 눌러야 한다.
- 로그에는 고정 코드와 개수만 쓴다(`LogCode`). 토큰·파일 이름·글은 로그·대기열·보낸 기록·명령 인자에 남지 않는다.
- 클립보드·키보드·마우스 위치는 읽지 않는다(입구를 없애며 코드째 지웠고, 시험으로 고정).

## 빌드·시험

```powershell
dotnet test basket-pc/tests/BasketDrop.Tests
dotnet run --project basket-pc/src/BasketDrop
```

개발 빌드(`dotnet run`)는 설치판이 아니므로 자동 업데이트와 시작 시 자동 실행 등록을 하지 않는다.

PC에서 직접 확인하는 순서는 PR 댓글에 있다.
