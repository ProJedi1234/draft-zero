import Foundation

extension APIClient {
    /// POST /api/import/scenario — a NovelAI `.scenario` as a new story.
    /// `placeholderValues` answers the scenario's `${…}` placeholders by id.
    func importScenario(json: String, placeholderValues: [String: String] = [:]) async throws -> ImportSummary {
        try await service(
            .post,
            "api/import/scenario",
            body: [
                "json": .string(json),
                "placeholderValues": .object(placeholderValues.mapValues(JSONValue.string)),
            ]
        )
    }

    /// POST /api/import/story-cards — an AI Dungeon card export as a new story.
    func importStoryCards(json: String) async throws -> ImportSummary {
        try await service(.post, "api/import/story-cards", body: ["json": .string(json)])
    }

    /// POST /api/import/backup — a whole AI Dungeon backup `.zip`, sent as raw bytes.
    func importBackup(zip: Data) async throws -> ImportSummary {
        try await upload("api/import/backup", data: zip, contentType: "application/zip")
    }

    /// POST /api/stories/:id/story-cards — merge a card export into an existing lorebook.
    func mergeStoryCards(storyId: String, json: String) async throws -> ImportSummary {
        try await service(.post, "api/stories/\(storyId)/story-cards", body: ["json": .string(json)])
    }
}
