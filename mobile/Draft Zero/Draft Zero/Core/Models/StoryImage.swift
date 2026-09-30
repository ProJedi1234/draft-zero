import Foundation

/// An illustration: a beat in the manuscript, positioned in the same sequence
/// as passages. Mirrors `StoryImage` in lib/types.ts.
nonisolated struct StoryImage: Codable, Sendable, Hashable, Identifiable {
    var id: String
    var position: Int
    var imageGroupId: String
    var imageIndex: Int
    var imageCount: Int
    /// Every take of the slot, oldest first.
    var takes: [ImageTake]
    /// Exactly what the image model was sent, style sentence included.
    var prompt: String
    /// The writer's brief before a develop call expanded it, when there was one.
    var sourcePrompt: String?
    var promptLoreIds: [String]
    var modelId: String
    var aspectRatio: ImageAspectRatio
    var seed: Int
    var mediaType: String
    var costUsd: String?
    var callStatus: CallStatus?
    /// Every draw of the slot, including the takes no longer showing.
    var slotCostUsd: String?
    var slotUnpricedCalls: Int
    var createdAt: String
}
