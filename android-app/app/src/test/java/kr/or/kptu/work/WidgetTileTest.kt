package kr.or.kptu.work

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import org.w3c.dom.Element

/**
 * S68-08(11/22): 한 칸 위젯·빠른 쓰기 먹색 칸 크기를 홈 화면이 준 칸 크기에서 계산(옛 48dp·40dp 고정은 옆 앱 아이콘보다 작았다).
 */
class WidgetTileTest {
    private val android = "http://schemas.android.com/apk/res/android"

    private fun xml(path: String): Element =
        DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }.newDocumentBuilder().parse(File(path)).documentElement

    private fun tileOf(path: String): Element {
        val list = xml(path).getElementsByTagName("FrameLayout")
        return list.item(0) as Element
    }

    @Test
    fun oneTileFromCellSize() {
        // 이름 12sp 한 줄 = 16dp, 칸과 이름 사이 7dp, 위아래 4dp → 칸 높이에서 27dp를 뺀다.
        assertEquals(16, WidgetTileRules.labelDp(12f, 1f))
        val cases = listOf(
            Triple(0, 0, 48), // 크기 모름 → 최소
            Triple(40, 40, 48), // 아주 작은 칸 → 최소 48dp
            Triple(70, 90, 50), // 폭 기준 70×0.72
            Triple(80, 100, 57),
            Triple(103, 110, 74), // 갤럭시 폴드 펼침 칸(앱 아이콘 약 72dp)
            Triple(120, 130, 76), // 큰 칸 → 최대 76dp
            Triple(120, 70, 48), // 넓고 낮은 칸 → 높이 기준이 최소보다 작아 48dp
        )
        for ((w, h, want) in cases) assertEquals("$w×$h", want, WidgetTileRules.one(w, h, 1f))
        // 글자 크기를 키우면 이름 줄이 커져 높이 기준이 줄어든다.
        assertEquals(21, WidgetTileRules.labelDp(12f, 1.3f))
        assertEquals(68, WidgetTileRules.one(110, 100, 1.3f))
        assertEquals(73, WidgetTileRules.one(110, 100, 1f))
    }

    @Test
    fun oneTileBoundsAreKept() {
        for (w in 0..300 step 7) for (h in 0..300 step 7) {
            val t = WidgetTileRules.one(w, h, 1f)
            assertTrue("$w×$h=$t", t in WidgetTileRules.ONE_MIN..WidgetTileRules.ONE_MAX)
        }
        assertEquals(48, WidgetTileRules.ONE_MIN)
        assertEquals(76, WidgetTileRules.ONE_MAX)
    }

    @Test
    fun quickTileFromWidgetSize() {
        assertEquals(15, WidgetTileRules.labelDp(11f, 1f))
        assertEquals(40, WidgetTileRules.quick(250, 40, 4, 1f)) // 가장 낮은 높이 → 최소 40dp(옛 크기)
        assertEquals(66, WidgetTileRules.quick(400, 100, 4, 1f))
        assertEquals(66, WidgetTileRules.quick(400, 120, 4, 1f)) // 폭 기준
        assertEquals(59, WidgetTileRules.quick(180, 100, 2, 1f)) // 2칸
        assertEquals(76, WidgetTileRules.quick(800, 200, 4, 1f)) // 최대
        assertEquals(40, WidgetTileRules.quick(0, 0, 4, 1f))
        assertTrue(WidgetTileRules.quickWide(250))
        assertFalse(WidgetTileRules.quickWide(249))
        // 4칸으로 바뀌는 폭은 위젯 정보 최소 폭과 같다.
        assertEquals("${WidgetTileRules.QUICK_WIDE}dp", xml("src/main/res/xml/quick_widget_info.xml").getAttributeNS(android, "minWidth"))
    }

    @Test
    fun iconCornerAndStep() {
        assertEquals(26, WidgetTileRules.icon(48))
        assertEquals(33, WidgetTileRules.icon(60))
        assertEquals(40, WidgetTileRules.icon(72))
        assertEquals(42, WidgetTileRules.icon(76))
        assertEquals(13, WidgetTileRules.corner(48))
        assertEquals(21, WidgetTileRules.corner(76))
        assertEquals(48, WidgetTileRules.step(50))
        assertEquals(48, WidgetTileRules.step(54))
        assertEquals(60, WidgetTileRules.step(55))
        assertEquals(60, WidgetTileRules.step(66))
        assertEquals(72, WidgetTileRules.step(67))
        assertEquals(72, WidgetTileRules.step(76))
    }

    @Test
    fun layoutsMatchTheRules() {
        // 기본 틀에는 옛 고정값 48dp가 남지 않는다(12+는 코드가 크기를 정하고, 11 이하 작은 칸만 one_widget_48).
        val base = tileOf("src/main/res/layout/one_widget.xml")
        assertFalse(File("src/main/res/layout/one_widget.xml").readText().contains("\"48dp\""))
        assertEquals("60dp", base.getAttributeNS(android, "layout_width"))
        for ((name, size) in listOf("one_widget_48" to 48, "one_widget" to 60, "one_widget_72" to 72)) {
            assertTrue(size in WidgetTileRules.ONE_STEPS)
            val tile = tileOf("src/main/res/layout/$name.xml")
            assertEquals(name, "${size}dp", tile.getAttributeNS(android, "layout_width"))
            assertEquals(name, "${size}dp", tile.getAttributeNS(android, "layout_height"))
            assertEquals(name, "@+id/one_tile", tile.getAttributeNS(android, "id"))
            val icon = tile.getElementsByTagName("ImageView").item(0) as Element
            assertEquals(name, "${WidgetTileRules.icon(size)}dp", icon.getAttributeNS(android, "layout_width"))
            val label = xml("src/main/res/layout/$name.xml").getElementsByTagName("TextView").item(0) as Element
            assertEquals(name, "${WidgetTileRules.GAP}dp", label.getAttributeNS(android, "paddingTop"))
            assertEquals(name, "12sp", label.getAttributeNS(android, "textSize"))
        }
        // 빠른 쓰기 칸·그림은 코드가 크기를 정하도록 번호가 있다.
        for ((name, n) in listOf("quick_widget" to 4, "quick_widget_small" to 2)) {
            val text = File("src/main/res/layout/$name.xml").readText()
            for (i in 0 until n) {
                assertTrue("$name tile$i", text.contains("@+id/quick_tile$i\""))
                assertTrue("$name icon$i", text.contains("@+id/quick_icon$i\""))
            }
        }
    }

    @Test
    fun tileShapeScalesWithSize() {
        // 칸 모양은 100 기준 그림이라 모서리가 늘 칸의 28%(고정 dp 모서리 없음).
        val shape = xml("src/main/res/drawable/widget_one_tile.xml")
        assertEquals("vector", shape.tagName)
        assertEquals("100", shape.getAttributeNS(android, "viewportWidth"))
        assertEquals("100", shape.getAttributeNS(android, "viewportHeight"))
        val path = shape.getElementsByTagName("path").item(0) as Element
        assertEquals("@color/widget_one_bg", path.getAttributeNS(android, "fillColor"))
        val r = (WidgetTileRules.CORNER_RATIO * 100).toInt()
        assertTrue(path.getAttributeNS(android, "pathData").contains("A$r,$r"))
        assertFalse(File("src/main/res/drawable/widget_one_tile.xml").readText().contains("corners"))
    }

    @Test
    fun widgetsUseRealCellSize() {
        val code = File("src/main/java/kr/or/kptu/work/ActionWidgets.kt").readText()
        // 한 칸·빠른 쓰기 모두 크기가 바뀌면 다시 그린다.
        assertEquals(2, Regex("override fun onAppWidgetOptionsChanged").findAll(code).count())
        assertTrue(code.contains("WidgetTileRules.one("))
        assertTrue(code.contains("WidgetTileRules.quick("))
        assertEquals(2, Regex("HomeWidgets.perSize\\(HomeWidgets.cellSizes\\(manager, id\\)\\)").findAll(code).count())
        val hub = File("src/main/java/kr/or/kptu/work/NowWidget.kt").readText()
        for (s in listOf("OPTION_APPWIDGET_SIZES", "OPTION_APPWIDGET_MIN_WIDTH", "OPTION_APPWIDGET_MAX_WIDTH", "OPTION_APPWIDGET_MIN_HEIGHT", "OPTION_APPWIDGET_MAX_HEIGHT", "setViewLayoutWidth", "setViewLayoutHeight")) {
            assertTrue(s, hub.contains(s))
        }
    }
}
