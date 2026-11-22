package kr.or.kptu.work

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** S68-02: 앱 사진첩 폴더 이름(이미 있는 'Pictures/노조+'는 그대로, 없으면 nojo_words만 '노조+', 그 밖 'WORK ON+'). */
class AppFolderRulesTest {
    @Test
    fun existingOldFolderIsAlwaysKept() {
        assertEquals("노조+", AppFolderRules.pick(oldExists = true, nojoWords = false))
        assertEquals("노조+", AppFolderRules.pick(oldExists = true, nojoWords = null))
        assertEquals("노조+", AppFolderRules.pick(oldExists = true, nojoWords = true))
    }

    @Test
    fun newFolderOnlyWhenNoOldFolder() {
        assertEquals("노조+", AppFolderRules.pick(oldExists = false, nojoWords = true))
        assertEquals("WORK ON+", AppFolderRules.pick(oldExists = false, nojoWords = false))
        assertEquals("WORK ON+", AppFolderRules.pick(oldExists = false, nojoWords = null))
    }

    @Test
    fun resolveMapsOnlyAppFolders() {
        assertEquals("Pictures/WORK ON+/", AppFolderRules.resolve(null, "WORK ON+"))
        assertEquals("Pictures/노조+/", AppFolderRules.resolve(null, "노조+"))
        // 웹이 원래 폴더를 모를 때 보내는 기본값·폰이 바꿔 넣는 기본값은 이 사람의 앱 폴더로.
        assertEquals("Pictures/WORK ON+/", AppFolderRules.resolve(PhotoEditRules.SAVE_DIR, "WORK ON+"))
        assertEquals("Movies/WORK ON+/", AppFolderRules.resolve(PhotoEditRules.restoreDir("Download/", true), "WORK ON+"))
        assertEquals("Pictures/노조+/", AppFolderRules.resolve("Pictures/WORK ON+/", "노조+"))
        // 원래 폴더는 그대로.
        assertEquals("DCIM/Camera/", AppFolderRules.resolve("DCIM/Camera/", "WORK ON+"))
        assertEquals("Pictures/노조+ 사진/", AppFolderRules.resolve("Pictures/노조+ 사진/", "WORK ON+"))
        assertTrue(AppFolderRules.isAppDir("Movies/노조+/"))
        assertFalse(AppFolderRules.isAppDir("Pictures/"))
    }

    @Test
    fun nojoWordsFromServerFeatureList() {
        assertEquals(true, AppFolderRules.nojoWordsOf(200, listOf("calls", "nojo_words")))
        assertEquals(false, AppFolderRules.nojoWordsOf(200, listOf("calls")))
        assertEquals(false, AppFolderRules.nojoWordsOf(200, emptyList<String>()))
        assertNull(AppFolderRules.nojoWordsOf(500, listOf("nojo_words")))
        assertNull(AppFolderRules.nojoWordsOf(200, mapOf("nojo_words" to true)))
        assertNull(AppFolderRules.nojoWordsOf(200, null))
    }

    @Test
    fun savesGoThroughTheRuleNotAFixedFolder() {
        val src = File("src/main/java/kr/or/kptu/work")
        val media = File(src, "PhoneMedia.kt").readText()
        assertTrue(media.contains("AppFolderRules.resolve(begin.dir, AppFolders.home(context))"))
        val camera = File(src, "ActionWidgets.kt").readText()
        assertTrue(camera.contains("Environment.DIRECTORY_PICTURES + \"/\" + AppFolders.home(this@PhotoPickActivity)"))
        assertFalse(camera.contains("\"/노조+\""))
        // 폴더를 옮기거나 이름을 바꾸는 코드는 없다(읽기·새로 넣기만).
        val folders = File(src, "AppFolders.kt").readText()
        assertFalse(folders.contains(".update(") || folders.contains(".delete(") || folders.contains("renameTo"))
    }
}
