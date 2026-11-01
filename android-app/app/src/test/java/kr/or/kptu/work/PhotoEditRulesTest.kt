package kr.or.kptu.work

import kr.or.kptu.work.PhotoEditRules.Message
import kr.or.kptu.work.PhotoEditRules.Target
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PhotoEditRulesTest {
    private fun media(id: Long, name: String, size: Long, taken: Long, video: Boolean = false) =
        PhoneMediaRules.Media(id, name, size, taken, false, taken, if (video) "video/mp4" else "image/jpeg", 100, 80, 0, video, false)

    @Test
    fun editMessages() {
        assertEquals(Message.Edit(Target.Id(123)), PhotoEditRules.message("photos:edit:{\"id\":\"123\"}"))
        assertEquals(Message.Edit(Target.Match("IMG_1.jpg", 2048, 1700000000000)),
            PhotoEditRules.message("photos:edit:{\"name\":\"IMG_1.jpg\",\"size\":2048,\"taken\":1700000000000}"))
        assertNull(PhotoEditRules.message("photos:edit:{\"id\":\"12a\"}"))
        assertNull(PhotoEditRules.message("photos:edit:{\"id\":123}"))
        assertNull(PhotoEditRules.message("photos:edit:{}"))
        assertNull(PhotoEditRules.message("photos:edit:not-json"))
        assertNull(PhotoEditRules.message("photos:edit:{\"name\":\"a\\nb\",\"size\":1}"))
        assertNull(PhotoEditRules.message("photos:edits:{\"id\":\"1\"}"))
    }

    @Test
    fun saveMessages() {
        assertEquals(Message.Begin("IMG_1.jpg", "image/jpeg", 10), PhotoEditRules.message("photos:save:begin:{\"name\":\"IMG_1.jpg\",\"mime\":\"image/jpeg\",\"size\":10}"))
        // 동영상·너무 큰 것·크기 없음은 받지 않는다.
        assertNull(PhotoEditRules.message("photos:save:begin:{\"name\":\"a.mp4\",\"mime\":\"video/mp4\",\"size\":10}"))
        assertNull(PhotoEditRules.message("photos:save:begin:{\"name\":\"a.jpg\",\"mime\":\"image/jpeg\",\"size\":${PhotoEditRules.SAVE_MAX + 1}}"))
        assertNull(PhotoEditRules.message("photos:save:begin:{\"name\":\"a.jpg\",\"mime\":\"image/jpeg\",\"size\":0}"))
        assertEquals(Message.Part("QUJD"), PhotoEditRules.message("photos:save:part:QUJD"))
        assertNull(PhotoEditRules.message("photos:save:part:QUJ"))
        assertNull(PhotoEditRules.message("photos:save:part:QU#D"))
        assertNull(PhotoEditRules.message("photos:save:part:"))
        assertEquals(Message.End, PhotoEditRules.message("photos:save:end"))
        assertEquals(Message.Cancel, PhotoEditRules.message("photos:save:cancel"))
    }

    @Test
    fun fileNamesStayInsideOneFolder() {
        assertEquals("IMG_1.jpg", PhotoEditRules.fileName("IMG_1.JPG", "image/jpeg"))
        assertEquals("x.png", PhotoEditRules.fileName("../../x.jpg", "image/png"))
        assertEquals("web2-photo.jpg", PhotoEditRules.fileName("...", "image/jpeg"))
        assertEquals("web2-photo.heic", PhotoEditRules.fileName(null, "image/heic"))
        assertEquals("ab.jpg", PhotoEditRules.fileName("a\u0000b?.jpg", "image/jpeg"))
        assertTrue(PhotoEditRules.fileName("x".repeat(400), "image/jpeg").length <= PhotoEditRules.NAME_MAX)
    }

    @Test
    fun matchesSamePhotoOnPhone() {
        val t = 1_700_000_000_000L
        val list = listOf(
            media(1, "IMG_1.jpg", 500, t - 60_000),
            media(2, "img_1.JPG", 900, t + 1500),
            media(3, "other.jpg", 2048, t + 500),
            media(4, "IMG_1.mp4", 2048, t, video = true),
        )
        // 이름 + 시각 2초 안
        assertEquals(2L, PhotoEditRules.pick(list, Target.Match("IMG_1.jpg", 0, t))?.id)
        // 크기 + 시각 2초 안(이름 달라도)
        assertEquals(3L, PhotoEditRules.pick(list, Target.Match("x.jpg", 2048, t))?.id)
        // 이름 + 크기
        assertEquals(1L, PhotoEditRules.pick(list, Target.Match("IMG_1.jpg", 500, 0))?.id)
        // 없음, 동영상은 편집하지 않음
        assertNull(PhotoEditRules.pick(list, Target.Match("none.jpg", 7, t)))
        assertNull(PhotoEditRules.pick(list, Target.Id(4)))
        assertEquals(3L, PhotoEditRules.pick(list, Target.Id(3))?.id)
    }

    @Test
    fun editIntentPlan() {
        val uri = "content://media/external/images/media/7"
        val samsung = PhotoEditRules.plan(uri, "image/jpeg", samsungCanEdit = true)!!
        assertEquals("android.intent.action.EDIT", samsung.action)
        assertEquals(PhotoEditRules.SAMSUNG_GALLERY, samsung.pkg)
        assertFalse(samsung.chooser)
        assertEquals(PhotoEditRules.GRANT_READ or PhotoEditRules.GRANT_WRITE, samsung.flags)
        assertEquals(0x3, samsung.flags)
        val other = PhotoEditRules.plan(uri, "", samsungCanEdit = false)!!
        assertNull(other.pkg)
        assertTrue(other.chooser)
        assertEquals("image/*", other.mime)
        // 쓰기 권한이 없는 사진은 읽기만 넘긴다.
        assertEquals(PhotoEditRules.GRANT_READ, PhotoEditRules.plan(uri, "image/jpeg", true, canWrite = false)!!.flags)
        // 파일 경로는 넘기지 않는다.
        assertNull(PhotoEditRules.plan("file:///storage/emulated/0/DCIM/a.jpg", "image/jpeg", true))
        assertNull(PhotoEditRules.plan("/storage/emulated/0/a.jpg", "image/jpeg", true))
    }

    @Test
    fun answersAndSizes() {
        assertTrue(PhotoEditRules.changed(-1, 5))
        assertTrue(PhotoEditRules.changed(4, 5))
        assertFalse(PhotoEditRules.changed(5, 5))
        assertEquals("photos:edited:{\"ok\":false,\"changed\":false,\"error\":\"none\"}", PhotoEditRules.editedMessage(false, error = "none"))
        assertEquals("photos:edited:{\"ok\":true,\"changed\":true,\"error\":\"\"}", PhotoEditRules.editedMessage(true, true))
        assertEquals("photos:save:{\"ok\":true,\"step\":\"end\",\"got\":10,\"id\":\"42\",\"error\":\"\"}", PhotoEditRules.saveMessage(true, "end", 10, 42))
        val s = PhotoEditRules.Saving(10)
        assertTrue(s.add(6))
        assertFalse(s.complete)
        assertFalse(s.add(5))
        assertTrue(s.add(4))
        assertTrue(s.complete)
    }
}
