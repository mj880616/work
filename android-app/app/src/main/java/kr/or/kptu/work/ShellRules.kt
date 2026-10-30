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
    /** 웹2 주소(주소 이전 ①-D1 뒤 정식 주소, 설계 docs/design/domain-move.md 1.1절). */
    const val WEB2_HOST = "bokdoong.com"
    const val HOME = "https://$WEB2_HOST/work/app/"

    /**
     * 웹2를 앱 안에 띄우는 호스트. auth-handoff 허용 Origin과 같다.
     * desk·work는 넘김(302) 기간 동안 안쪽으로 둔다(옛 링크가 bokdoong.com으로 넘어올 때 앱 안에 머물게).
     */
    val INTERNAL_HOSTS: Set<String> = setOf(WEB2_HOST, "desk.bokdoong.com", "work.bokdoong.com", "mj880616.github.io")

    /** 맨 앞(/)이 웹2로 넘어가는 호스트(Worker movesToWeb2). work의 / 는 Web1이라 넣지 않는다. */
    private val ROOT_TO_WEB2_HOSTS: Set<String> = setOf(WEB2_HOST, "desk.bokdoong.com")
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
     * https + 허용 호스트 + /work/app/ 아래. bokdoong.com·desk는 맨 앞 / 도(Worker가 bokdoong.com/work/app/으로 보냄).
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
    fun shareListJson(id: String, subject: String?, text: String?, items: List<ShareMeta>): String {
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
        sb.append("]}")
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
}
