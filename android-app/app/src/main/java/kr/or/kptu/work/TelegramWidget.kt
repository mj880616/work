package kr.or.kptu.work

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.View
import android.widget.RemoteViews

/**
 * WIDGET-여러개 ③: 홈 화면 '웹2 텔레그램' 위젯(4×2, 운영자 전용). 오늘 위젯과 같은 위젯 세션·같은 갱신 작업으로 읽는다.
 * 내용은 서버 허용표를 쓰는 기존 RLS만 주고, 기능이 없는 사람에게는 '이 기능 없음'만 그린다.
 * 줄을 누르면 앱 텔레그램 화면의 그 방·그 날(MainActivity ACTION_TG → 웹 ?view=telegram&tg_room=&tg_day= 또는 다리 tg:open:).
 * 마지막에 그린 내용은 이 프로세스 메모리에만 둔다(폰에 저장하지 않음, 결정 W-D2).
 */
class TelegramWidget : AppWidgetProvider() {
    sealed class State {
        object Loading : State()
        object SignedOut : State()
        object Failed : State()
        data class Shown(val content: WidgetTelegram.Content) : State()
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
        const val ACTION_REFRESH = "kr.or.kptu.work.widget.TG_REFRESH"
        /** 줄을 누르면 MainActivity가 받는 동작. 방 번호·날짜는 EXTRA_ROOM·EXTRA_DAY(앱이 다시 거름). */
        const val ACTION_TG = "kr.or.kptu.work.action.WIDGET_TG"
        const val EXTRA_ROOM = "room"
        const val EXTRA_DAY = "day"
        private val ROWS = intArrayOf(R.id.tg_row0, R.id.tg_row1, R.id.tg_row2)

        @Volatile private var last: WidgetTelegram.Content? = null

        fun hasWidgets(context: Context): Boolean =
            AppWidgetManager.getInstance(context).getAppWidgetIds(ComponentName(context, TelegramWidget::class.java)).isNotEmpty()

        fun state(p: WidgetRefresh.Paint<WidgetTelegram.Content>): State = when (p) {
            is WidgetRefresh.Paint.Shown -> State.Shown(p.content)
            WidgetRefresh.Paint.SignedOut -> State.SignedOut
            WidgetRefresh.Paint.Failed -> State.Failed
        }

        fun show(context: Context, state: State) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, TelegramWidget::class.java))
            if (ids.isNotEmpty()) show(context, state, manager, ids)
        }

        /** 그리다 실패하면(예외·초기화 실패) 빈칸 대신 '불러오지 못했어요' 한 줄만 그린다(FIX-위젯). */
        private fun show(context: Context, state: State, manager: AppWidgetManager, ids: IntArray) {
            if (WidgetGuard.run { draw(context, state, manager, ids) }) return
            WidgetGuard.run {
                val views = RemoteViews(context.packageName, R.layout.telegram_widget)
                note(views, "불러오지 못했어요 · ↻로 다시")
                views.setOnClickPendingIntent(R.id.tg_refresh, refresh(context))
                manager.updateAppWidget(ids, views)
            }
        }

        private fun draw(context: Context, state: State, manager: AppWidgetManager, ids: IntArray) {
            when (state) {
                is State.Shown -> last = state.content
                State.SignedOut -> last = null
                else -> Unit
            }
            val views = RemoteViews(context.packageName, R.layout.telegram_widget)
            views.setTextViewText(R.id.tg_title, "텔레그램")
            views.setOnClickPendingIntent(R.id.tg_title, openTelegram(context))
            views.setOnClickPendingIntent(R.id.tg_refresh, refresh(context))
            ROWS.forEach { views.setViewVisibility(it, View.GONE) }
            views.setViewVisibility(R.id.tg_note, View.GONE)
            views.setViewVisibility(R.id.tg_refresh, View.VISIBLE)
            when (state) {
                State.SignedOut -> {
                    views.setViewVisibility(R.id.tg_refresh, View.GONE)
                    views.setViewVisibility(ROWS[0], View.VISIBLE)
                    views.setTextViewText(ROWS[0], HomeWidgets.SIGNED_OUT_LINE)
                    views.setOnClickPendingIntent(ROWS[0], HomeWidgets.login(context))
                }
                State.Loading -> note(views, "불러오는 중")
                State.Failed -> {
                    last?.let { paint(context, views, it) }
                    note(views, "불러오지 못했어요 · ↻로 다시")
                }
                is State.Shown -> {
                    paint(context, views, state.content)
                    state.content.note?.let { note(views, it) }
                }
            }
            manager.updateAppWidget(ids, views)
        }

        private fun note(views: RemoteViews, text: String) {
            views.setViewVisibility(R.id.tg_note, View.VISIBLE)
            views.setTextViewText(R.id.tg_note, text)
        }

        private fun paint(context: Context, views: RemoteViews, content: WidgetTelegram.Content) {
            views.setTextViewText(R.id.tg_title, content.head)
            if (!content.enabled) {
                // 기능이 없는 사람: 아무 화면으로도 보내지 않고 새로고침도 숨긴다.
                views.setViewVisibility(R.id.tg_refresh, View.GONE)
                return
            }
            content.rooms.take(ROWS.size).forEachIndexed { i, room ->
                views.setViewVisibility(ROWS[i], View.VISIBLE)
                views.setTextViewText(ROWS[i], room.text)
                val intent = Intent(context, MainActivity::class.java).setAction(ACTION_TG)
                    .putExtra(EXTRA_ROOM, room.key)
                    .putExtra(EXTRA_DAY, room.day.toString())
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                views.setOnClickPendingIntent(ROWS[i], PendingIntent.getActivity(context, 300 + i, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
            }
        }

        private fun openTelegram(context: Context): PendingIntent {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(ShellRules.HOME + "?view=telegram"), context, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            return PendingIntent.getActivity(context, 310, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }

        private fun refresh(context: Context): PendingIntent {
            val intent = Intent(context, TelegramWidget::class.java).setAction(ACTION_REFRESH)
            return PendingIntent.getBroadcast(context, 23, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }
    }
}
