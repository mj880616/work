package kr.or.kptu.work

import java.io.File
import java.io.IOException
import java.net.URLEncoder

/** 위젯 세션의 새로고침 토큰을 두는 곳. 기기에서는 KeystoreVault(Android Keystore 암호화), 시험에서는 메모리. */
interface WidgetVault {
    fun exists(): Boolean
    fun read(): String?
    @Throws(Exception::class)
    fun write(value: String)
    fun clear()
}

/**
 * 위젯이 부를 수 있는 주소와 로그인 주소(설계 docs/design/phone-widget-auth.md 3·4·6절).
 * 위젯 코드가 만드는 요청은 여기 적은 것뿐이다(WidgetAuthTest·WidgetWeekTest·WidgetRefreshTest가 고정).
 */
object WidgetRules {
    const val SUPABASE = "https://xmlkxfjeagycwttklxjw.supabase.co"
    /** 공개용(publishable) 키. 웹 runtime-client.js와 같은 값이고 비밀이 아니다. 권한은 로그인 토큰과 서버 규칙이 정한다. */
    const val PUBLIC_KEY = "sb_publishable_X-0lXJztIQUriUidBZ1PLQ_QemTRSpA"
    /** auth-handoff 허용 Origin 중 하나. 앱은 웹2 화면(bokdoong.com)의 일부로서 이 값을 밝힌다(설계 4절 A안, 서버 변경 없음). */
    const val ORIGIN = "https://" + ShellRules.WEB2_HOST
    /** WidgetLoginActivity(내보내지 않음)가 MainActivity를 열 때 쓰는 동작. 표시가 살아 있을 때만 로그인 탭을 연다. */
    const val ACTION_WIDGET_LOGIN = "kr.or.kptu.work.action.WIDGET_LOGIN"

    const val HANDOFF = "$SUPABASE/functions/v1/auth-handoff"
    const val TOKEN = "$SUPABASE/auth/v1/token?grant_type=refresh_token"
    const val LOGOUT = "$SUPABASE/auth/v1/logout?scope=local"
    const val CALENDAR_PREFIX = "$SUPABASE/functions/v1/google-calendar?action=events&timeMin="
    const val TASKS = "$SUPABASE/functions/v1/google-tasks?action=overview"
    /**
     * APP-위젯다시: '지금' 위젯의 '나한테 온 요청'·'챙길 것' 줄(건수 + 한 줄). 웹 inbox-count.js와 같은 처리 전 후보 읽기.
     * 기존 소유자 RLS(app_todo_candidates)가 이 사람 작업공간 줄만 준다. 두 칸(종류·한 줄)만 읽는다.
     */
    const val CANDIDATES = "$SUPABASE/rest/v1/app_todo_candidates?status=eq.open&select=source_kind,summary&order=created_at.desc&limit=100"
    /**
     * APP-위젯빠른쓰기(설계 13절): '새 글 넣기' 세 가지만. app_notes는 물음표 없는 정확한 주소 하나(필터를 붙인 일괄 요청 불가),
     * 할 일은 google-tasks create 하나. 작업공간 확인은 위젯 세션 사용자 id로 읽는 한 줄(기존 소유자 RLS).
     */
    const val NOTES = "$SUPABASE/rest/v1/app_notes"
    const val TASK_CREATE = "$SUPABASE/functions/v1/google-tasks?action=create"
    private const val WORKSPACE_PREFIX = "$SUPABASE/rest/v1/app_workspace_members?user_id=eq."
    private const val WORKSPACE_SUFFIX = "&select=workspace_id&limit=1"

    /**
     * APP-위젯빠른쓰기 [사진] 뒤에서 올리기: 정리함 첨부 올리기(웹 basket-upload.js uploadBatch와 같은 길). 물음표 없는 정확한 주소에
     * multipart(파일 하나 + 이어 붙일 때 note_id)만 보낸다. 같은 주소의 JSON(글자 읽기)·action(지우기·사진 보기·정리)은 보내지 않는다.
     */
    const val BASKET_FILES = "$SUPABASE/functions/v1/basket-files"

    /**
     * multipart 모양 검사: basket-files POST에만, 본문 글 없이, 'file' 파일 칸 정확히 하나 + 선택 'note_id'(uuid) 하나.
     * 그 밖의 칸·다른 주소의 multipart·basket-files의 JSON 본문은 모두 거절한다.
     */
    fun allowedParts(method: String, url: String, body: String?, parts: List<WidgetPart>?): Boolean {
        if (parts == null) return url != BASKET_FILES
        if (method != "POST" || url != BASKET_FILES || body != null) return false
        val files = parts.filter { it.name == "file" }
        val notes = parts.filter { it.name == "note_id" }
        if (files.size != 1 || notes.size > 1 || files.size + notes.size != parts.size) return false
        val f = files[0]
        if (f.file == null || f.value != null || f.fileName.isNullOrEmpty()) return false
        return notes.all { it.file == null && isUserId(it.value) }
    }

    fun workspaceUrl(userId: String): String {
        require(isUserId(userId))
        return WORKSPACE_PREFIX + userId + WORKSPACE_SUFFIX
    }

    private fun isWorkspaceUrl(url: String): Boolean =
        url.startsWith(WORKSPACE_PREFIX) && url.endsWith(WORKSPACE_SUFFIX) &&
            isUserId(url.substring(WORKSPACE_PREFIX.length, url.length - WORKSPACE_SUFFIX.length))

    /** WIDGET-여러개 ③ 아스날: 공개 정적 파일(앱 아스날 화면과 같은 자료). 로그인 토큰을 붙이지 않는다(readPublic). */
    const val ARSENAL = ShellRules.HOME + "arsenal/matches.js"

    /** 단계 ①과 같은 로그인 주소(돌아올 주소가 같아 Supabase 허용 주소를 늘리지 않는다). */
    val LOGIN_URL: String =
        "$SUPABASE/auth/v1/authorize?provider=google&redirect_to=" +
            URLEncoder.encode(ShellRules.HOME + "native-callback.html?native=android", "UTF-8")

    private val HANDOFF_VALUE = Regex("^[A-Za-z0-9_-]{16,32768}$")
    private val UUID = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", RegexOption.IGNORE_CASE)
    private val ISO = Regex("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z$")

    fun isHandoff(value: String?): Boolean = value != null && HANDOFF_VALUE.matches(value)

    fun isUserId(value: String?): Boolean = value != null && UUID.matches(value)

    fun calendarUrl(timeMin: String, timeMax: String): String {
        require(ISO.matches(timeMin) && ISO.matches(timeMax))
        return CALENDAR_PREFIX + URLEncoder.encode(timeMin, "UTF-8") + "&timeMax=" + URLEncoder.encode(timeMax, "UTF-8")
    }

    /** 위젯이 보내도 되는 요청인지. 이 밖의 주소·방식은 보내지 않는다. */
    fun allowed(method: String, url: String): Boolean = when (method) {
        "POST" -> url == HANDOFF || url == TOKEN || url == LOGOUT || url == NOTES || url == TASK_CREATE || url == BASKET_FILES
        "GET" -> url == TASKS || url == CANDIDATES || url == ARSENAL || isCalendarUrl(url) || isWorkspaceUrl(url)
        else -> false
    }

    private fun isCalendarUrl(url: String): Boolean {
        if (!url.startsWith(CALENDAR_PREFIX)) return false
        val rest = url.substring(CALENDAR_PREFIX.length).split("&timeMax=")
        if (rest.size != 2) return false
        val a = java.net.URLDecoder.decode(rest[0], "UTF-8")
        val b = java.net.URLDecoder.decode(rest[1], "UTF-8")
        return ISO.matches(a) && ISO.matches(b) && URLEncoder.encode(a, "UTF-8") == rest[0] && URLEncoder.encode(b, "UTF-8") == rest[1]
    }
}

/**
 * 위젯 로그인 줄을 눌렀을 때의 단계(설계 docs/design/phone-widget-auth.md 12절). 안드로이드 API 없이 시험한다.
 * WAITING: 웹2 화면의 'widget:ready'(로그인됨)를 기다림 → MINTING: 'widget:mint'를 보내고 봉인을 기다림 → 봉인이 오면 IDLE.
 * 웹 화면이 로그아웃(로그인 화면)·실패·시간 초과면 FALLBACK(구글 로그인 탭). FALLBACK은 곧바로 IDLE로 돌린다.
 */
object WidgetLoginFlow {
    enum class Step { IDLE, WAITING, MINTING, FALLBACK }
    enum class Event { WEB_READY, WEB_SIGNED_OUT, MINT_FAILED, TIMEOUT, HANDOFF }

    fun next(step: Step, event: Event): Step = when (step) {
        Step.WAITING -> when (event) {
            Event.WEB_READY -> Step.MINTING
            Event.HANDOFF -> Step.WAITING
            else -> Step.FALLBACK
        }
        Step.MINTING -> when (event) {
            Event.HANDOFF -> Step.IDLE
            Event.WEB_READY -> Step.MINTING
            else -> Step.FALLBACK
        }
        Step.IDLE, Step.FALLBACK -> step
    }
}

/**
 * 위젯 전용 로그인 세션(같은 사용자의 두 번째 세션, 설계 2·3·5절).
 * - 새로고침 토큰: vault(암호화)에만. 접근 토큰: 메모리에만. 로그인 표시: 메모리에만, 10분·한 번.
 * - 토큰 갱신은 잠금 하나로 묶고, 새 토큰을 먼저 저장한 뒤 쓴다.
 * - 토큰·응답 본문은 어디에도 출력하지 않는다.
 */
class WidgetSession(
    private val http: WidgetHttp,
    private val vault: WidgetVault,
    private val now: () -> Long = System::currentTimeMillis,
) {
    sealed class Outcome<out T> {
        data class Ok<T>(val value: T) : Outcome<T>()
        /** 위젯 로그인이 없거나 끊김. 위젯은 "로그인" 줄로 돌아간다. */
        object SignedOut : Outcome<Nothing>()
        /** 네트워크·서버 일시 오류. 토큰은 지우지 않고 다음 갱신을 기다린다. */
        data class Failed(val reason: String) : Outcome<Nothing>()
    }

    data class Raw(
        val calendarStatus: Int,
        val calendar: Any?,
        val tasksStatus: Int,
        val tasks: Any?,
        /** WIDGET-여러개 ②: 처리 전 후보(건수용). 읽지 않았으면 0. */
        val candidatesStatus: Int = 0,
        val candidates: Any? = null,
    )

    /** 읽기 한 건의 답(상태·JSON). */
    data class Reply(val status: Int, val body: Any?)

    private val lock = Any()
    private var access: String? = null
    private var accessUntil = 0L
    private var loginSince = 0L

    // ── 로그인 표시(설계 3절 1·3) ──

    fun beginLogin() {
        synchronized(lock) { loginSince = now() }
    }

    fun loginPending(): Boolean = synchronized(lock) { fresh(loginSince) }

    /** 표시를 세운 시각(없으면 0). 화면 상태 저장(savedInstanceState)에 시각만 넣는다(비밀 아님, 폰 저장소에 쓰지 않음). */
    fun loginStartedAt(): Long = synchronized(lock) { if (fresh(loginSince)) loginSince else 0L }

    /** 화면이 다시 만들어질 때 저장해 둔 시각을 잇는다. 10분이 지났거나 미래 시각이면 무시한다. */
    fun resumeLogin(since: Long) {
        synchronized(lock) { if (loginSince <= 0L && fresh(since)) loginSince = since }
    }

    /** 표시가 살아 있으면 true를 돌려주고 지운다(한 번만). */
    fun takeLogin(): Boolean = synchronized(lock) {
        val ok = fresh(loginSince)
        loginSince = 0L
        ok
    }

    private fun fresh(since: Long): Boolean {
        if (since <= 0L) return false
        val age = now() - since
        return age in 0..LOGIN_WINDOW_MS
    }

    fun signedIn(): Boolean = vault.exists()

    // ── handoff 받기(설계 3절 3·4) ──

    fun consume(handoff: String): Outcome<Unit> = synchronized(lock) {
        if (!WidgetRules.isHandoff(handoff)) return Outcome.Failed("invalid_handoff")
        val res = try {
            send(
                WidgetRequest(
                    "POST", WidgetRules.HANDOFF,
                    mapOf("Content-Type" to "application/json", "Origin" to WidgetRules.ORIGIN),
                    "{\"action\":\"consume\",\"token\":" + ShellRules.jsonString(handoff) + "}",
                ),
            )
        } catch (_: IOException) {
            // 봉인은 이미 쓰였을 수 있다(서버가 되돌리지 않음). 다시 시도하지 않고 새 로그인을 받는다.
            return Outcome.Failed("network")
        }
        if (res.status != 200) return Outcome.Failed("handoff_" + res.status)
        val session = MiniJson.obj(MiniJson.obj(MiniJson.parse(res.body))?.get("session")) ?: return Outcome.Failed("handoff_body")
        return when (val s = readSession(session, null)) {
            null -> Outcome.Failed("handoff_body")
            else -> if (keep(s)) Outcome.Ok(Unit) else Outcome.Failed("save")
        }
    }

    private data class Session(val access: String, val refresh: String, val userId: String, val expiresIn: Long)

    private fun readSession(map: Map<String, Any?>, expectUser: String?): Session? {
        val a = MiniJson.str(map["access_token"]) ?: return null
        val r = MiniJson.str(map["refresh_token"]) ?: return null
        val u = MiniJson.str(MiniJson.obj(map["user"])?.get("id")) ?: return null
        if (a.isEmpty() || r.isEmpty() || r.length > 16384 || !WidgetRules.isUserId(u)) return null
        if (expectUser != null && !expectUser.equals(u, ignoreCase = true)) return null
        val e = MiniJson.num(map["expires_in"])?.toLong()?.takeIf { it in 60..86_400 } ?: 3600L
        return Session(a, r, u, e)
    }

    /** 새 새로고침 토큰을 먼저 저장하고, 성공했을 때만 접근 토큰을 쓴다. */
    private fun keep(s: Session): Boolean {
        try {
            vault.write(VAULT_PREFIX + s.userId + "\n" + s.refresh)
        } catch (_: Exception) {
            forget()
            return false
        }
        access = s.access
        accessUntil = now() + (s.expiresIn - 60) * 1000
        return true
    }

    private fun stored(): Pair<String, String>? {
        val v = vault.read() ?: return null
        if (!v.startsWith(VAULT_PREFIX)) return null
        val rest = v.substring(VAULT_PREFIX.length)
        val nl = rest.indexOf('\n')
        if (nl <= 0) return null
        val user = rest.substring(0, nl)
        val rt = rest.substring(nl + 1)
        if (!WidgetRules.isUserId(user) || rt.isEmpty()) return null
        return user to rt
    }

    private fun forget() {
        workspace = null
        access = null
        accessUntil = 0L
        vault.clear()
    }

    // ── 접근 토큰(설계 3절 5·6) ──

    fun accessToken(): Outcome<String> = synchronized(lock) { tokenLocked() }

    private fun tokenLocked(): Outcome<String> {
        val a = access
        if (a != null && now() < accessUntil) return Outcome.Ok(a)
        access = null
        val (user, rt) = stored() ?: run {
            if (vault.exists()) forget()
            return Outcome.SignedOut
        }
        val res = try {
            send(
                WidgetRequest(
                    "POST", WidgetRules.TOKEN,
                    mapOf("apikey" to WidgetRules.PUBLIC_KEY, "Content-Type" to "application/json"),
                    "{\"refresh_token\":" + ShellRules.jsonString(rt) + "}",
                ),
            )
        } catch (_: IOException) {
            return Outcome.Failed("network")
        }
        if (res.status == 400 || res.status == 401 || res.status == 403) {
            // invalid_grant·refresh_token_not_found·session_not_found 등: 세션이 끝났다(웹 로그아웃 포함).
            forget()
            return Outcome.SignedOut
        }
        if (res.status != 200) return Outcome.Failed("token_" + res.status)
        val s = MiniJson.obj(MiniJson.parse(res.body))?.let { readSession(it, user) } ?: run {
            forget()
            return Outcome.SignedOut
        }
        return if (keep(s)) Outcome.Ok(s.access) else Outcome.SignedOut
    }

    // ── 위젯 읽기(설계 6절) ──

    /** 오늘 일정·할 일(+ counts면 처리 전 후보). 같은 위젯 세션 읽기(readList) 한 번. */
    fun readToday(timeMin: String, timeMax: String, counts: Boolean = false): Outcome<Raw> {
        val urls = listOf(WidgetRules.calendarUrl(timeMin, timeMax), WidgetRules.TASKS) + (if (counts) listOf(WidgetRules.CANDIDATES) else emptyList())
        return when (val r = readList(urls)) {
            is Outcome.Ok -> {
                val c = r.value.getOrNull(2)
                Outcome.Ok(Raw(r.value[0].status, r.value[0].body, r.value[1].status, r.value[1].body, c?.status ?: 0, c?.body))
            }
            is Outcome.SignedOut -> Outcome.SignedOut
            is Outcome.Failed -> r
        }
    }

    /**
     * 허용 주소(WidgetRules.allowed)만 차례로 GET. 접근 토큰이 서버에서 먼저 끝났으면(401) 버리고 한 번만 새로 받아 다시 읽는다.
     * WIDGET-여러개 ②: 오늘·이번 주 위젯이 같은 갱신 작업 한 번에 같이 읽는다.
     */
    fun readList(urls: List<String>): Outcome<List<Reply>> = synchronized(lock) {
        readOnce(urls) ?: run {
            access = null
            accessUntil = 0L
            readOnce(urls) ?: Outcome.Failed("unauthorized")
        }
    }

    /** 로그인 없이 읽는 공개 주소(아스날 정적 파일)만. 토큰·apikey를 붙이지 않는다. 네트워크 오류는 Failed. */
    fun readPublic(url: String): Outcome<Reply> {
        if (url != WidgetRules.ARSENAL) return Outcome.Failed("blocked")
        return try {
            val r = send(WidgetRequest("GET", url, emptyMap()))
            Outcome.Ok(Reply(r.status, r.body))
        } catch (_: IOException) {
            Outcome.Failed("network")
        }
    }

    /** 한 번 읽기. 401이 하나라도 있으면 null. */
    private fun readOnce(urls: List<String>): Outcome<List<Reply>>? {
        val token = when (val t = tokenLocked()) {
            is Outcome.Ok -> t.value
            is Outcome.SignedOut -> return Outcome.SignedOut
            is Outcome.Failed -> return t
        }
        val headers = mapOf("Authorization" to "Bearer $token", "apikey" to WidgetRules.PUBLIC_KEY)
        val got = ArrayList<WidgetResponse>()
        try {
            for (url in urls) got.add(send(WidgetRequest("GET", url, headers)))
        } catch (_: IOException) {
            return Outcome.Failed("network")
        }
        if (got.any { it.status == 401 }) return null
        return Outcome.Ok(got.map { Reply(it.status, MiniJson.parse(it.body)) })
    }

    // ── 빠른 쓰기(설계 13절, APP-위젯빠른쓰기) ──

    /** 이 위젯 세션 사용자의 작업공간 id(메모리에만, 사용자와 함께). */
    private var workspace: Pair<String, String>? = null

    /** 쓰기 결과: 성공, 로그인 풀림(웹2 쓰기 창으로 넘김), 실패(이유 한 줄, 글은 창에 남김). */
    sealed class Write {
        object Saved : Write()
        object SignedOut : Write()
        data class Failed(val reason: String) : Write()
    }

    /**
     * 새 글 하나를 넣는다(업데이트·할 일·노트). 읽기와 같은 잠금·같은 '401이면 한 번만 새로 받기'.
     * 보내는 요청은 QuickWriteRules.request가 만든 것과 작업공간 확인 GET뿐이고, 둘 다 WidgetRules.allowed를 거친다.
     */
    fun write(kind: WidgetAction, text: String): Write = synchronized(lock) {
        when (val c = QuickWriteRules.check(kind, text)) {
            is QuickWriteRules.Check.Bad -> return@synchronized Write.Failed(c.reason)
            QuickWriteRules.Check.Ok -> Unit
        }
        writeOnce(kind, text) ?: run {
            access = null
            accessUntil = 0L
            writeOnce(kind, text) ?: Write.Failed(QuickWriteRules.SIGNED_OUT)
        }
    }

    /** 한 번 쓰기. 401이면 null(접근 토큰을 새로 받아 한 번 더). */
    private fun writeOnce(kind: WidgetAction, text: String): Write? {
        val token = when (val t = tokenLocked()) {
            is Outcome.Ok -> t.value
            is Outcome.SignedOut -> return Write.SignedOut
            is Outcome.Failed -> return Write.Failed(QuickWriteRules.NETWORK)
        }
        val user = stored()?.first ?: return Write.SignedOut
        val headers = mapOf("Authorization" to "Bearer $token", "apikey" to WidgetRules.PUBLIC_KEY)
        try {
            val ws = workspace?.takeIf { it.first == user }?.second ?: run {
                val r = send(WidgetRequest("GET", WidgetRules.workspaceUrl(user), headers))
                if (r.status == 401) return null
                if (r.status != 200) return Write.Failed(QuickWriteRules.NO_WORKSPACE)
                val id = MiniJson.str(MiniJson.obj(MiniJson.list(MiniJson.parse(r.body))?.firstOrNull())?.get("workspace_id"))
                if (!WidgetRules.isUserId(id)) return Write.Failed(QuickWriteRules.NO_WORKSPACE)
                workspace = user to id!!
                id
            }
            val req = QuickWriteRules.request(kind, text, ws)
            val h = HashMap(headers)
            h["Content-Type"] = "application/json"
            req.prefer?.let { h["Prefer"] = it }
            val r = send(WidgetRequest("POST", req.url, h, req.body))
            if (r.status == 401) return null
            val body = MiniJson.parse(r.body)
            return if (QuickWriteRules.success(kind, r.status, body)) Write.Saved else Write.Failed(QuickWriteRules.reason(kind, r.status, body))
        } catch (_: IOException) {
            return Write.Failed(QuickWriteRules.NETWORK)
        }
    }

    // ── [사진] 뒤에서 올리기(APP-위젯빠른쓰기 남은 일 1) ──

    /** 사진 한 장 올리기 결과: 저장됨(정리함 글 번호), 로그인 풀림, 실패(이유 한 줄·다시 시도 가능 여부·이어 붙일 글이 사라졌는지). */
    sealed class Photo {
        data class Saved(val noteId: String) : Photo()
        object SignedOut : Photo()
        data class Failed(val reason: String, val retry: Boolean, val forgetNote: Boolean = false) : Photo()
    }

    /**
     * 사진 한 장을 정리함에 올린다(basket-files multipart). noteId가 있으면 그 정리함 글에 이어 붙인다(여러 장을 한 업데이트로).
     * 접근 토큰은 잠금 안에서 받고, 올리기(몇 초)는 잠금 밖에서 해 위젯 갱신을 막지 않는다. 401이면 토큰을 버리고 한 번만 다시.
     * 서버가 소유자·작업공간을 스스로 정한다(요청에 작업공간 id 없음).
     */
    fun uploadPhoto(file: File, name: String, type: String, noteId: String?): Photo {
        val parts = QuickPhotoRules.parts(file, name, type, noteId)
        for (attempt in 0..1) {
            val token = when (val t = accessToken()) {
                is Outcome.Ok -> t.value
                is Outcome.SignedOut -> return Photo.SignedOut
                is Outcome.Failed -> return Photo.Failed(QuickPhotoRules.NETWORK, true)
            }
            val headers = mapOf("Authorization" to "Bearer $token", "apikey" to WidgetRules.PUBLIC_KEY)
            val res = try {
                send(WidgetRequest("POST", WidgetRules.BASKET_FILES, headers, null, parts))
            } catch (_: IOException) {
                return Photo.Failed(QuickPhotoRules.NETWORK, true)
            }
            if (res.status == 401) {
                synchronized(lock) {
                    if (access == token) {
                        access = null
                        accessUntil = 0L
                    }
                }
                if (attempt == 0) continue
                return Photo.Failed(QuickPhotoRules.SIGNED_OUT, true)
            }
            return QuickPhotoRules.result(res.status, MiniJson.parse(res.body), noteId)
        }
        return Photo.Failed(QuickPhotoRules.SIGNED_OUT, true)
    }

    // ── 위젯 로그아웃(설계 5절 폐기 1) ──

    /** 이 세션만 서버에서 끝내고(scope=local), 성공·실패와 관계없이 폰의 열쇠를 지운다. */
    fun logout() {
        synchronized(lock) { logoutLocked() }
    }

    private fun logoutLocked() {
        val token = when (val t = tokenLocked()) {
            is Outcome.Ok -> t.value
            else -> null
        }
        if (token != null) {
            try {
                send(
                    WidgetRequest(
                        "POST", WidgetRules.LOGOUT,
                        mapOf("apikey" to WidgetRules.PUBLIC_KEY, "Authorization" to "Bearer $token", "Content-Type" to "application/json"),
                        "{}",
                    ),
                )
            } catch (_: IOException) {
            }
        }
        loginSince = 0L
        forget()
    }

    private fun send(request: WidgetRequest): WidgetResponse {
        if (!WidgetRules.allowed(request.method, request.url)) throw IOException("blocked")
        if (!WidgetRules.allowedParts(request.method, request.url, request.body, request.parts)) throw IOException("blocked")
        return http.send(request)
    }

    companion object {
        const val LOGIN_WINDOW_MS = 10 * 60 * 1000L
        private const val VAULT_PREFIX = "v1\n"
    }
}
