package kr.or.kptu.work

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.SizeF
import android.view.View
import android.widget.RemoteViews
import java.time.LocalDate

/**
 * 홈 화면 '웹2 이번 주' 위젯(4×2·4×1, APP-위젯다시 ③). '지금' 위젯과 같은 위젯 세션·같은 갱신 작업(WidgetWorker) 하나로 읽는다.
 * 아래 줄·4×1 요일 칸을 누르면 앱 달력의 그 날(MainActivity ACTION_DAY → 웹 ?view=calendar&day= 또는 다리 day:open:).
 * APP-위젯날짜고르기: 4×2 요일 칸을 누르면 앱을 열지 않고 아래 칸이 그 날 일정·기한 할 일로 바뀐다(ACTION_PICK). [열기]만 앱 달력의 그 날을 연다.
 * S68-51(11/23 사용자 "위젯 다른 날 클릭이 안됨 / 일정 그냥 다 보여줘"): 주간 요약 줄(몰린 날)을 없애고 아래 칸은 늘 하루 목록
 * (안 고르면 오늘, 다른 주는 일요일)을 줄임 없이 전부, 위젯 안에서 스크롤(안드로이드 12+ RemoteCollectionItems, 11 이하 WeekListService).
 * 누름에는 그 칸이 속한 주(일요일)를 실어 보내, 앱 프로세스가 내려가 메모리를 잃은 뒤에 눌러도 그 날을 고르고 다시 읽는다.
 * 마지막에 그린 내용과 고른 날짜는 이 프로세스 메모리에만 둔다(폰에 저장하지 않음, 결정 W-D2).
 * APP-이번주위젯 S68-12: 늘 이번 주부터. 4×2 머리 줄 ‹ ›로 앞뒤 주(±WidgetWeek.MAX_SHIFT), 옮긴 주에서 머리 글자를 누르면 이번 주로.
 * 옮긴 주·고른 날은 위젯마다(appWidgetId) 메모리에만, 날이 바뀌면 이번 주·주간 요약으로 돌아간다. 4×1은 칸이 좁아 이번 주 고정.
 */
class WeekWidget : AppWidgetProvider() {
    sealed class State {
        object Loading : State()
        object SignedOut : State()
        object Failed : State()
        /** contents: 받은 주 내용(그 주 일요일이 열쇠). asked: 이번 갱신에서 읽으려 한 주(받지 못한 주는 '불러오지 못했어요'). */
        data class Shown(val contents: Map<LocalDate, WidgetWeek.Content>, val asked: Set<LocalDate> = contents.keys) : State()
    }

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val signedIn = WidgetGuard.get { WidgetHub.session(context).signedIn() } == true
        show(context, if (!signedIn) State.SignedOut else cached() ?: State.Loading, manager, ids)
        if (signedIn) {
            WidgetJobs.schedule(context)
            WidgetJobs.refreshNow(context)
        }
    }

    override fun onEnabled(context: Context) {
        if (WidgetHub.session(context).signedIn()) WidgetJobs.schedule(context)
    }

    override fun onDisabled(context: Context) {
        if (!HomeWidgets.anyRefreshed(context)) WidgetJobs.cancel(context)
        last = emptyMap()
        seen.clear()
        WeekListService.clear()
    }

    override fun onDeleted(context: Context, appWidgetIds: IntArray) {
        appWidgetIds.forEach {
            seen.remove(it)
            WeekListService.remove(it)
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == ACTION_REFRESH) {
            if (WidgetHub.session(context).signedIn()) {
                show(context, cached() ?: State.Loading)
                WidgetJobs.refreshNow(context)
            } else {
                show(context, State.SignedOut)
            }
            return
        }
        if (intent.action == ACTION_PICK) {
            pick(context, widgetId(intent), WidgetWeek.parseDay(intent.getStringExtra(EXTRA_DAY)), WidgetWeek.parseDay(intent.getStringExtra(EXTRA_SUNDAY)))
            return
        }
        if (intent.action == ACTION_SHIFT) {
            shift(
                context,
                widgetId(intent),
                intent.getIntExtra(EXTRA_DELTA, 0),
                WidgetWeek.parseDay(intent.getStringExtra(EXTRA_TO)),
                WidgetWeek.parseDay(intent.getStringExtra(EXTRA_SUNDAY)),
            )
            return
        }
        super.onReceive(context, intent)
    }

    companion object {
        const val ACTION_REFRESH = "kr.or.kptu.work.widget.WEEK_REFRESH"
        /** 4×2 요일 칸 누름: 이 위젯 아래 목록을 그 날로 바꾼다(앱을 열지 않음). */
        const val ACTION_PICK = "kr.or.kptu.work.widget.WEEK_PICK"
        /** S68-12: 4×2 머리 줄 ‹(−1)·›(+1), 옮긴 주의 머리 글자(0 = 이번 주로). 앱을 열지 않음. */
        const val ACTION_SHIFT = "kr.or.kptu.work.widget.WEEK_SHIFT"
        private const val EXTRA_DELTA = "delta"
        /** S68-51: 누른 칸·화살표가 그려질 때의 주 일요일(yyyy-mm-dd). 메모리를 잃어도 그 주를 되찾는 데만 쓴다. */
        private const val EXTRA_SUNDAY = "sunday"
        /** S69-78: ‹ ›가 옮길 대상 주 일요일(yyyy-mm-dd, 절대값). 머리 글자(0)에는 없다. */
        private const val EXTRA_TO = "to"
        /** 줄을 누르면 MainActivity가 받는 동작. 날짜는 EXTRA_DAY(yyyy-mm-dd, WidgetWeek.parseDay로만 읽음). */
        const val ACTION_DAY = "kr.or.kptu.work.action.WIDGET_DAY"
        const val EXTRA_DAY = "day"
        private val SMALL = SizeF(250f, 40f)
        private val LARGE = SizeF(250f, 110f)
        private val CELLS = intArrayOf(R.id.week_d0, R.id.week_d1, R.id.week_d2, R.id.week_d3, R.id.week_d4, R.id.week_d5, R.id.week_d6)
        private val WEEK = intArrayOf(R.id.week_w0, R.id.week_w1, R.id.week_w2, R.id.week_w3, R.id.week_w4, R.id.week_w5, R.id.week_w6)
        private val DATE = intArrayOf(R.id.week_n0, R.id.week_n1, R.id.week_n2, R.id.week_n3, R.id.week_n4, R.id.week_n5, R.id.week_n6)
        private val COUNT = intArrayOf(R.id.week_c0, R.id.week_c1, R.id.week_c2, R.id.week_c3, R.id.week_c4, R.id.week_c5, R.id.week_c6)
        /** APP-위젯먹색 S68-06: 4×2 요일 칸 첫 일정 줄(4×1 화면 틀에는 없다). */
        private val FIRST = intArrayOf(R.id.week_f0, R.id.week_f1, R.id.week_f2, R.id.week_f3, R.id.week_f4, R.id.week_f5, R.id.week_f6)

        /** 마지막에 받은 주 내용(그 주 일요일이 열쇠). 메모리에만. */
        @Volatile private var last: Map<LocalDate, WidgetWeek.Content> = emptyMap()

        /** 위젯 하나가 지금 보는 것: 옮긴 주와 옮긴 날짜, 고른 날과 고른 날짜(서울). 메모리에만. */
        private data class Seen(val shift: Int = 0, val shiftOn: LocalDate? = null, val picked: LocalDate? = null, val pickedOn: LocalDate? = null)

        private val seen = java.util.concurrent.ConcurrentHashMap<Int, Seen>()
        @Volatile private var drawn: State? = null

        private fun widgetId(intent: Intent): Int = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)

        private fun cached(): State? = last.takeIf { it.isNotEmpty() }?.let { State.Shown(it) }

        /** 이 위젯이 지금 보일 주(날이 바뀌었으면 0). */
        private fun shiftOf(id: Int, now: Long): Int = seen[id]?.let { WidgetWeek.shiftNow(it.shift, it.shiftOn, now) } ?: 0

        /** 갱신 작업이 읽을 주: 이번 주(0) + 위젯들이 지금 옮겨 둔 주. */
        fun shifts(now: Long = System.currentTimeMillis()): Set<Int> = setOf(0) + seen.keys.map { shiftOf(it, now) }

        /**
         * 요일 칸을 눌렀을 때: 그 위젯의 고른 날을 그 날로(같은 날을 다시 눌러도 그대로), 주는 누름에 실린 일요일로 맞추고 다시 그린다.
         * S68-51 원인: 예전에는 받은 내용(메모리)이 없으면 아무것도 하지 않았다. 홈 화면에 있는 동안 폰이 앱 프로세스를 내리면
         * 메모리가 비어 다른 날을 눌러도 바뀌지 않았다. 이제는 고른 날을 먼저 적고, 메모리가 비었으면 '불러오는 중'으로 그린 뒤 다시 읽는다.
         */
        private fun pick(context: Context, id: Int, day: LocalDate?, sunday: LocalDate?) {
            if (id == AppWidgetManager.INVALID_APPWIDGET_ID) return
            val now = System.currentTimeMillis()
            val shift = WidgetWeek.shiftOf(sunday, now)
            if (shift != null && WidgetWeek.dayInWeek(day, sunday)) {
                val today = WidgetWeek.today(now)
                seen[id] = Seen(shift = shift, shiftOn = today, picked = day, pickedOn = today)
            }
            redraw(context)
        }

        /** ‹ ›·머리 글자: 그 위젯의 주를 옮기고(0이면 이번 주로) 고른 날은 푼다. 받아 둔 주면 바로, 아니면 '불러오는 중' 뒤 읽기. */
        private fun shift(context: Context, id: Int, delta: Int, to: LocalDate?, sunday: LocalDate?) {
            if (id == AppWidgetManager.INVALID_APPWIDGET_ID) return
            val now = System.currentTimeMillis()
            // S69-78: 누름에 실린 대상 주(그릴 때 보이던 주에서 한 칸)가 1순위. 옛 판 누름은 위젯 기억에서 한 칸, 옛 월요일 판은 이번 주.
            val memory = seen[id]?.let { WidgetWeek.shiftNow(it.shift, it.shiftOn, now) }
            val next = WidgetWeek.shiftTarget(to, sunday, delta, memory, now)
            seen[id] = Seen(shift = next, shiftOn = WidgetWeek.today(now))
            redraw(context)
        }

        /** 마지막에 그린 상태 그대로 다시 그린다. 프로세스가 새로 떠 그린 상태가 없으면 '불러오는 중'으로 그리고 한 번 읽는다. */
        private fun redraw(context: Context) {
            val state = drawn
            if (state != null) {
                show(context, state)
                return
            }
            if (!WidgetHub.session(context).signedIn()) {
                show(context, State.SignedOut)
                return
            }
            show(context, State.Loading)
            WidgetJobs.refreshNow(context)
        }

        fun hasWidgets(context: Context): Boolean =
            AppWidgetManager.getInstance(context).getAppWidgetIds(ComponentName(context, WeekWidget::class.java)).isNotEmpty()

        /** 갱신 결과(주마다) → 그릴 상태. 로그아웃이면 로그아웃, 받은 주가 하나도 없으면 실패. */
        fun state(weeks: Map<Int, WidgetRefresh.Paint<WidgetWeek.Content>>, nowMs: Long): State {
            if (weeks.values.any { it == WidgetRefresh.Paint.SignedOut }) return State.SignedOut
            val got = weeks.values.mapNotNull { (it as? WidgetRefresh.Paint.Shown)?.content }.associateBy { it.sunday }
            if (got.isEmpty()) return State.Failed
            return State.Shown(got, weeks.keys.map { WidgetWeek.start(nowMs, shift = it) }.toSet())
        }

        fun show(context: Context, state: State) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, WeekWidget::class.java))
            if (ids.isNotEmpty()) show(context, state, manager, ids)
        }

        /** 그리다 실패하면(예외·초기화 실패) 빈칸 대신 '불러오지 못했어요' 한 줄만 그린다(FIX-위젯). */
        private fun show(context: Context, state: State, manager: AppWidgetManager, ids: IntArray) {
            if (WidgetGuard.run { draw(context, state, manager, ids) }) return
            WidgetGuard.run {
                val views = RemoteViews(context.packageName, R.layout.week_widget)
                note(views, "불러오지 못했어요 · ↻로 다시")
                views.setOnClickPendingIntent(R.id.week_refresh, refresh(context))
                manager.updateAppWidget(ids, views)
            }
        }

        private fun draw(context: Context, state: State, manager: AppWidgetManager, ids: IntArray) {
            drawn = state
            when (state) {
                is State.Shown -> last = state.contents
                State.SignedOut -> {
                    last = emptyMap()
                    seen.clear()
                    WeekListService.clear()
                }
                else -> Unit
            }
            val now = System.currentTimeMillis()
            var missing = false
            val lists = ArrayList<Int>()
            // 위젯마다 보는 주·고른 날이 달라 하나씩 그린다.
            for (id in ids) {
                var listed = false
                val rv = HomeWidgets.sized(context, R.layout.week_widget_small, R.layout.week_widget, SMALL, LARGE) { v, small ->
                    val r = paint(context, v, state, small, id, now)
                    if (r.unread) missing = true
                    if (r.listed) listed = true
                }
                manager.updateAppWidget(id, rv)
                if (listed && Build.VERSION.SDK_INT < Build.VERSION_CODES.S) lists += id
            }
            // 11 이하: 목록은 WeekListService가 메모리에서 읽는다. 새 줄을 다시 읽게 알린다.
            if (lists.isNotEmpty()) manager.notifyAppWidgetViewDataChanged(lists.toIntArray(), R.id.week_sel_list)
            // 옮긴 주를 아직 받지 않았으면 한 번 읽는다(이번 갱신에서 읽으려 했다가 못 받은 주는 다시 읽지 않음, ↻로).
            if (missing) WidgetJobs.refreshNow(context)
        }

        /** unread: 이 위젯이 보는 주를 아직 읽지 않았나(읽기 요청이 필요). listed: 아래 목록을 채웠나. */
        private class Painted(val unread: Boolean, val listed: Boolean)

        private fun paint(context: Context, views: RemoteViews, state: State, small: Boolean, id: Int, now: Long): Painted {
            // 4×1은 ‹ ›가 들어갈 칸이 없어 늘 이번 주(S68-12).
            val shift = if (small) 0 else shiftOf(id, now)
            val sunday = WidgetWeek.start(now, shift = shift)
            views.setOnClickPendingIntent(R.id.week_title, if (shift == 0) day(context, null, 0) else shiftIntent(context, id, 0, sunday, null))
            views.setOnClickPendingIntent(R.id.week_refresh, refresh(context))
            // S69-78: 4×1 틀에는 ‹ ›가 없다. 예전에는 4×1도 이번 주로 화살표 누름을 다시 만들어 4×2 누름에 실린 주를 덮었다.
            if (!small) {
                arrow(context, views, R.id.week_prev, id, shift, -1, sunday, now)
                arrow(context, views, R.id.week_next, id, shift, 1, sunday, now)
            }
            views.setViewVisibility(R.id.week_note, View.GONE)
            views.setTextViewText(R.id.week_title, WidgetWeek.header(now, shift = shift))
            views.setTextViewText(R.id.week_total, "")
            val shown = when (state) {
                is State.Shown, State.Failed -> last[sunday]
                else -> null
            }
            val unread = state is State.Shown && shown == null && sunday !in state.asked
            val c = shown ?: WidgetWeek.content(0, null, now, shift = shift)
            val v = seenOf(id)
            // 고른 날은 받은 내용이 없을 때(불러오는 중)에도 음영으로 보이고, 받은 뒤 그 주 밖이거나 날이 바뀌었을 때만 푼다.
            val active = if (small) null else WidgetWeek.active(v.picked, v.pickedOn, now, c.days)
            if (!small && shown != null && active == null && v.picked != null) seen[id] = v.copy(picked = null)
            val sel = if (small) null else WidgetWeek.shownDay(active, WidgetWeek.today(now), c.days)
            cells(context, views, c, small, sel, id, sunday)
            val detail = sel?.let { shown?.details?.get(it) }
            if (detail != null && shown != null) {
                selected(context, views, id, detail)
            } else {
                views.setViewVisibility(R.id.week_sel, View.GONE)
            }
            when (state) {
                State.SignedOut -> {
                    views.setViewVisibility(R.id.week_refresh, View.GONE)
                    note(views, HomeWidgets.SIGNED_OUT_LINE)
                    views.setOnClickPendingIntent(R.id.week_note, HomeWidgets.login(context))
                }
                State.Loading -> {
                    views.setViewVisibility(R.id.week_refresh, View.VISIBLE)
                    note(views, "불러오는 중")
                }
                State.Failed -> {
                    views.setViewVisibility(R.id.week_refresh, View.VISIBLE)
                    note(views, "불러오지 못했어요 · ↻로 다시")
                }
                is State.Shown -> {
                    views.setViewVisibility(R.id.week_refresh, View.VISIBLE)
                    when {
                        shown != null -> {
                            views.setTextViewText(R.id.week_title, shown.title)
                            views.setTextViewText(R.id.week_total, "일정 " + shown.total)
                            shown.note?.let { note(views, it) }
                        }
                        unread -> note(views, "불러오는 중")
                        else -> note(views, "불러오지 못했어요 · ↻로 다시")
                    }
                }
            }
            return Painted(unread, detail != null && shown != null)
        }

        private fun seenOf(id: Int): Seen = seen[id] ?: Seen()

        /** 머리 줄 ‹ ›(4×2만). 범위 끝이면 자리만 남기고 숨긴다(머리 글자가 흔들리지 않게). */
        private fun arrow(context: Context, views: RemoteViews, view: Int, id: Int, shift: Int, delta: Int, sunday: LocalDate, now: Long) {
            // S69-78: 그릴 때마다 지금 보이는 주에서 한 칸 옮긴 대상 주(절대값)를 새로 실어 묶는다.
            val to = WidgetWeek.arrowTo(shift, delta, now)
            views.setViewVisibility(view, if (to != null) View.VISIBLE else View.INVISIBLE)
            if (to != null) views.setOnClickPendingIntent(view, shiftIntent(context, id, delta, sunday, to))
        }

        /**
         * 요일 칸 7개. 칸 숫자가 없으면 '·'. 모든 날 같은 바탕, 고른 날만 옅은 먹색 칸, 오늘은 먹색 바탕 + 밝은 글자(S68-06). 바탕은 모두 누를 때 물결.
         * 4×2는 숫자 아래 그날 첫 일정 제목 앞부분 한 줄(WidgetWeek.firstLine), 4×1은 지금처럼 수만.
         * 4×2는 누르면 아래 목록이 그 날로 바뀌고(ACTION_PICK), 4×1은 아래 칸이 없으니 지금처럼 앱 그 날.
         */
        private fun cells(context: Context, views: RemoteViews, c: WidgetWeek.Content, small: Boolean, sel: LocalDate?, id: Int, sunday: LocalDate) {
            val today = LocalDate.now(WidgetNow.ZONE)
            c.days.take(CELLS.size).forEachIndexed { i, d ->
                views.setTextViewText(WEEK[i], if (small) d.week + " " + d.date else d.week)
                views.setTextViewText(DATE[i], d.date.toString())
                views.setTextViewText(COUNT[i], if (d.count > 0) d.count.toString() else "·")
                // 모든 날 같은 건수 색. 고른 날은 옅은 먹색 칸, 오늘은 먹색 바탕 + 밝은 글자(S68-06).
                val kind = WidgetWeek.cell(d, today, sel)
                val onInk = kind == WidgetWeek.Cell.TODAY || kind == WidgetWeek.Cell.TODAY_PICKED
                val ink = context.getColor(R.color.widget_today_ink)
                views.setTextColor(COUNT[i], if (onInk) ink else context.getColor(if (d.count > 0) R.color.widget_todo_ink else R.color.widget_muted))
                // S69-위젯일요일: 일요일 칸 요일·날짜 글자는 앱 달력과 같은 일요일 색(오늘 칸은 먹색 바탕 위 밝은 글자 그대로).
                val sun = WidgetWeek.isSunday(d.day)
                views.setTextColor(WEEK[i], if (onInk) ink else context.getColor(if (sun) R.color.widget_sun_ink else R.color.widget_muted))
                views.setTextColor(DATE[i], if (onInk) ink else context.getColor(if (sun) R.color.widget_sun_ink else R.color.widget_ink))
                if (!small) {
                    val first = WidgetWeek.firstLine(d, small)
                    views.setViewVisibility(FIRST[i], if (first == null) View.GONE else View.VISIBLE)
                    views.setTextViewText(FIRST[i], first ?: "")
                    views.setTextColor(FIRST[i], if (onInk) ink else context.getColor(R.color.widget_muted))
                }
                val bg = when (kind) {
                    WidgetWeek.Cell.TODAY -> R.drawable.widget_day_today
                    WidgetWeek.Cell.TODAY_PICKED -> R.drawable.widget_day_today_pick
                    WidgetWeek.Cell.PICKED -> R.drawable.widget_day_pick
                    WidgetWeek.Cell.PLAIN -> R.drawable.widget_day_plain
                }
                views.setInt(CELLS[i], "setBackgroundResource", bg)
                views.setOnClickPendingIntent(CELLS[i], if (small) day(context, d.day, i + 1) else pickIntent(context, id, d.day, sunday, i))
            }
        }

        /**
         * S68-51: 아래 칸 = 머리 줄(S69-07 시안 B: 날짜만 '11/23(월)') + [열기] + 그 날 줄 전부(줄임 없음, 위젯 안에서 스크롤).
         * S69-07: 일정 줄 → 가는 줄 + '할 일 n' 머리 → 빈 네모 + 할 일 줄(WidgetWeek.dayRows). 다가오는 일(D-n)·보고일 줄은 없다.
         * 안드로이드 12+는 줄을 그림에 함께 싣고(RemoteCollectionItems, 프로세스가 내려가도 남음), 11 이하는 WeekListService가 메모리에서 읽는다.
         */
        private fun selected(context: Context, views: RemoteViews, id: Int, d: WidgetWeek.Detail) {
            views.setViewVisibility(R.id.week_sel, View.VISIBLE)
            views.setTextViewText(R.id.week_sel_title, WidgetWeek.detailHead(d))
            views.setOnClickPendingIntent(R.id.week_sel_open, day(context, d.day, 11))
            val rows = WidgetWeek.dayRows(d)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val b = RemoteViews.RemoteCollectionItems.Builder().setHasStableIds(false).setViewTypeCount(ROW_TYPES)
                rows.forEachIndexed { i, row -> b.addItem(i.toLong(), rowView(context, row)) }
                views.setRemoteAdapter(R.id.week_sel_list, b.build())
            } else {
                WeekListService.put(id, rows)
                val intent = Intent(context, WeekListService::class.java).setData(Uri.parse("workon-widget://week/$id/list"))
                    .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
                @Suppress("DEPRECATION")
                views.setRemoteAdapter(R.id.week_sel_list, intent)
            }
        }

        /** S69-07: 목록 줄 종류마다 레이아웃 하나(일정·빈 날은 같은 줄, 할 일 머리, 할 일). 11 이하 WeekListService도 이것을 쓴다. */
        const val ROW_TYPES = 3

        fun rowView(context: Context, row: WidgetWeek.Row): RemoteViews {
            val layout = when (row.kind) {
                WidgetWeek.Kind.TASK_HEAD -> R.layout.week_widget_task_head
                WidgetWeek.Kind.TASK -> R.layout.week_widget_task_row
                WidgetWeek.Kind.EVENT, WidgetWeek.Kind.EMPTY -> R.layout.week_widget_row
            }
            return RemoteViews(context.packageName, layout).apply {
                setTextViewText(R.id.week_row, row.text)
                if (row.kind == WidgetWeek.Kind.TASK_HEAD) setViewVisibility(R.id.week_row_line, if (row.line) View.VISIBLE else View.GONE)
            }
        }

        private fun note(views: RemoteViews, text: String) {
            views.setViewVisibility(R.id.week_note, View.VISIBLE)
            views.setTextViewText(R.id.week_note, text)
        }

        /**
         * 4×2 요일 칸 누름(이 위젯에만 가는 방송). 요청 번호 230~236은 다른 위젯과 겹치지 않는다.
         * S68-12: 위젯마다 다른 누름이 되도록 위젯 번호를 data 주소에 넣는다(요청 번호가 같아도 섞이지 않음, 앱 밖으로 나가지 않는 표시일 뿐).
         */
        private fun pickIntent(context: Context, id: Int, day: LocalDate, sunday: LocalDate, i: Int): PendingIntent {
            val intent = Intent(context, WeekWidget::class.java).setAction(ACTION_PICK).setData(Uri.parse("workon-widget://week/$id/pick/$i/$day"))
                .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id).putExtra(EXTRA_DAY, day.toString()).putExtra(EXTRA_SUNDAY, sunday.toString())
            return PendingIntent.getBroadcast(context, 230 + i, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }

        /**
         * S68-12: 주 옮기기(−1·+1, 0 = 이번 주로). 요청 번호 237~239.
         * S69-78: 대상 주(to)를 data 주소에도 넣어 주마다 다른 누름이 되게 한다(다른 주를 그려도 실린 값이 덮이지 않음).
         */
        private fun shiftIntent(context: Context, id: Int, delta: Int, sunday: LocalDate, to: LocalDate?): PendingIntent {
            val intent = Intent(context, WeekWidget::class.java).setAction(ACTION_SHIFT).setData(Uri.parse(WidgetWeek.shiftData(id, delta, to)))
                .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id).putExtra(EXTRA_DELTA, delta).putExtra(EXTRA_SUNDAY, sunday.toString())
            to?.let { intent.putExtra(EXTRA_TO, it.toString()) }
            return PendingIntent.getBroadcast(context, 238 + delta, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }

        /** 그 날(없으면 달력 화면만). 요청 번호 200~211은 다른 위젯과 겹치지 않는다(211 = 고른 날 [열기], 208~210은 S68-51에서 비움). */
        private fun day(context: Context, day: LocalDate?, slot: Int): PendingIntent {
            val intent = Intent(context, MainActivity::class.java).setAction(ACTION_DAY).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            day?.let { intent.putExtra(EXTRA_DAY, it.toString()) }
            return PendingIntent.getActivity(context, 200 + slot, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }

        private fun refresh(context: Context): PendingIntent {
            val intent = Intent(context, WeekWidget::class.java).setAction(ACTION_REFRESH)
            return PendingIntent.getBroadcast(context, 22, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }
    }
}
