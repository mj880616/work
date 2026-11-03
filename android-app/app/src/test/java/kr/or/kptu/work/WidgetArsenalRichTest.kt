package kr.or.kptu.work

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.time.LocalDate
import java.time.LocalDateTime

/** APP-아스날위젯알차게(S48-55): 4×2를 빈칸 없이 — 최근 5경기·지난 경기 리뷰·경기 끝난 뒤 결과·다음 경기·줄임 글자. */
class WidgetArsenalRichTest {
    private val sample = """window.ARSENAL_MATCHES = [
      {"id":"2026-11-04-slavia-praha-away-ucl","upcoming":true,"date":"2026-11-05","kickoff":"05:00","competition":"UEFA Champions League","round":"League Phase MD4","home":"슬라비아 프라하","away":"아스날"},
      {"id":"2026-11-07-hull-home","upcoming":true,"date":"2026-11-08","kickoff":"00:00","competition":"Premier League","round":"10R","home":"아스날","away":"헐 시티"},
      {"id":"2026-11-21-newcastle-away","upcoming":true,"date":"2026-11-22","kickoff":"02:30","competition":"Premier League","round":"11R","home":"뉴캐슬 유나이티드","away":"아스날"},
      {"id":"2026-12-02-zorya-away","upcoming":true,"date":"2026-12-02","kickoff":"02:45","competition":"FA Cup","round":"3R","home":"조르야","away":"아스날"},
      {"id":"2026-11-01-liverpool-away","date":"2026-11-01","competition":"Premier League","round":"9R","home":"리버풀","away":"아스날","homeScore":0,"awayScore":1,"result":"승",
       "subtitle":"하베르츠의 16분 골 하나를 끝까지 지켜 선두를 되찾았음. 둘째 문장은 안 나옴.",
       "goals":[{"side":"away","minute":"16","scorer":"Kai Havertz","assist":"Declan Rice","type":"goal"},{"side":"home","minute":"80","scorer":"Mo Salah","type":"goal"}]},
      {"id":"2026-10-27-fleetwood-away-carabao","date":"2026-10-27","competition":"Carabao Cup","round":"4R","home":"플리트우드 타운","away":"아스날","homeScore":1,"awayScore":1,"result":"패","verdict":"승부차기에서 졌음! 다음 문장"},
      {"id":"2026-10-22-lille-home-ucl","date":"2026-10-22","competition":"UEFA Champions League","round":"League Phase MD3","home":"아스날","away":"릴","homeScore":3,"awayScore":0,"result":"승",
       "goals":[{"side":"home","minute":"64","scorer":"Jurriën Timber","type":"goal"},{"side":"home","minute":"67","scorer":"Bukayo Saka","type":"penalty"},{"side":"home","minute":"71","scorer":"Bukayo Saka","type":"goal"},{"side":"away","minute":"75","scorer":"X Y","type":"own-goal"}]},
      {"id":"2026-10-18-forest-home","date":"2026-10-18","competition":"Premier League","round":"8R","home":"아스날","away":"노팅엄 포리스트","homeScore":1,"awayScore":0},
      {"id":"2026-10-10-leeds-away","date":"2026-10-10","competition":"Premier League","round":"7R","home":"리즈 유나이티드","away":"아스날","homeScore":2,"awayScore":2},
      {"id":"bad id with space","date":"2026-10-01","competition":"Premier League","home":"아스날","away":"번리","homeScore":0,"awayScore":1,
       "goals":[{"side":"away","minute":"5","scorer":"B","type":"goal"},{"side":"home","minute":"","scorer":"빈 분","type":"goal"}]}
    ];"""

    private val list = WidgetArsenal.parse(sample)!!
    private fun at(m: Int, d: Int, h: Int, min: Int = 0) = LocalDateTime.of(2026, m, d, h, min)

    @Test
    fun parseKeepsIdReviewAndOnlyOurGoals() {
        val liv = list.first { it.opponent == "리버풀" }
        assertEquals("2026-11-01-liverpool-away", liv.id)
        assertEquals("하베르츠의 16분 골 하나를 끝까지 지켜 선두를 되찾았음.", liv.review)
        assertEquals(listOf(WidgetArsenal.Goal("16", "Kai Havertz", "goal")), liv.goals)
        // 리뷰 첫 문장이 없으면 판정 첫 문장.
        assertEquals("승부차기에서 졌음!", list.first { it.opponent == "플리트우드 타운" }.review)
        // id 모양이 아니면 비우고(주소에 넣지 않음), 분이 빈 골은 버린다. 상대 골은 안 넣는다.
        val burnley = list.first { it.opponent == "번리" }
        assertEquals("", burnley.id)
        assertEquals(emptyList<WidgetArsenal.Goal>(), burnley.goals)
        // 예전 모양(리뷰·골 없음)도 그대로 읽힌다.
        assertNull(list.first { it.opponent == "노팅엄 포리스트" }.review)
    }

    @Test
    fun firstSentenceCutsAtSentenceEndOnly() {
        assertEquals("점수는 2.5골 기대값이었음.", WidgetArsenal.firstSentence("점수는 2.5골 기대값이었음. 다음"))
        assertEquals("마침표 없음", WidgetArsenal.firstSentence("  마침표   없음 "))
        assertNull(WidgetArsenal.firstSentence("   "))
        assertNull(WidgetArsenal.firstSentence(null))
        val long = WidgetArsenal.firstSentence("가".repeat(200))!!
        assertEquals(120, long.length)
        assertTrue(long.endsWith("…"))
    }

    @Test
    fun codesTagsAndScorers() {
        assertEquals("LIV", WidgetArsenal.code(list.first { it.opponent == "리버풀" }))
        assertEquals("SLA", WidgetArsenal.code(list.first { it.opponent == "슬라비아 프라하" }))
        // 표에 없는 팀은 경기 id 영문 이름 앞 세 글자, id도 없으면 첫 글자.
        assertEquals("ZOR", WidgetArsenal.code(list.first { it.opponent == "조르야" }))
        assertEquals("번", WidgetArsenal.code(WidgetArsenal.Match(LocalDate.of(2026, 1, 1), true, "번개", "", null, null, null)))
        assertEquals("UCL", WidgetArsenal.tag(list.first { it.opponent == "릴" }))
        assertEquals("EFL", WidgetArsenal.tag(list.first { it.opponent == "플리트우드 타운" }))
        assertEquals("FA", WidgetArsenal.tag(list.first { it.opponent == "조르야" }))
        assertEquals("PL", WidgetArsenal.tag(list.first { it.opponent == "리버풀" }))
        assertEquals("Havertz 16'", WidgetArsenal.scorers(list.first { it.opponent == "리버풀" }))
        assertEquals("Timber 64', Saka 67'(PK) 71'", WidgetArsenal.scorers(list.first { it.opponent == "릴" }))
        assertNull(WidgetArsenal.scorers(list.first { it.opponent == "노팅엄 포리스트" }))
        val og = WidgetArsenal.Match(LocalDate.of(2026, 1, 1), true, "A", "", null, "1-0", null, goals = listOf(WidgetArsenal.Goal("9", "Z Q", "own-goal")))
        assertEquals("자책골 9'", WidgetArsenal.scorers(og))
    }

    @Test
    fun normalModeFillsEveryRow() {
        // 11/3 낮: 리버풀전(11/1)은 결과 보여 주는 때(다음 날 21시)가 지남 → 다음 경기 모드.
        val r = WidgetArsenal.rich(list, at(11, 3, 12), WidgetArsenal.Mine.SignedOut, hide = false)
        assertFalse(r.post)
        assertEquals("SLA", r.headCode)
        assertEquals("UCL", r.headTag)
        assertEquals("✈원정", r.headSide)
        assertEquals("원정 슬라비아 프라하", r.title)
        assertEquals("D-2", r.badge)
        assertTrue(r.line2, r.line2.startsWith("끝 07:00 · "))
        assertEquals("지난 11.1 PL 원정 리버풀 1-0", r.formLine)
        assertEquals("“하베르츠의 16분 골 하나를 끝까지 지켜 선두를 되찾았음.”", r.review)
        assertEquals("2026-11-01-liverpool-away", r.reviewId)
        // 맨 위 경기는 빼고 그다음 경기들(최대 3).
        assertEquals(listOf("HUL", "NEW", "ZOR"), r.next3.map { it.code })
        assertEquals(WidgetArsenal.Mini("11.8 00:00", "PL", "⌂", "HUL", "헐 시티"), r.next3[0])
        assertEquals(listOf("무", "승", "승", "패", "승"), r.card.form)
        for (s in listOf(r.title, r.sub, r.line2, r.formLine, r.wideTop, r.wideBottom, r.smallTop, r.smallBottom)) assertTrue(s.isNotBlank())
    }

    @Test
    fun postModeShowsResultUntilNextEvening() {
        // 경기 날 아침부터 다음 날 21:00까지 결과·골 넣은 선수가 맨 위.
        for (now in listOf(at(11, 1, 0, 0), at(11, 1, 9), at(11, 2, 21, 0))) {
            val r = WidgetArsenal.rich(list, now, WidgetArsenal.Mine.SignedOut, hide = false)
            assertTrue(now.toString(), r.post)
            assertEquals("원정 리버풀 1-0 승", r.title)
            assertEquals("LIV", r.headCode)
            assertEquals("결과", r.badge)
            assertEquals("⚽ Havertz 16'", r.line2)
            assertEquals("프리미어리그 9R · 11.1(일)", r.sub)
            assertTrue(r.formLine, r.formLine.startsWith("다음 "))
            // 결과 모드에서는 맨 위가 끝난 경기라 다음 경기부터 셋.
            assertEquals(listOf("SLA", "HUL", "NEW"), r.next3.map { it.code })
            assertEquals("리버풀 1-0 승", r.smallTop)
            assertEquals("⚽ Havertz 16'", r.smallBottom)
            assertEquals("원정 리버풀 1-0 승", r.wideTop)
        }
        assertFalse(WidgetArsenal.rich(list, at(11, 2, 21, 1), WidgetArsenal.Mine.SignedOut, false).post)
        // 무득점 경기는 '아스날 득점 없음'.
        val nil = listOf(WidgetArsenal.Match(LocalDate.of(2026, 11, 1), true, "첼시", "Premier League", null, "0-0", null))
        assertEquals("⚽ 아스날 득점 없음", WidgetArsenal.rich(nil, at(11, 1, 23), WidgetArsenal.Mine.SignedOut, false).line2)
    }

    @Test
    fun hideNeverRevealsScoreOrReview() {
        for (now in listOf(at(11, 1, 9), at(11, 3, 12))) {
            val r = WidgetArsenal.rich(list, now, WidgetArsenal.Mine.SignedOut, hide = true)
            assertFalse(r.post)
            assertEquals(WidgetArsenal.HIDDEN_LINE, r.review)
            assertEquals(emptyList<String>(), r.card.form)
            for (s in listOf(r.title, r.sub, r.line2, r.formLine, r.wideTop, r.wideBottom, r.smallTop, r.smallBottom, r.review!!)) {
                assertFalse(s, s.contains("1-0") || s.contains("Havertz") || s.contains("되찾았음"))
            }
        }
    }

    @Test
    fun placeholderAndSizes() {
        val p = WidgetArsenal.richPlaceholder("불러오는 중")
        assertEquals("불러오는 중", p.line2)
        assertEquals(emptyList<WidgetArsenal.Mini>(), p.next3)
        assertNull(p.review)
        assertTrue(WidgetArsenal.tall(WidgetArsenal.Size.SMALL, 110))
        assertFalse(WidgetArsenal.tall(WidgetArsenal.Size.SMALL, 60))
        assertTrue(WidgetArsenal.tall(WidgetArsenal.Size.BIG, 180))
        assertFalse(WidgetArsenal.tall(WidgetArsenal.Size.BIG, 110))
        assertFalse(WidgetArsenal.tall(WidgetArsenal.Size.WIDE, 300))
    }

    @Test
    fun matchUrlOnlyCarriesSafeIds() {
        assertEquals(ShellRules.HOME + "?view=arsenal&match=2026-11-01-liverpool-away", WidgetArsenal.matchUrl("2026-11-01-liverpool-away"))
        assertEquals(ShellRules.HOME + "?view=arsenal", WidgetArsenal.matchUrl(null))
        assertEquals(ShellRules.HOME + "?view=arsenal", WidgetArsenal.matchUrl("a&b=c"))
        assertEquals(ShellRules.HOME + "?view=arsenal", WidgetArsenal.matchUrl("x".repeat(81)))
        // 폰 앱이 받아 주는 웹2 주소 모양 안(새 주소·권한 없음).
        assertTrue(ShellRules.isInternalApp(WidgetArsenal.matchUrl("2026-11-01-liverpool-away")))
    }

    @Test
    fun widgetUsesOnlyExistingDataAndNoStorage() {
        val src = File("src/main/java/kr/or/kptu/work/ArsenalWidget.kt").readText()
        // 경기 자료는 기존 공개 파일 하나(새 외부 주소 없음), 그림을 받거나 저장하지 않는다.
        assertTrue(src.contains("session.readPublic(WidgetRules.ARSENAL)"))
        for (bad in listOf("http://", "setImageViewUri", "setImageViewBitmap", "BitmapFactory", "cacheDir", "putString(")) assertFalse(bad, src.contains(bad))
        val model = File("src/main/java/kr/or/kptu/work/WidgetArsenal.kt").readText()
        assertEquals(listOf(WidgetArsenal.FOTMOB_URL), Regex("https://[^\"]+").findAll(model).map { it.value }.toList())
        // 4×2 화면 틀에 이번 줄이 모두 있다.
        val big = File("src/main/res/layout/arsenal_widget.xml").readText()
        for (id in listOf("ars_home_code", "ars_tag", "ars_side", "ars_f0", "ars_f4", "ars_last", "ars_review", "ars_n0", "ars_n2_text", "ars_cal", "ars_fotmob")) {
            assertTrue(id, big.contains("@+id/$id\""))
        }
        assertTrue(File("src/main/res/layout/arsenal_widget_small.xml").readText().contains("@+id/ars_formrow\""))
    }
}
