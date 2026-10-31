package kr.or.kptu.work

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.time.ZoneId
import java.time.ZonedDateTime
import javax.xml.parsers.DocumentBuilderFactory
import org.w3c.dom.Element

/**
 * FIX-위젯: 위젯이 빈칸·'불러오는 중'에 멈추던 문제(0.3.5~0.3.7).
 * 원인: WidgetToday의 정규식 (?U)가 안드로이드(ICU)에서 PatternSyntaxException → WidgetToday 초기화 실패 →
 * 그 객체를 쓰는 오늘·이번 주·텔레그램·아스날 그리기와 갱신 작업이 모두 예외로 끝남. JVM에서는 (?U)가 되어 시험이 못 잡았다.
 */
class WidgetRefreshTest {
    private val src = File("src/main/java/kr/or/kptu/work")
    private val now = ZonedDateTime.of(2026, 10, 30, 19, 12, 0, 0, ZoneId.of("Asia/Seoul")).toInstant().toEpochMilli()

    private fun reply(status: Int, json: String?) = WidgetSession.Reply(status, MiniJson.parse(json))

    // 지금 서버 응답 모양(google-calendar normEvent·google-tasks overview·PostgREST 표)을 본뜬 가짜 값. 지금은 금 10/30 19:12(서울).
    private fun ev(id: String, title: String, start: String, end: String, allDay: Boolean) =
        """{"id":"$id","title":"$title","start":"$start","end":"$end","allDay":$allDay,"location":"","description":"","calendarId":"primary","colorId":null,"color":null,"htmlLink":"","organizationIds":[],"recurring":false,"mine":true,"source":"google"}"""
    private val e1 = ev("e1", "운영위 회의", "2026-10-30T10:00:00+09:00", "2026-10-30T11:00:00+09:00", false)
    private val e2 = ev("e2", "창립 기념일", "2026-10-30", "2026-10-31", true)
    private val e4 = ev("e4", "평가회의", "2026-10-30T20:30:00+09:00", "2026-10-30T21:30:00+09:00", false)
    private val e5 = ev("e5", "주말 당직", "2026-10-31", "2026-11-01", true)
    private val e3 = ev("e3", "교섭", "2026-11-01T14:00:00+09:00", "2026-11-01T16:00:00+09:00", false)
    // 서버가 timeMin~timeMax로 거른 답: '지금'은 오늘~모레 0시, '이번 주'는 월~다음 월.
    private val today = """{"events":[$e1,$e2,$e4,$e5],"colors":{},"eventColors":{}}"""
    private val week = """{"events":[$e1,$e2,$e4,$e5,$e3],"colors":{},"eventColors":{}}"""
    private val tasks = """{"connected":true,"authorized":true,"needs_reconnect":false,"email":null,"tasks":[
        {"id":"t1","title":"보고서 보내기","notes":"","due":"2026-10-30T00:00:00.000Z","status":"needsAction","completed":null,"updated":null,"taskListId":"@default","taskListTitle":"내 할 일","position":null,"webViewLink":null,"source":"google-task"},
        {"id":"t2","title":"지난 일","notes":"","due":"2026-10-28T00:00:00.000Z","status":"needsAction","completed":null,"updated":null,"taskListId":"@default","taskListTitle":"내 할 일","position":null,"webViewLink":null,"source":"google-task"}
      ]}"""
    private val candidates = """[{"source_kind":"telegram","summary":"자료 부탁"},{"source_kind":"meeting","summary":"보고서 보내기"},{"source_kind":"note","summary":"현수막 주문"}]"""

    private fun serverReplies(plan: WidgetRefresh): List<WidgetSession.Reply> = plan.urls.map { url ->
        when (url) {
            plan.nowCal -> reply(200, today)
            plan.weekCal -> reply(200, week)
            WidgetRules.TASKS -> reply(200, tasks)
            WidgetRules.CANDIDATES -> reply(200, candidates)
            else -> throw AssertionError(url)
        }
    }

    @Test
    fun noJavaOnlyRegexFlagsInAppCode() {
        // 안드로이드 정규식(ICU)의 줄 안 표시는 i·m·s·x·w뿐. (?U)·(?u)·(?d)·UNICODE_CHARACTER_CLASS·CANON_EQ는 기기에서 예외.
        // CI는 scripts/check-icu-regex.py로 실제 ICU에도 만들어 본다.
        val inline = Regex("""\(\?([A-Za-z-]+)[:)]""")
        src.listFiles()!!.filter { it.name.endsWith(".kt") }.forEach { f ->
            val text = f.readText()
            assertFalse(f.name, text.contains("UNICODE_CHARACTER_CLASS") || text.contains("CANON_EQ"))
            inline.findAll(text).forEach { m ->
                assertTrue("${f.name}: ${m.value}", m.groupValues[1].all { it in "imsxw-" })
            }
        }
    }

    @Test
    fun titleNoiseMatchesWebRule() {
        // 웹 /[\s\p{P}\p{S}]+/gu와 같게: 유니코드 줄 나눔(2028)·폭 없는 공백(FEFF)·문장부호·기호를 뺀다.
        assertEquals("abc", WidgetNow.normalizeTitle("A b﻿ c"))
        assertEquals("회의준비", WidgetNow.normalizeTitle("회의 준비！★"))
        assertEquals("보고서보내기", WidgetNow.normalizeTitle(" 보고서, 보내기! "))
    }

    @Test
    fun nowAndWeekFromServerShapes() {
        val plan = WidgetRefresh(now = true, week = true, nowMs = now)
        // 겹치는 주소(할 일·후보)는 한 번만, 모두 허용 주소. 텔레그램 읽기는 없다(위젯 지움).
        assertEquals(plan.urls.toSet().size, plan.urls.size)
        assertEquals(4, plan.urls.size)
        plan.urls.forEach { assertTrue(it, WidgetRules.allowed("GET", it)) }
        assertFalse(plan.urls.any { it.contains("feed") || it.contains("app_my_features") })
        val r = plan.result(WidgetSession.Outcome.Ok(serverReplies(plan)))

        val nw = (r.now as WidgetRefresh.Paint.Shown<WidgetNow.Content>).content
        assertEquals(WidgetNow.Next("20:30", "평가회의", "1시간 18분 뒤", java.time.LocalDate.of(2026, 10, 30)), nw.next)
        assertEquals("그다음 · 내일 종일 주말 당직", nw.after)
        // '보고서 보내기'는 이미 할 일이라 빼고 2건, 그중 텔레그램 1건.
        assertEquals(WidgetNow.Line(1, "자료 부탁"), nw.asks)
        assertEquals(WidgetNow.Line(2, "현수막 주문"), nw.todo)
        assertEquals(WidgetNow.Line(2, "지남 · 지난 일"), nw.due)
        assertNull(nw.note)

        val wk = (r.week as WidgetRefresh.Paint.Shown<WidgetWeek.Content>).content
        assertEquals("이번 주 10/26–11/1", wk.title)
        assertEquals(5, wk.total)
        assertEquals(listOf(0, 0, 0, 0, 3, 1, 1), wk.days.map { it.count })
        assertEquals(WidgetWeek.Pick(java.time.LocalDate.of(2026, 11, 1), "D-2", "일 14:00 교섭"), wk.big)
        assertEquals(WidgetWeek.Pick(java.time.LocalDate.of(2026, 11, 2), "월", "11/2 상집 보고일"), wk.report)
        assertEquals(WidgetWeek.Pick(java.time.LocalDate.of(2026, 10, 30), "금", "일정 3개 몰림 · 운영위 회의 10:00부터"), wk.busy)
        assertEquals(listOf(false, false, false, false, false, false, true), wk.days.map { it.hot })
        assertEquals(listOf(false, false, false, false, true, false, false), wk.days.map { it.busy })
    }

    @Test
    fun oneWidgetFailureDoesNotBlockOthers() {
        val plan = WidgetRefresh(now = true, week = true, nowMs = now)
        // 0.3.7의 실제 실패 모양(클래스 초기화 오류)을 '지금' 위젯에만 일으킨다.
        val r = plan.result(
            WidgetSession.Outcome.Ok(serverReplies(plan)),
            nowContent = { _, _ -> throw ExceptionInInitializerError(IllegalArgumentException("regex")) },
        )
        assertEquals(WidgetRefresh.Paint.Failed, r.now)
        assertTrue(r.week is WidgetRefresh.Paint.Shown)

        val r2 = plan.result(WidgetSession.Outcome.Ok(serverReplies(plan)), weekContent = { _, _, _ -> throw NoClassDefFoundError("x") })
        assertTrue(r2.now is WidgetRefresh.Paint.Shown)
        assertEquals(WidgetRefresh.Paint.Failed, r2.week)

        // 울타리: 앞이 실패해도 뒤를 한다.
        val done = ArrayList<String>()
        val failed = WidgetGuard.each(
            listOf<Pair<String, () -> Unit>>(
                "arsenal" to { throw ExceptionInInitializerError() },
                "now" to { done.add("now"); Unit },
                "x" to { throw IllegalStateException() },
                "week" to { done.add("week"); Unit },
            ),
        )
        assertEquals(listOf("arsenal", "x"), failed)
        assertEquals(listOf("now", "week"), done)
        assertNull(WidgetGuard.get<String> { throw NoClassDefFoundError("x") })
    }

    @Test
    fun signedOutAndFailedReachEveryWidget() {
        val plan = WidgetRefresh(now = true, week = false, nowMs = now)
        val out = plan.result(WidgetSession.Outcome.SignedOut)
        assertEquals(WidgetRefresh.Paint.SignedOut, out.now)
        assertNull(out.week)
        val down = plan.result(WidgetSession.Outcome.Failed("network"))
        assertEquals(WidgetRefresh.Paint.Failed, down.now)
        // 답 수가 맞지 않으면 엉뚱한 칸에 그리지 않고 실패로.
        val short = plan.result(WidgetSession.Outcome.Ok(listOf(reply(200, "{}"))))
        assertEquals(WidgetRefresh.Paint.Failed, short.now)
        val both = WidgetRefresh(now = true, week = true, nowMs = now)
        val signedOut = both.result(WidgetSession.Outcome.SignedOut)
        assertEquals(WidgetRefresh.Paint.SignedOut, signedOut.week)
    }

    @Test
    fun refreshNowIsExpeditedAndRunsOnOpenAndLogin() {
        assertTrue(WidgetRefresh.expedite(31))
        assertTrue(WidgetRefresh.expedite(36))
        assertFalse(WidgetRefresh.expedite(30))
        assertFalse(WidgetRefresh.expedite(29))
        // 앱을 열 때: 처음이거나 5분이 지났을 때만(배터리).
        assertTrue(WidgetRefresh.dueOnOpen(now, 0L))
        assertFalse(WidgetRefresh.dueOnOpen(now, now - 60_000))
        assertTrue(WidgetRefresh.dueOnOpen(now, now - WidgetRefresh.OPEN_REFRESH_AFTER_MS))
        assertTrue(WidgetRefresh.dueOnOpen(now, now + 60_000))

        val jobs = File(src, "NowWidget.kt").readText()
        assertTrue(jobs.contains("builder.setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)"))
        assertTrue(jobs.contains("if (WidgetRefresh.expedite(Build.VERSION.SDK_INT))"))
        // 위젯 로그인 직후에는 도는 작업을 새로 바꾼다.
        assertTrue(jobs.contains("WidgetJobs.refreshNow(context, replace = true)"))
        // 갱신 작업은 위젯마다 울타리 안에서, 아스날은 따로.
        assertTrue(jobs.contains("WidgetGuard.run { refreshSigned(ctx, now, week, at) }"))
        assertTrue(jobs.contains("WidgetGuard.run { ArsenalWidget.refresh(ctx, WidgetHub.session(ctx), at) }"))
        val main = File(src, "MainActivity.kt").readText()
        assertTrue(main.contains("WidgetGuard.run { WidgetJobs.refreshOnOpen(applicationContext) }"))
        // 놓을 때(onUpdate)도 바로 한 번.
        for (name in listOf("NowWidget.kt", "WeekWidget.kt", "ArsenalWidget.kt")) {
            assertTrue(name, File(src, name).readText().contains("WidgetJobs.refreshNow(context)"))
        }
    }

    private val android = "http://schemas.android.com/apk/res/android"

    private fun view(path: String, id: String): Element {
        val doc = DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }.newDocumentBuilder().parse(File(path))
        val all = doc.getElementsByTagName("TextView")
        for (i in 0 until all.length) {
            val e = all.item(i) as Element
            if (e.getAttributeNS(android, "id") == "@+id/$id") return e
        }
        throw AssertionError("$path $id")
    }

    @Test
    fun initialLayoutsAreNeverBlank() {
        // 놓자마자·앱이 그리기 전에도 빈칸이 아니게: 머리와 '불러오는 중'이 기본으로 보인다.
        val cases = listOf(
            Triple("now_widget", "now_label" to "다음 일정", "now_note"),
            Triple("week_widget", "week_title" to "이번 주", "week_note"),
            Triple("arsenal_widget", "ars_top" to "아스날", "ars_bottom"),
        )
        for ((layout, title, note) in cases) {
            val path = "src/main/res/layout/$layout.xml"
            assertEquals(layout, title.second, view(path, title.first).getAttributeNS(android, "text"))
            val n = view(path, note)
            assertEquals(layout, "불러오는 중", n.getAttributeNS(android, "text"))
            assertFalse(layout, n.getAttributeNS(android, "visibility") == "gone")
        }
        // 위젯 로그인이 없을 때 두 위젯이 같은 한 줄. 지운 위젯 파일은 없다.
        assertFalse(File(src, "TodayWidget.kt").exists() || File(src, "TelegramWidget.kt").exists() || File(src, "WidgetTelegram.kt").exists())
        for (name in listOf("NowWidget.kt", "WeekWidget.kt")) {
            val text = File(src, name).readText()
            assertTrue(name, text.contains("HomeWidgets.SIGNED_OUT_LINE"))
            assertTrue(name, text.contains("WidgetGuard.run { draw(context, state, manager, ids) }") || text.contains("WidgetGuard.run { paint(context, state, manager, ids) }"))
        }
    }
}
