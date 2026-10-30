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

    // 지금 서버 응답 모양(google-calendar normEvent·google-tasks overview·PostgREST 표·rpc text[])을 본뜬 가짜 값.
    private val week = """{"events":[
        {"id":"e1","title":"운영위 회의","start":"2026-10-30T10:00:00+09:00","end":"2026-10-30T11:00:00+09:00","allDay":false,"location":"","description":"","calendarId":"primary","colorId":null,"color":null,"htmlLink":"","organizationIds":[],"recurring":false,"mine":true,"source":"google"},
        {"id":"e2","title":"창립 기념일","start":"2026-10-30","end":"2026-10-31","allDay":true,"location":"","description":"","calendarId":"primary","colorId":null,"color":null,"htmlLink":"","organizationIds":[],"recurring":false,"mine":true,"source":"google"},
        {"id":"e3","title":"교섭","start":"2026-11-01T14:00:00+09:00","end":"2026-11-01T16:00:00+09:00","allDay":false,"location":"","description":"","calendarId":"primary","colorId":null,"color":null,"htmlLink":"","organizationIds":[],"recurring":false,"mine":true,"source":"google"}
      ],"colors":{},"eventColors":{}}"""
    // 서버가 timeMin~timeMax로 거른 오늘 답(오늘 일정 둘).
    private val today = week.replace(Regex(""",\s*\{"id":"e3"[^}]*\}"""), "")
    private val tasks = """{"connected":true,"authorized":true,"needs_reconnect":false,"email":null,"tasks":[
        {"id":"t1","title":"보고서 보내기","notes":"","due":"2026-10-30T00:00:00.000Z","status":"needsAction","completed":null,"updated":null,"taskListId":"@default","taskListTitle":"내 할 일","position":null,"webViewLink":null,"source":"google-task"},
        {"id":"t2","title":"지난 일","notes":"","due":"2026-10-28T00:00:00.000Z","status":"needsAction","completed":null,"updated":null,"taskListId":"@default","taskListTitle":"내 할 일","position":null,"webViewLink":null,"source":"google-task"}
      ]}"""
    private val candidates = """[{"source_kind":"telegram","summary":"자료 부탁"},{"source_kind":"meeting","summary":"보고서 보내기"},{"source_kind":"note","summary":"현수막 주문"}]"""
    private val features = """["calls","telegram"]"""
    private val feedDays = """[{"day":"2026-10-30","kept_count":3,"room_count":2}]"""
    private val feedItems = """[
        {"room_key":"-1001","room_label":"운영위 방","title":"공지","summary":"내일 회의 자료 올림","day":"2026-10-30","occurred_at":"2026-10-30T09:00:00+00:00"},
        {"room_key":"-1002","room_label":"지부장 방","title":"확인","summary":null,"day":"2026-10-29","occurred_at":"2026-10-29T09:00:00+00:00"}
      ]"""

    private fun serverReplies(plan: WidgetRefresh): List<WidgetSession.Reply> = plan.urls.map { url ->
        when (url) {
            plan.todayCal -> reply(200, today)
            plan.weekCal -> reply(200, week)
            WidgetRules.TASKS -> reply(200, tasks)
            WidgetRules.CANDIDATES -> reply(200, candidates)
            WidgetRules.FEATURES -> reply(200, features)
            plan.feedDays -> reply(200, feedDays)
            plan.feedItems -> reply(200, feedItems)
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
        assertEquals("abc", WidgetToday.normalizeTitle("A b﻿ c"))
        assertEquals("회의준비", WidgetToday.normalizeTitle("회의 준비！★"))
        assertEquals("보고서보내기", WidgetToday.normalizeTitle(" 보고서, 보내기! "))
    }

    @Test
    fun todayWeekTelegramFromServerShapes() {
        val plan = WidgetRefresh(today = true, week = true, tg = true, nowMs = now)
        // 겹치는 주소(할 일·후보)는 한 번만, 모두 허용 주소.
        assertEquals(plan.urls.toSet().size, plan.urls.size)
        assertEquals(7, plan.urls.size)
        plan.urls.forEach { assertTrue(it, WidgetRules.allowed("GET", it)) }
        val r = plan.result(WidgetSession.Outcome.Ok(serverReplies(plan)))

        val td = (r.today as WidgetRefresh.Paint.Shown<WidgetToday.Content>).content
        assertEquals("오늘 10.30 금", td.title)
        assertEquals(
            listOf("종일 창립 기념일", "10:00 운영위 회의", "지남 지난 일", "오늘 보고서 보내기"),
            td.rows.map { it.time + " " + it.title },
        )
        assertNull(td.note)
        // '보고서 보내기'는 이미 할 일이라 빼고 2건, 그중 텔레그램 1건.
        assertEquals("챙길 것 2 · 나한테 온 요청 1", td.counts)

        val wk = (r.week as WidgetRefresh.Paint.Shown<WidgetWeek.Content>).content
        assertEquals("이번 주 10.26~11.1", wk.title)
        assertEquals(listOf("금 30  종일  창립 기념일", "금 30  10:00  운영위 회의", "일 1  14:00  교섭"), wk.rows.map { it.text })

        val tg = (r.tg as WidgetRefresh.Paint.Shown<WidgetTelegram.Content>).content
        assertTrue(tg.enabled)
        assertEquals("새 소식 3 · 요청 1", tg.head)
        assertEquals(listOf("운영위 방 · 내일 회의 자료 올림", "지부장 방 · 확인"), tg.rooms.map { it.text })
    }

    @Test
    fun oneWidgetFailureDoesNotBlockOthers() {
        val plan = WidgetRefresh(today = true, week = true, tg = true, nowMs = now)
        // 0.3.7의 실제 실패 모양(클래스 초기화 오류)을 오늘 위젯에만 일으킨다.
        val r = plan.result(
            WidgetSession.Outcome.Ok(serverReplies(plan)),
            todayContent = { _, _ -> throw ExceptionInInitializerError(IllegalArgumentException("regex")) },
        )
        assertEquals(WidgetRefresh.Paint.Failed, r.today)
        assertTrue(r.week is WidgetRefresh.Paint.Shown)
        assertTrue(r.tg is WidgetRefresh.Paint.Shown)

        val r2 = plan.result(WidgetSession.Outcome.Ok(serverReplies(plan)), weekContent = { _, _, _ -> throw NoClassDefFoundError("x") })
        assertTrue(r2.today is WidgetRefresh.Paint.Shown)
        assertEquals(WidgetRefresh.Paint.Failed, r2.week)
        assertTrue(r2.tg is WidgetRefresh.Paint.Shown)

        // 울타리: 앞이 실패해도 뒤를 한다.
        val done = ArrayList<String>()
        val failed = WidgetGuard.each(
            listOf<Pair<String, () -> Unit>>(
                "arsenal" to { throw ExceptionInInitializerError() },
                "today" to { done.add("today"); Unit },
                "tg" to { throw IllegalStateException() },
                "week" to { done.add("week"); Unit },
            ),
        )
        assertEquals(listOf("arsenal", "tg"), failed)
        assertEquals(listOf("today", "week"), done)
        assertNull(WidgetGuard.get<String> { throw NoClassDefFoundError("x") })
    }

    @Test
    fun signedOutAndFailedReachEveryWidget() {
        val plan = WidgetRefresh(today = true, week = false, tg = true, nowMs = now)
        val out = plan.result(WidgetSession.Outcome.SignedOut)
        assertEquals(WidgetRefresh.Paint.SignedOut, out.today)
        assertNull(out.week)
        assertEquals(WidgetRefresh.Paint.SignedOut, out.tg)
        val down = plan.result(WidgetSession.Outcome.Failed("network"))
        assertEquals(WidgetRefresh.Paint.Failed, down.today)
        assertEquals(WidgetRefresh.Paint.Failed, down.tg)
        // 답 수가 맞지 않으면 엉뚱한 칸에 그리지 않고 실패로.
        val short = plan.result(WidgetSession.Outcome.Ok(listOf(reply(200, "{}"))))
        assertEquals(WidgetRefresh.Paint.Failed, short.today)
        assertEquals(WidgetRefresh.Paint.Failed, short.tg)
        // 텔레그램 기능 목록을 못 읽으면 실패, 기능이 없으면 '이 기능 없음'.
        val tgOnly = WidgetRefresh(today = false, week = false, tg = true, nowMs = now)
        val noFeature = tgOnly.urls.map { if (it == WidgetRules.FEATURES) reply(200, """["calls"]""") else reply(200, "[]") }
        assertEquals(WidgetTelegram.NO_FEATURE, (tgOnly.result(WidgetSession.Outcome.Ok(noFeature)).tg as WidgetRefresh.Paint.Shown<WidgetTelegram.Content>).content)
        val broken = tgOnly.urls.map { if (it == WidgetRules.FEATURES) reply(500, null) else reply(200, "[]") }
        assertEquals(WidgetRefresh.Paint.Failed, tgOnly.result(WidgetSession.Outcome.Ok(broken)).tg)
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

        val jobs = File(src, "TodayWidget.kt").readText()
        assertTrue(jobs.contains("builder.setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)"))
        assertTrue(jobs.contains("if (WidgetRefresh.expedite(Build.VERSION.SDK_INT))"))
        // 위젯 로그인 직후에는 도는 작업을 새로 바꾼다.
        assertTrue(jobs.contains("WidgetJobs.refreshNow(context, replace = true)"))
        // 갱신 작업은 위젯마다 울타리 안에서, 아스날은 따로.
        assertTrue(jobs.contains("WidgetGuard.run { refreshSigned(ctx, today, week, tg, now) }"))
        assertTrue(jobs.contains("WidgetGuard.run { ArsenalWidget.refresh(ctx, WidgetHub.session(ctx), now) }"))
        val main = File(src, "MainActivity.kt").readText()
        assertTrue(main.contains("WidgetGuard.run { WidgetJobs.refreshOnOpen(applicationContext) }"))
        // 놓을 때(onUpdate)도 바로 한 번.
        for (name in listOf("TodayWidget.kt", "WeekWidget.kt", "TelegramWidget.kt", "ArsenalWidget.kt")) {
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
            Triple("today_widget", "widget_title" to "오늘", "widget_note"),
            Triple("week_widget", "week_title" to "이번 주", "week_note"),
            Triple("telegram_widget", "tg_title" to "텔레그램", "tg_note"),
            Triple("arsenal_widget", "ars_top" to "아스날", "ars_bottom"),
        )
        for ((layout, title, note) in cases) {
            val path = "src/main/res/layout/$layout.xml"
            assertEquals(layout, title.second, view(path, title.first).getAttributeNS(android, "text"))
            val n = view(path, note)
            assertEquals(layout, "불러오는 중", n.getAttributeNS(android, "text"))
            assertFalse(layout, n.getAttributeNS(android, "visibility") == "gone")
        }
        // 위젯 로그인이 없을 때 세 위젯이 같은 한 줄.
        for (name in listOf("TodayWidget.kt", "WeekWidget.kt", "TelegramWidget.kt")) {
            val text = File(src, name).readText()
            assertTrue(name, text.contains("HomeWidgets.SIGNED_OUT_LINE"))
            assertTrue(name, text.contains("WidgetGuard.run { draw(context, state, manager, ids) }") || text.contains("WidgetGuard.run { paint(context, state, manager, ids) }"))
        }
    }
}
