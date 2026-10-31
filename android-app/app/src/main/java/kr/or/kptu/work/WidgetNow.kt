package kr.or.kptu.work

import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * APP-위젯다시 ①: '지금' 위젯(4×2·2×2)에 그릴 것. 지난 '오늘'·'텔레그램' 위젯을 합쳐 바꿨다(두 위젯은 코드째 지움).
 * 안드로이드 API를 쓰지 않아 JVM 시험 대상이다. 읽기는 지금 위젯 로그인이 허용한 주소 셋뿐이다
 * (google-calendar events 오늘 0시~모레 0시, google-tasks overview, 처리 전 후보 app_todo_candidates).
 * - 다음 일정: 오늘 남은(또는 진행 중인) 시간 일정 하나를 크게 + 남은 시간, 그다음 일정 한 줄(내일 것까지).
 * - 처리할 것 세 줄: 나한테 온 요청 n + 가장 오래 기다린 요청, 챙길 것 n + 가장 최근 한 줄, 오늘(지난 포함) 기한 할 일 n + 한 줄.
 * 만든 내용은 폰에 저장하지 않는다(결정 W-D2).
 */
object WidgetNow {
    val ZONE: ZoneId = ZoneId.of("Asia/Seoul")
    private const val MAX_TITLE = 80
    private val HHMM = DateTimeFormatter.ofPattern("HH:mm")

    /**
     * 웹 /[\s\p{P}\p{S}]+/gu와 같은 글자들. 안드로이드 정규식(ICU)은 자바 전용 줄 안 표시 U를 받지 않아(PatternSyntaxException)
     * 표시 없이 유니코드 공백(\p{Z}·FEFF)을 직접 적는다(FIX-위젯).
     */
    private val TITLE_NOISE = Regex("[\\s\\p{Z}\\uFEFF\\p{P}\\p{S}]+")

    /** 웹 todo-radar-data.js normalizeTitle과 같은 비교용 제목(소문자·NFKC·공백·문장부호·기호 빼기·80자). */
    fun normalizeTitle(value: String?): String {
        val t = java.text.Normalizer.normalize((value ?: "").lowercase(), java.text.Normalizer.Form.NFKC).replace(TITLE_NOISE, "")
        return if (t.length > 80) t.substring(0, 80) else t
    }

    fun cleanTitle(value: String?): String {
        val t = (value ?: "").replace(Regex("[\\u0000-\\u001f\\u007f\\u2028\\u2029]+"), " ").trim()
        val cut = t.codePoints().limit(MAX_TITLE.toLong()).toArray().let { String(it, 0, it.size) }.trim()
        return cut.ifEmpty { "(제목 없음)" }
    }

    /** 일정 하나(서울 기준 날짜). 종일 일정은 startMs·endMs가 그 날 0시·끝난 다음 날 0시. */
    data class Ev(val allDay: Boolean, val startMs: Long, val endMs: Long, val day: LocalDate, val title: String)

    /** 큰 줄: 시각·제목·남은 시간. day는 누르면 열 달력 날짜. */
    data class Next(val time: String, val title: String, val left: String, val day: LocalDate)

    /** 처리할 것 한 줄. count가 null이면 읽지 못함(text에 짧은 이유). */
    data class Line(val count: Int?, val text: String)

    data class Content(
        val next: Next?,
        val after: String?,
        val asks: Line,
        val todo: Line,
        val due: Line,
        val note: String?,
    )

    /** 오늘 0시와 모레 0시(서울)를 UTC 글(…Z)로. '그다음'이 내일 일정일 수 있어 이틀을 읽는다. */
    fun range(nowMs: Long, zone: ZoneId = ZONE): Pair<String, String> {
        val today = Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate()
        return today.atStartOfDay(zone).toInstant().toString() to today.plusDays(2).atStartOfDay(zone).toInstant().toString()
    }

    /** google-calendar action=events 응답 → 일정 목록(시작 순, 같은 날은 종일 먼저). 모양이 다른 줄은 뺀다. */
    fun events(body: Any?, zone: ZoneId = ZONE): List<Ev> {
        val list = MiniJson.list(MiniJson.obj(body)?.get("events")) ?: return emptyList()
        val out = ArrayList<Ev>()
        for (item in list) {
            val e = MiniJson.obj(item) ?: continue
            val start = MiniJson.str(e["start"]) ?: continue
            val title = cleanTitle(MiniJson.str(e["title"]))
            if (e["allDay"] == true) {
                val d = date(start) ?: continue
                val after = MiniJson.str(e["end"])?.let(::date)?.takeIf { it.isAfter(d) } ?: d.plusDays(1)
                out.add(Ev(true, d.atStartOfDay(zone).toInstant().toEpochMilli(), after.atStartOfDay(zone).toInstant().toEpochMilli(), d, title))
            } else {
                val t = time(start) ?: continue
                val s = t.toInstant().toEpochMilli()
                val end = MiniJson.str(e["end"])?.let(::time)?.toInstant()?.toEpochMilli()?.takeIf { it >= s } ?: s
                out.add(Ev(false, s, end, t.atZoneSameInstant(zone).toLocalDate(), title))
            }
        }
        out.sortWith(compareBy<Ev>({ it.day }, { !it.allDay }, { it.startMs }))
        return out
    }

    /** '1시간 36분 뒤'·'25분 뒤'·'진행 중'. */
    fun left(nowMs: Long, startMs: Long): String {
        if (startMs <= nowMs) return "진행 중"
        val mins = ((startMs - nowMs + 59_999) / 60_000).toInt()
        if (mins < 60) return "${mins}분 뒤"
        val h = mins / 60
        val m = mins % 60
        return if (m == 0) "${h}시간 뒤" else "${h}시간 ${m}분 뒤"
    }

    private fun label(ev: Ev, today: LocalDate, zone: ZoneId): String {
        val time = if (ev.allDay) "종일" else Instant.ofEpochMilli(ev.startMs).atZone(zone).format(HHMM)
        return when {
            ev.day == today -> time
            ev.day == today.plusDays(1) -> "내일 $time"
            else -> "${ev.day.monthValue}/${ev.day.dayOfMonth} $time"
        }
    }

    /** 다음 일정(오늘 남은 시간 일정) + 그다음 한 줄. */
    fun pick(evs: List<Ev>, nowMs: Long, zone: ZoneId = ZONE): Pair<Next?, String?> {
        val today = Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate()
        val next = evs.firstOrNull { !it.allDay && it.day == today && (it.endMs > nowMs || it.startMs >= nowMs) }
        val from = next?.startMs ?: nowMs
        // 그다음: 다음 일정보다 늦게 시작하는 시간 일정, 또는 내일의 종일 일정(오늘 종일은 큰 줄과 겹쳐 뺀다).
        val rest = evs.filter { it !== next && (if (it.allDay) it.day.isAfter(today) else it.startMs > from) }
        val after = rest.firstOrNull()?.let { "그다음 · " + label(it, today, zone) + " " + it.title }
        val big = next?.let { Next(Instant.ofEpochMilli(it.startMs).atZone(zone).format(HHMM), it.title, left(nowMs, it.startMs), it.day) }
        return big to after
    }

    /** 처리 전 후보(최근 순)와 할 일 목록 → 요청·챙길 것 줄. 웹 inbox-count.js와 같은 규칙(이미 할 일이 된 제목은 빼기). */
    fun inbox(candidates: Any?, tasks: Any?): Pair<Line, Line>? {
        val rows = MiniJson.list(candidates) ?: return null
        val known = HashSet<String>()
        MiniJson.list(MiniJson.obj(tasks)?.get("tasks"))?.forEach { item ->
            val t = MiniJson.obj(item) ?: return@forEach
            if (MiniJson.str(t["status"]) == "completed") return@forEach
            normalizeTitle(MiniJson.str(t["title"])).takeIf { it.isNotEmpty() }?.let(known::add)
        }
        val asks = ArrayList<String>()
        val all = ArrayList<String>()
        val others = ArrayList<String>()
        for (item in rows) {
            val r = MiniJson.obj(item) ?: continue
            val summary = MiniJson.str(r["summary"])
            if (normalizeTitle(summary) in known) continue
            val text = cleanTitle(summary)
            all.add(text)
            if (MiniJson.str(r["source_kind"]) == "telegram") asks.add(text) else others.add(text)
        }
        // 후보는 최근 순으로 온다: 가장 오래 기다린 요청 = 맨 뒤, 챙길 것 한 줄 = 요청이 아닌 가장 최근 것.
        val ask = Line(asks.size, asks.lastOrNull() ?: "없음")
        val todo = Line(all.size, others.firstOrNull() ?: all.firstOrNull() ?: "없음")
        return ask to todo
    }

    /** 끝내지 않은 할 일 중 기한이 오늘이거나 지난 것. 한 줄은 가장 오래 밀린 것. */
    fun due(body: Any?, nowMs: Long, zone: ZoneId = ZONE): Line {
        val today = Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate()
        val list = MiniJson.list(MiniJson.obj(body)?.get("tasks")) ?: return Line(0, "없음")
        data class T(val due: LocalDate, val index: Int, val title: String)
        val out = ArrayList<T>()
        list.forEachIndexed { i, item ->
            val t = MiniJson.obj(item) ?: return@forEachIndexed
            if (MiniJson.str(t["status"]) == "completed") return@forEachIndexed
            val d = MiniJson.str(t["due"])?.let { if (it.length >= 10) date(it.substring(0, 10)) else null } ?: return@forEachIndexed
            if (d.isAfter(today)) return@forEachIndexed
            out.add(T(d, i, cleanTitle(MiniJson.str(t["title"]))))
        }
        out.sortWith(compareBy<T>({ it.due }, { it.index }))
        val first = out.firstOrNull() ?: return Line(0, "없음")
        return Line(out.size, (if (first.due.isBefore(today)) "지남 · " else "") + first.title)
    }

    /** 받은 답 셋 → 위젯 내용. 연결이 없거나 읽지 못한 쪽은 그 줄에 짧은 이유. */
    fun content(raw: WidgetSession.Raw, nowMs: Long, zone: ZoneId = ZONE): Content {
        var note: String? = null
        var next: Next? = null
        var after: String? = null
        if (raw.calendarStatus == 200) {
            val evs = events(raw.calendar, zone)
            val picked = pick(evs, nowMs, zone)
            next = picked.first
            after = picked.second
            if (evs.isEmpty() && MiniJson.obj(raw.calendar)?.get("warning") != null) note = "일정을 읽지 못했어요"
        } else {
            note = "일정 연결을 확인해 주세요"
        }
        val tasksObj = MiniJson.obj(raw.tasks)
        val due = when {
            raw.tasksStatus != 200 -> Line(null, "읽지 못했어요")
            tasksObj?.get("connected") == false -> Line(null, "할 일 연결이 필요해요")
            tasksObj?.get("needs_reconnect") == true -> Line(null, "할 일을 다시 연결해 주세요")
            else -> due(raw.tasks, nowMs, zone)
        }
        // 후보 표가 아직 없으면(404) 웹처럼 0으로 센다. 그 밖의 실패는 '읽지 못했어요'.
        val box = when (raw.candidatesStatus) {
            200 -> inbox(raw.candidates, if (raw.tasksStatus == 200) raw.tasks else null)
            404 -> Line(0, "없음") to Line(0, "없음")
            else -> null
        } ?: (Line(null, "읽지 못했어요") to Line(null, "읽지 못했어요"))
        return Content(next, after, box.first, box.second, due, note)
    }

    /** 다음 일정이 없을 때 큰 줄 자리의 글. */
    const val NO_NEXT = "오늘 남은 일정 없음"

    private fun date(value: String): LocalDate? =
        try {
            LocalDate.parse(value.take(10))
        } catch (_: Exception) {
            null
        }

    private fun time(value: String): OffsetDateTime? =
        try {
            OffsetDateTime.parse(value)
        } catch (_: Exception) {
            null
        }
}
