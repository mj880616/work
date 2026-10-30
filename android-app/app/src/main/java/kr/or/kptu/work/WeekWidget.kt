package kr.or.kptu.work

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews
import java.time.LocalDate

/**
 * WIDGET-여러개 ②: 홈 화면 '웹2 이번 주' 위젯(4×2). 오늘 위젯과 같은 위젯 세션·같은 갱신 작업(TodayWidgetWorker) 하나로 읽는다.
 * 줄을 누르면 앱 달력의 그 날(MainActivity ACTION_DAY → 웹 ?view=calendar&day= 또는 다리 day:open:).
 * 마지막에 그린 내용은 이 프로세스 메모리에만 둔다(폰에 저장하지 않음, 결정 W-D2).
 */
class WeekWidget : AppWidgetProvider() {
    sealed class State {
        object Loading : State()
        object SignedOut : State()
        object Failed : State()
        data class Shown(val content: WidgetWeek.Content) : State()
    }

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val signedIn = WidgetGuard.get { WidgetHub.session(context).signedIn() } == true
        show(context, if (!signedIn) State.SignedOut else last?.let { State.Shown(it) } ?: State.Loading, manager, ids)
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
        last = null
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == ACTION_REFRESH) {
            if (WidgetHub.session(context).signedIn()) {
                show(context, last?.let { State.Shown(it) } ?: State.Loading)
                WidgetJobs.refreshNow(context)
            } else {
                show(context, State.SignedOut)
            }
            return
        }
        super.onReceive(context, intent)
    }

    companion object {
        const val ACTION_REFRESH = "kr.or.kptu.work.widget.WEEK_REFRESH"
        /** 줄을 누르면 MainActivity가 받는 동작. 날짜는 EXTRA_DAY(yyyy-mm-dd, WidgetWeek.parseDay로만 읽음). */
        const val ACTION_DAY = "kr.or.kptu.work.action.WIDGET_DAY"
        const val EXTRA_DAY = "day"
        private val ROWS = intArrayOf(R.id.week_row0, R.id.week_row1, R.id.week_row2, R.id.week_row3, R.id.week_row4, R.id.week_row5, R.id.week_row6, R.id.week_row7)

        @Volatile private var last: WidgetWeek.Content? = null

        fun hasWidgets(context: Context): Boolean =
            AppWidgetManager.getInstance(context).getAppWidgetIds(ComponentName(context, WeekWidget::class.java)).isNotEmpty()

        fun state(p: WidgetRefresh.Paint<WidgetWeek.Content>): State = when (p) {
            is WidgetRefresh.Paint.Shown -> State.Shown(p.content)
            WidgetRefresh.Paint.SignedOut -> State.SignedOut
            WidgetRefresh.Paint.Failed -> State.Failed
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
            when (state) {
                is State.Shown -> last = state.content
                State.SignedOut -> last = null
                else -> Unit
            }
            val views = RemoteViews(context.packageName, R.layout.week_widget)
            val now = System.currentTimeMillis()
            views.setOnClickPendingIntent(R.id.week_title, day(context, null, 0))
            views.setOnClickPendingIntent(R.id.week_refresh, refresh(context))
            ROWS.forEach { views.setViewVisibility(it, View.GONE) }
            views.setViewVisibility(R.id.week_note, View.GONE)
            views.setTextViewText(R.id.week_title, WidgetWeek.header(now))
            when (state) {
                State.SignedOut -> {
                    views.setViewVisibility(R.id.week_refresh, View.GONE)
                    views.setViewVisibility(ROWS[0], View.VISIBLE)
                    views.setTextViewText(ROWS[0], HomeWidgets.SIGNED_OUT_LINE)
                    views.setOnClickPendingIntent(ROWS[0], HomeWidgets.login(context))
                }
                State.Loading -> {
                    views.setViewVisibility(R.id.week_refresh, View.VISIBLE)
                    note(views, "불러오는 중")
                }
                State.Failed -> {
                    views.setViewVisibility(R.id.week_refresh, View.VISIBLE)
                    last?.let { rows(context, views, it) }
                    note(views, "불러오지 못했어요 · ↻로 다시")
                }
                is State.Shown -> {
                    views.setViewVisibility(R.id.week_refresh, View.VISIBLE)
                    rows(context, views, state.content)
                    state.content.note?.let { note(views, it) }
                }
            }
            manager.updateAppWidget(ids, views)
        }

        private fun note(views: RemoteViews, text: String) {
            views.setViewVisibility(R.id.week_note, View.VISIBLE)
            views.setTextViewText(R.id.week_note, text)
        }

        private fun rows(context: Context, views: RemoteViews, content: WidgetWeek.Content) {
            views.setTextViewText(R.id.week_title, content.title)
            content.rows.take(ROWS.size).forEachIndexed { i, row ->
                views.setViewVisibility(ROWS[i], View.VISIBLE)
                views.setTextViewText(ROWS[i], row.text)
                views.setOnClickPendingIntent(ROWS[i], day(context, row.day, i + 1))
            }
        }

        /** 그 날(없으면 달력 화면만). 요청 번호 200~208은 다른 위젯과 겹치지 않는다. */
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
