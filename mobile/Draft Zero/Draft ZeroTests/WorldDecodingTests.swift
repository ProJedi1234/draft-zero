import Foundation
import Testing
@testable import Draft_Zero

struct WorldDecodingTests {
    @Test func storyFeaturesAndNPCOptIn() throws {
        let workspace = try FixtureLoader.decode(WorkspacePayload.self, from: "living-world-workspace.json")
        #expect(workspace.story.features?.world?.enabled == true)
        #expect(workspace.story.features?.world?.pacing.contains("three days") == true)
        #expect(workspace.lorebookEntries.first?.npc == true)
        let snapshot = try FixtureLoader.decode(StorySnapshot.self, from: "living-world-stories.json")
        #expect(snapshot.records.first?.features?.world?.enabled == true)
    }

    @Test func worldStateAndUnanchoredMemory() throws {
        let response = try FixtureLoader.decode(ServiceEnvelope<WorldResponse>.self, from: "living-world.json")
        let state = try #require(response.data?.state)
        #expect(state.minutes == 3960)
        let npc = try #require(state.npcs.first)
        #expect(npc.name == "Wren")
        #expect(npc.mind == "Keep the lantern burning until the others return.")
        #expect(npc.memories.first?.importance == 4)
        #expect(npc.memories.first?.entryId == nil)
    }

    @Test func worldContextAndOlderPayloads() throws {
        let context = try FixtureLoader.decode(ServiceEnvelope<EntryContext>.self, from: "living-world-context.json")
        #expect(context.data?.context.world?.first == "[World: day 3, evening]")
        #expect(context.data?.context.world?.last?.contains("Wren") == true)
        let older = try FixtureLoader.decode(WorkspacePayload.self, from: "workspace.json")
        #expect(older.story.features == nil)
        #expect(older.lorebookEntries.allSatisfy { $0.npc != true })
    }
}
