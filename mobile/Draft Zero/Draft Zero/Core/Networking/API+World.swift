import Foundation

extension APIClient {
    func world(storyId: String) async throws -> WorldState {
        try await service(.get, "api/stories/\(storyId)/world", as: WorldResponse.self).state
    }

    func patchWorld(storyId: String, ops: [JSONObject]) async throws -> WorldState {
        try await service(
            .post, "api/stories/\(storyId)/world/patch",
            body: ["ops": .array(ops.map(JSONValue.object))], as: WorldResponse.self
        ).state
    }
}
