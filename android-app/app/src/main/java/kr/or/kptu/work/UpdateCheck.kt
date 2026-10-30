package kr.or.kptu.work

import java.net.URL
import javax.net.ssl.HttpsURLConnection

/**
 * 앱을 열 때 공개 릴리스 목록에서 phone-app-v* 최신 버전을 한 번 확인한다(설계 D10).
 * 로그인·토큰을 쓰지 않는 공개 요청이고, 결과는 폰에 저장하지 않는다.
 * 고르는 규칙은 UpdateRules.pick(시험으로 고정). 받기·설치는 AppUpdater가 한다(APP-스스로업데이트).
 */
object UpdateCheck {
    /** 백그라운드 스레드에서 부른다. 실패하면 조용히 null. */
    fun fetch(current: String): UpdateRules.Release? {
        var conn: HttpsURLConnection? = null
        return try {
            conn = URL(UpdateRules.RELEASES_URL).openConnection() as HttpsURLConnection
            conn.connectTimeout = 8000
            conn.readTimeout = 8000
            conn.setRequestProperty("Accept", "application/vnd.github+json")
            conn.setRequestProperty("User-Agent", "KPTUAndroid/$current")
            if (conn.responseCode != 200) return null
            val body = conn.inputStream.bufferedReader().use { it.readText() }
            UpdateRules.pick(body, current)
        } catch (_: Exception) {
            null
        } finally {
            conn?.disconnect()
        }
    }
}
