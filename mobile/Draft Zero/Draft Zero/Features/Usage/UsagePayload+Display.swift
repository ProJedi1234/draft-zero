import Foundation

extension UsagePayload {
    /// Whether a picture has ever been asked for. Picture figures stay hidden
    /// until then, so a text-only ledger never grows a row of $0.
    nonisolated var hasImages: Bool { !byImageModel.isEmpty }

    /// The largest spend among models, which sets the scale of every share bar.
    nonisolated var modelPeak: Double {
        byModel.reduce(0) { max($0, Double($1.costUsd) ?? 0) }
    }

    nonisolated var imageModelPeak: Double {
        byImageModel.reduce(0) { max($0, Double($1.costUsd) ?? 0) }
    }
}

extension UsagePayload.ModelSpend {
    nonisolated func share(of peak: Double) -> Double {
        peak > 0 ? (Double(costUsd) ?? 0) / peak : 0
    }
}

extension UsagePayload.ImageModelSpend {
    nonisolated func share(of peak: Double) -> Double {
        peak > 0 ? (Double(costUsd) ?? 0) / peak : 0
    }
}
