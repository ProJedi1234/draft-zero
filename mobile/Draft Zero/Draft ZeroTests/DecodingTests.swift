import Foundation
import Testing
@testable import Draft_Zero

/// Every payload the app reads, decoded from a verbatim server response.
struct DecodingTests {
    @Test func workspacePayload() throws {
        let payload = try FixtureLoader.decode(WorkspacePayload.self, from: "workspace.json")
        #expect(!payload.story.entries.isEmpty)
        #expect(!payload.story.images.isEmpty)
        #expect(!payload.models.isEmpty)
        #expect(!payload.lorebookEntries.isEmpty)
        #expect(payload.story.settings.contextWindow > 0)
        let image = try #require(payload.story.images.first)
        #expect(image.takes.count == image.imageCount)
    }

    @Test func settingsPayload() throws {
        let payload = try FixtureLoader.decode(SettingsPayload.self, from: "settings.json")
        #expect(!payload.profiles.isEmpty)
        #expect(payload.settings.defaultProfileId != nil)
    }

    @Test func settingsPayloadWithLocalModels() throws {
        let payload = try FixtureLoader.decode(SettingsPayload.self, from: "settings.json")
        let local = payload.models.filter { $0.local != nil }
        #expect(!local.isEmpty)
        #expect(local.allSatisfy { $0.id.hasPrefix(LocalModels.idPrefix) && $0.zdr })
        #expect(payload.localModels?.host == "metis")
        #expect(payload.decisionModels?.contains { $0.id == BuiltInModels.atmosphereDecision } == true)
    }

    /// A server from before local models omits every new field, and still decodes.
    @Test func settingsPayloadFromAnOlderServer() throws {
        let payload = try FixtureLoader.decode(SettingsPayload.self, from: "settings-before-local-models.json")
        #expect(payload.decisionModels == nil)
        #expect(payload.localModels == nil)
        #expect(payload.settings.atmosphere.decisionModelId == nil)
        #expect(payload.models.allSatisfy { $0.local == nil })
    }

    @Test func usagePayload() throws {
        let payload = try FixtureLoader.decode(UsagePayload.self, from: "usage.json")
        #expect(payload.bars.count == payload.windowDays)
    }

    @Test func galleryAndLibrary() throws {
        struct Gallery: Decodable { var images: [GalleryImage] }
        let gallery = try FixtureLoader.decode(Gallery.self, from: "gallery.json")
        #expect(!gallery.images.isEmpty)
        // The server omits `missing` for a picture whose file exists.
        #expect(gallery.images.allSatisfy { $0.missing == nil })
        let library = try FixtureLoader.decode(LibraryPayload.self, from: "library.json")
        #expect(!library.excerpts.isEmpty)
    }

    @Test func storySnapshots() throws {
        let full = try FixtureLoader.decode(StorySnapshot.self, from: "snapshot-full.json")
        #expect(full.mode == "full")
        #expect(!full.records.isEmpty)
        let delta = try FixtureLoader.decode(StorySnapshot.self, from: "snapshot-delta.json")
        #expect(delta.mode == "delta")
        #expect(delta.allIds?.isEmpty == false)
    }

    @Test func lorebookPartition() throws {
        let partition = try FixtureLoader.decode(LorebookPartition.self, from: "lorebook.json")
        #expect(partition.rows.count == 2)
    }

    @Test func draftRead() throws {
        let draft = try FixtureLoader.decode(DraftRead.self, from: "draft.json")
        #expect(!draft.version.isEmpty)
    }

    @Test func serviceEnvelopes() throws {
        let context = try FixtureLoader.decode(ServiceEnvelope<EntryContext?>.self, from: "entry-context.json")
        #expect(context.ok)
        let composed = try #require(context.data??.context)
        #expect(composed.approxTokens > 0)

        let older = try FixtureLoader.decode(ServiceEnvelope<OlderEntriesPage>.self, from: "older-entries.json")
        #expect(older.data?.entries.isEmpty == false)

        let endpoints = try FixtureLoader.decode(ServiceEnvelope<[ModelEndpoint]>.self, from: "endpoints.json")
        #expect(endpoints.data?.isEmpty == false)

        let zdr = try FixtureLoader.decode(ServiceEnvelope<[String: AccountZdrPolicy]>.self, from: "zdr.json")
        #expect(zdr.data?.count == 5)
    }

    @Test func serviceFailureEnvelope() throws {
        let body = Data(#"{"ok":false,"code":"conflict","error":"A generation is already running."}"#.utf8)
        let envelope = try JSONDecoder().decode(ServiceEnvelope<JSONValue>.self, from: body)
        #expect(!envelope.ok)
        #expect(envelope.code == "conflict")
        #expect(envelope.error == "A generation is already running.")
    }

    @Test func nullDataEnvelope() throws {
        let body = Data(#"{"ok":true,"data":null}"#.utf8)
        let envelope = try JSONDecoder().decode(ServiceEnvelope<HistoryMove?>.self, from: body)
        #expect(envelope.ok)
        #expect(envelope.data != nil)
        #expect(envelope.data?.map(\.summary) == nil)
    }

    @Test func legacyCategoryReadsAsConcept() throws {
        let body = Data(#"{"id":"a","storyId":"s","name":"N","category":"spell","keys":[],"content":"","enabled":true,"alwaysActive":false,"priority":50,"createdAt":"x","updatedAt":"x"}"#.utf8)
        let entry = try JSONDecoder().decode(LorebookEntry.self, from: body)
        #expect(entry.category == .concept)
    }
}
