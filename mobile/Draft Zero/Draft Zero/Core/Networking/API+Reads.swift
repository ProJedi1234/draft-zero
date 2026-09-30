import Foundation

/// The draft row as GET /api/draft states it.
nonisolated struct DraftRead: Decodable, Sendable {
    var text: String
    var mode: ComposerMode
    var imagePrompt: String?
    var imageAssisted: Bool
    var imageStyle: String?
    var imageExcludedLoreIds: [String]
    var version: String

    var asDraft: ComposerDraft {
        ComposerDraft(
            text: text,
            mode: mode,
            imagePrompt: imagePrompt,
            imageAssisted: imageAssisted,
            imageStyle: imageStyle,
            imageExcludedLoreIds: imageExcludedLoreIds,
            updatedAt: version
        )
    }
}

nonisolated private struct DraftSaved: Decodable, Sendable {
    var version: String
}

nonisolated private struct GalleryBody: Decodable, Sendable {
    var images: [GalleryImage]
}

nonisolated private struct Health: Decodable, Sendable {
    var ok: Bool
}

extension APIClient {
    /// GET /api/health — is this server answering? Deliberately skips the database.
    func health() async throws -> Bool {
        try await payload(.get, "api/health", as: Health.self).ok
    }

    /// GET /api/story/:id/workspace — everything the story screen mounts with.
    func workspace(storyId: String) async throws -> WorkspacePayload {
        try await payload(.get, "api/story/\(storyId)/workspace")
    }

    /// GET /api/store/snapshot — every story, or those moved since a version.
    func storySnapshot(since: String? = nil) async throws -> StorySnapshot {
        var query: [URLQueryItem] = []
        if let since { query.append(URLQueryItem(name: "since", value: since)) }
        return try await payload(.get, "api/store/snapshot", query: query)
    }

    /// GET /api/library — excerpts, the picture rail and the runs in flight.
    func library() async throws -> LibraryPayload {
        try await payload(.get, "api/library")
    }

    /// GET /api/gallery — every illustration slot, newest first.
    func gallery() async throws -> [GalleryImage] {
        try await payload(.get, "api/gallery", as: GalleryBody.self).images
    }

    /// GET /api/usage — the spend ledger's aggregates.
    func usage() async throws -> UsagePayload {
        try await payload(.get, "api/usage")
    }

    /// GET /api/draft — the resync probe. Nil (204) when the composer was never touched.
    func draft(storyId: String) async throws -> DraftRead? {
        try await optionalPayload(.get, "api/draft", query: [URLQueryItem(name: "storyId", value: storyId)])
    }

    /// POST /api/draft — upserts the draft row and announces it. Returns the new version.
    func saveDraft(storyId: String, draft: DraftPayload) async throws -> String {
        try await payload(
            .post,
            "api/draft",
            body: [
                "storyId": .string(storyId),
                "text": .string(draft.text),
                "mode": .string(draft.mode.rawValue),
                "imagePrompt": .optional(draft.imagePrompt),
                "imageAssisted": .bool(draft.imageAssisted),
                "imageStyle": .optional(draft.imageStyle),
                "imageExcludedLoreIds": .strings(draft.imageExcludedLoreIds),
                "origin": .string(origin),
            ],
            as: DraftSaved.self
        ).version
    }

    /// GET /api/sync/events — the long-lived change channel.
    func syncEvents() async throws -> AsyncThrowingStream<SyncWireEvent, Error> {
        guard let events = try await stream("api/sync/events", as: SyncWireEvent.self) else {
            throw APIError.http(status: 204, message: "The sync channel answered with nothing.")
        }
        return events
    }
}
