package kr.or.kptu.work

import org.json.JSONArray
import java.net.URL
import javax.net.ssl.HttpsURLConnection

/**
 * 앱을 열 때 공개 릴리스 목록에서 phone-app-v* 최신 버전을 한 번 확인한다(설계 D10).
 * 로그인·토큰을 쓰지 않는 공개 요청이고, 결과는 폰에 저장하지 않는다.
 * 설치는 하지 않는다. [받기]는 브라우저로 APK 주소를 연다(설치 권한 요청 없음).
 */
object UpdateCheck {
    private const val RELEASES = "https://api.github.com/repos/mj880616/work/releases?per_page=50"

    data class Found(val version: String, val url: String)

    /** 백그라운드 스레드에서 부른다. 실패하면 조용히 null. */
    fun fetch(current: String): Found? {
        var conn: HttpsURLConnection? = null
        return try {
            conn = URL(RELEASES).openConnection() as HttpsURLConnection
            conn.connectTimeout = 8000
            conn.readTimeout = 8000
            conn.setRequestProperty("Accept", "application/vnd.github+json")
            conn.setRequestProperty("User-Agent", "KPTUAndroid/$current")
            if (conn.responseCode != 200) return null
            val body = conn.inputStream.bufferedReader().use { it.readText() }
            pick(JSONArray(body), current)
        } catch (_: Exception) {
            null
        } finally {
            conn?.disconnect()
        }
    }

    private fun pick(releases: JSONArray, current: String): Found? {
        var best: Found? = null
        for (i in 0 until releases.length()) {
            val release = releases.optJSONObject(i) ?: continue
            if (release.optBoolean("draft") || release.optBoolean("prerelease")) continue
            val version = ShellRules.versionFromTag(release.optString("tag_name")) ?: continue
            if (!ShellRules.isNewer(version, current)) continue
            if (best != null && !ShellRules.isNewer(version, best.version)) continue
            val assets = release.optJSONArray("assets") ?: continue
            for (j in 0 until assets.length()) {
                val url = assets.optJSONObject(j)?.optString("browser_download_url")
                if (ShellRules.isTrustedApk(url, version)) {
                    best = Found(version, url!!)
                    break
                }
            }
        }
        return best
    }
}
