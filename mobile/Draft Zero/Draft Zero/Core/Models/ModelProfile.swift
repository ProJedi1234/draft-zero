import Foundation

/// A named, global bundle of generation settings a story can follow.
nonisolated struct ModelProfile: Codable, Sendable, Hashable, Identifiable {
    var id: String
    var name: String
    var sortOrder: Int
    var settings: ProfileSettings
}
