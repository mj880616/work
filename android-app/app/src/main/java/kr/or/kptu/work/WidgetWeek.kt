package kr.or.kptu.work

import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit

/**
 * APP-위젯다시 ③: '이번 주' 위젯(4×2·4×1)에 그릴 것. 안드로이드 API를 쓰지 않아 JVM 시험 대상이다.
 * 범위: 보이는 주 월요일 0시 ~ 다음 월요일 0시(서울). 토·일에는 다음 주를 보인다.
 * 읽기는 '지금' 위젯과 같은 google-calendar action=events(허용 주소 그대로).
 * - 요일 칸 7개: 일정 수. 3개 이상 몰린 날·가장 큰 일이 있는 날은 옅은 색.
 * - 아래 줄(4×2만): '가장 큰 일 D-n'(고르는 기준은 docs/design/phone-widget-auth.md 14절), '월 상집 보고일', '일정 몰린 날'.
 * 칸·줄을 누르면 앱 달력의 그 날(웹 ?view=calendar&day=). 만든 내용은 폰에 저장하지 않는다(결정 W-D2).
 */
object WidgetWeek {
    private val HHMM = DateTimeFormatter.ofPattern("HH:mm")
    private val DAYS = arrayOf("월", "화", "수", "목", "금", "토", "일")
    private val DAY = Regex("^\\d{4}-\\d{2}-\\d{2}$")
    /** 몰린 날 기준(일정 수). */
    const val BUSY = 3
    /** 낱말이 없을 때 '가장 큰 일'로 볼 시간 일정의 최소 길이. */
    const val BIG_MIN_MS = 2 * 60 * 60 * 1000L
    /** '가장 큰 일' 낱말(설계 14절). 명진이 고칠 낱말을 주면 여기만 바꾼다. */
    val BIG_WORDS = listOf("파업", "집회", "기자회견", "결의대회", "선포", "총회", "대의원", "대표자회의", "교섭", "투쟁", "출범", "토론회", "공청회", "간담회", "면담", "대회")

    data class Day(val day: LocalDate, val week: String, val date: Int, val count: Int, val hot: Boolean, val busy: Boolean)

    /** 아래 줄 하나: 앞 표(D-2·월·금)와 글, 누르면 열 날. */
    data class Pick(val day: LocalDate, val tag: String, val text: String)

    data class Content(val title: String, val total: Int, val days: List<Day>, val big: Pick?, val report: Pick?, val busy: Pick?, val note: String?)

    fun weekday(d: LocalDate): String = DAYS[d.dayOfWeek.value - 1]

    /** 보이는 주의 월요일: 월~금은 이번 주, 토·일은 다음 주. */
    fun start(nowMs: Long, zone: ZoneId = WidgetNow.ZONE): LocalDate {
        val d = Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate()
        val monday = d.minusDays((d.dayOfWeek.value - DayOfWeek.MONDAY.value).toLong())
        return if (d.dayOfWeek == DayOfWeek.SATURDAY || d.dayOfWeek == DayOfWeek.SUNDAY) monday.plusDays(7) else monday
    }

    fun nextWeek(nowMs: Long, zone: ZoneId = WidgetNow.ZONE): Boolean =
        start(nowMs, zone).isAfter(Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate())

    /** 보이는 주 월요일 0시와 다음 월요일 0시(서울)를 UTC 글(…Z)로. */
    fun range(nowMs: Long, zone: ZoneId = WidgetNow.ZONE): Pair<String, String> {
        val m = start(nowMs, zone)
        return m.atStartOfDay(zone).toInstant().toString() to m.plusDays(7).atStartOfDay(zone).toInstant().toString()
    }

    fun header(nowMs: Long, zone: ZoneId = WidgetNow.ZONE): String {
        val m = start(nowMs, zone)
        val e = m.plusDays(6)
        return (if (nextWeek(nowMs, zone)) "다음 주 " else "이번 주 ") + "${m.monthValue}/${m.dayOfMonth}–${e.monthValue}/${e.dayOfMonth}"
    }

    /** 앱 달력의 그 날을 여는 주소(웹이 읽고 주소에서 지운다). */
    fun dayUrl(day: LocalDate): String = ShellRules.HOME + "?view=calendar&day=" + day

    /** 웹2가 이미 떠 있을 때 다리로 보내는 글. */
    fun dayMessage(day: LocalDate): String = "day:open:$day"

    /** 밖에서 받은 날짜 글은 yyyy-mm-dd 모양의 실제 날짜만. */
    fun parseDay(value: String?): LocalDate? {
        if (value == null || !DAY.matches(value)) return null
        return try {
            LocalDate.parse(value)
        } catch (_: Exception) {
            null
        }
    }

    /** 보이는 주 안의 일정(시작 날 기준, 전 주에 시작해 이어지는 것은 월요일에). */
    private fun inWeek(evs: List<WidgetNow.Ev>, monday: LocalDate, zone: ZoneId): List<WidgetNow.Ev> {
        val end = monday.plusDays(7)
        val from = monday.atStartOfDay(zone).toInstant().toEpochMilli()
        return evs.mapNotNull { e ->
            when {
                !e.day.isBefore(end) -> null
                !e.day.isBefore(monday) -> e
                e.endMs > from -> e.copy(day = monday)
                else -> null
            }
        }
    }

    /** 가장 큰 일(설계 14절): 오늘 이후 → 낱말 → 2시간 이상 가장 긴 시간 일정 → 이른 것. */
    fun big(evs: List<WidgetNow.Ev>, nowMs: Long, zone: ZoneId = WidgetNow.ZONE): WidgetNow.Ev? {
        val today = Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate()
        val ahead = evs.filter { if (it.allDay) !it.day.isBefore(today) else it.startMs >= nowMs }
        ahead.filter { e -> BIG_WORDS.any { e.title.contains(it) } }.minByOrNull { it.startMs }?.let { return it }
        return ahead.filter { !it.allDay && it.endMs - it.startMs >= BIG_MIN_MS }
            .sortedWith(compareByDescending<WidgetNow.Ev> { it.endMs - it.startMs }.thenBy { it.startMs })
            .firstOrNull()
    }

    private fun clock(e: WidgetNow.Ev, zone: ZoneId): String = if (e.allDay) "종일" else Instant.ofEpochMilli(e.startMs).atZone(zone).format(HHMM)

    fun dTag(today: LocalDate, day: LocalDate): String {
        val n = ChronoUnit.DAYS.between(today, day)
        return if (n <= 0) "오늘" else "D-$n"
    }

    fun content(status: Int, body: Any?, nowMs: Long, zone: ZoneId = WidgetNow.ZONE): Content {
        val title = header(nowMs, zone)
        val monday = start(nowMs, zone)
        val today = Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate()
        val empty = (0 until 7).map { i -> monday.plusDays(i.toLong()).let { Day(it, weekday(it), it.dayOfMonth, 0, false, false) } }
        if (status != 200) return Content(title, 0, empty, null, null, null, "일정 연결을 확인해 주세요")
        val evs = inWeek(WidgetNow.events(body, zone), monday, zone)
        val counts = evs.groupingBy { it.day }.eachCount()
        val big = big(evs, nowMs, zone)
        val days = empty.map { d ->
            val n = counts[d.day] ?: 0
            d.copy(count = n, hot = big?.day == d.day, busy = n >= BUSY)
        }
        val bigPick = big?.let { Pick(it.day, dTag(today, it.day), "${weekday(it.day)} ${clock(it, zone)} ${it.title}") }
        // 상집 보고일: 주간보고 기준일 규칙(journal-data.js reportDay, 월요일). 오늘 이후의 가장 가까운 월요일(오늘이 월요일이면 오늘).
        val report = if (monday.isBefore(today)) monday.plusDays(7) else monday
        val reportPick = Pick(report, "월", "${report.monthValue}/${report.dayOfMonth} 상집 보고일")
        val busyDay = days.firstOrNull { it.busy && !it.day.isBefore(today) }
        val busyPick = busyDay?.let { d ->
            val first = evs.filter { it.day == d.day && !it.allDay }.minByOrNull { it.startMs }
            val tail = first?.let { " · ${it.title} ${clock(it, zone)}부터" } ?: ""
            Pick(d.day, d.week, "일정 ${d.count}개 몰림$tail")
        }
        val note = if (evs.isEmpty() && MiniJson.obj(body)?.get("warning") != null) "일정을 읽지 못했어요" else null
        return Content(title, evs.size, days, bigPick, reportPick, busyPick, note)
    }
}
