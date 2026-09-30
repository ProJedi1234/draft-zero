import Foundation

/// The usage screen's data, from GET /api/usage. Mirrors lib/payloads/usage.ts.
/// Every USD figure is a decimal string summed in SQL.
nonisolated struct UsagePayload: Codable, Sendable {
    struct Summary: Codable, Sendable, Hashable {
        var todayUsd: String
        var weekUsd: String
        var allTimeUsd: String
        var todayImageUsd: String
        var weekImageUsd: String
        var allTimeImageUsd: String
        var unpricedCalls: Int
        var todayUnpricedCalls: Int
        var weekUnpricedCalls: Int
        var todayImageUnpricedCalls: Int
        var weekImageUnpricedCalls: Int
        var allTimeImageUnpricedCalls: Int
    }

    /// One day of the spend strip; `day` is a "YYYY-MM-DD" key.
    struct SpendBar: Codable, Sendable, Hashable, Identifiable {
        var day: String
        var costUsd: String
        var imageUsd: String
        var calls: Int
        var value: Double
        var imageValue: Double
        var id: String { day }
    }

    struct StorySpend: Codable, Sendable, Hashable, Identifiable {
        /// Nil once the story is deleted; the ledger outlives it.
        var storyId: String?
        var title: String
        var isDeleted: Bool
        var costUsd: String
        var calls: Int
        var id: String { storyId ?? "deleted-\(title)" }
    }

    struct ModelSpend: Codable, Sendable, Hashable, Identifiable {
        var modelId: String
        var costUsd: String
        var calls: Int
        var promptTokens: Int
        var completionTokens: Int
        var id: String { modelId }
    }

    struct ImageModelSpend: Codable, Sendable, Hashable, Identifiable {
        var modelId: String
        var costUsd: String
        var images: Int
        var avgUsd: String?
        var unpricedImages: Int
        var id: String { modelId }
    }

    var summary: Summary
    var bars: [SpendBar]
    var byStory: [StorySpend]
    var byModel: [ModelSpend]
    var byImageModel: [ImageModelSpend]
    var windowDays: Int
    var windowUsd: String
    var windowUnpricedCalls: Int
    var locale: String
    var zoneLabel: String
}
