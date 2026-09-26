# CLAUDE.md

@AGENTS.md

규칙 원문은 위에서 불러온 `AGENTS.md` 하나다. 이 파일에는 Claude Code 전용 내용만 두고, 규칙을 복사하지 않는다. 규칙을 바꿀 때는 `AGENTS.md`를 고친다.

## Claude Code 전용

- 세션 판별: `mcp__supabase__*` 도구가 보이면 Claude Code 로컬, 없으면 Claude Code 웹으로 본다(`AGENTS.md` 1절).
- 로컬 세션의 Supabase MCP는 사용자 설정(저장소 밖)에 조회 전용·이 프로젝트 한정(`read_only=true`, `project_ref`)으로 등록되어 있다. 쓰기 도구(`apply_migration` 등)는 쓰지 않는다.
- 규칙 로드 확인: 새 세션에서 `/memory`를 열어 `CLAUDE.md`와 함께 `AGENTS.md`가 불러와졌는지 본다.
