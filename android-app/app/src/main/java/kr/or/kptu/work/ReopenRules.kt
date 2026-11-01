package kr.or.kptu.work

/**
 * APP-다시열림(요청함 11/01 13:43): 앱이 웹2 화면을 통째로 다시 연(첫 화면 '업무 공간을 확인하고 있습니다.'가 뜬) 까닭을 남긴다.
 * - 종류와 시각만 남긴다. 주소·내용·사람 정보는 남기지 않는다.
 * - 앱 메모리에만 둔다(기기 저장 없음). 앱이 꺼졌다 다시 켜지면 비고, 그 첫 기록이 'restore'(밖에서 꺼졌다 복원)·'start'(처음 켬)다.
 * - 웹2는 프로필의 '다시 연 기록'에서 'reopen:list'로 묻고 'reopen:list:<종류>@<시각ms>,…'를 받는다.
 * - 웹2가 스스로 다시 열기 직전에는 'reopen:mark:<종류>'를 보낸다(당겨서 새로고침·새 버전·로그인 바뀜 등).
 * 안드로이드 API를 쓰지 않아 JVM 단위 시험으로 확인한다.
 */
object ReopenRules {
    /** 앱이 다시 연 까닭(앱 쪽). */
    val APP_KINDS: Set<String> = setOf(
        "start",    // 앱을 처음 켬
        "restore",  // 안드로이드가 뒤에 있던 앱을 끄고, 돌아올 때 다시 만듦
        "recreate", // 앱은 살아 있는데 화면(Activity)만 다시 만들어짐(설정 바뀜 등)
        "engine",   // 화면 엔진(웹뷰)이 죽어 다시 만듦
        "push",     // 폰 알림을 눌러 열었는데 화면 안 이동을 못 함
        "link",     // 웹2 링크로 열었는데 화면 안 이동을 못 함
        "widget",   // 위젯으로 열었는데 화면 안 이동을 못 함
        "share",    // 공유로 받음(화면이 없을 때)
        "signin",   // 로그인·캘린더 연결 복귀
        "pull",     // 당겨서 새로고침(웹 다리 없는 옛 화면)
    )

    /** 웹2가 스스로 다시 열기 직전에 알리는 까닭. */
    val WEB_KINDS: Set<String> = setOf(
        "pull",     // 당겨서 새로고침
        "version",  // 새 버전 [새로고침]
        "session",  // 로그인한 사람이 바뀜
        "bfcache",  // 뒤로가기로 돌아온 화면 확인
        "retry",    // 첫 화면 [다시 시도]
    )

    /** 까닭을 모를 때: 웹 화면이 스스로 옮겨 감. 로그인 화면이면 'login'. */
    const val WEB = "web"
    const val LOGIN = "login"
    const val MAX = 30
    /** 까닭 표시는 이 안에 시작한 다시 열기에만 붙인다. */
    const val MARK_WINDOW_MS = 10_000L
    const val ASK_LIST = "reopen:list"
    private const val MARK_PREFIX = "reopen:mark:"

    /** 웹이 보낸 'reopen:mark:<종류>' → 종류. 모르는 종류는 null. */
    fun webMark(data: String?): String? {
        if (data == null || !data.startsWith(MARK_PREFIX)) return null
        return data.substring(MARK_PREFIX.length).takeIf { it in WEB_KINDS }
    }

    /** 앱 쪽 시작 까닭. 저장 상태가 없으면 처음 켬, 있으면 프로세스가 새것인지로 나눈다. 엔진이 죽어 다시 만든 것은 앞서 표시(engine)한다. */
    fun createKind(hasSavedState: Boolean, freshProcess: Boolean): String = when {
        !hasSavedState -> "start"
        freshProcess -> "restore"
        else -> "recreate"
    }

    fun listMessage(entries: List<Entry>): String =
        "reopen:list:" + entries.joinToString(",") { it.kind + "@" + it.at }

    data class Entry(val kind: String, val at: Long)

    /** 메모리 기록장. 다시 열기 직전에 expect(까닭), 웹2 화면이 실제로 열리기 시작하면 started()로 한 줄 남긴다. */
    class Log(private val max: Int = MAX) {
        private var pending: Entry? = null
        private val entries = ArrayDeque<Entry>()

        @Synchronized
        fun expect(kind: String, now: Long) {
            if (kind in APP_KINDS || kind in WEB_KINDS) pending = Entry(kind, now)
        }

        /** 웹2 화면이 열리기 시작함(최상위). 표시된 까닭이 없거나 오래됐으면 web/login. 남긴 종류를 돌려준다. */
        @Synchronized
        fun started(now: Long, loginPage: Boolean): String {
            val mark = pending?.takeIf { now - it.at in 0..MARK_WINDOW_MS }
            pending = null
            val kind = when {
                mark != null -> mark.kind
                loginPage -> LOGIN
                else -> WEB
            }
            entries.addLast(Entry(kind, now))
            while (entries.size > max) entries.removeFirst()
            return kind
        }

        @Synchronized
        fun snapshot(): List<Entry> = entries.toList()
    }
}

/** 앱 프로세스 하나에 하나. 프로세스가 끝나면 함께 비고, 새 프로세스의 첫 화면이 그 사실(restore/start)을 남긴다. */
object ReopenBook {
    val log = ReopenRules.Log()
    /** 이 프로세스에서 아직 화면(Activity)을 만든 적이 없음. */
    @Volatile var freshProcess = true
    /** 화면 엔진이 죽어 화면을 다시 만드는 중(onRenderProcessGone → recreate). */
    @Volatile var engineGone = false
}
