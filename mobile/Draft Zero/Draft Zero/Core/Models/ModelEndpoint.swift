import Foundation

/// One upstream endpoint serving a model — a row of the provider picker.
nonisolated struct ModelEndpoint: Codable, Sendable, Hashable, Identifiable {
    /// OpenRouter endpoint tag, e.g. "deepinfra/turbo". Unique per model.
    var tag: String
    var providerName: String
    var contextLength: Int
    var pricing: OpenRouterModel.Pricing
    /// Median output tokens per second, or nil when unmeasured.
    var throughput: Double?
    /// Success fraction 0–1 over the last day, or nil when unmeasured.
    var uptime: Double?
    var quantization: String?
    var zdr: Bool

    var id: String { tag }
}
