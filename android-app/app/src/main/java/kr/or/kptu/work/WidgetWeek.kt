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
 * APP-위젯날짜고르기: 4×2에서 요일 칸을 누르면 앱을 열지 않고 아래 칸이 그 날 일정·기한 할 일로 바뀐다(dayDetail).
 * 할 일은 '지금' 위젯이 이미 읽는 google-tasks overview(허용 주소 그대로)를 함께 받는다. 새 주소·새 권한은 없다.
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

    /** 고른 날 아래 칸 한 줄: 시각('종일'·'HH:mm'·'할 일')과 제목. */
    data class Item(val time: String, val title: String)

    /** 고른 날의 내용. tasks가 null이면 할 일을 읽지 못함. items는 일정(종일 먼저·시각 순) 다음 할 일. */
    data class Detail(val day: LocalDate, val events: Int, val tasks: Int?, val items: List<Item>)

    data class Content(
        val title: String,
        val total: Int,
        val days: List<Day>,
        val big: Pick?,
        val report: Pick?,
        val busy: Pick?,
        val note: String?,
        val details: Map<LocalDate, Detail> = emptyMap(),
    )

    /** 4×2 아래 칸에 보일 줄 수(머리 줄 제외). */
    const val DETAIL_ROWS = 3

    /** 같은 날을 다시 누르면 고르기를 풀고(주간 요약으로), 다른 날이면 그 날. */
    fun toggle(current: LocalDate?, tapped: LocalDate): LocalDate? = if (current == tapped) null else tapped

    /**
     * 지금 보일 고른 날. 고른 날짜가 바뀌었거나(pickedOn이 오늘이 아님) 보이는 주 밖이면 null(주간 요약으로 돌아감).
     */
    fun active(picked: LocalDate?, pickedOn: LocalDate?, nowMs: Long, days: List<Day>, zone: ZoneId = WidgetNow.ZONE): LocalDate? {
        if (picked == null || pickedOn == null) return null
        val today = Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate()
        if (pickedOn != today) return null
        return picked.takeIf { p -> days.any { it.day == p } }
    }

    /** 머리 줄: '11/6(금) 일정 4 · 할 일 2'. 할 일을 읽지 못하면 '할 일 읽지 못함'. */
    fun detailHead(d: Detail): String {
        val tasks = d.tasks?.let { "할 일 $it" } ?: "할 일 읽지 못함"
        return "${d.day.monthValue}/${d.day.dayOfMonth}(${weekday(d.day)}) 일정 ${d.events} · $tasks"
    }

    /** 아래 칸 줄(최대 rows). 넘치면 마지막 줄을 '외 n'으로. 아무것도 없으면 '일정·할 일 없음'. */
    fun detailRows(d: Detail, rows: Int = DETAIL_ROWS): List<String> {
        val all = d.items.map { "${it.time}  ${it.title}" }
        if (all.isEmpty()) return listOf("일정·할 일 없음")
        if (all.size <= rows) return all
        return all.take(rows - 1) + "외 ${all.size - (rows - 1)}"
    }

    /** 끝내지 않은 할 일 → 기한 날짜별 제목(받은 차례 그대로). 모양이 다르거나 기한 없는 것은 뺀다. */
    fun tasksByDay(body: Any?): Map<LocalDate, List<String>> {
        val list = MiniJson.list(MiniJson.obj(body)?.get("tasks")) ?: return emptyMap()
        val out = LinkedHashMap<LocalDate, MutableList<String>>()
        for (item in list) {
            val t = MiniJson.obj(item) ?: continue
            if (MiniJson.str(t["status"]) == "completed") continue
            val d = MiniJson.str(t["due"])?.takeIf { it.length >= 10 }?.let { parseDay(it.substring(0, 10)) } ?: continue
            out.getOrPut(d) { ArrayList() }.add(WidgetNow.cleanTitle(MiniJson.str(t["title"])))
        }
        return out
    }

    /** 할 일 답이 읽을 수 있는 모양인지(연결 없음·다시 연결 필요·실패면 false). */
    fun tasksReadable(status: Int, body: Any?): Boolean {
        if (status != 200) return false
        val o = MiniJson.obj(body) ?: return false
        return o["connected"] != false && o["needs_reconnect"] != true && MiniJson.list(o["tasks"]) != null
    }

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

    fun content(
        status: Int,
        body: Any?,
        nowMs: Long,
        zone: ZoneId = WidgetNow.ZONE,
        tasksStatus: Int = 0,
        tasks: Any? = null,
    ): Content {
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
        val byTask = if (tasksReadable(tasksStatus, tasks)) tasksByDay(tasks) else null
        val details = days.associate { d ->
            val dayEvs = evs.filter { it.day == d.day }
            val dayTasks = byTask?.get(d.day).orEmpty()
            val items = dayEvs.map { Item(clock(it, zone), it.title) } + dayTasks.map { Item("할 일", it) }
            d.day to Detail(d.day, dayEvs.size, byTask?.let { dayTasks.size }, items)
        }
        return Content(title, evs.size, days, bigPick, reportPick, busyPick, note, details)
    }
}
