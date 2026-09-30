import Foundation

/// A story just created or duplicated.
nonisolated struct StoryCreated: Decodable, Sendable {
    var id: String
    var record: StoryRecord
}

nonisolated private struct RecordBox<T: Decodable & Sendable>: Decodable, Sendable {
    var record: T
}

extension APIClient {
    /// POST /api/stories. A client-minted id lets the row render before the reply.
    func createStory(id: String? = nil, title: String? = nil) async throws -> StoryCreated {
        var body: JSONObject = [:]
        if let id { body["id"] = .string(id) }
        if let title { body["title"] = .string(title) }
        return try await service(.post, "api/stories", body: body)
    }

    /// PATCH /api/stories/:id — any of title, description, genre, memory,
    /// authorsNote, systemPrompt ("" or null clears it), summarize.
    func updateStoryMeta(_ storyId: String, patch: JSONObject) async throws -> StoryRecord {
        try await service(.patch, "api/stories/\(storyId)", body: patch, as: RecordBox<StoryRecord>.self).record
    }

    /// PATCH /api/stories/:id/tint. A nil hue clears the tint; `auto` nil leaves the flag.
    func updateStoryTint(
        _ storyId: String,
        hue: Double?,
        strength: Double? = nil,
        auto: Bool? = nil
    ) async throws -> StoryRecord {
        var body: JSONObject = ["hue": .optional(hue)]
        if let strength { body["strength"] = .number(strength) }
        if let auto { body["auto"] = .bool(auto) }
        return try await service(.patch, "api/stories/\(storyId)/tint", body: body, as: RecordBox<StoryRecord>.self).record
    }

    /// PATCH /api/stories/:id/tint/auto. Hands the tint to the atmosphere picker, or takes it back.
    func setStoryTintAuto(_ storyId: String, auto: Bool) async throws -> StoryRecord {
        try await service(
            .patch,
            "api/stories/\(storyId)/tint/auto",
            body: ["auto": .bool(auto)],
            as: RecordBox<StoryRecord>.self
        ).record
    }

    /// POST /api/stories/:id/duplicate.
    func duplicateStory(_ storyId: String, copyId: String? = nil) async throws -> StoryCreated {
        var body: JSONObject = [:]
        if let copyId { body["copyId"] = .string(copyId) }
        return try await service(.post, "api/stories/\(storyId)/duplicate", body: body)
    }

    /// DELETE /api/stories/:id. Idempotent.
    func deleteStory(_ storyId: String) async throws {
        try await serviceVoid(.delete, "api/stories/\(storyId)")
    }

    /// PATCH /api/stories/:id/generation-settings — a partial GenerationSettings.
    func updateGenerationSettings(_ storyId: String, patch: JSONObject) async throws {
        try await serviceVoid(.patch, "api/stories/\(storyId)/generation-settings", body: patch)
    }

    /// PATCH /api/stories/:id/image-model. Nil follows the app's default image model.
    func setStoryImageModel(_ storyId: String, imageModelId: String?) async throws {
        try await serviceVoid(
            .patch,
            "api/stories/\(storyId)/image-model",
            body: ["imageModelId": .optional(imageModelId)]
        )
    }
}
