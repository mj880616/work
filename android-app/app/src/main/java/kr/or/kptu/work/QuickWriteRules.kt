package kr.or.kptu.work

/**
 * APP-위젯빠른쓰기: 위젯 빠른 쓰기 창이 서버로 보내는 '새 글 넣기' 세 가지(설계 docs/design/phone-widget-auth.md 13절).
 * 안드로이드 API를 쓰지 않아 JVM 시험 대상이다. 지우기·고치기·다른 표는 만들지 않는다.
 * - 업데이트(정리함): POST rest/v1/app_notes {workspace_id, raw_text} — 웹 basket-data.js createNote와 같은 길.
 * - 노트: POST rest/v1/app_notes {workspace_id, kind:"note", title, raw_text} — 웹 createNoteDoc와 같은 길.
 * - 할 일: POST functions/v1/google-tasks?action=create {action:"create", title, notes, due:null} — 웹 할 일 만들기와 같은 길.
 * 글은 메모리에만 있고 폰에 저장하지 않는다(서버 저장 원칙). 로그·오류에도 글을 싣지 않는다.
 */
object QuickWriteRules {
    /** 표 검사와 같은 길이(app_notes raw_text 1~20000, 노트 본문 100000, 노트 제목 200). 할 일 제목은 구글 한도 안쪽. */
    const val UPDATE_MAX = 20000
    const val NOTE_MAX = 100000
    const val NOTE_TITLE_MAX = 200
    const val TASK_TITLE_MAX = 1024
    const val TASK_NOTES_MAX = 8192

    data class Request(val url: String, val body: String, val prefer: String?)

    sealed class Check {
        object Ok : Check()
        data class Bad(val reason: String) : Check()
    }

    private fun length(s: String): Int = s.codePointCount(0, s.length)

    private fun cut(s: String, max: Int): String {
        if (length(s) <= max) return s
        return s.substring(0, s.offsetByCodePoints(0, max))
    }

    /** 첫 줄(앞뒤 빈칸 뺌). 노트 제목·할 일 제목. */
    fun firstLine(text: String): String = text.trim().lineSequence().firstOrNull()?.trim().orEmpty()

    /** 보내기 전에 앱이 먼저 막는 것(빈 글·너무 긴 글). */
    fun check(kind: WidgetAction, text: String): Check {
        if (text.isBlank()) return Check.Bad("내용을 입력해 주세요")
        val max = when (kind) {
            WidgetAction.UPDATE -> UPDATE_MAX
            WidgetAction.NOTE -> NOTE_MAX
            WidgetAction.TASK -> TASK_TITLE_MAX + TASK_NOTES_MAX
            else -> return Check.Bad("이 칸은 빠른 쓰기가 없어요")
        }
        if (length(text) > max) return Check.Bad("글이 너무 길어요 · [크게 열기]로 써 주세요")
        return Check.Ok
    }

    /** 종류·글·작업공간 → 보낼 요청 하나. 본문은 정해진 칸만 넣어 앱이 만든다(글은 JSON 문자열로만 들어감). */
    fun request(kind: WidgetAction, text: String, workspaceId: String): Request {
        require(WidgetRules.isUserId(workspaceId))
        require(check(kind, text) == Check.Ok)
        val ws = ShellRules.jsonString(workspaceId)
        return when (kind) {
            WidgetAction.UPDATE -> Request(WidgetRules.NOTES, "{\"workspace_id\":$ws,\"raw_text\":${ShellRules.jsonString(text)}}", PREFER)
            WidgetAction.NOTE -> {
                val title = cut(firstLine(text), NOTE_TITLE_MAX).ifEmpty { "새 노트" }
                Request(
                    WidgetRules.NOTES,
                    "{\"workspace_id\":$ws,\"kind\":\"note\",\"title\":${ShellRules.jsonString(title)},\"raw_text\":${ShellRules.jsonString(text)}}",
                    PREFER,
                )
            }
            WidgetAction.TASK -> {
                val title = cut(firstLine(text), TASK_TITLE_MAX)
                val notes = cut(text.trim().lineSequence().drop(1).joinToString("\n").trim(), TASK_NOTES_MAX)
                Request(
                    WidgetRules.TASK_CREATE,
                    "{\"action\":\"create\",\"title\":${ShellRules.jsonString(title)},\"notes\":${ShellRules.jsonString(notes)},\"due\":null}",
                    null,
                )
            }
            else -> throw IllegalArgumentException("kind")
        }
    }

    /** app_notes 쓰기는 돌려받지 않는다(Prefer 값은 이것 하나만 보낸다). */
    const val PREFER = "return=minimal"

    /** 저장 뒤 짧은 알림. */
    fun saved(kind: WidgetAction): String = when (kind) {
        WidgetAction.UPDATE -> "정리함에 넣었어요"
        WidgetAction.TASK -> "할 일에 넣었어요"
        WidgetAction.NOTE -> "노트에 넣었어요"
        else -> "저장했어요"
    }

    /** 창 입력칸 안내. */
    fun hint(kind: WidgetAction): String = when (kind) {
        WidgetAction.UPDATE -> "업데이트 입력(정리함에 저장)"
        WidgetAction.TASK -> "할 일 제목(둘째 줄부터 메모)"
        WidgetAction.NOTE -> "노트(첫 줄이 제목)"
        else -> ""
    }

    /** 서버 답 → 성공 여부. 할 일은 ok:true까지 본다. */
    fun success(kind: WidgetAction, status: Int, body: Any?): Boolean = when (kind) {
        WidgetAction.TASK -> status == 200 && MiniJson.obj(body)?.get("ok") == true
        else -> status == 201 || status == 200 || status == 204
    }

    /** 실패 이유 한 줄(글·응답 원문은 싣지 않는다). */
    fun reason(kind: WidgetAction, status: Int, body: Any?): String {
        val message = MiniJson.str(MiniJson.obj(body)?.get("error")) ?: ""
        return when {
            kind == WidgetAction.TASK && message.contains("연결되지") -> "할 일 연결이 필요해요 · [크게 열기]"
            kind == WidgetAction.TASK && (message.contains("TASKS_SCOPE") || message.contains("다시 연결")) -> "할 일을 다시 연결해 주세요 · [크게 열기]"
            status == 403 -> "저장 권한을 확인하지 못했어요 · [크게 열기]"
            status in 500..599 -> "서버가 잠시 답하지 않아요 · 다시 저장"
            else -> "저장하지 못했어요($status) · 다시 저장"
        }
    }

    const val NETWORK = "인터넷 연결을 확인해 주세요 · 다시 저장"
    const val SIGNED_OUT = "위젯 로그인이 풀렸어요 · [크게 열기]로 저장"
    const val NO_WORKSPACE = "작업공간을 확인하지 못했어요 · [크게 열기]"
}
