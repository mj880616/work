namespace BasketDrop.App;

/// <summary>User-facing Korean texts. Shown on screen only; none of this is written to the log.</summary>
internal static class Messages
{
    public static string State(QueueItem item) => item.State switch
    {
        ItemState.Pending => "대기 중",
        ItemState.Sending => "보내는 중",
        ItemState.NotReached => "오프라인 대기 중 (자동으로 다시 시도)",
        ItemState.LoginRequired => "로그인이 필요해요",
        ItemState.Unknown => "저장됐는지 확인이 필요해요",
        _ => $"보내지 못했어요 ({item.ErrorCode})",
    };

    public static string Describe(QueueItem item)
    {
        var parts = new List<string>();
        if (item.Files.Count > 0) parts.Add($"파일 {item.Files.Count}개");
        if (item.RawText.Length > 0) parts.Add("글");
        return string.Join(" + ", parts);
    }
}
