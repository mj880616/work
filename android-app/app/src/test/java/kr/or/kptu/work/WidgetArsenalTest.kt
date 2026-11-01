package kr.or.kptu.work

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.time.LocalDate
import java.time.LocalDateTime

/** APP-위젯아스날맞춤 B(S47-63): 아스날 위젯 순수 계산(D-n·끝나는 시각·잠 n시간·최근 5경기·첫 글자). */
class WidgetArsenalTest {
    private fun d(y: Int, m: Int, day: Int) = LocalDate.of(y, m, day)
    private fun t(y: Int, m: Int, day: Int, h: Int, min: Int = 0) = LocalDateTime.of(y, m, day, h, min)

    private fun upcoming(
        date: LocalDate,
        kickoff: String?,
        competition: String = "Premier League",
        round: String = "9R",
        opponent: String = "리버풀",
    ) = WidgetArsenal.Match(date, false, opponent, competition, kickoff, null, null, round)

    private fun finished(date: LocalDate, score: String, result: String? = null) =
        WidgetArsenal.Match(date, true, "상대", "Premier League", null, score, result)

    private val sample = """window.ARSENAL_MATCHES = [
      {"id":"u1","upcoming":true,"date":"2026-11-02","kickoff":"01:30","competition":"Premier League","round":"9R","home":"리버풀","away":"아스날","broadcast":" 쿠팡플레이 "},
      {"id":"u2","upcoming":true,"date":"2026-11-05","kickoff":"05:00","competition":"UEFA Champions League","round":"League Phase MD4","home":"슬라비아 프라하","away":"아스날"},
      {"id":"u3","upcoming":true,"date":"2026-11-08","kickoff":"00:00","competition":"Premier League","round":"10R","home":"아스날","away":"헐 시티","broadcast":""},
      {"id":"f1","date":"2026-10-27","competition":"Carabao Cup","round":"4R","home":"플리트우드 타운","away":"아스날","homeScore":1,"awayScore":1,"result":"패"}
    ];"""

    @Test
    fun parseKeepsRoundAndOptionalBroadcast() {
        val list = WidgetArsenal.parse(sample)!!
        assertEquals(4, list.size)
        assertEquals("9R", list[0].round)
        assertEquals("쿠팡플레이", list[0].broadcast)
        // 결정 ⑤: 중계를 못 찾으면 칸이 없거나 비어 있다 → null(위젯은 그 줄을 생략).
        assertNull(list[1].broadcast)
        assertNull(list[2].broadcast)
        assertEquals("League Phase MD4", list[1].round)
        // 기존 두 줄 모양은 그대로.
        assertEquals("다음 11.2(월) 01:30 원정 리버풀", WidgetArsenal.content(list, d(2026, 11, 1)).top)
    }

    @Test
    fun nextPicksNearestUnplayedAndEarlierKickoffOnSameDay() {
        val list = WidgetArsenal.parse(sample)!!
        assertEquals("리버풀", WidgetArsenal.next(list, d(2026, 11, 1))!!.opponent)
        assertEquals("리버풀", WidgetArsenal.next(list, d(2026, 11, 2))!!.opponent)
        assertEquals("슬라비아 프라하", WidgetArsenal.next(list, d(2026, 11, 3))!!.opponent)
        assertNull(WidgetArsenal.next(list, d(2026, 11, 9)))
        assertNull(WidgetArsenal.next(null, d(2026, 11, 1)))
        val late = upcoming(d(2026, 11, 2), "20:00", opponent = "늦은")
        val early = upcoming(d(2026, 11, 2), "01:30", opponent = "이른")
        assertEquals("이른", WidgetArsenal.next(listOf(late, early), d(2026, 11, 1))!!.opponent)
    }

    @Test
    fun dDayCountsKoreanCalendarDays() {
        val m = upcoming(d(2026, 11, 2), "01:30")
        assertEquals("D-1", WidgetArsenal.dDay(m, d(2026, 11, 1)))
        assertEquals("D-day", WidgetArsenal.dDay(m, d(2026, 11, 2)))
        assertEquals("D-7", WidgetArsenal.dDay(m, d(2026, 10, 26)))
        assertNull(WidgetArsenal.dDay(m, d(2026, 11, 3)))
    }

    @Test
    fun endTimeIsKickoffPlusTwoHoursAndCupsPlusTwoAndAHalf() {
        // 결정 ②: 보통 + 2시간.
        assertEquals(t(2026, 11, 2, 3, 30), WidgetArsenal.endAt(upcoming(d(2026, 11, 2), "01:30")))
        // 리그 페이즈 챔피언스리그도 연장 없음.
        assertEquals(t(2026, 11, 5, 7, 0), WidgetArsenal.endAt(upcoming(d(2026, 11, 5), "05:00", "UEFA Champions League", "League Phase MD4")))
        // 컵(연장·승부차기 가능)은 + 2시간 30분, 자정을 넘기면 다음 날.
        assertEquals(t(2026, 12, 18, 6, 15), WidgetArsenal.endAt(upcoming(d(2026, 12, 18), "03:45", "Carabao Cup", "QF")))
        assertEquals(t(2027, 1, 11, 1, 30), WidgetArsenal.endAt(upcoming(d(2027, 1, 10), "23:00", "FA Cup", "3R")))
        assertEquals(t(2027, 3, 11, 7, 30), WidgetArsenal.endAt(upcoming(d(2027, 3, 11), "05:00", "UEFA Champions League", "Round of 16")))
        assertTrue(WidgetArsenal.mayGoToExtraTime(upcoming(d(2027, 3, 11), "05:00", "UEFA Champions League", "Round of 16")))
        assertFalse(WidgetArsenal.mayGoToExtraTime(upcoming(d(2026, 11, 5), "05:00", "UEFA Champions League", "League Phase MD4")))
        // 킥오프 없으면 계산하지 않음.
        assertNull(WidgetArsenal.endAt(upcoming(d(2026, 11, 2), null)))
    }

    @Test
    fun sleepUntilFirstEventOfTheWakeDay() {
        // 새벽 경기: 03:30 끝 → 같은 날 09:00 첫 일정 → 5시간(내림).
        val dawnEnd = t(2026, 11, 2, 3, 30)
        assertEquals(d(2026, 11, 2), WidgetArsenal.wakeDay(dawnEnd))
        val starts = listOf(t(2026, 11, 2, 14, 0), t(2026, 11, 2, 9, 0), t(2026, 11, 1, 20, 0), t(2026, 11, 3, 8, 0))
        val first = WidgetArsenal.firstAfter(dawnEnd, starts)
        assertEquals(t(2026, 11, 2, 9, 0), first)
        assertEquals(5L, WidgetArsenal.sleepHours(dawnEnd, first))
        assertEquals("생중계 보면 잠 5시간", WidgetArsenal.sleepText(dawnEnd, first))

        // 저녁 경기: 23:00 끝 → 다음 날 첫 일정.
        val eveningEnd = t(2026, 11, 8, 23, 0)
        assertEquals(d(2026, 11, 9), WidgetArsenal.wakeDay(eveningEnd))
        val next = WidgetArsenal.firstAfter(eveningEnd, listOf(t(2026, 11, 8, 23, 30), t(2026, 11, 9, 7, 30)))
        assertEquals(t(2026, 11, 9, 7, 30), next)
        assertEquals(8L, WidgetArsenal.sleepHours(eveningEnd, next))

        // 그날 일정이 없으면 줄 생략.
        assertNull(WidgetArsenal.firstAfter(dawnEnd, listOf(t(2026, 11, 3, 9, 0))))
        assertNull(WidgetArsenal.sleepText(dawnEnd, null))
        // 첫 일정이 끝나는 시각보다 이르면 0시간.
        assertEquals(0L, WidgetArsenal.sleepHours(dawnEnd, t(2026, 11, 2, 3, 0)))
    }

    @Test
    fun formIsLastFiveOldestFirstAndTrustsResultField() {
        val list = listOf(
            finished(d(2026, 10, 1), "2-0"),
            finished(d(2026, 10, 5), "0-1"),
            finished(d(2026, 10, 10), "1-1"),
            finished(d(2026, 10, 15), "3-1"),
            finished(d(2026, 10, 20), "0-0"),
            // 승부차기 패: 점수는 1-1이지만 result 칸이 '패'.
            finished(d(2026, 10, 27), "1-1", "패"),
            upcoming(d(2026, 11, 2), "01:30"),
        )
        assertEquals(listOf("패", "무", "승", "무", "패"), WidgetArsenal.form(list))
        assertEquals(listOf("승", "패"), WidgetArsenal.form(list.take(2)))
        assertEquals(emptyList<String>(), WidgetArsenal.form(null))
        assertEquals("패", WidgetArsenal.outcome(WidgetArsenal.parse(sample)!![3]))
        assertNull(WidgetArsenal.outcome(upcoming(d(2026, 11, 2), "01:30")))
    }

    @Test
    fun initialIsFirstLetterForTheCircle() {
        assertEquals("리", WidgetArsenal.initial("리버풀"))
        assertEquals("헐", WidgetArsenal.initial(" 헐 시티"))
        assertEquals("C", WidgetArsenal.initial("chelsea"))
        assertEquals("?", WidgetArsenal.initial("  "))
    }

    @Test
    fun fotmobIsFixedTeamPageAndWidgetDrawingIsUntouched() {
        assertTrue(WidgetArsenal.FOTMOB_URL.startsWith("https://www.fotmob.com/teams/"))
        // B는 계산만: 그리는 쪽(ArsenalWidget)은 새 계산을 아직 부르지 않는다(C에서 붙임).
        val drawer = File("src/main/java/kr/or/kptu/work/ArsenalWidget.kt").readText()
        for (name in listOf("dDay(", "endAt(", "sleepText(", "form(", "initial(")) {
            assertFalse(name, drawer.contains("WidgetArsenal.$name"))
        }
    }
}
