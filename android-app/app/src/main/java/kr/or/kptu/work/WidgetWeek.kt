package kr.or.kptu.work

import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit

/**
 * APP-위젯다시 ③: '이번 주' 위젯(4×2·4×1)에 그릴 것. 안드로이드 API를 쓰지 않아 JVM 시험 대상이다.
 * 범위: 보이는 주 일요일 0시 ~ 다음 일요일 0시(서울). 기본은 늘 오늘이 든 주(APP-이번주위젯 S68-12).
 * S69-위젯일요일(11/24 사용자 "위젯이 일월화수목금토여야 돼"): 주 시작을 앱 달력(월 보기 일~토)과 같은 일요일로, 칸 순서 일 월 … 토.
 * 4×2는 머리 줄 ‹ ›로 앞뒤 MAX_SHIFT주까지 옮기고(위젯마다 메모리에만), 날이 바뀌면 이번 주로 돌아온다(shiftNow).
 * 읽기는 '지금' 위젯과 같은 google-calendar action=events(허용 주소 그대로).
 * - 요일 칸 7개: 일정 수. 4×2는 그 아래 그날 첫 일정 제목 앞부분 한 줄(APP-위젯먹색 S68-06, 아래 칸 목록과 같은 차례의 첫 줄).
 * - 아래 목록(4×2만, S68-51): 고른 날(안 고르면 오늘, 다른 주는 일요일)의 일정·할 일을 전부(dayRows, 위젯 안에서 스크롤).
 *   S68-51(11/23 사용자 "일정 그냥 다 보여줘 뭘 또 4개 몰림이야"): '일정 n개 몰림' 요약 줄과 '외 n' 줄임을 없앴다.
 *   S69-07(11/24 사용자 "디마이너스 1 디마이너스 2 뭐 이런 건 안 해도 돼 / 일정이랑 할 일을 시각적으로 구분이 안가", 시안 B):
 *   목록 끝의 '가장 큰 일 D-n'·'월 보고일' 줄을 없앴다. 일정 묶음(시각 + 제목) 아래 가는 줄 + 작은 회색 머리 '할 일 n',
 *   그 아래 할 일 줄은 앞에 빈 네모 + 제목('할 일' 글자를 줄마다 붙이지 않음).
 * 칸·줄을 누르면 앱 달력의 그 날(웹 ?view=calendar&day=). 만든 내용은 폰에 저장하지 않는다(결정 W-D2).
 * APP-위젯날짜고르기: 4×2에서 요일 칸을 누르면 앱을 열지 않고 아래 칸이 그 날 일정·기한 할 일로 바뀐다(dayDetail).
 * 할 일은 '지금' 위젯이 이미 읽는 google-tasks overview(허용 주소 그대로)를 함께 받는다. 새 주소·새 권한은 없다.
 */
object WidgetWeek {
    private val HHMM = DateTimeFormatter.ofPattern("HH:mm")
    /** 칸 차례(일요일 시작). 앱 달력 월 보기 머리(일 월 화 수 목 금 토)와 같다. */
    private val DAYS = arrayOf("일", "월", "화", "수", "목", "금", "토")
    private val DAY = Regex("^\\d{4}-\\d{2}-\\d{2}$")

    /** first: 그날 첫 일정 제목(종일 먼저·시각 순, 고른 날 아래 칸 첫 일정과 같음). 일정이 없으면 null. */
    data class Day(val day: LocalDate, val week: String, val date: Int, val count: Int, val first: String? = null)

    /**
     * APP-위젯먹색 S68-06: 4×2 요일 칸 셋째 줄(그날 첫 일정 제목 앞부분). 일정이 없거나 제목이 비면 null(줄을 숨김).
     * 4×1(small)에는 이 줄이 없다(지금처럼 수만). 앞부분 자르기는 칸 폭에 맞춘 말줄임(ellipsize)이 한다.
     */
    fun firstLine(d: Day, small: Boolean): String? = if (small || d.count <= 0) null else d.first?.trim()?.takeIf { it.isNotEmpty() }

    /**
     * APP-위젯먹색 S68-06: 오늘 칸은 먹색 바탕 + 밝은 글자(누르지 않아도 늘). 고른 날은 먹색 톤 옅은 음영(S68-12에서 또렷하게).
     * S68-12: 오늘을 고르면 오늘 표시가 앞서고 음영 테두리가 겹친다(TODAY_PICKED). 다른 주로 옮기면 오늘 칸은 없다.
     */
    enum class Cell { PLAIN, PICKED, TODAY, TODAY_PICKED }

    fun cell(d: Day, today: LocalDate, picked: LocalDate?): Cell = when {
        d.day == today && d.day == picked -> Cell.TODAY_PICKED
        d.day == today -> Cell.TODAY
        d.day == picked -> Cell.PICKED
        else -> Cell.PLAIN
    }

    /** 고른 날 아래 칸 일정 한 줄: 시각('종일'·'HH:mm')과 제목. */
    data class Item(val time: String, val title: String)

    /**
     * 고른 날의 내용. tasks가 null이면 할 일을 읽지 못함. items는 일정(종일 먼저·시각 순), todos는 기한 할 일 제목(받은 차례).
     * beyond(S68-12): 서버 할 일 요약이 주지 않는 날(오늘+TASK_DAYS 뒤)이라 할 일을 모름.
     */
    data class Detail(
        val day: LocalDate,
        val events: Int,
        val tasks: Int?,
        val items: List<Item>,
        val beyond: Boolean = false,
        val todos: List<String> = emptyList(),
    )

    /**
     * S69-07 시안 B: 아래 목록 줄의 종류. EVENT '10:30  제목', TASK_HEAD 가는 줄 + 회색 머리('할 일 3'),
     * TASK 빈 네모 + 제목, EMPTY '일정·할 일 없음'. line은 TASK_HEAD 위 가는 줄(일정이 없어 첫 줄이면 false).
     */
    enum class Kind { EVENT, TASK_HEAD, TASK, EMPTY }

    data class Row(val kind: Kind, val text: String, val line: Boolean = false)

    /** 서버 google-tasks overview가 주는 끝내지 않은 할 일 범위(오늘~6일 뒤 기한, 지난 것 포함). 설계 15절. */
    const val TASK_DAYS = 6L

    data class Content(
        val title: String,
        val total: Int,
        val days: List<Day>,
        val note: String?,
        val details: Map<LocalDate, Detail> = emptyMap(),
    ) {
        /** 이 내용이 보이는 주의 일요일(위젯이 옮긴 주의 내용을 찾을 때 열쇠). */
        val sunday: LocalDate get() = days.first().day
    }

    /**
     * 지금 보일 고른 날. 고른 날짜가 바뀌었거나(pickedOn이 오늘이 아님) 보이는 주 밖이면 null(기본 날 shownDay로 돌아감).
     */
    fun active(picked: LocalDate?, pickedOn: LocalDate?, nowMs: Long, days: List<Day>, zone: ZoneId = WidgetNow.ZONE): LocalDate? {
        if (picked == null || pickedOn == null) return null
        val today = Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate()
        if (pickedOn != today) return null
        return picked.takeIf { p -> days.any { it.day == p } }
    }

    /** 머리 줄(S69-07 시안 B): 날짜만 '11/6(금)'. 할 일 수는 목록의 할 일 머리('할 일 2')로 옮겼다. */
    fun detailHead(d: Detail): String = "${d.day.monthValue}/${d.day.dayOfMonth}(${weekday(d.day)})"

    /**
     * S68-51: 아래 목록이 보일 날. 고른 날(active) → 보이는 주에 오늘이 있으면 오늘 → 그 주 일요일.
     * 주간 요약 줄을 없앴으니 아래 칸은 늘 어느 하루의 목록이다. 같은 날을 다시 눌러도 그 날 그대로.
     */
    fun shownDay(active: LocalDate?, today: LocalDate, days: List<Day>): LocalDate? =
        active ?: days.firstOrNull { it.day == today }?.day ?: days.firstOrNull()?.day

    /**
     * S68-51: 요일 칸·‹ ›가 그려질 때의 주(일요일, 누름에 실어 보냄) → 지금 기준 옮긴 주 수.
     * 앱 프로세스가 내려가 메모리(옮긴 주)를 잃어도 누른 칸이 속한 주를 되찾는다. 일요일이 아니거나 ±MAX_SHIFT 밖이면 null.
     */
    fun shiftOf(sunday: LocalDate?, nowMs: Long, zone: ZoneId = WidgetNow.ZONE): Int? {
        if (sunday == null || sunday.dayOfWeek != DayOfWeek.SUNDAY) return null
        val weeks = ChronoUnit.WEEKS.between(start(nowMs, zone), sunday)
        return weeks.toInt().takeIf { it in -MAX_SHIFT..MAX_SHIFT }
    }

    /**
     * S69-78(11/24 사용자 "지난주 갔다가 > 누르면 이번주를 건너뛰고 다음주로 감"): 화살표(delta −1·+1)가 옮길 대상 주의 일요일(절대값).
     * 그릴 때마다 지금 보이는 주(shift)에서 계산해 누름에 싣는다. 범위 끝이라 못 옮기면 null(화살표를 숨김).
     */
    fun arrowTo(shift: Int, delta: Int, nowMs: Long, zone: ZoneId = WidgetNow.ZONE): LocalDate? =
        if (delta == 0 || !canMove(shift, delta)) null else start(nowMs, zone, move(shift, delta))

    /**
     * 주 옮기기 누름의 주소(data). 대상 주를 주소에 넣어, 다른 주를 그릴 때 같은 PendingIntent의 실린 값이 덮이지 않게 한다.
     * (원인: 4×2를 그린 뒤 같은 갱신에서 4×1 틀을 이번 주로 그리며 같은 주소·같은 요청 번호의 ‹ › 누름을 FLAG_UPDATE_CURRENT로
     * 다시 만들어, 누름에 실린 주가 늘 이번 주 일요일로 덮였다.) to가 null이면 머리 글자(이번 주로).
     */
    fun shiftData(id: Int, delta: Int, to: LocalDate?): String = "workon-widget://week/$id/shift/$delta/" + (to?.toString() ?: "now")

    /**
     * 주 옮기기 누름을 받았을 때 새 주(이번 주 기준 옮긴 주 수).
     * - delta 0(머리 글자) → 이번 주(0).
     * - 누름에 대상 주(to, 일요일·범위 안)가 실려 있으면 그 주(그릴 때 보이던 주에서 한 칸 = 화면 그대로).
     * - 대상 주가 없는 옛 판 누름: 실린 '그린 주'가 일요일이 아니면(옛 월요일 판) 이번 주(0)로.
     *   그 밖에는 위젯 기억(memory) → 실린 일요일 → 0 순으로 기준을 잡고 한 칸.
     */
    fun shiftTarget(to: LocalDate?, drawn: LocalDate?, delta: Int, memory: Int?, nowMs: Long, zone: ZoneId = WidgetNow.ZONE): Int {
        if (delta == 0) return 0
        shiftOf(to, nowMs, zone)?.let { return it }
        if (drawn != null && drawn.dayOfWeek != DayOfWeek.SUNDAY) return 0
        val base = memory ?: shiftOf(drawn, nowMs, zone) ?: 0
        return move(base, delta)
    }

    /** 누른 날이 그 주(sunday~+6일) 안인지. */
    fun dayInWeek(day: LocalDate?, sunday: LocalDate?): Boolean =
        day != null && sunday != null && !day.isBefore(sunday) && day.isBefore(sunday.plusDays(7))

    /**
     * S69-07 시안 B: 아래 목록 줄 전부(줄임 없음). 그날 일정(종일 먼저·시각 순, '10:30  제목')
     * → 할 일이 있으면 가는 줄 + '할 일 n' 머리 → 빈 네모 + 할 일 제목. 할 일 0개면 머리·줄 모두 없음.
     * 할 일을 모르면(읽지 못함·서버 범위 밖) 머리 자리에 '할 일 읽지 못함'·'할 일은 앱에서'.
     * 일정·할 일이 모두 0개면 '일정·할 일 없음' 한 줄. 다가오는 일(D-n)·보고일 줄은 없다.
     */
    fun dayRows(d: Detail): List<Row> {
        val out = d.items.mapTo(ArrayList()) { Row(Kind.EVENT, "${it.time}  ${it.title}") }
        val line = out.isNotEmpty()
        when {
            d.beyond -> out.add(Row(Kind.TASK_HEAD, "할 일은 앱에서", line))
            d.tasks == null -> out.add(Row(Kind.TASK_HEAD, "할 일 읽지 못함", line))
            d.todos.isNotEmpty() -> {
                out.add(Row(Kind.TASK_HEAD, "할 일 ${d.todos.size}", line))
                d.todos.forEach { out.add(Row(Kind.TASK, it)) }
            }
        }
        return out.ifEmpty { listOf(Row(Kind.EMPTY, "일정·할 일 없음")) }
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

    /** DayOfWeek.value는 월=1 … 일=7이라 7로 나눈 나머지가 일=0 … 토=6(칸 차례). */
    fun col(d: LocalDate): Int = d.dayOfWeek.value % 7

    fun weekday(d: LocalDate): String = DAYS[col(d)]

    /** 일요일 칸만 앱 달력과 같은 일요일 색(웹 .cal-head.sunday = kptu-danger). */
    fun isSunday(d: LocalDate): Boolean = d.dayOfWeek == DayOfWeek.SUNDAY

    /** S68-12: 앞뒤로 옮길 수 있는 주 수(이번 주에서 ±). */
    const val MAX_SHIFT = 8

    fun today(nowMs: Long, zone: ZoneId = WidgetNow.ZONE): LocalDate = Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate()

    /** 보이는 주의 일요일: 오늘이 든 주(일요일 시작, 토요일이면 그 주 일~토) + shift주. */
    fun start(nowMs: Long, zone: ZoneId = WidgetNow.ZONE, shift: Int = 0): LocalDate {
        val d = today(nowMs, zone)
        return d.minusDays(col(d).toLong()).plusWeeks(clamp(shift).toLong())
    }

    fun clamp(shift: Int): Int = shift.coerceIn(-MAX_SHIFT, MAX_SHIFT)

    /** ‹(−1)·›(+1)를 눌렀을 때 새 주. 범위 끝에서는 그대로. */
    fun move(shift: Int, delta: Int): Int = clamp(clamp(shift) + delta)

    fun canMove(shift: Int, delta: Int): Boolean = move(shift, delta) != clamp(shift)

    /** 지금 보일 주. 옮긴 날(shiftOn)이 오늘이 아니면(자정을 지남) 이번 주(0)로 돌아간다(고른 날 active와 같은 방식). */
    fun shiftNow(shift: Int, shiftOn: LocalDate?, nowMs: Long, zone: ZoneId = WidgetNow.ZONE): Int =
        if (shiftOn == null || shiftOn != today(nowMs, zone)) 0 else clamp(shift)

    /** 머리 줄 앞말: 이번 주·지난주·다음 주, 그 밖은 없음(날짜만). */
    fun label(shift: Int): String? = when (clamp(shift)) {
        0 -> "이번 주"
        -1 -> "지난주"
        1 -> "다음 주"
        else -> null
    }

    /** 보이는 주 일요일 0시와 다음 일요일 0시(서울)를 UTC 글(…Z)로. */
    fun range(nowMs: Long, zone: ZoneId = WidgetNow.ZONE, shift: Int = 0): Pair<String, String> {
        val m = start(nowMs, zone, shift)
        return m.atStartOfDay(zone).toInstant().toString() to m.plusDays(7).atStartOfDay(zone).toInstant().toString()
    }

    fun header(nowMs: Long, zone: ZoneId = WidgetNow.ZONE, shift: Int = 0): String {
        val m = start(nowMs, zone, shift)
        val e = m.plusDays(6)
        val dates = "${m.monthValue}/${m.dayOfMonth}–${e.monthValue}/${e.dayOfMonth}"
        return label(shift)?.let { "$it $dates" } ?: dates
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

    /** 보이는 주 안의 일정(시작 날 기준, 전 주에 시작해 이어지는 것은 일요일에). */
    private fun inWeek(evs: List<WidgetNow.Ev>, sunday: LocalDate, zone: ZoneId): List<WidgetNow.Ev> {
        val end = sunday.plusDays(7)
        val from = sunday.atStartOfDay(zone).toInstant().toEpochMilli()
        return evs.mapNotNull { e ->
            when {
                !e.day.isBefore(end) -> null
                !e.day.isBefore(sunday) -> e
                e.endMs > from -> e.copy(day = sunday)
                else -> null
            }
        }
    }

    /** 하루 목록 차례: 종일 먼저, 그다음 시작 시각 순(전 주에서 이어진 일정도 섞이지 않게 다시 줄 세움). */
    private val ORDER = compareBy<WidgetNow.Ev>({ !it.allDay }, { it.startMs })

    private fun clock(e: WidgetNow.Ev, zone: ZoneId): String = if (e.allDay) "종일" else Instant.ofEpochMilli(e.startMs).atZone(zone).format(HHMM)

    fun content(
        status: Int,
        body: Any?,
        nowMs: Long,
        zone: ZoneId = WidgetNow.ZONE,
        tasksStatus: Int = 0,
        tasks: Any? = null,
        shift: Int = 0,
    ): Content {
        val title = header(nowMs, zone, shift)
        val sunday = start(nowMs, zone, shift)
        val today = today(nowMs, zone)
        val empty = (0 until 7).map { i -> sunday.plusDays(i.toLong()).let { Day(it, weekday(it), it.dayOfMonth, 0) } }
        if (status != 200) return Content(title, 0, empty, "일정 연결을 확인해 주세요")
        val evs = inWeek(WidgetNow.events(body, zone), sunday, zone)
        val counts = evs.groupingBy { it.day }.eachCount()
        val days = empty.map { d ->
            val n = counts[d.day] ?: 0
            d.copy(count = n, first = evs.filter { it.day == d.day }.sortedWith(ORDER).firstOrNull()?.title)
        }
        val note = if (evs.isEmpty() && MiniJson.obj(body)?.get("warning") != null) "일정을 읽지 못했어요" else null
        val byTask = if (tasksReadable(tasksStatus, tasks)) tasksByDay(tasks) else null
        val details = days.associate { d ->
            val dayEvs = evs.filter { it.day == d.day }.sortedWith(ORDER)
            // S68-12: 다음 주 이후로 옮기면 서버 할 일 범위 밖 날이 생긴다. 0개로 보이지 않게 '할 일은 앱에서'.
            val beyond = d.day.isAfter(today.plusDays(TASK_DAYS))
            val dayTasks = if (beyond) emptyList() else byTask?.get(d.day).orEmpty()
            val items = dayEvs.map { Item(clock(it, zone), it.title) }
            d.day to Detail(d.day, dayEvs.size, if (beyond) null else byTask?.let { dayTasks.size }, items, beyond, dayTasks)
        }
        return Content(title, evs.size, days, note, details)
    }
}
