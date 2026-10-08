import Foundation

/// A story as the workspace reads it: metadata, settings, and a tail window of
/// the manuscript. Mirrors `Story` in lib/types.ts.
nonisolated struct Story: Codable, Sendable, Hashable, Identifiable {
    struct GeneratedSpan: Codable, Sendable, Hashable {
        var firstIso: String
        var lastIso: String
    }

    var id: String
    var title: String
    var description: String
    var genre: String
    var createdAt: String
    var updatedAt: String
    var wordCount: Int
    /// The manuscript's active passages, or a tail window of them.
    var entries: [StoryEntry]
    var entriesBefore: Int?
    var charsBefore: Int?
    /// True when older live passages exist before `entries[0]`.
    var hasMoreBefore: Bool?
    /// The first loaded passage's position — the cursor for paging older ones in.
    var windowStartPosition: Int?
    var generatedSpan: GeneratedSpan?
    /// The active take of every illustration slot.
    var images: [StoryImage]
    /// The followed profile, or nil for Custom.
    var profileId: String?
    var settings: GenerationSettings
    var memory: String
    var authorsNote: String
    /// Whether new summary versions are written as the window slides.
    var summarize: Bool
    var summary: String
    /// The narrator prompt override, or nil for the built-in one.
    var systemPrompt: String?
    var tintHue: Double?
    var tintStrength: Double
    var tintAuto: Bool
    var imageModelId: String?
    var activeLorebookEntryIds: [String]
    var canUndo: Bool
    var canRedo: Bool
    var undoSummary: String?
    var redoSummary: String?
}
