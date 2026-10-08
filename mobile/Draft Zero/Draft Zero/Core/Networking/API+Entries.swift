import Foundation

/// One page of older passages, walking backward from the loaded window.
nonisolated struct OlderEntriesPage: Decodable, Sendable {
    var entries: [StoryEntry]
    var windowStartPosition: Int?
    var hasMore: Bool
}

/// How a passage is appended from outside a run.
nonisolated enum AppendMode: String, Sendable {
    case narration
    case say
    case `do`
}

nonisolated private struct AppendedEntry: Decodable, Sendable {
    var entry: StoryEntry
}

extension APIClient {
    /// GET /api/entries — older passages before `beforePosition`.
    func olderEntries(storyId: String, beforePosition: Int, limit: Int = 40) async throws -> OlderEntriesPage {
        try await service(
            .get,
            "api/entries",
            query: [
                URLQueryItem(name: "storyId", value: storyId),
                URLQueryItem(name: "beforePosition", value: String(beforePosition)),
                URLQueryItem(name: "limit", value: String(limit)),
            ]
        )
    }

    /// POST /api/entries — append a passage without generating after it.
    func appendEntry(storyId: String, mode: AppendMode, text: String) async throws -> StoryEntry {
        try await service(
            .post,
            "api/entries",
            body: ["storyId": .string(storyId), "mode": .string(mode.rawValue), "text": .string(text)],
            as: AppendedEntry.self
        ).entry
    }

    /// PATCH /api/entries/:id — rewrite a passage's prose. Clears its Say/Do pair.
    func updateEntryText(entryId: String, storyId: String, text: String) async throws {
        try await serviceVoid(
            .patch,
            "api/entries/\(entryId)",
            body: ["storyId": .string(storyId), "text": .string(text)]
        )
    }

    /// POST /api/entries/:id/action — re-edit a player turn from its first-person input.
    func updateActionEntry(entryId: String, storyId: String, rawText: String, kind: ActionKind) async throws {
        try await serviceVoid(
            .post,
            "api/entries/\(entryId)/action",
            body: ["storyId": .string(storyId), "rawText": .string(rawText), "kind": .string(kind.rawValue)]
        )
    }

    /// DELETE /api/entries/:id — soft-delete a passage. Undoable.
    func deleteEntry(entryId: String, storyId: String) async throws {
        try await serviceVoid(.delete, "api/entries/\(entryId)", body: ["storyId": .string(storyId)])
    }

    /// POST /api/entries/:id/rewind — set aside everything after this passage, as one undo step.
    func rewind(toEntry entryId: String, storyId: String) async throws {
        try await serviceVoid(.post, "api/entries/\(entryId)/rewind", body: ["storyId": .string(storyId)])
    }

    /// GET /api/entries/:id/context — what this passage would be sent now. Nil
    /// when the passage is no longer in the manuscript.
    func entryContext(entryId: String, storyId: String) async throws -> EntryContext? {
        try await service(
            .get,
            "api/entries/\(entryId)/context",
            query: [URLQueryItem(name: "storyId", value: storyId)],
            as: EntryContext?.self
        )
    }

    /// GET /api/stories/:id/context — what the next passage would be sent now.
    func nextContext(storyId: String) async throws -> EntryContext {
        try await service(.get, "api/stories/\(storyId)/context")
    }
}
