package kr.or.kptu.work

/**
 * 위젯 먹색 칸 규칙(단위 시험으로 고정).
 * S68-11(11/22): 칸 크기는 계산하지 않는다. 칸은 그림 한 장(widget_tile_*, 100 기준: 모서리 28·그림 55)이고,
 * 화면 틀이 이름 줄 위 남는 공간 전체에 fitCenter로 그려 홈 화면이 실제로 준 공간에서 가장 큰 정사각이 된다.
 * 좌우는 무게 14 : 72 : 14로 비워 앱 아이콘처럼 칸 폭의 72% 안쪽.
 * (S68-08의 크기 계산은 삼성 홈이 1×1 칸 크기를 작게 알려 줘 최소 48dp로 잘렸다 → 지움.)
 */
object WidgetTileRules {
    const val SIDE_WEIGHT = 14
    const val TILE_WEIGHT = 72
    const val ICON_RATIO = 0.55
    const val CORNER_RATIO = 0.28

    /** 빠른 쓰기 4칸 그림을 쓰는 가장 좁은 폭(dp). 그보다 좁으면 2칸(quick_widget_info minWidth와 같은 값). */
    const val QUICK_WIDE = 250

    /** 빠른 쓰기에서 이 폭이 4칸인지(아니면 2칸). 안드로이드 12+ 크기별 그림과 같은 기준. */
    fun quickWide(widgetW: Int): Boolean = widgetW >= QUICK_WIDE
}
