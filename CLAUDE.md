# CLAUDE.md

@AGENTS.md

규칙 원문은 위에서 불러온 `AGENTS.md` 하나다. 이 파일에는 Claude Code 전용 내용만 두고, 규칙을 복사하지 않는다. 규칙을 바꿀 때는 `AGENTS.md`를 고친다.

## Claude Code 전용

- 세션 판별: `mcp__supabase__*` 도구가 보이면 Claude Code 로컬, 없으면 Claude Code 웹으로 본다(`AGENTS.md` 1절).
- 로컬 세션의 Supabase MCP는 사용자 설정(저장소 밖)에 조회 전용·이 프로젝트 한정(`read_only=true`, `project_ref`)으로 등록되어 있다. 쓰기 도구(`apply_migration` 등)는 쓰지 않는다.
- 규칙 로드 확인: 새 세션에서 `/memory`를 열어 `CLAUDE.md`와 함께 `AGENTS.md`가 불러와졌는지 본다.

## 사용량 절약 (Claude Code 전용)

- 모델: 기본값은 `.claude/settings.json`의 `opusplan`(계획 모드는 Opus, 실행은 Sonnet). Opus가 필요한 일은 구조 설계, 원인 불명 디버깅, DB migration·RLS·권한 검토, 보안 판단뿐이다(`/model opus`). 조사·단순 수정·테스트 실행·문서 정리는 Sonnet으로 한다.
- 읽는 양: 큰 파일은 통째로 읽지 말고 검색 후 필요한 부분만 읽는다. 넓은 조사는 하위 에이전트에 맡기고 결론만 받는다. 긴 로그·테스트 출력은 실패 부분만 본다.
- 작업 하나가 끝나면 다음 작업은 새 대화(`/clear`)로 시작하고, 긴 작업 중간에는 `/compact`를 쓴다.
- 같은 명령이 두 번 실패하면 반복하지 말고 멈춰서 원인을 보고한다.
- 남은 사용량: 세션을 시작할 때와 끝낼 때 `/usage`로 확인한다.
