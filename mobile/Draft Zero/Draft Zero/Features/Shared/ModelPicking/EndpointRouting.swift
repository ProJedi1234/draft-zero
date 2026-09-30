import Foundation

/// How a pinned provider and a retention policy decide which endpoint serves a
/// request. Mirrors the ZDR helpers at the bottom of lib/types.ts.
nonisolated enum EndpointRouting {
    /// The endpoint a pin actually lands on, or nil for OpenRouter's own routing.
    /// A tag that left the list, or one naming a retaining endpoint under ZDR,
    /// cannot be honoured, so both read as Auto.
    static func routableEndpoint(_ endpoints: [ModelEndpoint], tag: String?, zdr: Bool) -> ModelEndpoint? {
        guard let tag, let endpoint = endpoints.first(where: { $0.tag == tag }) else { return nil }
        return !zdr || endpoint.zdr ? endpoint : nil
    }

    /// The endpoints a policy leaves pickable, and the ones it rules out.
    static func partition(_ endpoints: [ModelEndpoint], zdr: Bool) -> (allowed: [ModelEndpoint], blocked: [ModelEndpoint]) {
        guard zdr else { return (endpoints, []) }
        return (endpoints.filter(\.zdr), endpoints.filter { !$0.zdr })
    }

    /// The best measured speed among the endpoints, standing in for Auto's.
    static func fastestThroughput(_ endpoints: [ModelEndpoint]) -> Double? {
        endpoints.compactMap(\.throughput).max()
    }

    /// The window a request can actually use: a pinned endpoint's, else the model's.
    /// Zero means unknown, which clamps nothing.
    static func contextLength(
        endpoints: [ModelEndpoint],
        tag: String?,
        zdr: Bool,
        model: OpenRouterModel?
    ) -> Int {
        routableEndpoint(endpoints, tag: tag, zdr: zdr)?.contextLength ?? model?.contextLength ?? 0
    }
}
