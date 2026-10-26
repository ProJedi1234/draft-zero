import Testing
@testable import Draft_Zero

struct WorldTests {
    @Test func clockBucketsMatchTheServer() {
        let cases = [(0, "Day 1 · night"), (359, "Day 1 · night"), (360, "Day 1 · morning"),
                     (720, "Day 1 · afternoon"), (1080, "Day 1 · evening"), (1440, "Day 2 · night"), (3960, "Day 3 · evening")]
        for (minutes, label) in cases { #expect(WorldClock.label(minutes) == label) }
        #expect(WorldClock.absoluteMinutes(day: 3, time: "18:07") == 3967)
        #expect(WorldClock.time(3967) == "18:07")
        #expect(WorldClock.absoluteMinutes(day: 0, time: "00:00") == nil)
        #expect(WorldClock.absoluteMinutes(day: 1, time: "24:00") == nil)
        #expect(WorldClock.absoluteMinutes(day: 1, time: "12:60") == nil)
        #expect(WorldClock.absoluteMinutes(day: .max, time: "00:00") == nil)
    }

    @Test func npcOptInParticipatesInLoreAutosave() throws {
        let workspace = try FixtureLoader.decode(WorkspacePayload.self, from: "living-world-workspace.json")
        var draft = NewLorebookEntry(entry: try #require(workspace.lorebookEntries.first))
        let previous = draft
        draft.npc = false
        #expect(LorebookField.changed(from: previous, to: draft) == [.npc])
        #expect(LorebookField.patch([.npc], from: draft) == ["npc": .bool(false)])
        #expect(LorebookField.npc.saveDelay == .zero)
        #expect(LorebookField.npc.revertsOnFailure)
    }

    @Test func limitsMatchTheServersUTF16Counts() {
        #expect(WorldText.limited("a😀b", to: 3) == "a😀")
        #expect(WorldText.limited("a😀b", to: 2) == "a")
    }

    @Test func contextSegmentsIncludeWorldLabelsAndSeparators() throws {
        let response = try FixtureLoader.decode(ServiceEnvelope<EntryContext>.self, from: "living-world-context.json")
        let context = try #require(response.data?.context)
        let sections = ContextSections.sections(context)
        #expect(sections.map(\.name) == ["Instructions", "Lorebook", "Story", "World"])
        #expect(sections.first { $0.name == "Lorebook" }?.tokens == 15)
        #expect(sections.first { $0.name == "Story" }?.tokens == 17)
        #expect(sections.first { $0.name == "World" }?.tokens == 42)
    }

    @Test func decodesAPassageAnchoredWorldPass() throws {
        let response = try FixtureLoader.decode(ServiceEnvelope<WorldResponse>.self, from: "living-world-generated.json")
        let npc = try #require(response.data?.state.npcs.first)
        #expect(!npc.mind.isEmpty)
        #expect(npc.memories.contains { $0.entryId != nil })
        #expect(npc.memories.allSatisfy { (1...5).contains($0.importance) })
    }

    @Test func clockFollowsRemoteChangesAfterFocusAndKeepsUnsentEdits() async {
        let controls = WorldClockControls(minutes: 3960, version: "1", persist: { _ in true })
        controls.setFocused(true)
        controls.receive(minutes: 4710, version: "2")
        #expect(controls.dayValue == 3)
        controls.setFocused(false)
        #expect(controls.dayValue == 4)
        #expect(controls.timeValue == "06:30")
        controls.dayValue = 5
        controls.receive(minutes: 3960, version: "3")
        #expect(controls.dayValue == 5)
        await controls.save()
        #expect(controls.dayValue == 3)
    }
}
