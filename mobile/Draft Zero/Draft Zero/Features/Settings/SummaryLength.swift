import Foundation

/// What the summarizer's "auto" length resolves to. Mirrors
/// lib/generation/summary-plan.ts: five percent of the window, in words.
nonisolated enum SummaryLength {
    static let range: ClosedRange<Double> = 25...2000
    static let step: Double = 25
    static let capRange: ClosedRange<Double> = 64...8192
    static let capStep: Double = 64

    /// About 307 words at the 8k default, held between 150 and 600.
    static func autoTarget(contextWindow: Int) -> Double {
        let words = (Double(contextWindow) * 0.05 * 0.75).rounded()
        return min(600, max(150, words))
    }

    /// The derived output cap: three tokens of room per target word.
    static func autoCap(targetWords: Double?, contextWindow: Int) -> Double {
        ((targetWords ?? autoTarget(contextWindow: contextWindow)) * 3).rounded()
    }
}
