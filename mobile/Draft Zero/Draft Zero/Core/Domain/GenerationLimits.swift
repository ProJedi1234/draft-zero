import Foundation

/// The ladders and bounds the server enforces on generation settings.
/// Mirrors the constants in lib/types.ts.
nonisolated enum GenerationLimits {
    /// Selectable input-context sizes, ascending.
    static let contextWindows = [2048, 4096, 6144, 8192, 10240, 12288, 16384, 32768, 65536, 131072]
    static let contextWindowLabels = ["2k", "4k", "6k", "8k", "10k", "12k", "16k", "32k", "64k", "128k"]
    static let defaultContextWindow = 8192

    static let loreBudgetRange: ClosedRange<Double> = 0...50
    static let loreBudgetStep: Double = 5
    static let defaultLoreBudget: Double = 25

    static let temperatureRange: ClosedRange<Double> = 0...2
    static let topPRange: ClosedRange<Double> = 0...1
    static let penaltyRange: ClosedRange<Double> = -2...2

    /// The develop call's context budgets.
    static let imageContextOptions = [1024, 2048, 4096, 8192, 16384]

    /// The compact label for a context ladder stop, e.g. "128k".
    static func contextWindowLabel(_ value: Int) -> String {
        guard let index = contextWindows.firstIndex(of: value) else { return "\(value)" }
        return contextWindowLabels[index]
    }

    /// The largest ladder stop a model with this window can accept. A zero
    /// length means the model is unknown, so nothing is clamped.
    static func clampContextWindow(_ value: Int, contextLength: Int) -> Int {
        guard contextLength > 0 else { return value }
        let allowed = contextWindows.last { $0 <= contextLength } ?? contextWindows[0]
        return min(value, allowed)
    }
}
