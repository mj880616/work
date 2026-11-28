package kr.or.kptu.work

import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder

/**
 * 앱 껍데기의 판단 규칙. 안드로이드 API를 쓰지 않아 JVM 단위 시험으로 확인한다.
 * - 어떤 주소를 앱 안(WebView)에 띄우고 어떤 주소를 브라우저 탭으로 보낼지
 * - 로그인 복귀(kptuwork://auth?…)에서 웹으로 넘길 값
 * - 시스템 바 색, 새 버전 비교
 */
object ShellRules {
    /**
     * 웹2 주소: 처음 여는 주소(HOME)·위젯 Origin·알림이 여는 주소의 호스트.
     * DOMAIN-workonplus 1단계(docs/design/domain-workonplus.md, 0.5.17부터): WORK ON+ 주소 workonplus.com.
     * 로그인 정보는 주소마다 따로라, 옛 판(bokdoong.com)에서 올라온 사람은 새 판에서 한 번 다시 로그인한다(자료는 서버에 그대로).
     */
    const val WEB2_HOST = "workonplus.com"
    const val HOME = "https://$WEB2_HOST/work/app/"

    /** 옛 웹2 주소(주소 이전 ①-D1 뒤 0.5.16까지 처음 여는 주소). 옛 링크가 앱 안에 머물도록 안쪽으로 둔다. */
    const val OLD_WEB2_HOST = "bokdoong.com"

    /** 지난 새 주소(DOMAIN-nojoplus, docs/design/domain-nojoplus.md). 옛 링크가 앱 안에 머물도록 안쪽으로 둔다. */
    const val NEW_WEB2_HOST = "nojoplus.com"

    /**
     * 웹2를 앱 안에 띄우는 호스트. auth-handoff 허용 Origin과 같다.
     * desk·work는 넘김(302) 기간 동안 안쪽으로 둔다(옛 링크가 bokdoong.com으로 넘어올 때 앱 안에 머물게).
     * www는 Worker가 넘기므로 넣지 않는다.
     */
    val INTERNAL_HOSTS: Set<String> = setOf(WEB2_HOST, OLD_WEB2_HOST, NEW_WEB2_HOST, "desk.bokdoong.com", "work.bokdoong.com", "mj880616.github.io")

    /** 맨 앞(/)이 웹2로 넘어가는 호스트(Worker movesToWeb2). work의 / 는 Web1이라 넣지 않는다. */
    private val ROOT_TO_WEB2_HOSTS: Set<String> = setOf(WEB2_HOST, OLD_WEB2_HOST, NEW_WEB2_HOST, "desk.bokdoong.com")
    val ALLOWED_ORIGINS: Set<String> = INTERNAL_HOSTS.map { "https://$it" }.toSet()
    private const val APP_PATH = "/work/app/"

    /** 로그인·캘린더 복귀에서 웹으로 넘기는 값. 토큰 원문(access_token 등)은 넘기지 않는다. */
    val RETURN_PARAMS: List<String> = listOf("handoff", "google", "reason")
    private const val MAX_RETURN_VALUE = 4096

    /** 바깥에 열어도 되는 앱 주소 종류. file·content·javascript·data 등은 열지 않는다. */
    val OUTSIDE_SCHEMES: Set<String> = setOf("tel", "mailto", "sms", "geo", "market")

    const val RELEASE_TAG_PREFIX = "phone-app-v"
    const val RELEASE_DOWNLOAD_PREFIX = "https://github.com/mj880616/work/releases/download/$RELEASE_TAG_PREFIX"

    private fun parse(url: String?): URI? =
        try {
            if (url.isNullOrBlank()) null else URI(url.trim())
        } catch (_: Exception) {
            null
        }

    /**
     * https + 허용 호스트 + /work/app/ 아래. 웹2 호스트·desk는 맨 앞 / 도(Worker가 /work/app/으로 보냄).
     * 그 밖(bokdoong.com/p/·/s/ 짧은 주소, /work/share/ 공유 페이지, work의 Web1)은 바깥(설계 4.3절).
     */
    fun isInternalApp(url: String?): Boolean {
        val u = parse(url) ?: return false
        if (!"https".equals(u.scheme, ignoreCase = true)) return false
        if (u.rawUserInfo != null) return false
        if (u.port != -1 && u.port != 443) return false
        val host = u.host?.lowercase() ?: return false
        if (host !in INTERNAL_HOSTS) return false
        val path = u.rawPath ?: ""
        if (path == "/work/app" || path.startsWith(APP_PATH)) return true
        return host in ROOT_TO_WEB2_HOSTS && (path.isEmpty() || path == "/")
    }

    /**
     * 앱 자리가 이전 안내 한 장이 된 호스트. nojoplus.com(DOMAIN-workonplus 4절)과 S68-01부터 bokdoong.com.
     * desk·work는 bokdoong.com으로 넘기므로(Worker) 같이 둔다(알림·위젯·공유로 들어온 옛 링크).
     */
    private val MOVED_HOSTS: Set<String> = setOf(NEW_WEB2_HOST, OLD_WEB2_HOST, "desk.bokdoong.com", "work.bokdoong.com")

    /**
     * DOMAIN-workonplus·S68-01: 옛 주소(nojoplus.com, bokdoong.com·desk·work)의 웹2 앱 주소(맨 앞 / 와 /work/app/ 아래)를
     * 같은 경로·질의·조각의 workonplus.com 주소로 바꾼다. 옛 주소의 앱 자리는 이전 안내 한 장이 되므로 앱은 안내 대신 새 주소를 바로 연다.
     * 그 밖(다른 호스트, 안쪽이 아닌 주소)은 null.
     */
    fun movedToHome(url: String?): String? {
        if (!isInternalApp(url)) return null
        val u = parse(url) ?: return null
        if (u.host?.lowercase() !in MOVED_HOSTS) return null
        val raw = u.rawPath ?: ""
        val path = if (raw.isEmpty() || raw == "/" || raw == "/work/app") APP_PATH else raw
        return "https://$WEB2_HOST" + path + (u.rawQuery?.let { "?$it" } ?: "") + (u.rawFragment?.let { "#$it" } ?: "")
    }

    /** 웹2 로그인 화면(/work/app/login/)인지. 웹 화면이 로그아웃 상태라 이리로 보낸 것으로 본다(위젯 로그인 대체 길). */
    fun isLoginPage(url: String?): Boolean {
        if (!isInternalApp(url)) return false
        val path = parse(url)?.rawPath ?: return false
        return path == APP_PATH + "login" || path.startsWith(APP_PATH + "login/")
    }

    /** 앱 안 웹 화면이 이동하려는 주소를 바깥(브라우저 탭·다른 앱)으로 보낼지. */
    fun opensOutside(url: String?): Boolean {
        if (!isInternalApp(url)) return true
        return queryValue(url, "external") == "1"
    }

    fun queryValue(url: String?, name: String): String? {
        val raw = parse(url)?.rawQuery ?: return null
        for (part in raw.split('&')) {
            if (part.isEmpty()) continue
            val eq = part.indexOf('=')
            val key = decode(if (eq < 0) part else part.substring(0, eq)) ?: continue
            if (key != name) continue
            return decode(if (eq < 0) "" else part.substring(eq + 1))
        }
        return null
    }

    private fun decode(value: String): String? =
        try {
            URLDecoder.decode(value, "UTF-8")
        } catch (_: Exception) {
            null
        }

    fun isAppReturn(url: String?): Boolean {
        val u = parse(url) ?: return false
        return "kptuwork".equals(u.scheme, ignoreCase = true) && "auth".equals(u.host, ignoreCase = true)
    }

    /**
     * kptuwork://auth?handoff=… → HOME?handoff=…
     * 웹의 auth-handoff-client.js가 handoff를 한 번 쓰고 지운다. 앱은 값을 보관하지 않는다.
     */
    fun homeForReturn(url: String?): String {
        if (!isAppReturn(url)) return HOME
        val pairs = RETURN_PARAMS.mapNotNull { name ->
            val value = queryValue(url, name)
            if (value.isNullOrEmpty() || value.length > MAX_RETURN_VALUE) null else name to value
        }
        if (pairs.isEmpty()) return HOME
        return HOME + "?" + pairs.joinToString("&") { (k, v) -> k + "=" + URLEncoder.encode(v, "UTF-8") }
    }

    /** 웹 theme-color 값(#rgb, #rrggbb) → 불투명 ARGB. 그 밖의 값은 버린다. */
    fun parseColor(value: String?): Int? {
        val v = value?.trim()?.lowercase() ?: return null
        val hex = when {
            Regex("^#[0-9a-f]{6}$").matches(v) -> v.substring(1)
            Regex("^#[0-9a-f]{3}$").matches(v) -> v.substring(1).map { "$it$it" }.joinToString("")
            else -> return null
        }
        return (0xFF000000L or hex.toLong(16)).toInt()
    }

    /** 밝은 바탕이면 바 아이콘을 어둡게 그려야 한다. */
    fun isLight(color: Int): Boolean {
        fun channel(c: Int): Double {
            val s = c / 255.0
            return if (s <= 0.03928) s / 12.92 else Math.pow((s + 0.055) / 1.055, 2.4)
        }
        val l = 0.2126 * channel((color shr 16) and 0xFF) + 0.7152 * channel((color shr 8) and 0xFF) + 0.0722 * channel(color and 0xFF)
        return l > 0.4
    }

    fun parseVersion(value: String?): IntArray? {
        val v = value?.trim() ?: return null
        if (!Regex("^\\d{1,4}\\.\\d{1,4}\\.\\d{1,4}$").matches(v)) return null
        return v.split('.').map { it.toInt() }.toIntArray()
    }

    fun isNewer(candidate: String?, current: String?): Boolean {
        val a = parseVersion(candidate) ?: return false
        val b = parseVersion(current) ?: return false
        for (i in 0 until 3) if (a[i] != b[i]) return a[i] > b[i]
        return false
    }

    fun versionFromTag(tag: String?): String? {
        if (tag == null || !tag.startsWith(RELEASE_TAG_PREFIX)) return null
        val v = tag.substring(RELEASE_TAG_PREFIX.length)
        return if (parseVersion(v) != null) v else null
    }

    /** 이 저장소의 phone-app-v<버전> 릴리스에 올린 APK 주소만 받는다. */
    fun isTrustedApk(url: String?, version: String): Boolean {
        if (url == null || parseVersion(version) == null) return false
        val prefix = "$RELEASE_DOWNLOAD_PREFIX$version/"
        if (!url.startsWith(prefix)) return false
        val name = url.substring(prefix.length)
        return name.endsWith(".apk") && Regex("^[A-Za-z0-9._-]+$").matches(name) && !name.contains("..")
    }

    // ── 단계 ② 공유로 바구니 넣기(설계 4절) ──

    /** 일회용 번호: SecureRandom 16바이트 base64url(22자). 웹 share-intake-model.mjs isShareId와 같은 모양. */
    private val SHARE_ID = Regex("^[A-Za-z0-9_-]{22,64}$")
    private val SHARE_PATH = Regex("^(?:/work/app)?/__share/([A-Za-z0-9_-]{22,64})/(\\d{1,2})$")
    private val MIME = Regex("^[a-z0-9.+-]+/[a-z0-9.+-]+$")
    const val SHARE_MAX_ITEMS = 50
    const val SHARE_MAX_TEXT = 100_000

    fun isShareId(value: String?): Boolean = value != null && SHARE_ID.matches(value)

    /**
     * APP-공유노트할일(요청함 11/02 00:22): 공유 창 세 칸 'WORK ON+ 노트로 보내기'(MainActivity, 0.5.32부터. 옛 '잊지 말기로 보내기'·S49-9 '웹2 정리함')·'웹2 노트'·'웹2 할 일'(같은 화면의 activity-alias).
     * 받기 길(ShareIntake)은 하나이고 들어갈 곳만 다르다. 알 수 없는 이름은 정리함(이전과 같음).
     */
    const val SHARE_TO_NOTE = "ShareToNote"
    const val SHARE_TO_TASK = "ShareToTask"
    /** S62-22 APP-공유로뉴스보관: 네 번째 칸 'WORK ON+ 저장'(S68-35 옛 'News 보관', 같은 activity-alias 방식). 웹은 글에서 기사 주소만 골라 서버로 보낸다. */
    const val SHARE_TO_NEWS = "ShareToNews"
    /** S68-09 READ-읽을거리함: 다섯 번째 칸 'WORK ON+ 저장한 글'(S68-34 옛 'WORK ON+ 읽을 거리', 같은 activity-alias 방식). 웹은 글에서 주소 하나만 골라 읽을 거리에 넣는다. */
    const val SHARE_TO_READING = "ShareToReading"
    val SHARE_TARGETS = setOf("basket", "note", "task", "news", "reading")

    fun shareTarget(className: String?): String {
        val simple = className?.substringAfterLast('.') ?: return "basket"
        return when (simple) {
            SHARE_TO_NOTE -> "note"
            SHARE_TO_TASK -> "task"
            SHARE_TO_NEWS -> "news"
            SHARE_TO_READING -> "reading"
            else -> "basket"
        }
    }

    /** 공유를 받으면 여는 주소. 웹 basket-share.js가 번호를 읽고 다리로 목록을 묻는다. */
    fun shareHome(id: String): String = HOME + "?view=basket&share=" + id

    /**
     * 웹이 파일 내용을 받으려고 부르는 주소(https://<허용 호스트>/work/app/__share/<번호>/<순번>)인지.
     * 맞으면 (번호, 순번). 이 주소는 서버로 나가지 않고 앱이 가로챈다.
     */
    fun shareRequest(url: String?): Pair<String, Int>? {
        val u = parse(url) ?: return null
        if (!"https".equals(u.scheme, ignoreCase = true) || u.rawUserInfo != null) return null
        if (u.port != -1 && u.port != 443) return null
        val host = u.host?.lowercase() ?: return null
        if (host !in INTERNAL_HOSTS) return null
        if (u.rawQuery != null || u.rawFragment != null) return null
        val m = SHARE_PATH.matchEntire(u.rawPath ?: return null) ?: return null
        return m.groupValues[1] to m.groupValues[2].toInt()
    }

    /** 다리로 받은 공유 메시지. get(번호 또는 빈 값) / done(번호) / back. 그 밖은 null. */
    sealed class ShareMessage {
        data class Get(val id: String?) : ShareMessage()
        data class Done(val id: String) : ShareMessage()
        object Back : ShareMessage()
    }

    fun shareMessage(data: String?): ShareMessage? {
        if (data == null) return null
        if (data == "share:back") return ShareMessage.Back
        if (data.startsWith("share:get:")) {
            val id = data.substring("share:get:".length)
            return if (id.isEmpty()) ShareMessage.Get(null) else if (isShareId(id)) ShareMessage.Get(id) else null
        }
        if (data.startsWith("share:done:")) {
            val id = data.substring("share:done:".length)
            return if (isShareId(id)) ShareMessage.Done(id) else null
        }
        return null
    }

    /** 파일 이름: 경로·제어 문자를 빼고 200자까지. 비면 "공유 파일 n". */
    fun shareName(value: String?, index: Int): String {
        val cleaned = (value ?: "").replace(Regex("[\\u0000-\\u001f\\u007f/\\\\]+"), " ").trim()
        val cut = cleaned.codePoints().limit(200).toArray().let { String(it, 0, it.size) }.trim()
        return cut.ifEmpty { "공유 파일 ${index + 1}" }
    }

    /** 종류: 소문자 type/subtype만. 모르면 application/octet-stream. 별표 꼴(image/별표)도 모르는 것으로 본다. */
    fun shareMime(value: String?): String {
        val v = value?.trim()?.lowercase() ?: return "application/octet-stream"
        return if (MIME.matches(v)) v else "application/octet-stream"
    }

    data class ShareMeta(val name: String, val type: String, val size: Long)

    /** 'share:list:' 뒤에 붙는 JSON(org.json 없이 만들어 JVM 시험이 된다). 파일 내용·URI는 넣지 않는다. */
    fun shareListJson(id: String, subject: String?, text: String?, items: List<ShareMeta>, target: String = "basket"): String {
        val sb = StringBuilder()
        sb.append("{\"id\":").append(jsonString(id))
        sb.append(",\"subject\":").append(jsonString((subject ?: "").take(1000)))
        sb.append(",\"text\":").append(jsonString((text ?: "").take(SHARE_MAX_TEXT)))
        sb.append(",\"items\":[")
        items.take(SHARE_MAX_ITEMS).forEachIndexed { i, item ->
            if (i > 0) sb.append(',')
            sb.append("{\"i\":").append(i)
            sb.append(",\"name\":").append(jsonString(item.name))
            sb.append(",\"type\":").append(jsonString(item.type))
            sb.append(",\"size\":").append(if (item.size >= 0) item.size else -1)
            sb.append('}')
        }
        sb.append(']')
        // 정리함은 이전과 같은 모양(칸 없음). 노트·할 일·저장(news)·읽을 거리만 들어갈 곳을 적는다(정해진 낱말만).
        if (target != "basket" && target in SHARE_TARGETS) sb.append(",\"target\":").append(jsonString(target))
        sb.append('}')
        return sb.toString()
    }

    fun jsonString(value: String): String {
        val sb = StringBuilder("\"")
        for (c in value) {
            when {
                c == '"' -> sb.append("\\\"")
                c == '\\' -> sb.append("\\\\")
                c == '<' -> sb.append("\\u003c")
                c == '\u2028' -> sb.append("\\u2028")
                c == '\u2029' -> sb.append("\\u2029")
                c < ' ' -> sb.append(String.format("\\u%04x", c.code))
                else -> sb.append(c)
            }
        }
        return sb.append('"').toString()
    }

    /** APP-당겨서새로고침: 당기기를 받아도 되는지. 웹이 이 손가락에 pull:on을 보냈고, 웹 화면 자체가 맨 위이고, 웹2 화면일 때만. */
    fun pullReady(webSaidOn: Boolean, scrollY: Int, internal: Boolean): Boolean = webSaidOn && scrollY <= 0 && internal

    /**
     * NOTE-폴더고른뒤새로고침(11/18 21:25): SwipeRefreshLayout에 '웹 화면이 위로 더 올라갈 수 있다'(당기기 막음)고 답할지.
     * 막는 것은 손가락이 움직이는 순간(MOVE)뿐이다. 손가락을 대는 순간(DOWN)·떼는 순간(UP·CANCEL)까지 막으면, 웹의 pull:on/off는
     * 손가락을 댄 뒤에야 오므로 SwipeRefreshLayout이 이 손가락의 시작점을 못 적고(앞 손가락이 pull:off였을 때) 끝도 못 지운다(이 손가락이 pull:off일 때).
     * 그러면 다음 손가락이 pull:on을 받는 순간 오래된 시작점(예: 폴더 고르기 창에서 누른 줄)에서 지금까지를 당긴 거리로 잡아,
     * 입력칸·[크게]를 한 번 톡 누른 것이 '당겨서 새로고침'이 된다. 시작·끝은 늘 받게 해 손가락마다 새로 적게 한다.
     */
    fun pullBlocked(moving: Boolean, webSaidOn: Boolean, scrollY: Int, internal: Boolean): Boolean =
        moving && !pullReady(webSaidOn, scrollY, internal)

    /**
     * S68-59(명진 11/23 16:17 "왼쪽으로 스와이프 여전히 안됨"): 손가락 하나의 갈래 — 아직 모름(null) · 옆(true) · 위아래(false).
     * SwipeRefreshLayout은 가로·세로를 견주지 않고, 맨 위에서 손가락이 아래로 touchSlop만 내려가도 '당기기'로 보고 손가락을 웹에서 빼앗는다
     * (웹에는 pointercancel). 오른손 엄지로 줄을 왼쪽으로 밀면 손끝이 호를 그리며 아래로 조금 내려가므로(오른쪽으로 밀면 위로) 웹 목록의
     * 왼쪽 밀기만 늘 끊겼다. 처음으로 slop을 넘은 순간 가로가 세로보다 크면 그 손가락은 옆으로 가는 것으로 정하고, 끝날 때까지 당기기로 보지 않는다.
     * 같은 크기(대각선)는 위아래 쪽(지금까지처럼 당기기 판정에 맡김).
     */
    fun pullAxis(dx: Float, dy: Float, slop: Float): Boolean? {
        val ax = kotlin.math.abs(dx)
        val ay = kotlin.math.abs(dy)
        if (maxOf(ax, ay) <= slop) return null
        return ax > ay
    }

    /** APP-다시열림: 화면 안 이동에 넘길 질의 글 모양(폰 알림 open과 같은 글자, 200자까지). */
    private val IN_PLACE_QUERY = Regex("^[A-Za-z0-9_=&%.-]{0,200}$")

    /**
     * APP-다시열림: 이미 열린 웹2 화면 안에서 자리만 옮길 수 있는 주소면 그 질의("?…" 또는 "")를 돌려준다.
     * 웹2 앱 주소(/work/app/ 또는 /work/app/index.html)이고 질의 글자가 좁은 모양일 때만. 로그인 화면·조각(#)·다른 길은 null(통째로 연다).
     * 돌려준 글은 따옴표·역슬래시가 없어 스크립트 글에 그대로 넣어도 된다.
     */
    fun inPlaceQuery(url: String?): String? {
        if (!isInternalApp(url) || isLoginPage(url)) return null
        val u = parse(url) ?: return null
        if (u.rawFragment != null) return null
        val path = u.rawPath ?: return null
        if (path != APP_PATH && path != APP_PATH + "index.html") return null
        val query = u.rawQuery ?: return ""
        if (!IN_PLACE_QUERY.matches(query)) return null
        return if (query.isEmpty()) "" else "?$query"
    }
}
