import Foundation

/// A lorebook entry's editable fields, as a create call sends them.
nonisolated struct NewLorebookEntry: Sendable, Hashable {
    var name: String
    var category: LorebookCategory = .concept
    var keys: [String] = []
    var content: String = ""
    var enabled: Bool = true
    var alwaysActive: Bool = false
    var priority: Int = 50
}

nonisolated private struct LorebookRecordBox: Decodable, Sendable {
    var record: LorebookEntry
}

nonisolated struct LorebookPartition: Decodable, Sendable {
    struct Row: Decodable, Sendable {
        var row: LorebookEntry
    }
    var rows: [Row]
}

extension APIClient {
    /// POST /api/lorebook. A client-minted id makes a retry land on the same row.
    func createLorebookEntry(storyId: String, id: String? = nil, entry: NewLorebookEntry) async throws -> LorebookEntry {
        var body: JSONObject = [
            "storyId": .string(storyId),
            "name": .string(entry.name),
            "category": .string(entry.category.rawValue),
            "keys": .strings(entry.keys),
            "content": .string(entry.content),
            "enabled": .bool(entry.enabled),
            "alwaysActive": .bool(entry.alwaysActive),
            "priority": .number(Double(entry.priority)),
        ]
        if let id { body["id"] = .string(id) }
        return try await service(.post, "api/lorebook", body: body, as: LorebookRecordBox.self).record
    }

    /// PATCH /api/lorebook/:id — only the given fields move.
    func updateLorebookEntry(_ entryId: String, patch: JSONObject) async throws -> LorebookEntry {
        try await service(.patch, "api/lorebook/\(entryId)", body: patch, as: LorebookRecordBox.self).record
    }

    func deleteLorebookEntry(_ entryId: String) async throws {
        try await serviceVoid(.delete, "api/lorebook/\(entryId)")
    }

    /// Every lorebook entry of one story, from the store snapshot's lore partition.
    func lorebook(storyId: String) async throws -> [LorebookEntry] {
        try await payload(
            .get,
            "api/store/snapshot",
            query: [
                URLQueryItem(name: "entity", value: "lorebook-entry"),
                URLQueryItem(name: "storyId", value: storyId),
            ],
            as: LorebookPartition.self
        ).rows.map(\.row)
    }
}
