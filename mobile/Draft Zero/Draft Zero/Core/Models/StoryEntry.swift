import Foundation

/// One passage of prose, as the active take of its slot. Mirrors `StoryEntry`
/// in lib/types.ts.
nonisolated struct StoryEntry: Codable, Sendable, Hashable, Identifiable {
    enum Source: String, Codable, Sendable {
        case user
        case generated
    }

    var id: String
    /// Shared ordering counter with images; merges prose and pictures into one timeline.
    var position: Int?
    var source: Source
    /// Second-person prose, paragraphs separated by blank lines.
    var text: String
    var actionKind: ActionKind?
    /// The writer's raw first-person input, when this passage was a Do or Say.
    var inputText: String?
    var variantGroupId: String
    var variantIndex: Int
    var variantCount: Int
    var variantProfilesMixed: Bool
    var generation: EntryGeneration?
    /// USD as a decimal string; nil means unknown, never zero.
    var costUsd: String?
    var reasoningTokens: Int?
    var callStatus: CallStatus?
    var createdAt: String

    var isGenerated: Bool { source == .generated }
}
