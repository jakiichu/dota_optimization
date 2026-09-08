namespace Frameloss.Sidecar.Network;

/// <summary>
/// Один замер задержки до узла.
/// </summary>
/// <remarks>
/// `RoundTripMs` равен null, когда ответа не было: потерянный пакет — это не
/// нулевая задержка, и подменять одно другим нельзя.
/// </remarks>
public sealed record NetworkProbeReading
{
    public required string Target { get; init; }

    /// <summary>Человеческое имя узла: «шлюз», «интернет».</summary>
    public required string Label { get; init; }

    public double? RoundTripMs { get; init; }

    /// <summary>Ответ получен. False — потеря или таймаут.</summary>
    public required bool Success { get; init; }

    /// <summary>Что именно вернул стек, если ответа не было.</summary>
    public string? Status { get; init; }
}
