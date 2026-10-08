import Foundation

/// A started run's identity. Prose streams from the subscribe channel.
nonisolated struct StartedRun: Decodable, Sendable {
    var runId: String
    /// The writer's persisted turn, or nil for Continue and Retry.
    var userEntryId: String?
}

/// What an undo, redo or take switch moved.
nonisolated struct HistoryMove: Decodable, Sendable {
    var summary: String
}

/// Which move asked for a generation; recorded on the spend ledger.
nonisolated enum GenerationRequestKind: String, Sendable {
    case generate
    case retry
    case `continue`
}

extension APIClient {
    /// POST /api/stories/:id/generation — persists the turn and launches a server-owned run.
    func startGeneration(
        storyId: String,
        kind: ActionKind? = nil,
        userText: String? = nil,
        turnId: String,
        variantGroupId: String? = nil,
        removingEntryIds: [String] = [],
        requestKind: GenerationRequestKind,
        profileId: String? = nil,
        modelId: String? = nil
    ) async throws -> StartedRun {
        var body: JSONObject = [
            "turnId": .string(turnId),
            "requestKind": .string(requestKind.rawValue),
        ]
        if let kind { body["kind"] = .string(kind.rawValue) }
        if let userText { body["userText"] = .string(userText) }
        if let variantGroupId { body["variantGroupId"] = .string(variantGroupId) }
        if !removingEntryIds.isEmpty { body["removingEntryIds"] = .strings(removingEntryIds) }
        if let profileId { body["profileId"] = .string(profileId) }
        if let modelId { body["modelId"] = .string(modelId) }
        return try await service(.post, "api/stories/\(storyId)/generation", body: body)
    }

    /// DELETE /api/stories/:id/generation — the only way a run is ever aborted.
    /// `startTurnId` scopes a stop sent before the runId is known.
    func stopGeneration(storyId: String, runId: String?, startTurnId: String? = nil) async throws {
        try await serviceVoid(
            .delete,
            "api/stories/\(storyId)/generation",
            body: ["runId": .optional(runId), "startTurnId": .optional(startTurnId)]
        )
    }

    /// POST /api/stories/:id/undo. Nil when there was nothing to undo.
    func undo(storyId: String) async throws -> HistoryMove? {
        try await service(.post, "api/stories/\(storyId)/undo", as: HistoryMove?.self)
    }

    /// POST /api/stories/:id/redo. Nil when there was nothing to redo.
    func redo(storyId: String) async throws -> HistoryMove? {
        try await service(.post, "api/stories/\(storyId)/redo", as: HistoryMove?.self)
    }

    /// POST /api/stories/:id/variant — step the newest passage's take by ±1.
    func selectVariant(storyId: String, entryId: String, offset: Int) async throws -> HistoryMove? {
        try await service(
            .post,
            "api/stories/\(storyId)/variant",
            body: ["entryId": .string(entryId), "offset": .number(Double(offset))],
            as: HistoryMove?.self
        )
    }

    /// GET /api/generation/subscribe. Nil (204) when nothing is running.
    func subscribeRun(storyId: String, runId: String?) async throws -> AsyncThrowingStream<RunWireEvent, Error>? {
        var query = [URLQueryItem(name: "storyId", value: storyId)]
        if let runId { query.append(URLQueryItem(name: "runId", value: runId)) }
        return try await stream("api/generation/subscribe", query: query, as: RunWireEvent.self)
    }
}
