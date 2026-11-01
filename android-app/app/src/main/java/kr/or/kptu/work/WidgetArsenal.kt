package kr.or.kptu.work

import java.time.Duration
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.temporal.ChronoUnit

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

    data class Match(
        val date: LocalDate,
        val home: Boolean,
        val opponent: String,
        val competition: String,
        val kickoff: String?,
        val score: String?,
        val result: String?,
        val round: String = "",
        val broadcast: String? = null,
    )

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
            val broadcast = MiniJson.str(m["broadcast"])?.trim()?.takeIf { it.isNotEmpty() && it.length <= 40 }
            out.add(
                Match(
                    date, isHome, if (isHome) away else home, MiniJson.str(m["competition"]) ?: "", kickoff, score,
                    MiniJson.str(m["result"]), MiniJson.str(m["round"]) ?: "", broadcast,
                ),
            )
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

    // ── APP-위젯아스날맞춤 B(S47-63): 4×2·4×1 위젯이 쓸 순수 계산. 그리는 쪽(ArsenalWidget·레이아웃)은 C에서 붙인다. ──
    // 기준: docs/design/arsenal-widget-remaining.md 4절 B, 5절 결정 ②(끝나는 시각)·⑤(중계 없으면 비움)·⑥(FotMob 팀 페이지).

    /** 결정 ⑥: 경기별 주소 자료가 없으므로 FotMob 아스날 팀 페이지 고정. 버튼은 C에서 붙인다. */
    const val FOTMOB_URL = "https://www.fotmob.com/teams/9825/overview/arsenal"

    /** 결정 ②: 보통 경기 = 킥오프 + 2시간(전후반·휴식·추가시간). */
    const val MATCH_MINUTES = 120L

    /** 결정 ②: 연장·승부차기가 가능한 컵 경기 = 킥오프 + 2시간 30분. */
    const val CUP_MATCH_MINUTES = 150L

    private val CUPS = setOf("Carabao Cup", "FA Cup")

    /** 다음 경기: 점수가 없고 오늘 이후인 줄 중 가장 가까운 것(같은 날이면 이른 킥오프). */
    fun next(matches: List<Match>?, today: LocalDate): Match? =
        matches.orEmpty()
            .filter { it.score == null && !it.date.isBefore(today) }
            .minWithOrNull(compareBy<Match>({ it.date }, { it.kickoff ?: "99:99" }))

    /** 'D-day'(오늘), 'D-1', 'D-3' … 지난 날짜면 null. */
    fun dDay(match: Match, today: LocalDate): String? {
        val n = ChronoUnit.DAYS.between(today, match.date)
        return when {
            n < 0 -> null
            n == 0L -> "D-day"
            else -> "D-$n"
        }
    }

    /** 연장·승부차기가 있을 수 있는 경기: 국내 컵 두 개, 챔피언스리그는 리그 페이즈가 아닌 녹아웃 라운드. */
    fun mayGoToExtraTime(match: Match): Boolean =
        match.competition in CUPS ||
            (match.competition == "UEFA Champions League" && match.round.isNotBlank() && !match.round.startsWith("League Phase"))

    /** 킥오프(한국 시각) 날짜·시각. 킥오프가 없으면 null. */
    fun kickoffAt(match: Match): LocalDateTime? {
        val k = match.kickoff ?: return null
        val h = k.substring(0, 2).toIntOrNull() ?: return null
        val m = k.substring(3, 5).toIntOrNull() ?: return null
        return LocalDateTime.of(match.date, LocalTime.of(h, m))
    }

    /** 끝나는 시각(한국 시각) = 킥오프 + 2시간, 컵 연장 가능 경기 + 2시간 30분. 킥오프가 없으면 null. */
    fun endAt(match: Match): LocalDateTime? =
        kickoffAt(match)?.plusMinutes(if (mayGoToExtraTime(match)) CUP_MATCH_MINUTES else MATCH_MINUTES)

    /**
     * '다음 날 첫 일정'을 볼 날: 경기가 정오 전에 끝나면(새벽 경기) 그날 아침, 정오 이후에 끝나면 이튿날.
     * 예) 01:30 킥오프 → 03:30 끝 → 같은 날 / 21:00 킥오프 → 23:00 끝 → 다음 날.
     */
    fun wakeDay(end: LocalDateTime): LocalDate = if (end.hour < 12) end.toLocalDate() else end.toLocalDate().plusDays(1)

    /**
     * 끝난 뒤의 첫 일정 시작: [starts](시간 있는 일정의 시작, 한국 시각. 하루 종일 일정은 넣지 않음) 중
     * [wakeDay] 날짜에 있고 끝나는 시각 이후인 가장 이른 것. 없으면 null.
     */
    fun firstAfter(end: LocalDateTime, starts: List<LocalDateTime>): LocalDateTime? {
        val day = wakeDay(end)
        return starts.filter { it.toLocalDate() == day && it.isAfter(end) }.minOrNull()
    }

    /** 끝나는 시각부터 첫 일정까지 잘 수 있는 시간(시간 단위, 내림). 첫 일정이 없으면 null. */
    fun sleepHours(end: LocalDateTime, first: LocalDateTime?): Long? {
        val f = first ?: return null
        if (!f.isAfter(end)) return 0L
        return Duration.between(end, f).toHours()
    }

    /** 10/31 확정 문구: '생중계 보면 잠 n시간'. 첫 일정이 없으면 null(줄 생략). */
    fun sleepText(end: LocalDateTime, first: LocalDateTime?): String? =
        sleepHours(end, first)?.let { "생중계 보면 잠 ${it}시간" }

    /** 끝난 경기 한 줄의 승·무·패. result 칸이 있으면 그대로(승부차기 패 등), 없으면 점수로. */
    fun outcome(match: Match): String? {
        match.result?.takeIf { it == "승" || it == "무" || it == "패" }?.let { return it }
        val s = match.score ?: return null
        val dash = s.indexOf('-')
        if (dash <= 0) return null
        val us = s.substring(0, dash).toIntOrNull() ?: return null
        val them = s.substring(dash + 1).toIntOrNull() ?: return null
        return when {
            us > them -> "승"
            us < them -> "패"
            else -> "무"
        }
    }

    /** 최근 다섯 경기 승·무·패, 오래된 경기 → 최근 경기 순(왼쪽부터 읽음). 끝난 경기가 적으면 있는 만큼. */
    fun form(matches: List<Match>?, count: Int = 5): List<String> =
        matches.orEmpty()
            .filter { it.score != null }
            .sortedByDescending { it.date }
            .mapNotNull { outcome(it) }
            .take(count)
            .reversed()

    /** 글자 동그라미에 넣을 상대 팀 첫 글자(엠블럼 그림 안 씀). 영문은 대문자. 이름이 비면 '?'. */
    fun initial(name: String): String {
        val t = name.trim()
        if (t.isEmpty()) return "?"
        val cp = t.codePointAt(0)
        return String(Character.toChars(Character.toUpperCase(cp)))
    }
}
