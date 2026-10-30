package kr.or.kptu.work

import java.time.LocalDate

/**
 * WIDGET-여러개 ③: '아스날' 위젯(2×1)에 그릴 두 줄. 안드로이드 API를 쓰지 않아 JVM 시험 대상이다.
 * 자료: 앱 아스날 화면과 같은 공개 정적 파일 app/arsenal/matches.js(window.ARSENAL_MATCHES = [ … ]). 로그인 없이 읽는다.
 * 지금 파일에는 끝난 경기만 있다. 다음 경기는 점수가 없고 날짜가 오늘 이후인 줄이 생기면(선택: "kickoff":"HH:MM" 서울 시각) 그 줄을 쓴다.
 * 그런 줄이 없으면 '다음 경기 자료 준비 중' + 마지막 결과.
 */
object WidgetArsenal {
    const val ARSENAL = "아스날"
    private val DAYS = arrayOf("월", "화", "수", "목", "금", "토", "일")
    private val HHMM = Regex("^([01]\\d|2[0-3]):[0-5]\\d$")

    data class Match(val date: LocalDate, val home: Boolean, val opponent: String, val competition: String, val kickoff: String?, val score: String?, val result: String?)

    data class Content(val top: String, val bottom: String)

    /** "window.ARSENAL_MATCHES = [ … ];" → 경기 목록. 모양이 다르면 null. */
    fun parse(text: String?): List<Match>? {
        val t = text ?: return null
        val a = t.indexOf('[')
        val b = t.lastIndexOf(']')
        if (a < 0 || b <= a || !t.substring(0, a).contains("ARSENAL_MATCHES")) return null
        val list = MiniJson.list(MiniJson.parse(t.substring(a, b + 1))) ?: return null
        val out = ArrayList<Match>()
        for (item in list) {
            val m = MiniJson.obj(item) ?: continue
            val date = WidgetWeek.parseDay(MiniJson.str(m["date"])) ?: continue
            val home = MiniJson.str(m["home"]) ?: continue
            val away = MiniJson.str(m["away"]) ?: continue
            val isHome = home == ARSENAL
            if (!isHome && away != ARSENAL) continue
            val hs = MiniJson.num(m["homeScore"])?.toInt()
            val aw = MiniJson.num(m["awayScore"])?.toInt()
            val score = if (hs != null && aw != null) (if (isHome) "$hs-$aw" else "$aw-$hs") else null
            val kickoff = MiniJson.str(m["kickoff"])?.takeIf { HHMM.matches(it) }
            out.add(Match(date, isHome, if (isHome) away else home, MiniJson.str(m["competition"]) ?: "", kickoff, score, MiniJson.str(m["result"])))
        }
        return out
    }

    private fun day(d: LocalDate): String = "${d.monthValue}.${d.dayOfMonth}(${DAYS[d.dayOfWeek.value - 1]})"

    fun content(matches: List<Match>?, today: LocalDate): Content {
        if (matches == null) return Content("아스날", "불러오지 못했어요")
        val next = matches.filter { it.score == null && !it.date.isBefore(today) }.minByOrNull { it.date }
        val last = matches.filter { it.score != null }.maxByOrNull { it.date }
        val top = if (next != null) {
            "다음 ${day(next.date)}${next.kickoff?.let { " $it" } ?: ""} ${if (next.home) "홈" else "원정"} ${next.opponent}"
        } else {
            "다음 경기 자료 준비 중"
        }
        val bottom = if (last != null) {
            "지난 ${day(last.date)} ${if (last.home) "홈" else "원정"} ${last.opponent} ${last.score}${last.result?.let { " $it" } ?: ""}"
        } else {
            "지난 경기 없음"
        }
        return Content(top, bottom)
    }
}
