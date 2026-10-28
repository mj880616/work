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
    const val HOME = "https://desk.bokdoong.com/work/app/"

    /** 웹2를 앱 안에 띄우는 주소. auth-handoff 허용 Origin과 같다. */
    val INTERNAL_HOSTS: Set<String> = setOf("desk.bokdoong.com", "work.bokdoong.com", "mj880616.github.io")
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

    /** https + 허용 호스트 + /work/app/ 아래(desk는 맨 앞 / 도, Worker가 /work/app/으로 보냄). */
    fun isInternalApp(url: String?): Boolean {
        val u = parse(url) ?: return false
        if (!"https".equals(u.scheme, ignoreCase = true)) return false
        if (u.rawUserInfo != null) return false
        if (u.port != -1 && u.port != 443) return false
        val host = u.host?.lowercase() ?: return false
        if (host !in INTERNAL_HOSTS) return false
        val path = u.rawPath ?: ""
        if (path == "/work/app" || path.startsWith(APP_PATH)) return true
        return host == "desk.bokdoong.com" && (path.isEmpty() || path == "/")
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
}
