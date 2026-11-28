package kr.or.kptu.work

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import org.w3c.dom.Element

/**
 * S68-11(11/22): 한 칸 위젯·빠른 쓰기 먹색 칸은 크기를 계산하지 않고, 그림 한 장(widget_tile_*)을 이름 줄 위 남는 공간 전체에
 * fitCenter로 그려 홈 화면이 실제로 준 공간에서 가장 큰 정사각이 되게 한다(S68-08 계산은 삼성 홈에서 최소 48dp로 잘렸다).
 */
class WidgetTileTest {
    private val android = "http://schemas.android.com/apk/res/android"
    private val actions = listOf("task", "note", "photo", "record")

    private fun xml(path: String): Element =
        DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }.newDocumentBuilder().parse(File(path)).documentElement

    private fun children(parent: Element, tag: String): List<Element> {
        val nodes = parent.childNodes
        return (0 until nodes.length).mapNotNull { nodes.item(it) as? Element }.filter { it.tagName == tag }
    }

    private fun attr(e: Element, name: String): String = e.getAttributeNS(android, name)

    /** 칸 하나(세로 LinearLayout): [남는 공간 전체 줄(14:72:14) 안 fitCenter 그림] + [이름]. 그림을 돌려준다. */
    private fun checkCell(where: String, cell: Element, tileId: String): Element {
        assertEquals(where, "vertical", attr(cell, "orientation"))
        val row = children(cell, "LinearLayout").single()
        assertEquals(where, "match_parent", attr(row, "layout_width"))
        assertEquals(where, "0dp", attr(row, "layout_height"))
        assertEquals(where, "1", attr(row, "layout_weight"))
        assertEquals(where, "horizontal", attr(row, "orientation"))
        val side = children(row, "TextView")
        assertEquals(where, 2, side.size)
        for (s in side) {
            assertEquals(where, "0dp", attr(s, "layout_width"))
            assertEquals(where, "${WidgetTileRules.SIDE_WEIGHT}", attr(s, "layout_weight"))
        }
        val tile = children(row, "ImageView").single()
        assertEquals(where, tileId, attr(tile, "id"))
        assertEquals(where, "0dp", attr(tile, "layout_width"))
        assertEquals(where, "${WidgetTileRules.TILE_WEIGHT}", attr(tile, "layout_weight"))
        assertEquals(where, "match_parent", attr(tile, "layout_height"))
        assertEquals(where, "fitCenter", attr(tile, "scaleType"))
        assertEquals(where, "true", attr(tile, "adjustViewBounds"))
        assertTrue(where, attr(tile, "src").startsWith("@drawable/widget_tile_"))
        // 고정 dp 칸·따로 얹는 그림·물들이기가 없다(그림 한 장이 칸).
        assertEquals(where, "", attr(tile, "tint"))
        assertEquals(where, "", attr(tile, "background"))
        assertTrue(where, children(cell, "FrameLayout").isEmpty())
        assertTrue(where, children(row, "FrameLayout").isEmpty())
        // 이름은 칸 아래(셋째가 아닌 둘째 자식, 무게 없음).
        val label = children(cell, "TextView").single()
        assertEquals(where, "", attr(label, "layout_weight"))
        assertEquals(where, 2 * WidgetTileRules.SIDE_WEIGHT + WidgetTileRules.TILE_WEIGHT, 100)
        return tile
    }

    @Test
    fun oneWidgetTileFillsTheSpaceAboveTheLabel() {
        val root = xml("src/main/res/layout/one_widget.xml")
        assertEquals("@+id/one_root", attr(root, "id"))
        assertEquals("match_parent", attr(root, "layout_width"))
        assertEquals("match_parent", attr(root, "layout_height"))
        // S68-19(11/22 명진 "똑같음 더 크게"): 한 칸 위젯은 좌우를 비우지 않는다 — 삼성 홈이 위젯 칸을 앱 아이콘 칸보다 좁게 주어
        // 72%만 쓰면 옆 앱 아이콘보다 작았다. 폭 전부·이름 위 높이 전부에서 fitCenter로 가장 큰 정사각.
        assertEquals("vertical", attr(root, "orientation"))
        assertTrue(children(root, "LinearLayout").isEmpty())
        val tile = children(root, "ImageView").single()
        assertEquals("@+id/one_tile", attr(tile, "id"))
        assertEquals("match_parent", attr(tile, "layout_width"))
        assertEquals("0dp", attr(tile, "layout_height"))
        assertEquals("1", attr(tile, "layout_weight"))
        assertEquals("fitCenter", attr(tile, "scaleType"))
        assertEquals("true", attr(tile, "adjustViewBounds"))
        assertTrue(attr(tile, "src").startsWith("@drawable/widget_tile_"))
        assertEquals("", attr(tile, "tint"))
        assertEquals("", attr(tile, "background"))
        assertEquals("0dp", attr(root, "paddingTop"))
        assertEquals("12sp", attr(children(root, "TextView").single(), "textSize"))
        // 옛 크기별 틀(11 이하용)은 없다.
        assertFalse(File("src/main/res/layout/one_widget_48.xml").exists())
        assertFalse(File("src/main/res/layout/one_widget_72.xml").exists())
        assertFalse(File("src/main/res/layout/one_widget.xml").readText().contains("@+id/one_icon"))
    }

    @Test
    fun quickWidgetTilesFillTheirCells() {
        for ((name, n) in listOf("quick_widget" to 3, "quick_widget_small" to 2)) {
            val cells = children(xml("src/main/res/layout/$name.xml"), "LinearLayout")
            assertEquals(name, n, cells.size)
            cells.forEachIndexed { i, cell ->
                val tile = checkCell("$name $i", cell, "@+id/quick_tile$i")
                assertEquals("$name $i", "@drawable/widget_tile_${actions[i]}", attr(tile, "src"))
            }
            assertFalse(name, File("src/main/res/layout/$name.xml").readText().contains("quick_icon"))
        }
        assertTrue(WidgetTileRules.quickWide(250))
        assertFalse(WidgetTileRules.quickWide(249))
        // 4칸으로 바뀌는 폭은 위젯 정보 최소 폭과 같다.
        assertEquals("${WidgetTileRules.QUICK_WIDE}dp", xml("src/main/res/xml/quick_widget_info.xml").getAttributeNS(android, "minWidth"))
    }

    @Test
    fun tileDrawablesAreOneSquarePicture() {
        // 기능마다 정사각 그림 한 장: 100 기준 둥근 먹색 칸(모서리 28) + 가운데 흰 그림(칸의 55%).
        val r = (WidgetTileRules.CORNER_RATIO * 100).toInt()
        val icon = WidgetTileRules.ICON_RATIO * 100
        for (a in actions) {
            val f = "src/main/res/drawable/widget_tile_$a.xml"
            val v = xml(f)
            assertEquals(f, "vector", v.tagName)
            assertEquals(f, attr(v, "width"), attr(v, "height"))
            assertEquals(f, "100", attr(v, "viewportWidth"))
            assertEquals(f, "100", attr(v, "viewportHeight"))
            val bg = children(v, "path").single()
            assertEquals(f, "@color/widget_one_bg", attr(bg, "fillColor"))
            assertTrue(f, attr(bg, "pathData").contains("A$r,$r"))
            val g = children(v, "group").single()
            val scale = attr(g, "scaleX").toDouble()
            assertEquals(f, attr(g, "scaleX"), attr(g, "scaleY"))
            assertEquals(f, icon, scale * 24, 0.01) // 24 기준 그림 → 칸의 55%
            assertEquals(f, (100 - icon) / 2, attr(g, "translateX").toDouble(), 0.01) // 가운데
            assertEquals(f, attr(g, "translateX"), attr(g, "translateY"))
            val text = File(f).readText()
            // 그림 색은 흰 그림 하나(낮·밤 같은 먹 칸 위).
            assertTrue(f, text.contains("@color/widget_one_icon"))
            assertFalse(f, text.contains("@color/widget_icon\""))
        }
        // 옛 따로 그림(칸 모양 + 24 기준 그림)은 없다.
        assertFalse(File("src/main/res/drawable/widget_one_tile.xml").exists())
        for (a in actions) assertFalse(a, File("src/main/res/drawable/ic_w_$a.xml").exists())
    }

    @Test
    fun noSizeMathLeft() {
        val code = File("src/main/java/kr/or/kptu/work/ActionWidgets.kt").readText()
        val hub = File("src/main/java/kr/or/kptu/work/HomeWidgets.kt").readText()
        // 칸 크기를 코드로 정하지 않는다(한 가지 방식만).
        for (s in listOf("setViewLayoutWidth", "setViewLayoutHeight", "tileSize", "WidgetTileRules.one(", "WidgetTileRules.quick(", "one_widget_48", "one_widget_72")) {
            assertFalse(s, code.contains(s))
            assertFalse(s, hub.contains(s))
        }
        // 한 칸 위젯은 크기별 그림이 없어 크기가 바뀌어도 다시 그릴 것이 없다. 빠른 쓰기는 4칸·2칸을 고르느라 크기별 그림을 둔다.
        assertEquals(1, Regex("override fun onAppWidgetOptionsChanged").findAll(code).count())
        assertEquals(1, Regex("HomeWidgets.perSize\\(HomeWidgets.cellSizes\\(manager, id\\)\\)").findAll(code).count())
        assertTrue(code.contains("views.setImageViewResource(R.id.one_tile, WidgetIntents.tile(action))"))
        for (a in listOf("TASK", "NOTE", "PHOTO", "RECORD")) {
            assertTrue(a, code.contains("WidgetAction.$a -> R.drawable.widget_tile_${a.lowercase()}"))
        }
    }
}
