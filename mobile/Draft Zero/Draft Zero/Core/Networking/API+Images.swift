import Foundation

nonisolated private struct LaunchedRun: Decodable, Sendable {
    var runId: String
}

extension APIClient {
    /// POST /api/image — launch a server-owned illustration run.
    /// `imageGroupId` joins an existing slot as a new take; `modelId` overrides
    /// the story's image model for this draw only.
    func startIllustration(
        storyId: String,
        prompt: String,
        sourcePrompt: String?,
        promptLoreIds: [String],
        aspectRatio: ImageAspectRatio,
        imageGroupId: String? = nil,
        modelId: String? = nil
    ) async throws -> String {
        var body: JSONObject = [
            "storyId": .string(storyId),
            "prompt": .string(prompt),
            "sourcePrompt": .optional(sourcePrompt),
            "promptLoreIds": .strings(promptLoreIds),
            "aspectRatio": .string(aspectRatio.rawValue),
        ]
        if let imageGroupId { body["imageGroupId"] = .string(imageGroupId) }
        if let modelId { body["modelId"] = .string(modelId) }
        return try await payload(.post, "api/image", body: body, as: LaunchedRun.self).runId
    }

    /// POST /api/stories/:id/illustration/stop. A nil runId stops whatever is drawing.
    func stopIllustration(storyId: String, runId: String?) async throws {
        try await serviceVoid(.post, "api/stories/\(storyId)/illustration/stop", body: ["runId": .optional(runId)])
    }

    /// DELETE the whole slot, every take. Undone by `restoreIllustration`.
    func deleteIllustration(storyId: String, imageGroupId: String) async throws {
        try await serviceVoid(.delete, "api/stories/\(storyId)/illustrations/\(imageGroupId)")
    }

    func restoreIllustration(storyId: String, imageGroupId: String) async throws {
        try await serviceVoid(.post, "api/stories/\(storyId)/illustrations/\(imageGroupId)/restore")
    }

    /// Makes the named take the slot's active one.
    func selectImage(storyId: String, imageGroupId: String, imageId: String) async throws {
        try await serviceVoid(
            .post,
            "api/stories/\(storyId)/illustrations/\(imageGroupId)/select",
            body: ["imageId": .string(imageId)]
        )
    }

    /// Steps to the neighbouring take; `offset` is 1 or -1.
    func stepImage(storyId: String, imageGroupId: String, offset: Int) async throws {
        try await serviceVoid(
            .post,
            "api/stories/\(storyId)/illustrations/\(imageGroupId)/step",
            body: ["offset": .number(Double(offset))]
        )
    }

    /// POST /api/image-prompt — launch a develop. An empty brief describes the story as it stands.
    func startDerive(storyId: String, brief: String, excludedLoreIds: [String]) async throws -> String {
        try await payload(
            .post,
            "api/image-prompt",
            body: [
                "storyId": .string(storyId),
                "brief": .string(brief),
                "excludedLoreIds": .strings(excludedLoreIds),
            ],
            as: LaunchedRun.self
        ).runId
    }

    /// GET /api/image/subscribe. Nil (204) when nothing is drawing.
    func subscribeImageRun(storyId: String, runId: String?) async throws -> AsyncThrowingStream<ImageRunWireEvent, Error>? {
        var query = [URLQueryItem(name: "storyId", value: storyId)]
        if let runId { query.append(URLQueryItem(name: "runId", value: runId)) }
        return try await stream("api/image/subscribe", query: query, as: ImageRunWireEvent.self)
    }

    /// GET /api/image-prompt/subscribe. Nil (204) when nothing is developing.
    func subscribeDeriveRun(storyId: String, runId: String?) async throws -> AsyncThrowingStream<DeriveRunWireEvent, Error>? {
        var query = [URLQueryItem(name: "storyId", value: storyId)]
        if let runId { query.append(URLQueryItem(name: "runId", value: runId)) }
        return try await stream("api/image-prompt/subscribe", query: query, as: DeriveRunWireEvent.self)
    }
}
