package kr.or.kptu.work

import android.content.Context
import android.provider.MediaStore

/**
 * S68-02: AppFolderRules를 폰에서 쓰는 곳. nojo_words 값(위젯 갱신이 서버 기능 목록으로 받음)을 기기 설정에 두고,
 * 사진첩에 이미 'Pictures/노조+'·'Movies/노조+' 사진이 있는지 본다. 기록 내용은 두지 않는다(기능 하나의 참·거짓만).
 */
object AppFolders {
    private const val PREFS = "app_folders"
    private const val KEY_NOJO = "nojo_words"

    fun rememberNojoWords(context: Context, value: Boolean?) {
        if (value == null) return
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_NOJO, value).apply()
    }

    private fun nojoWords(context: Context): Boolean? {
        val p = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return if (p.contains(KEY_NOJO)) p.getBoolean(KEY_NOJO, false) else null
    }

    /** 옛 앱 폴더에 사진·동영상이 하나라도 있나(앱이 보는 범위). 확인하지 못하면 있다고 본다(옛 이름 쪽이 안전). */
    private fun oldExists(context: Context): Boolean = try {
        val where = "${MediaStore.MediaColumns.RELATIVE_PATH} IN (?, ?)"
        val args = arrayOf(AppFolderRules.pictures(AppFolderRules.OLD), AppFolderRules.movies(AppFolderRules.OLD))
        listOf(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, MediaStore.Video.Media.EXTERNAL_CONTENT_URI).any { uri ->
            context.contentResolver.query(uri, arrayOf(MediaStore.MediaColumns._ID), where, args, null)?.use { it.count > 0 } ?: false
        }
    } catch (_: Exception) {
        true
    }

    /** 이 사람의 앱 폴더 이름('노조+' 또는 'WORK ON+'). */
    fun home(context: Context): String = AppFolderRules.pick(oldExists(context), nojoWords(context))
}
