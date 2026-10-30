package kr.or.kptu.work

/**
 * WIDGET-여러개 ①: 서버를 읽지 않는 위젯(빠른 쓰기 4×1, 한 칸 1×1)의 규칙. 안드로이드 API를 쓰지 않아 JVM 시험 대상이다.
 * - 칸을 누르면 앱 화면만 연다. 위젯이 서버에 보내는 요청은 없다(WidgetRules.allowed 목록은 그대로).
 * - [업데이트]·[할 일]·[노트]: 웹2의 상단 [+ 추가]와 같은 쓰기 창(웹 phone-widget-write.js).
 * - [사진]: 사진 고르기·카메라 → 공유 받기와 같은 길로 정리함에 바로 넣는다(SHARE-바로넣기).
 * - [녹음]: 녹음 시작 인텐트(RecordHub.ACTION_START, 내보내지 않은 RecordActionActivity).
 * - 한 칸 위젯이 고른 기능은 앱 전용 공간(SharedPreferences, 백업 제외)에 위젯 번호별로 둔다. 업무 내용은 두지 않는다.
 * 시안 6번 '한 칸 바구니'는 한 칸 위젯의 [업데이트](기록할 곳을 고르지 않으면 정리함)와 같아 하나로 합쳤다.
 */
enum class WidgetAction(val id: String, val label: String) {
    UPDATE("update", "업데이트"),
    TASK("task", "할 일"),
    NOTE("note", "노트"),
    PHOTO("photo", "사진"),
    RECORD("record", "녹음"),
}

object WidgetActions {
    /** MainActivity가 받는 쓰기 창 동작. 종류는 EXTRA_KIND(허용 종류만 읽음). */
    const val ACTION_WRITE = "kr.or.kptu.work.action.WIDGET_WRITE"
    const val EXTRA_KIND = "kind"
    /** 한 칸 위젯이 고른 기능을 두는 앱 전용 설정 파일 이름(data_extraction_rules에서 백업 제외). */
    const val PREFS = "widget_one"

    /** 빠른 쓰기(4×1) 칸 순서: [업데이트] [할 일] [노트] [사진]. */
    val QUICK: List<WidgetAction> = listOf(WidgetAction.UPDATE, WidgetAction.TASK, WidgetAction.NOTE, WidgetAction.PHOTO)

    /** 한 칸(1×1) 위젯을 놓을 때 고르는 목록(요청 순서). */
    val ONE_CHOICES: List<WidgetAction> = listOf(WidgetAction.NOTE, WidgetAction.UPDATE, WidgetAction.TASK, WidgetAction.PHOTO, WidgetAction.RECORD)

    private val WRITE = setOf(WidgetAction.UPDATE, WidgetAction.TASK, WidgetAction.NOTE)

    fun fromId(id: String?): WidgetAction? = WidgetAction.values().firstOrNull { it.id == id }

    fun isWrite(action: WidgetAction): Boolean = action in WRITE

    /** 쓰기 창 종류만 받는다(밖에서 보낸 다른 값은 무시). */
    fun writeKind(value: String?): WidgetAction? = fromId(value)?.takeIf(::isWrite)

    /** 웹2를 새로 열 때의 주소(웹이 읽고 주소에서 지운다). */
    fun writeUrl(action: WidgetAction): String {
        require(isWrite(action))
        return ShellRules.HOME + "?write=" + action.id
    }

    /** 웹2가 이미 떠 있을 때 다리로 보내는 글(화면을 다시 불러오지 않는다). */
    fun writeMessage(action: WidgetAction): String {
        require(isWrite(action))
        return "write:open:" + action.id
    }

    /** 위젯 칸이 여는 곳. 안드로이드 Intent는 이것으로만 만든다(ActionWidgets.kt). */
    data class Target(val activity: String, val action: String, val kind: String?)

    const val MAIN = "MainActivity"
    const val PHOTO_ACTIVITY = "PhotoPickActivity"
    const val RECORD_ACTIVITY = "RecordActionActivity"
    const val ACTION_PHOTO = "kr.or.kptu.work.action.WIDGET_PHOTO"

    fun target(action: WidgetAction): Target = when (action) {
        WidgetAction.UPDATE, WidgetAction.TASK, WidgetAction.NOTE -> Target(MAIN, ACTION_WRITE, action.id)
        WidgetAction.PHOTO -> Target(PHOTO_ACTIVITY, ACTION_PHOTO, null)
        WidgetAction.RECORD -> Target(RECORD_ACTIVITY, RecordHub.ACTION_START, null)
    }

    /** PendingIntent 요청 번호(위젯 종류·칸마다 다르게, 오늘 위젯 10~21과 겹치지 않게). */
    fun requestCode(widget: Int, action: WidgetAction): Int = 100 + widget * 10 + action.ordinal

    fun prefKey(widgetId: Int): String = "one.$widgetId"

    /** 한 칸 위젯 설정 창의 결과: 고른 기능만, 모르는 값은 null(위젯을 놓지 않음). */
    fun chosen(value: String?): WidgetAction? = fromId(value)?.takeIf { it in ONE_CHOICES }
}
