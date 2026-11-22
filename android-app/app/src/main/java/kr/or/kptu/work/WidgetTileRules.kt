package kr.or.kptu.work

import kotlin.math.roundToInt

/**
 * S68-08(11/22): 위젯 먹색 칸 크기를 홈 화면이 실제로 준 칸 크기에서 계산한다(옛 48dp 고정은 옆 앱 아이콘보다 작았다).
 * 앱 아이콘이 칸 폭의 약 70%이므로 칸 = min(칸 폭 × 0.72, 칸 높이 − 이름 줄 − 칸과 이름 사이 − 위아래 여백), 최소·최대로 자른다.
 * 그림은 칸의 55%, 모서리는 칸의 28%(widget_one_tile이 100 기준 그림이라 칸 크기를 따라 커진다).
 * 안드로이드 서비스를 쓰지 않는 계산만 둔다(단위 시험으로 고정).
 */
object WidgetTileRules {
    const val WIDTH_RATIO = 0.72
    const val ICON_RATIO = 0.55
    const val CORNER_RATIO = 0.28

    /** 칸과 이름 사이(dp). */
    const val GAP = 7

    /** 위아래 여백 합(dp). */
    const val MARGIN = 4

    /** 글자 크기(sp) 한 줄이 차지하는 높이 비율. */
    const val LINE = 1.35

    /** 한 칸 위젯: 최소 48dp·최대 76dp, 이름 12sp. */
    const val ONE_MIN = 48
    const val ONE_MAX = 76
    const val ONE_LABEL_SP = 12f

    /** 안드로이드 11 이하(크기를 바로 정하지 못함)에서 고르는 한 칸 위젯 칸 크기. */
    val ONE_STEPS = listOf(48, 60, 72)

    /** 빠른 쓰기: 칸 4개(또는 2개)가 위젯 폭을 나눈다. 바깥 여백 4dp씩, 칸 사이 6dp. 이름 11sp, 최소 40dp·최대 76dp. */
    const val QUICK_PAD = 4
    const val QUICK_SPACE = 6
    const val QUICK_MIN = 40
    const val QUICK_MAX = 76
    const val QUICK_LABEL_SP = 11f

    /** 빠른 쓰기 4칸 그림을 쓰는 가장 좁은 폭(dp). 그보다 좁으면 2칸(quick_widget_info minWidth와 같은 값). */
    const val QUICK_WIDE = 250

    /** 이름 한 줄 높이(dp). 글자 크기 설정(fontScale)을 따른다. */
    fun labelDp(sp: Float, fontScale: Float): Int = (sp * fontScale.coerceIn(0.8f, 2f) * LINE).roundToInt()

    /** 칸 폭·높이(dp)에서 먹색 칸 크기(dp). 크기를 모르면(0 이하) 가장 작은 값. */
    fun tile(cellW: Int, cellH: Int, labelDp: Int, min: Int, max: Int): Int {
        if (cellW <= 0 || cellH <= 0) return min
        val byWidth = (cellW * WIDTH_RATIO).toInt()
        val byHeight = cellH - labelDp - GAP - MARGIN
        return minOf(byWidth, byHeight).coerceIn(min, max)
    }

    fun one(cellW: Int, cellH: Int, fontScale: Float): Int =
        tile(cellW, cellH, labelDp(ONE_LABEL_SP, fontScale), ONE_MIN, ONE_MAX)

    /** 빠른 쓰기: 위젯 폭·높이(dp)와 칸 수(4·2)에서 칸 하나의 먹색 칸 크기(dp). */
    fun quick(widgetW: Int, widgetH: Int, cells: Int, fontScale: Float): Int {
        if (widgetW <= 0 || widgetH <= 0 || cells <= 0) return QUICK_MIN
        val cellW = (widgetW - QUICK_PAD * 2 - QUICK_SPACE * (cells - 1)) / cells
        val cellH = widgetH - QUICK_PAD * 2
        return tile(cellW, cellH, labelDp(QUICK_LABEL_SP, fontScale), QUICK_MIN, QUICK_MAX)
    }

    /** 빠른 쓰기에서 이 폭이 4칸인지(아니면 2칸). 안드로이드 12+ 크기별 그림과 같은 기준. */
    fun quickWide(widgetW: Int): Boolean = widgetW >= QUICK_WIDE

    fun icon(tile: Int): Int = (tile * ICON_RATIO).roundToInt()

    fun corner(tile: Int): Int = (tile * CORNER_RATIO).roundToInt()

    /** 안드로이드 11 이하: 계산한 크기에 가장 가까운 칸(같으면 작은 쪽). */
    fun step(tile: Int): Int = ONE_STEPS.minWith(compareBy<Int>({ kotlin.math.abs(it - tile) }, { it }))
}
