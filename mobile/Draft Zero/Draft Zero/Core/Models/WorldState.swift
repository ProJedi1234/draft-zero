import Foundation

nonisolated struct WorldState: Codable, Sendable, Equatable {
    var storyId: String
    var minutes: Int
    var npcs: [WorldNPC]
}

nonisolated struct WorldNPC: Codable, Sendable, Equatable, Identifiable {
    var loreEntryId: String
    var name: String
    var mind: String
    var memories: [WorldMemory]
    var id: String { loreEntryId }
}

nonisolated struct WorldMemory: Codable, Sendable, Equatable, Identifiable {
    var id: String
    var text: String
    var importance: Int
    var minutes: Int
    var entryId: String?
}

nonisolated struct WorldResponse: Decodable, Sendable {
    var state: WorldState
}
