package kr.or.kptu.work

/**
 * APP-폰알림 N4(설계 docs/design/phone-notifications.md 3·4.4절): 폰 알림의 판단 규칙. 안드로이드 API를 쓰지 않아 JVM 단위 시험으로 확인한다.
 * - 받은 데이터 메시지(kind·title·open, family만 body)를 고르고 자르기
 * - 누르면 열 주소(open)를 웹2 안쪽 주소로만 바꾸기(아니면 첫 화면)
 * - 종류별 알림 채널·급함
 * - 웹 화면과 주고받는 다리 글(push:…)
 * - 빌드 변수(Firebase 앱 설정 4개)가 다 있는지
 * 기기 토큰은 앱이 서버에 직접 보내지 않는다. 다리로 웹 화면에 넘기고, 웹 화면이 웹 세션으로 등록한다(설계 4.4절).
 */
object PushRules {
    /** 서버(_shared/fcm-send.ts·app_push_log)가 보내는 종류와 채널 이름. 그 밖의 종류는 그리지 않는다. */
    val KINDS: Map<String, String> = linkedMapOf(
        "task_due" to "할 일 기한",
        "commitment" to "원장 약속",
        "meeting_done" to "회의 요약 완료",
        "collect_stall" to "수집 멈춤",
        "morning" to "아침 묶음",
        "evening" to "저녁 묶음",
        "next_week" to "다음 주 준비",
        "quiet_digest" to "조용한 시간 묶음",
        "test" to "시험 알림",
        // FAMILY-잊지말기 4단계: "잊지 말기 n건"(제목만, 잠금 화면은 PUBLIC_TITLE). 묶음처럼 보통(급하지 않음).
        // FAMILY-기억알림 ②: 월요일 '가족 · 이번 주 기억할 것 n'(본문 있음 → 잠금 화면에도 그대로, BODY_KINDS).
        "family" to "잊지 말기",
    )

    /** 바로 알리는 종류(설계 8절: 우선순위 높음은 즉시 알림 4종 + 시험). 묶음은 보통. */
    private val URGENT: Set<String> = setOf("task_due", "commitment", "meeting_done", "collect_stall", "test")

    const val CHANNEL_PREFIX = "push_"
    const val ACTION_OPEN = "kr.or.kptu.work.PUSH_OPEN"
    const val EXTRA_OPEN = "open"
    /** 잠금 화면에 보이는 글(설계 N-D4: 내용 숨김). */
    const val PUBLIC_TITLE = "웹2 · 새 알림"
    const val MAX_TITLE = 80
    /** 본문을 그리는 종류(서버 fcm-send.ts BODY_KINDS와 같음). 명진 결정 11/12 "보이기": 이 종류는 본문이 있으면 잠금 화면에도 그대로 보인다. */
    val BODY_KINDS: Set<String> = setOf("family")
    const val MAX_BODY = 160

    /** 서버 OPEN_PATH와 같은 모양: /work/app/ + 선택 질의(영문·숫자·_=&%.-, 200자까지). */
    private val OPEN = Regex("^/work/app/(\\?[A-Za-z0-9_=&%.-]{0,200})?$")
    /** phone-push register가 받는 토큰 모양(handler.ts TOKEN). */
    private val TOKEN = Regex("^[A-Za-z0-9_:-]{20,4096}$")
    /** 빌드 변수 값 모양(Firebase project id·app id·sender id·API key). 그 밖의 글은 설정 없음으로 본다. */
    private val CONFIG = Regex("^[A-Za-z0-9:._-]{1,200}$")

    data class Message(val kind: String, val title: String, val open: String, val body: String = "") {
        val urgent: Boolean get() = kind in URGENT
        val channel: String get() = channelId(kind)
        /** 잠금 화면에 글을 그대로 보이는지: 본문을 그리는 종류이면서 본문이 있을 때만. 그 밖에는 PUBLIC_TITLE(내용 숨김). */
        val showOnLock: Boolean get() = kind in BODY_KINDS && body.isNotEmpty()
    }

    fun channelId(kind: String): String = CHANNEL_PREFIX + kind

    fun urgent(kind: String): Boolean = kind in URGENT

    /** 데이터 메시지 → 그릴 알림. 모르는 종류·빈 제목은 null. 이상한 open은 첫 화면. 제목·본문은 한 줄로 자른다. 본문은 BODY_KINDS만(그 밖은 버림). */
    fun message(data: Map<String, String>?): Message? {
        if (data == null) return null
        val kind = data["kind"] ?: return null
        if (kind !in KINDS) return null
        val title = oneLine(data["title"], MAX_TITLE)
        if (title.isEmpty()) return null
        val body = if (kind in BODY_KINDS) oneLine(data["body"], MAX_BODY) else ""
        val open = data["open"]?.takeIf { OPEN.matches(it) } ?: "/work/app/"
        return Message(kind, title, open, body)
    }

    private fun oneLine(raw: String?, max: Int): String {
        val one = (raw ?: "").replace(Regex("[\\u0000-\\u001f\\u007f]+"), " ").replace(Regex("\\s+"), " ").trim()
        return if (one.codePointCount(0, one.length) > max) one.substring(0, one.offsetByCodePoints(0, max - 1)) + "…" else one
    }

    /** 누르면 열 주소. 허용 모양이 아니면 첫 화면. 결과는 늘 ShellRules.isInternalApp을 통과한다. */
    fun openUrl(path: String?): String {
        if (path == null || !OPEN.matches(path)) return ShellRules.HOME
        val url = "https://" + ShellRules.WEB2_HOST + path
        return if (ShellRules.isInternalApp(url)) url else ShellRules.HOME
    }

    /** 같은 종류·같은 자리는 같은 알림 번호(새 것이 앞 것을 바꾼다). 다른 앱 알림 번호(녹음·업데이트)와 겹치지 않게 큰 수 쪽에 둔다. */
    fun notifyId(m: Message): Int = 0x50000000 or ((m.kind + "|" + m.open).hashCode() and 0x0FFFFFFF)

    // ── APP-알림숫자지우기: 남은 폰 알림 지우기(갤럭시 아이콘 숫자 = 알림창에 남은 웹2 알림 수) ──

    /** 서버가 붙인 알림 자리 표시(open의 notice=종류.열쇠, 인코딩된 그대로). 알림 꼬리표(tag)로 써서 웹2 안에서 그 자리를 열면 그 알림만 지운다. 없으면 null. */
    fun noticeTag(open: String?): String? {
        if (open == null) return null
        val q = open.indexOf('?')
        if (q < 0) return null
        val raw = open.substring(q + 1).split('&').firstOrNull { it.startsWith("notice=") }?.removePrefix("notice=") ?: return null
        return raw.takeIf { NOTICE_KEY.matches(it) }
    }

    /** 웹이 보낸 push:clear:<종류>.<열쇠> → 지울 꼬리표. 모양이 아니면 null(아무것도 지우지 않음). */
    fun clearKey(data: String?): String? {
        if (data == null || !data.startsWith(CLEAR_PREFIX)) return null
        return data.removePrefix(CLEAR_PREFIX).takeIf { NOTICE_KEY.matches(it) }
    }

    /** 지워도 되는 알림인지: 폰 알림(push_ 채널)만. 녹음(recording)·앱 업데이트(app_update) 알림은 지우지 않는다. */
    fun clearable(channelId: String?): Boolean = channelId != null && channelId.startsWith(CHANNEL_PREFIX)

    const val CLEAR_PREFIX = "push:clear:"
    /** 종류(영문 소문자·_) + "." + 열쇠(서버가 encodeURIComponent한 모양: 영문·숫자·_.-%). */
    private val NOTICE_KEY = Regex("^[a-z_]{1,20}\\.[A-Za-z0-9_.%-]{1,240}$")

    fun tokenOk(token: String?): Boolean = token != null && TOKEN.matches(token)

    /** Firebase 앱 설정 4개가 모두 모양에 맞을 때만 알림 기능을 켠다(PR CI debug 빌드는 비어 있어 꺼진 채로 돈다). */
    fun configOk(projectId: String, appId: String, senderId: String, apiKey: String): Boolean =
        listOf(projectId, appId, senderId, apiKey).all { CONFIG.matches(it) }

    // ── 웹 화면 다리(KPTUAppShell, 허용 Origin 최상위 화면만) ──

    enum class Ask { HELLO, ENABLE, FORGET }

    /** 웹이 보낸 글 → 할 일. push:hello(상태 묻기), push:enable(이 폰에서 받기: 권한 묻기 + 토큰), push:forget(이 폰 끊기). */
    fun ask(data: String?): Ask? = when (data) {
        "push:hello" -> Ask.HELLO
        "push:enable" -> Ask.ENABLE
        "push:forget" -> Ask.FORGET
        else -> null
    }

    /** 앱 → 웹. none: 이 판은 알림을 못 받음(설정 없음), off: 이 폰에서 꺼짐, denied: 알림 허용 안 됨, fail: 토큰을 못 받음, on:<토큰>. */
    const val STATE_NONE = "push:none"
    const val STATE_OFF = "push:off"
    const val STATE_DENIED = "push:denied"
    const val STATE_FAIL = "push:fail"

    fun onMessage(token: String?): String = if (tokenOk(token)) "push:on:$token" else STATE_FAIL

    /** 지금 상태 글. configured=빌드 설정 있음, enabled=이 폰에서 받기로 함, canPost=알림 허용됨. 토큰이 필요하면 null(토큰을 받아 onMessage로). */
    fun state(configured: Boolean, enabled: Boolean, canPost: Boolean): String? = when {
        !configured -> STATE_NONE
        !enabled -> STATE_OFF
        !canPost -> STATE_DENIED
        else -> null
    }
}
