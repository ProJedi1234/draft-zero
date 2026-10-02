import Foundation

/// One bar of the per-passage chart: a run of consecutive passages and what
/// they cost together.
nonisolated struct PassageSpendBar: Identifiable, Hashable, Sendable {
    /// Zero-based slot along the x-axis.
    var index: Int
    /// One-based ordinals of the passages folded into this bar.
    var passages: ClosedRange<Int>
    /// Summed cost, or nil when none of the passages was priced.
    var usd: Double?

    var id: Int { index }
}

/// Folds the ledger's per-passage rows into evenly spaced bars, a port of
/// `bucketEntries` in `components/cost/cost-spark.tsx`.
nonisolated enum PassageSpendData {
    /// Past this many bars, each is too thin on an iPhone to read as a bar.
    static let maxBars = 60

    /// Bars in manuscript order. Raw positions are not used as x because
    /// images and user turns share the counter, which would space bars unevenly.
    static func bars(_ entries: [StoryCostProfile.EntrySpend], maxBars: Int = maxBars) -> [PassageSpendBar] {
        guard !entries.isEmpty, maxBars > 0 else { return [] }
        let perBar = (entries.count + maxBars - 1) / maxBars
        return stride(from: 0, to: entries.count, by: perBar).enumerated().map { index, start in
            let end = min(start + perBar, entries.count)
            let priced = entries[start..<end]
                .compactMap { $0.costUsd.flatMap(Double.init) }
                .filter(\.isFinite)
            return PassageSpendBar(
                index: index,
                passages: (start + 1)...end,
                usd: priced.isEmpty ? nil : priced.reduce(0, +)
            )
        }
    }
}
