package kr.or.kptu.work

import android.app.Activity
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ClipData
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.view.Gravity
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.RemoteViews
import android.widget.ScrollView
import android.widget.TextView

/**
 * WIDGET-여러개 ①: 서버를 읽지 않는 위젯. 칸을 누르면 앱 화면만 연다(서버 요청 없음, WidgetRules.allowed 그대로).
 * 어디로 여는지는 WidgetActions.target(시험으로 고정)이 정하고, 여기서는 그대로 Intent로 바꾼다.
 */
object WidgetIntents {
    fun intent(context: Context, action: WidgetAction): Intent {
        val t = WidgetActions.target(action)
        val cls: Class<*> = when (t.activity) {
            WidgetActions.MAIN -> MainActivity::class.java
            WidgetActions.PHOTO_ACTIVITY -> PhotoPickActivity::class.java
            WidgetActions.RECORD_ACTIVITY -> RecordActionActivity::class.java
            else -> error("unknown target")
        }
        val intent = Intent(context, cls).setAction(t.action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        t.kind?.let { intent.putExtra(WidgetActions.EXTRA_KIND, it) }
        return intent
    }

    fun pending(context: Context, widget: Int, action: WidgetAction): PendingIntent =
        PendingIntent.getActivity(
            context,
            WidgetActions.requestCode(widget, action),
            intent(context, action),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

    fun icon(action: WidgetAction): Int = when (action) {
        WidgetAction.UPDATE -> R.drawable.ic_w_update
        WidgetAction.TASK -> R.drawable.ic_w_task
        WidgetAction.NOTE -> R.drawable.ic_w_note
        WidgetAction.PHOTO -> R.drawable.ic_w_photo
        WidgetAction.RECORD -> R.drawable.ic_w_record
    }
}

/** 빠른 쓰기(4×1): [업데이트] [할 일] [노트] [사진]. */
class QuickWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val views = RemoteViews(context.packageName, R.layout.quick_widget)
        val cells = intArrayOf(R.id.quick_cell0, R.id.quick_cell1, R.id.quick_cell2, R.id.quick_cell3)
        WidgetActions.QUICK.forEachIndexed { i, action ->
            views.setOnClickPendingIntent(cells[i], WidgetIntents.pending(context, WIDGET, action))
        }
        manager.updateAppWidget(ids, views)
    }

    companion object {
        const val WIDGET = 1
    }
}

/**
 * 한 칸(1×1): 놓을 때 고른 기능 하나(OneWidgetConfigActivity). 같은 위젯을 여러 개 놓아 각각 다른 기능을 둔다.
 * 고른 기능은 앱 전용 설정 파일(백업 제외)에 위젯 번호별로 둔다. 위젯을 지우면 그 줄도 지운다.
 */
class OneWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        ids.forEach { draw(context, manager, it) }
    }

    override fun onDeleted(context: Context, ids: IntArray) {
        val edit = prefs(context).edit()
        ids.forEach { edit.remove(WidgetActions.prefKey(it)) }
        edit.apply()
    }

    companion object {
        const val WIDGET = 2

        private fun prefs(context: Context) = context.getSharedPreferences(WidgetActions.PREFS, Context.MODE_PRIVATE)

        fun chosen(context: Context, id: Int): WidgetAction? =
            WidgetActions.chosen(prefs(context).getString(WidgetActions.prefKey(id), null))

        fun choose(context: Context, id: Int, action: WidgetAction) {
            prefs(context).edit().putString(WidgetActions.prefKey(id), action.id).apply()
            draw(context, AppWidgetManager.getInstance(context), id)
        }

        fun draw(context: Context, manager: AppWidgetManager, id: Int) {
            val views = RemoteViews(context.packageName, R.layout.one_widget)
            val action = chosen(context, id)
            if (action == null) {
                // 고르지 않은 채 놓였으면(설정 창을 건너뛴 홈 화면) 누르면 고르기 창을 연다.
                views.setImageViewResource(R.id.one_icon, R.drawable.ic_w_update)
                views.setTextViewText(R.id.one_label, "고르기")
                val pick = Intent(context, OneWidgetConfigActivity::class.java)
                    .setAction(AppWidgetManager.ACTION_APPWIDGET_CONFIGURE)
                    .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                views.setOnClickPendingIntent(
                    R.id.one_root,
                    PendingIntent.getActivity(context, 1000 + id, pick, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT),
                )
            } else {
                views.setImageViewResource(R.id.one_icon, WidgetIntents.icon(action))
                views.setTextViewText(R.id.one_label, action.label)
                views.setContentDescription(R.id.one_root, action.label)
                views.setOnClickPendingIntent(R.id.one_root, WidgetIntents.pending(context, WIDGET, action))
            }
            manager.updateAppWidget(id, views)
        }
    }
}

/**
 * 한 칸 위젯을 놓을 때(또는 꾹 눌러 다시 고를 때) 뜨는 작은 고르기 창. 홈 화면 앱이 열어야 해서 내보낸다(exported),
 * 하는 일은 이 앱 위젯 번호의 기능 이름 하나 저장뿐이다. 모르는 번호·값은 받지 않는다.
 */
class OneWidgetConfigActivity : Activity() {
    private var widgetId = AppWidgetManager.INVALID_APPWIDGET_ID

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        widgetId = intent?.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
            ?: AppWidgetManager.INVALID_APPWIDGET_ID
        setResult(RESULT_CANCELED, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
        val mine = AppWidgetManager.getInstance(this)
            .getAppWidgetIds(android.content.ComponentName(this, OneWidget::class.java))
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID || widgetId !in mine) {
            finish()
            return
        }
        title = "한 칸 위젯 기능"
        val dp = resources.displayMetrics.density
        val list = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding((8 * dp).toInt(), (4 * dp).toInt(), (8 * dp).toInt(), (8 * dp).toInt())
        }
        val current = OneWidget.chosen(this, widgetId)
        WidgetActions.ONE_CHOICES.forEach { action ->
            val row = TextView(this).apply {
                text = (if (action == current) "✓ " else "") + choiceLabel(action)
                textSize = 15f
                minHeight = (44 * dp).toInt()
                gravity = Gravity.CENTER_VERTICAL
                setPadding((12 * dp).toInt(), 0, (12 * dp).toInt(), 0)
                isClickable = true
                isFocusable = true
                setBackgroundResource(android.R.drawable.list_selector_background)
                setOnClickListener { pick(action) }
            }
            list.addView(row, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        }
        setContentView(ScrollView(this).apply { addView(list) })
    }

    private fun choiceLabel(action: WidgetAction): String = when (action) {
        WidgetAction.NOTE -> "노트 추가"
        WidgetAction.UPDATE -> "업데이트(정리함)"
        WidgetAction.TASK -> "할 일 추가"
        WidgetAction.PHOTO -> "사진 올리기"
        WidgetAction.RECORD -> "녹음 시작"
    }

    private fun pick(action: WidgetAction) {
        OneWidget.choose(this, widgetId, action)
        setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
        finish()
    }
}

/**
 * 위젯 [사진] 칸: 사진 고르기(여러 장) 또는 카메라 → 공유 받기와 같은 길(ShareIntake, SHARE-바로넣기)로 정리함에 바로 넣는다.
 * 내보내지 않아 이 앱 안에서만 열린다. 저장소 권한은 쓰지 않는다(고른 사진의 임시 읽기 권한만).
 * 카메라 사진은 카메라 앱이 사진첩(Pictures/웹2)에 저장한다. 찍지 않고 닫으면 미리 만든 빈 자리를 지운다.
 */
class PhotoPickActivity : Activity() {
    private var shot: Uri? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (savedInstanceState != null) {
            shot = savedInstanceState.getString(STATE_SHOT)?.let(Uri::parse)
            return
        }
        val pick = Intent(Intent.ACTION_GET_CONTENT)
            .setType("image/*")
            .addCategory(Intent.CATEGORY_OPENABLE)
            .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        val chooser = Intent.createChooser(pick, "사진 올리기")
        newShot()?.let { uri ->
            shot = uri
            val camera = Intent(MediaStore.ACTION_IMAGE_CAPTURE)
                .putExtra(MediaStore.EXTRA_OUTPUT, uri)
                .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
            if (camera.resolveActivity(packageManager) != null) chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, arrayOf(camera))
            else dropShot()
        }
        try {
            @Suppress("DEPRECATION")
            startActivityForResult(chooser, REQUEST)
        } catch (_: Exception) {
            dropShot()
            finish()
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        shot?.let { outState.putString(STATE_SHOT, it.toString()) }
    }

    @Deprecated("Activity result")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQUEST) return
        val picked = ArrayList<Uri>()
        if (resultCode == RESULT_OK && data != null) {
            val clip = data.clipData
            if (clip != null) for (i in 0 until clip.itemCount) clip.getItemAt(i).uri?.let(picked::add)
            data.data?.let { if (it !in picked) picked.add(it) }
        }
        val camera = shot
        if (picked.isEmpty() && resultCode == RESULT_OK && camera != null && hasBytes(camera)) picked.add(camera)
        else if (camera != null && camera !in picked) dropShot()
        val content = picked.filter { "content".equals(it.scheme, ignoreCase = true) }
        if (content.isNotEmpty()) {
            val send = Intent(this, MainActivity::class.java)
                .setAction(Intent.ACTION_SEND_MULTIPLE)
                .setType("image/*")
                .putParcelableArrayListExtra(Intent.EXTRA_STREAM, ArrayList(content))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
            val clip = ClipData.newRawUri("", content[0])
            content.drop(1).forEach { clip.addItem(ClipData.Item(it)) }
            send.clipData = clip
            startActivity(send)
        }
        finish()
    }

    private fun newShot(): Uri? = try {
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, "web2-" + System.currentTimeMillis() + ".jpg")
            put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
            put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/웹2")
        }
        contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
    } catch (_: Exception) {
        null
    }

    private fun hasBytes(uri: Uri): Boolean = try {
        contentResolver.openAssetFileDescriptor(uri, "r")?.use { it.length != 0L } ?: false
    } catch (_: Exception) {
        false
    }

    private fun dropShot() {
        val uri = shot ?: return
        shot = null
        try {
            contentResolver.delete(uri, null, null)
        } catch (_: Exception) {
            // 지우지 못한 빈 자리는 사진첩에 보이지 않는다(크기 0).
        }
    }

    companion object {
        private const val REQUEST = 41
        private const val STATE_SHOT = "shot"
    }
}
