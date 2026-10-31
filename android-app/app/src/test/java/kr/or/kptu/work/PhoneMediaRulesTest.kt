package kr.or.kptu.work

import kr.or.kptu.work.PhoneMediaRules.Access
import kr.or.kptu.work.PhoneMediaRules.Media
import kr.or.kptu.work.PhoneMediaRules.Request
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PhoneMediaRulesTest {
    private val key = "abcdefghijklmnopqrstuvwxyzABCDEF"
    private val base = "https://bokdoong.com/work/app/__phone/$key/"

    private fun media(id: Long, taken: Long, name: String = "IMG_$id.jpg", video: Boolean = false, shot: Boolean = false, size: Long = id * 10, added: Long = taken) =
        Media(id, name, size, taken, false, added, if (video) "video/mp4" else "image/jpeg", 100, 80, if (video) 5000 else 0, video, shot)

    @Test
    fun onlyPhoneAddressesAreTaken() {
        assertNull(PhoneMediaRules.request("https://bokdoong.com/work/app/index.html", "GET", key))
        assertNull(PhoneMediaRules.request("https://bokdoong.com/work/app/__rec/x", "GET", key))
        assertEquals(Request.Page("taken_desc", "all", 0, 120, null), PhoneMediaRules.request(base + "page", "GET", key))
        assertEquals(Request.Thumb(12, true), PhoneMediaRules.request(base + "thumb/12?s=large", "GET", key))
        assertEquals(Request.Original(7), PhoneMediaRules.request(base + "media/7", "GET", key))
        assertEquals(Request.Ids(listOf(3L, 1L)), PhoneMediaRules.request(base + "ids?ids=3,1,3", "GET", key))
        assertEquals(Request.Days("2026-10", "video", setOf(4L)), PhoneMediaRules.request(base + "days?month=2026-10&filter=video&prefer=4", "GET", key))
        assertEquals(Request.Page("name_asc", "shot", 120, 60, 1700000000000), PhoneMediaRules.request(base + "page?sort=name_asc&filter=shot&offset=120&limit=60&before=1700000000000", "GET", key))
    }

    @Test
    fun wrongKeyHostMethodOrValuesAreRefused() {
        val other = "ZZZZefghijklmnopqrstuvwxyzABCDEF"
        assertEquals(Request.WrongKey, PhoneMediaRules.request("https://bokdoong.com/work/app/__phone/$other/page", "GET", key))
        assertEquals(Request.Bad, PhoneMediaRules.request("https://evil.example/work/app/__phone/$key/page", "GET", key))
        assertEquals(Request.Bad, PhoneMediaRules.request("http://bokdoong.com/work/app/__phone/$key/page", "GET", key))
        assertEquals(Request.Bad, PhoneMediaRules.request("https://bokdoong.com:8443/work/app/__phone/$key/page", "GET", key))
        assertEquals(Request.Bad, PhoneMediaRules.request(base + "page", "POST", key))
        assertEquals(Request.Bad, PhoneMediaRules.request(base + "page?sort=evil", "GET", key))
        assertEquals(Request.Bad, PhoneMediaRules.request(base + "page?limit=999", "GET", key))
        assertEquals(Request.Bad, PhoneMediaRules.request(base + "page?filter=star", "GET", key))
        assertEquals(Request.Bad, PhoneMediaRules.request(base + "page?x=1", "GET", key))
        assertEquals(Request.Bad, PhoneMediaRules.request(base + "page?limit=1&limit=2", "GET", key))
        assertEquals(Request.Bad, PhoneMediaRules.request(base + "thumb/1?s=huge", "GET", key))
        assertEquals(Request.Bad, PhoneMediaRules.request(base + "ids?ids=1,a", "GET", key))
        assertEquals(Request.Bad, PhoneMediaRules.request(base + "ids", "GET", key))
        assertEquals(Request.Bad, PhoneMediaRules.request(base + "days?month=2026-13", "GET", key))
        assertEquals(Request.Bad, PhoneMediaRules.request(base + "../etc", "GET", key))
        // 열쇠가 아직 없으면(빈 값) 무엇도 주지 않는다.
        assertEquals(Request.WrongKey, PhoneMediaRules.request(base + "page", "GET", ""))
    }

    @Test
    fun permissionsAndAccessByAndroidVersion() {
        assertEquals(listOf(PhoneMediaRules.READ_IMAGES, PhoneMediaRules.READ_VIDEO, PhoneMediaRules.READ_SELECTED), PhoneMediaRules.permissionsToAsk(34))
        assertEquals(listOf(PhoneMediaRules.READ_IMAGES, PhoneMediaRules.READ_VIDEO), PhoneMediaRules.permissionsToAsk(33))
        assertEquals(listOf(PhoneMediaRules.READ_STORAGE), PhoneMediaRules.permissionsToAsk(29))
        assertEquals(Access.FULL, PhoneMediaRules.access(34, setOf(PhoneMediaRules.READ_IMAGES, PhoneMediaRules.READ_VIDEO, PhoneMediaRules.READ_SELECTED)))
        assertEquals(Access.PARTIAL, PhoneMediaRules.access(34, setOf(PhoneMediaRules.READ_SELECTED)))
        assertEquals(Access.NONE, PhoneMediaRules.access(34, emptySet()))
        assertEquals(Access.FULL, PhoneMediaRules.access(33, setOf(PhoneMediaRules.READ_IMAGES)))
        assertEquals(Access.FULL, PhoneMediaRules.access(30, setOf(PhoneMediaRules.READ_STORAGE)))
        assertEquals(Access.NONE, PhoneMediaRules.access(33, setOf(PhoneMediaRules.READ_STORAGE)))
    }

    @Test
    fun stateMessageGivesKeyOnlyWithAccess() {
        assertEquals("photos:state:{\"access\":\"none\",\"trash\":true}", PhoneMediaRules.stateMessage(Access.NONE, key, 34))
        assertEquals("photos:state:{\"access\":\"partial\",\"key\":\"$key\",\"trash\":false}", PhoneMediaRules.stateMessage(Access.PARTIAL, key, 29))
    }

    @Test
    fun bridgeMessages() {
        assertEquals(PhoneMediaRules.Message.Hello, PhoneMediaRules.message("photos:hello"))
        assertEquals(PhoneMediaRules.Message.Ask, PhoneMediaRules.message("photos:ask"))
        assertEquals(PhoneMediaRules.Message.Trash(listOf(5L, 6L)), PhoneMediaRules.message("photos:trash:5,6"))
        assertNull(PhoneMediaRules.message("photos:trash:"))
        assertNull(PhoneMediaRules.message("photos:trash:5;rm"))
        assertNull(PhoneMediaRules.message("photos:other"))
        assertEquals("photos:trashed:{\"ok\":true,\"count\":2}", PhoneMediaRules.trashedMessage(true, 2))
    }

    @Test
    fun takenTimeFallsBackAndIsMarkedApprox() {
        assertEquals(1000L to false, PhoneMediaRules.taken(1000, 5, 6))
        assertEquals(5000L to true, PhoneMediaRules.taken(0, 5, 6))
        assertEquals(6000L to true, PhoneMediaRules.taken(null, null, 6))
        assertTrue(PhoneMediaRules.isScreenshot("Pictures/Screenshots/", "a.png"))
        assertTrue(PhoneMediaRules.isScreenshot("DCIM/스크린샷/", "a.png"))
        assertFalse(PhoneMediaRules.isScreenshot("DCIM/Camera/", "IMG_1.jpg"))
    }

    @Test
    fun pagesFollowSortFilterAndJump() {
        val list = listOf(media(1, 1000), media(2, 3000), media(3, 2000, video = true), media(4, 4000, shot = true))
        val first = PhoneMediaRules.page(list, Request.Page("taken_desc", "all", 0, 2, null))
        assertEquals(listOf(4L, 2L), first.items.map { it.id })
        assertEquals(2, first.next)
        val second = PhoneMediaRules.page(list, Request.Page("taken_desc", "all", 2, 2, null))
        assertEquals(listOf(3L, 1L), second.items.map { it.id })
        assertNull(second.next)
        assertEquals(listOf(3L), PhoneMediaRules.page(list, Request.Page("taken_desc", "video", 0, 10, null)).items.map { it.id })
        assertEquals(listOf(4L), PhoneMediaRules.page(list, Request.Page("taken_desc", "shot", 0, 10, null)).items.map { it.id })
        assertEquals(listOf(1L, 3L, 2L, 4L), PhoneMediaRules.page(list, Request.Page("taken_asc", "all", 0, 10, null)).items.map { it.id })
        assertEquals(listOf(4L, 3L, 2L, 1L), PhoneMediaRules.page(list, Request.Page("size_desc", "all", 0, 10, null)).items.map { it.id })
        // 날로 건너뛰기: before보다 앞에 찍은 것부터, next는 그 자리부터 센다.
        val jump = PhoneMediaRules.page(list, Request.Page("taken_desc", "all", 0, 1, 3000))
        assertEquals(listOf(3L), jump.items.map { it.id })
        assertEquals(1, jump.next)
        assertEquals(listOf(1L), PhoneMediaRules.page(list, Request.Page("taken_desc", "all", 1, 1, 3000)).items.map { it.id })
    }

    @Test
    fun jsonShapesMatchTheWebSide() {
        val ms = java.time.Instant.parse("2026-10-30T15:30:00Z").toEpochMilli() // 서울 10/31 00:30
        val m = media(9, ms, name = "a\"<b>.jpg")
        val json = PhoneMediaRules.itemJson(m)
        assertTrue(json.contains("\"id\":\"9\""))
        assertTrue(json.contains("\"taken_at\":\"2026-10-30T15:30:00.000Z\""))
        assertTrue(json.contains("\"day\":\"2026-10-31\""))
        assertTrue(json.contains("\\u003cb>"))
        assertTrue(json.contains("\"kind\":\"photo\""))
        assertEquals("{\"months\":{\"2026-10\":1}}", PhoneMediaRules.monthsJson(listOf(media(1, java.time.Instant.parse("2026-10-02T00:00:00Z").toEpochMilli()))))
        val d1 = java.time.Instant.parse("2026-10-02T01:00:00Z").toEpochMilli()
        val days = PhoneMediaRules.daysJson(listOf(media(1, d1), media(2, d1 + 1000), media(3, d1 + 2000, video = true)), "2026-10", setOf(1L))
        assertTrue(days.startsWith("{\"days\":{\"2026-10-02\":{\"count\":3,\"cover\":{\"id\":\"1\""))
        assertTrue(PhoneMediaRules.idsJson(listOf(media(1, 1), media(2, 2)), listOf(2L, 7L)).contains("\"id\":\"2\""))
    }

    // PHOTO-폰사진못읽음: 실패를 빈 404로 뭉개지 않고 종류를 돌려준다(사진 이름·경로·예외 글은 넣지 않음).
    @Test
    fun failuresCarryKindAndClassNameOnly() {
        assertEquals("{\"error\":\"query\",\"detail\":\"IllegalStateException\"}", PhoneMediaRules.failJson(PhoneMediaRules.Fail.QUERY, "IllegalStateException"))
        assertEquals("{\"error\":\"key\",\"detail\":\"\"}", PhoneMediaRules.failJson(PhoneMediaRules.Fail.KEY))
        // 클래스 이름 자리에 경로·따옴표가 와도 글자·숫자·_·$·.만 남는다.
        assertEquals("storageemulated0DCIMa.jpg", PhoneMediaRules.safeDetail("/storage/emulated/0/DCIM/\"a.jpg"))
        assertEquals(60, PhoneMediaRules.safeDetail("x".repeat(100)).length)
        assertEquals(403, PhoneMediaRules.Fail.PERMISSION.status)
        assertEquals(403, PhoneMediaRules.Fail.KEY.status)
        assertEquals(400, PhoneMediaRules.Fail.BAD_REQUEST.status)
        assertEquals(500, PhoneMediaRules.Fail.QUERY.status)
        assertEquals("Forbidden", PhoneMediaRules.reasonPhrase(403))
        assertEquals("Internal Server Error", PhoneMediaRules.reasonPhrase(500))
    }

    @Test
    fun exceptionsAreSortedByStage() {
        val list = PhoneMediaRules.Stage.LIST
        assertEquals(PhoneMediaRules.Fail.PERMISSION, PhoneMediaRules.classify(SecurityException("no"), list))
        assertEquals(PhoneMediaRules.Fail.COLUMN, PhoneMediaRules.classify(IllegalArgumentException("Invalid column date_taken"), list))
        assertEquals(PhoneMediaRules.Fail.QUERY, PhoneMediaRules.classify(IllegalArgumentException("Unknown URL"), list))
        assertEquals(PhoneMediaRules.Fail.QUERY, PhoneMediaRules.classify(IllegalStateException("cursor"), list))
        assertEquals(PhoneMediaRules.Fail.PERMISSION, PhoneMediaRules.classify(SecurityException("no"), PhoneMediaRules.Stage.THUMB))
        assertEquals(PhoneMediaRules.Fail.NOT_FOUND, PhoneMediaRules.classify(java.io.FileNotFoundException("x"), PhoneMediaRules.Stage.THUMB))
        assertEquals(PhoneMediaRules.Fail.DECODE, PhoneMediaRules.classify(java.io.IOException("x"), PhoneMediaRules.Stage.THUMB))
        assertEquals(PhoneMediaRules.Stage.THUMB, PhoneMediaRules.stageOf(Request.Thumb(1, false)))
        assertEquals(PhoneMediaRules.Stage.ORIGINAL, PhoneMediaRules.stageOf(Request.Original(1)))
        assertEquals(PhoneMediaRules.Stage.LIST, PhoneMediaRules.stageOf(Request.Months("all")))
        assertEquals("SecurityException", PhoneMediaRules.detailOf(SecurityException("/storage/x.jpg")))
    }

    @Test
    fun imagesAndVideosAreReadSeparatelyAndCombined() {
        val a = media(1, 100)
        val b = media(2, 200, video = true)
        assertNull(PhoneMediaRules.combine(null, null))
        assertEquals(listOf(a), PhoneMediaRules.combine(listOf(a), null))
        assertEquals(listOf(b), PhoneMediaRules.combine(null, listOf(b)))
        assertEquals(listOf(a, b), PhoneMediaRules.combine(listOf(a), listOf(b, a)))
        assertEquals(emptyList<Media>(), PhoneMediaRules.combine(emptyList(), null))
        // 합친 뒤 정렬은 쪽 규칙 그대로(찍은 날 최근 먼저).
        val page = PhoneMediaRules.page(PhoneMediaRules.combine(listOf(a), listOf(b))!!, Request.Page("taken_desc", "all", 0, 10, null))
        assertEquals(listOf(2L, 1L), page.items.map { it.id })
    }

    // PHOTO-출처모든칩: 폰 폴더 보기(사진첩 relative_path 기준, 보기 전용).
    @Test
    fun phoneFoldersAndFolderPages() {
        assertEquals(Request.Folders, PhoneMediaRules.request(base + "folders", "GET", key))
        assertEquals(Request.Bad, PhoneMediaRules.request(base + "folders?x=1", "GET", key))
        assertEquals(Request.Page("taken_desc", "all", 0, 120, null, "DCIM/Camera/"), PhoneMediaRules.request(base + "page?folder=DCIM%2FCamera%2F", "GET", key))
        assertEquals(Request.Page("taken_desc", "all", 0, 120, null, ""), PhoneMediaRules.request(base + "page?folder=", "GET", key))
        assertEquals(Request.Bad, PhoneMediaRules.request(base + "page?folder=a%0Ab", "GET", key))
        assertEquals(Request.Bad, PhoneMediaRules.request(base + "page?folder=" + "a".repeat(256), "GET", key))
        assertEquals("Camera", PhoneMediaRules.folderName("DCIM/Camera/"))
        assertEquals("Screenshots", PhoneMediaRules.folderName("Pictures/Screenshots/"))
        assertEquals("폰", PhoneMediaRules.folderName(""))

        val cam1 = media(1, 100).copy(folder = "DCIM/Camera/")
        val cam2 = media(2, 300, video = true).copy(folder = "DCIM/Camera/")
        val shot = media(3, 200, shot = true).copy(folder = "Pictures/Screenshots/")
        val list = listOf(cam1, cam2, shot)
        val folders = PhoneMediaRules.folders(list)
        assertEquals(listOf("DCIM/Camera/", "Pictures/Screenshots/"), folders.map { it.path })
        assertEquals(2, folders[0].count)
        assertEquals(1L, folders[0].cover.id) // 사진 먼저(동영상보다)
        val json = PhoneMediaRules.foldersJson(list)
        assertTrue(json.startsWith("{\"folders\":[{\"id\":\"DCIM/Camera/\",\"name\":\"Camera\",\"count\":2,\"cover\":{\"id\":\"1\""))
        val page = PhoneMediaRules.page(list, Request.Page("taken_desc", "all", 0, 10, null, "DCIM/Camera/"))
        assertEquals(listOf(2L, 1L), page.items.map { it.id })
        assertEquals(2, page.total)
        assertEquals(3, PhoneMediaRules.page(list, Request.Page("taken_desc", "all", 0, 10, null)).total)
    }
}
