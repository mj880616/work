package kr.or.kptu.work

import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import java.util.concurrent.ConcurrentHashMap

/**
 * S68-51: '이번 주' 위젯 아래 목록(스크롤)의 안드로이드 11 이하 길. 12+는 WeekWidget이 줄을 그림에 함께 싣는다(RemoteCollectionItems).
 * 줄은 이 프로세스 메모리에만 둔다(폰에 저장하지 않음, 결정 W-D2). 프로세스가 내려가 비면 빈 목록이고, 다음 갱신이 다시 채운다.
 * 내보내지 않은(exported=false) 서비스이며 BIND_REMOTEVIEWS 권한을 가진 시스템만 붙는다.
 */
class WeekListService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory =
        Rows(applicationContext, intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID))

    companion object {
        private val rows = ConcurrentHashMap<Int, List<WidgetWeek.Row>>()

        fun put(id: Int, list: List<WidgetWeek.Row>) {
            rows[id] = list
        }

        fun remove(id: Int) {
            rows.remove(id)
        }

        fun clear() = rows.clear()

        fun rowsOf(id: Int): List<WidgetWeek.Row> = rows[id].orEmpty()
    }

    private class Rows(private val context: Context, private val id: Int) : RemoteViewsFactory {
        private var items: List<WidgetWeek.Row> = emptyList()

        override fun onCreate() = Unit

        override fun onDataSetChanged() {
            items = rowsOf(id)
        }

        override fun onDestroy() = Unit

        override fun getCount(): Int = items.size

        override fun getViewAt(position: Int): RemoteViews =
            WeekWidget.rowView(context, items.getOrNull(position) ?: WidgetWeek.Row(WidgetWeek.Kind.EMPTY, ""))

        override fun getLoadingView(): RemoteViews? = null

        override fun getViewTypeCount(): Int = WeekWidget.ROW_TYPES

        override fun getItemId(position: Int): Long = position.toLong()

        override fun hasStableIds(): Boolean = false
    }
}
