# 바구니 PC드롭 (BASKET-PC드롭)

윈도우 PC에서 글·사진·파일을 Web2 바구니로 던지는 작은 프로그램. 설계: [docs/design/basket-pc-drop.md](../docs/design/basket-pc-drop.md). 보관 상태인 `windows-app/`와 별개의 새 폴더다.

## 지금 상태: 1차 시험판 A단계

| 있음 | 없음(다음 단계) |
| --- | --- |
| 트레이 아이콘, 붙여넣기 창(Ctrl+V → 미리보기 → 메모 한 줄 → Ctrl+Enter) | **구글 로그인(B단계)** — 지금은 로그인이 없어 PC에서 서버로 나가는 것이 없다 |
| 클립보드 단축키 Ctrl+Shift+B(누를 때만 읽음) | 설치형 포장·자동 업데이트(C단계) |
| 우클릭 [보내기](트레이 메뉴에서 켜고 끔) | 구석 반응·위젯(3단계) |
| 보낸 기록·대기열 창, 작은 알림 | |
| 오프라인 대기열(2GB 상한, 성공 즉시 삭제, 7일 지나면 버릴지 확인) | |

로그인이 없는 동안 보낸 것은 "로그인이 필요해요" 상태로 PC에 보관된다. B단계에서 로그인 구현(`IAuthProvider`)이 들어오면 그대로 이어서 나간다.

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

PC에서 직접 확인하는 순서는 PR 댓글에 있다.
