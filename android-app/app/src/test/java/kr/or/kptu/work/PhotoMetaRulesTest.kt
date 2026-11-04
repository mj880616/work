package kr.or.kptu.work

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.TimeZone

class PhotoMetaRulesTest {
    private val seoul = TimeZone.getTimeZone("Asia/Seoul")

    @Test
    fun readMessageTakesUpToTwoHundredNumbers() {
        val m = PhotoMetaRules.message("photos:meta:read:[\"12\",\"34\",\"12\"]")
        assertEquals(PhotoMetaRules.Message.Read(listOf(12L, 34L)), m)
        assertEquals(PhotoMetaRules.Message.Bad, PhotoMetaRules.message("photos:meta:read:[]"))
        assertEquals(PhotoMetaRules.Message.Bad, PhotoMetaRules.message("photos:meta:read:[\"a\"]"))
        val many = (1..201).joinToString(",", "[", "]") { "\"$it\"" }
        assertEquals(PhotoMetaRules.Message.Bad, PhotoMetaRules.message("photos:meta:read:$many"))
        assertNull(PhotoMetaRules.message("photos:hello"))
    }

    @Test
    fun writeMessageKeepsTimeLocationAndClear() {
        val m = PhotoMetaRules.message(
            "photos:meta:write:{\"items\":[{\"id\":\"1\",\"taken\":1762128000000},{\"id\":\"2\",\"loc\":{\"lat\":37.5,\"lon\":127.0}},{\"id\":\"3\",\"loc\":null}]}",
        ) as PhotoMetaRules.Message.Write
        assertEquals(3, m.changes.size)
        assertEquals(1762128000000L, m.changes[0].taken)
        assertFalse(m.changes[0].touchesLoc)
        assertEquals(PhotoMetaRules.Loc(37.5, 127.0), m.changes[1].loc)
        assertNull(m.changes[1].taken)
        assertTrue(m.changes[2].clearLoc)
        assertTrue(m.changes[2].touchesLoc)
    }

    @Test
    fun writeMessageRefusesBadValues() {
        fun bad(body: String) = assertEquals(PhotoMetaRules.Message.Bad, PhotoMetaRules.message("photos:meta:write:$body"))
        bad("{\"items\":[]}")
        bad("{\"items\":[{\"id\":\"1\"}]}") // 고칠 것 없음
        bad("{\"items\":[{\"id\":\"1\",\"taken\":1},{\"id\":\"2\",\"taken\":1762128000000}]}") // 1970-01-01
        bad("{\"items\":[{\"id\":\"1\",\"taken\":1762128000000.5}]}")
        bad("{\"items\":[{\"id\":\"1\",\"loc\":{\"lat\":91,\"lon\":0}}]}")
        bad("{\"items\":[{\"id\":\"1\",\"loc\":{\"lat\":0,\"lon\":0}}]}")
        bad("{\"items\":[{\"id\":\"1\",\"taken\":1762128000000},{\"id\":\"1\",\"taken\":1762128000000}]}") // 같은 사진 두 번
        bad("not json")
    }

    @Test
    fun exifDateUsesWallClockAndOffset() {
        // 2025-11-03 00:00:00 UTC = 서울 09:00.
        assertEquals("2025:11:03 09:00:00", PhotoMetaRules.exifDate(1762128000000L, seoul))
        assertEquals("+09:00", PhotoMetaRules.exifOffset(1762128000000L, seoul))
        assertEquals("-03:30", PhotoMetaRules.exifOffset(1762128000000L, TimeZone.getTimeZone("GMT-03:30")))
        // 8시간 밀기 = 같은 날 01:00.
        assertEquals("2025:11:03 01:00:00", PhotoMetaRules.exifDate(1762128000000L - 8 * 3_600_000L, seoul))
    }

    @Test
    fun onlyJpegPngWebpAreWritable() {
        assertTrue(PhotoMetaRules.canWrite("image/jpeg", false))
        assertTrue(PhotoMetaRules.canWrite("IMAGE/PNG", false))
        assertTrue(PhotoMetaRules.canWrite("image/webp", false))
        assertFalse(PhotoMetaRules.canWrite("image/heic", false))
        assertFalse(PhotoMetaRules.canWrite("video/mp4", true))
        assertFalse(PhotoMetaRules.canWrite("image/jpeg", true))
    }

    @Test
    fun messagesCarryNoNamesAndCleanText() {
        val text = PhotoMetaRules.metaMessage(
            true,
            listOf(
                PhotoMetaRules.Info(5, 1762128000000L, 37.123456789, 127.0, "SONY", "ILCE-7M4\n", "FE 24-70mm", true),
                PhotoMetaRules.Info(6, 1762128000000L, 0.0, 0.0, "", "", "", false),
            ),
        )
        assertEquals(
            "photos:meta:{\"ok\":true,\"items\":[{\"id\":\"5\",\"taken\":1762128000000,\"lat\":37.123457,\"lon\":127.000000,\"make\":\"SONY\",\"model\":\"ILCE-7M4\",\"lens\":\"FE 24-70mm\",\"can\":true}," +
                "{\"id\":\"6\",\"taken\":1762128000000,\"lat\":null,\"lon\":null,\"make\":\"\",\"model\":\"\",\"lens\":\"\",\"can\":false}],\"error\":\"\"}",
            text,
        )
        assertEquals("photos:metadone:{\"ok\":true,\"count\":2,\"failed\":[\"9\"],\"error\":\"\"}", PhotoMetaRules.doneMessage(true, 2, listOf(9L)))
        assertEquals("photos:metadone:{\"ok\":false,\"count\":0,\"failed\":[],\"error\":\"refused\"}", PhotoMetaRules.doneMessage(false, 0, error = "refused!"))
    }
}
