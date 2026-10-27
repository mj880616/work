namespace BasketDrop.App;

/// <summary>User-facing Korean texts. Shown on screen only; none of this is written to the log.</summary>
internal static class Messages
{
    public static string Problem(DropProblem p) => p.Kind switch
    {
        ProblemKind.Folder => $"폴더는 보낼 수 없어요: {p.Name}",
        ProblemKind.Missing => $"파일을 찾을 수 없거나 읽을 수 없어요: {p.Name}",
        ProblemKind.Empty => $"빈 파일은 보낼 수 없어요: {p.Name}",
        ProblemKind.TooLarge => $"파일은 100MiB까지 보낼 수 있어요: {p.Name}",
        ProblemKind.NameTooLong => $"파일 이름이 너무 길어요(255자까지): {p.Name}",
        ProblemKind.TextTooLong => "글은 20,000자까지 보낼 수 있어요.",
        ProblemKind.QueueFull => $"대기열이 가득 찼어요(2GB). 먼저 보낸 뒤 다시 시도해 주세요: {p.Name}",
        _ => "보낼 글이나 파일이 없어요.",
    };

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
