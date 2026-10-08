import Foundation

nonisolated private struct ProfileIdBox: Decodable, Sendable {
    var id: String
}

nonisolated private struct CreateProfileBody: Encodable, Sendable {
    var name: String
    var settings: ProfileSettings
}

extension APIClient {
    /// POST /api/profiles. Returns the new profile's id.
    func createProfile(name: String, settings: ProfileSettings) async throws -> String {
        try await service(
            .post,
            "api/profiles",
            encodable: CreateProfileBody(name: name, settings: settings),
            as: ProfileIdBox.self
        ).id
    }

    /// PATCH /api/profiles/:id. `settings` is a partial ProfileSettings patch.
    func updateProfile(_ profileId: String, name: String? = nil, settings: JSONObject? = nil) async throws {
        var body: JSONObject = [:]
        if let name { body["name"] = .string(name) }
        if let settings { body["settings"] = .object(settings) }
        try await serviceVoid(.patch, "api/profiles/\(profileId)", body: body)
    }

    /// POST /api/profiles/reorder — the whole list in its new order. A stale list is a conflict.
    func reorderProfiles(_ orderedIds: [String]) async throws {
        try await serviceVoid(.post, "api/profiles/reorder", body: ["orderedIds": .strings(orderedIds)])
    }

    func setDefaultProfile(_ profileId: String) async throws {
        try await serviceVoid(.post, "api/profiles/\(profileId)/default")
    }

    /// DELETE /api/profiles/:id. Followers flip to Custom; deleting the default is a conflict.
    func deleteProfile(_ profileId: String) async throws {
        try await serviceVoid(.delete, "api/profiles/\(profileId)")
    }

    /// POST /api/stories/:id/profile. Nil switches the story to Custom.
    func setStoryProfile(storyId: String, profileId: String?) async throws {
        try await serviceVoid(.post, "api/stories/\(storyId)/profile", body: ["profileId": .optional(profileId)])
    }

    /// POST /api/stories/:id/save-as-profile — creates a profile from the story's settings and follows it.
    func saveStoryAsProfile(storyId: String, name: String) async throws -> String {
        try await service(
            .post,
            "api/stories/\(storyId)/save-as-profile",
            body: ["name": .string(name)],
            as: ProfileIdBox.self
        ).id
    }
}
