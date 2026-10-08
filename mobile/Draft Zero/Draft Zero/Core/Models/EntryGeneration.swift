import Foundation

/// The settings one take was generated under, frozen at generation time.
nonisolated struct EntryGeneration: Codable, Sendable, Hashable {
    var modelId: String
    var thinking: ThinkingLevel
    var temperature: Double
    /// The profile name at generation time, or nil for a story's Custom settings.
    var profileName: String?
    var promptTokens: Int?
    var completionTokens: Int?
}
