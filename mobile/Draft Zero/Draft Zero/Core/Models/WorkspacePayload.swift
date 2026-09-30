import Foundation

/// Everything the story workspace mounts with, from
/// GET /api/story/:id/workspace. Mirrors lib/story/workspace-payload.ts.
nonisolated struct WorkspacePayload: Codable, Sendable {
    var story: Story
    var composerDraft: ComposerDraft?
    var lorebookEntries: [LorebookEntry]
    var models: [OpenRouterModel]
    var imageModels: [OpenRouterImageModel]
    var imageModelPrice: String?
    /// What a nil story image model resolves to.
    var defaultImageModelId: String
    var costProfile: StoryCostProfile
    var profiles: [ModelProfile]
    var defaultProfileId: String?
    var requireZdr: Bool
}
