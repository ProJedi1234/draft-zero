import Foundation

/// The library's projection of a story. `updatedAt` is the version the row is
/// arbitrated by. Mirrors `StoryRecord` in lib/store/records.ts.
nonisolated struct StoryRecord: Codable, Sendable, Hashable, Identifiable {
    var id: String
    var title: String
    var description: String
    var genre: String
    var createdAt: String
    var updatedAt: String
    var wordCount: Int
    var tintHue: Double?
    var tintStrength: Double
    var tintAuto: Bool

    var updatedDate: Date { ISODate.parse(updatedAt) ?? .distantPast }
    var createdDate: Date { ISODate.parse(createdAt) ?? .distantPast }
    var tint: StoryTintValue { StoryTintValue(hue: tintHue, strength: tintStrength) }
}
