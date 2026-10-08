import Foundation
import Testing
@testable import Draft_Zero

/// The inspector's logic: whose value a synced control shows (after
/// tests/server-synced.test.ts), the autosaving field built on it, the lore
/// scan port, and the readouts.
struct InspectorTests {
    private let v1 = "2026-09-01T00:00:01.000Z"
    private let v2 = "2026-09-01T00:00:02.000Z"
    private let v3 = "2026-09-01T00:00:03.000Z"
    private let v4 = "2026-09-01T00:00:04.000Z"

    /// A story row as the server holds it: a value, a version, and a log of saves.
    final class FakeRow<Value> {
        var value: Value
        var version: String
        var saves: [Value] = []
        var refusesSaves = false
        private var tick = 10

        init(_ value: Value, version: String) {
            self.value = value
            self.version = version
        }

        /// Takes a save and bumps the version, as `storyVersionBump` does.
        func save(_ next: Value) -> Bool {
            if refusesSaves { return false }
            saves.append(next)
            value = next
            tick += 1
            version = "2026-09-01T00:00:\(tick).000Z"
            return true
        }

        /// Another device writes the row.
        func foreignWrite(_ next: Value, version: String) {
            value = next
            self.version = version
        }
    }

    private func field<Value: Equatable>(
        _ row: FakeRow<Value>,
        onFailure: AutosavingField<Value>.OnFailure = .keepEdit
    ) -> AutosavingField<Value> {
        // A long pause: tests send edits with `flush`, never by waiting.
        AutosavingField(
            row.value,
            version: row.version,
            debounce: .seconds(60),
            onFailure: onFailure,
            read: { (row.value, row.version) },
            persist: { row.save($0) }
        )
    }

    // MARK: - ServerSyncedValue

    @Test func adoptsANewerVersionWhenIdle() {
        let synced = ServerSyncedValue("a", version: v1)
        synced.receive("b", version: v2)
        #expect(synced.value == "b")
        #expect(synced.server == "b")
        #expect(synced.version == v2)
    }

    @Test func turnsAwayAPayloadNoNewerThanTheOneShown() {
        let synced = ServerSyncedValue("a", version: v2)
        synced.receive("stale", version: v1)
        #expect(synced.value == "a")
        synced.receive("same version", version: v2)
        #expect(synced.value == "a")
    }

    @Test func aLateOlderPayloadCannotReplaceANewerOneStillWaiting() {
        let synced = ServerSyncedValue("a", version: v1)
        synced.hold(true)
        synced.receive("newest", version: v3)
        synced.receive("older", version: v2)
        synced.hold(false)
        #expect(synced.value == "newest")
        #expect(synced.version == v3)
    }

    @Test func holdsTheLocalValueUntilReleasedThenAdopts() {
        let synced = ServerSyncedValue("a", version: v1)
        synced.hold(true)
        synced.setLocal("typing")
        synced.receive("foreign", version: v2)
        #expect(synced.value == "typing")
        // Tracked through the hold, but the version stays owed to the release.
        #expect(synced.server == "foreign")
        #expect(synced.version == v1)
        synced.hold(false)
        #expect(synced.value == "foreign")
        #expect(synced.version == v2)
    }

    @Test func aReleaseBackOnTheOldValueStillCountsAsAChange() {
        let synced = ServerSyncedValue(0.9, version: v1)
        synced.hold(true)
        synced.setLocal(1.4)
        synced.receive(1.2, version: v2)
        synced.setLocal(0.9)
        // Where the thumb stopped differs from what the row now holds, so it is saved.
        #expect(synced.write(0.9))
        #expect(synced.inFlight == 1)
    }

    @Test func aWriteInFlightOutranksEveryPayloadUntilItSettles() {
        let synced = ServerSyncedValue("a", version: v1)
        #expect(synced.write("b"))
        // Rendered before the write landed: newer than v1, older than the write.
        synced.receive("a", version: v2)
        #expect(synced.value == "b")
        synced.receive("b", version: v3)
        synced.settle()
        #expect(synced.value == "b")
        #expect(synced.version == v3)
        #expect(synced.isIdle)
    }

    @Test func theFirstOfTwoWritesSettlingDoesNotHandControlBack() {
        let synced = ServerSyncedValue("off", version: v1)
        synced.write("low")
        synced.write("high")
        #expect(synced.inFlight == 2)
        synced.receive("low", version: v2)
        synced.settle()
        #expect(synced.value == "high")
        synced.receive("high", version: v3)
        synced.settle()
        #expect(synced.value == "high")
        #expect(synced.inFlight == 0)
    }

    @Test func aWriteOntoTheRowsValueIsNotCounted() {
        let synced = ServerSyncedValue(true, version: v1)
        #expect(!synced.write(true))
        #expect(synced.inFlight == 0)
        synced.settle()
        #expect(synced.inFlight == 0)
    }

    @Test func aRefusedWritePutsTheControlBackAndFollowsAgain() {
        let synced = ServerSyncedValue("sonnet", version: v1)
        synced.write("opus")
        synced.reset(to: "sonnet")
        #expect(synced.value == "sonnet")
        #expect(synced.isIdle)
        synced.receive("haiku", version: v2)
        #expect(synced.value == "haiku")
    }

    @Test func resettingTheServerAloneKeepsTheEditOnScreen() {
        let synced = ServerSyncedValue("old", version: v1)
        synced.hold(true)
        synced.write("typed")
        synced.resetServer(to: "old")
        #expect(synced.value == "typed")
        #expect(synced.server == "old")
    }

    // MARK: - AutosavingField

    @Test func editsWaitForThePauseThenSaveOnlyTheLatest() async {
        let row = FakeRow("", version: v1)
        let memory = field(row)
        memory.edit("W")
        memory.edit("Wren")
        #expect(row.saves.isEmpty)
        #expect(memory.hasPendingEdit)
        await memory.flush()
        #expect(row.saves == ["Wren"])
        #expect(memory.value == "Wren")
        // Its own echo is adopted, so it follows the server again.
        #expect(memory.sync.version == row.version)
        #expect(memory.sync.isIdle)
    }

    @Test func aFocusedFieldKeepsTheWritersTextWhenTheServerMoves() async {
        let row = FakeRow("Keep it atmospheric.", version: v1)
        let note = field(row)
        note.setFocused(true)
        note.edit("Keep it tense")
        row.foreignWrite("From the other device", version: v2)
        note.pull()
        #expect(note.value == "Keep it tense")
        await note.flush()
        #expect(row.saves == ["Keep it tense"])
        #expect(note.value == "Keep it tense")
    }

    @Test func focusingAndLeavingWithoutAnEditWritesNothingAndCatchesUp() async {
        let row = FakeRow("old", version: v1)
        let memory = field(row)
        memory.setFocused(true)
        row.foreignWrite("new", version: v2)
        memory.pull()
        #expect(memory.value == "old")
        memory.setFocused(false)
        await memory.flush()
        #expect(row.saves.isEmpty)
        #expect(memory.value == "new")
    }

    @Test func anIdleFieldFollowsTheServer() {
        let row = FakeRow("old", version: v1)
        let memory = field(row)
        row.foreignWrite("new", version: v2)
        memory.pull()
        #expect(memory.value == "new")
    }

    @Test func aRefusedTextSaveKeepsTheWordsUntilRetried() async {
        let row = FakeRow("old", version: v1)
        let memory = field(row, onFailure: .keepEdit)
        row.refusesSaves = true
        memory.edit("unsaved words")
        await memory.flush()
        #expect(memory.saveFailed)
        #expect(memory.value == "unsaved words")
        #expect(memory.sync.server == "old")
        // Unsaved text is held even though nothing is focused.
        row.foreignWrite("foreign", version: v2)
        memory.pull()
        #expect(memory.value == "unsaved words")
        row.refusesSaves = false
        await memory.flush()
        #expect(!memory.saveFailed)
        #expect(row.saves == ["unsaved words"])
        #expect(memory.value == "unsaved words")
    }

    @Test func discardingARefusedEditTakesTheServersValue() async {
        let row = FakeRow("old", version: v1)
        let memory = field(row, onFailure: .keepEdit)
        row.refusesSaves = true
        memory.edit("unsaved")
        await memory.flush()
        row.foreignWrite("foreign", version: v2)
        memory.pull()
        memory.discardEdit()
        #expect(memory.value == "foreign")
        #expect(!memory.saveFailed)
    }

    @Test func aRefusedSliderSaveSpringsBack() async {
        let row = FakeRow(0.9, version: v1)
        let temperature = field(row, onFailure: .revert)
        row.refusesSaves = true
        temperature.edit(1.3)
        await temperature.flush()
        #expect(temperature.value == 0.9)
        #expect(temperature.sync.isIdle)
        #expect(!temperature.saveFailed)
    }

    @Test func aSliderReleasedWhereItStartedSavesNothing() async {
        let row = FakeRow(0.9, version: v1)
        let temperature = field(row, onFailure: .revert)
        temperature.edit(1.3)
        temperature.edit(0.9)
        await temperature.flush()
        #expect(row.saves.isEmpty)
        #expect(temperature.sync.isIdle)
    }

    // MARK: - Lore scan

    private func passage(_ text: String, _ index: Int) -> StoryEntry {
        StoryEntry(
            id: "e\(index)", position: index, source: .generated, text: text, actionKind: nil, inputText: nil,
            variantGroupId: "g\(index)", variantIndex: 0, variantCount: 1, variantProfilesMixed: false,
            generation: nil, costUsd: nil, reasoningTokens: nil, callStatus: nil, createdAt: v1
        )
    }

    private func lore(
        _ id: String,
        keys: [String],
        content: String = "",
        priority: Int = 50,
        alwaysActive: Bool = false
    ) -> LorebookEntry {
        LorebookEntry(
            id: id, storyId: "s1", name: id.capitalized, category: .character, keys: keys, content: content,
            enabled: true, alwaysActive: alwaysActive, priority: priority, createdAt: v1, updatedAt: v1
        )
    }

    @Test func sourcesAreMemoryThenTheNoteThenRecentProseLowercased() {
        let sources = LoreScan.sources(memory: "You are WREN.", authorsNote: "Keep it Tense.", entries: [passage("The LANTERN gutters.", 0)])
        #expect(sources.map(\.id) == [.memory, .authorsNote, .story])
        #expect(sources.map(\.text) == ["you are wren.", "keep it tense.", "the lantern gutters."])
    }

    @Test func recentTextReadsTheLastFourPassagesJoinedByBlankLines() {
        let entries = (1...6).map { passage("Passage \($0)", $0) }
        #expect(LoreScan.recentStoryText(entries) == "passage 3\n\npassage 4\n\npassage 5\n\npassage 6")
        #expect(LoreScan.recentStoryText([]) == "")
    }

    @Test func recentTextKeepsOnlyTheFinalFourThousandUnits() {
        let long = String(repeating: "a", count: 5000) + "ZEPHYR"
        let text = LoreScan.recentStoryText([passage(long, 0)])
        #expect(text.utf16.count == 4000)
        #expect(text.hasSuffix("zephyr"))
        // Counted in UTF-16 as JavaScript counts it: each emoji is two units.
        let emoji = String(repeating: "🌊", count: 2100)
        #expect(LoreScan.recentStoryText([passage(emoji, 0)]).utf16.count == 4000)
    }

    @Test func memoryIsCreditedBeforeProseAndHoldsItsEntriesSteady() throws {
        let story = try storyFixture(memory: "You are Wren.", note: "", passages: ["Wren lights the lantern."])
        let matches = LoreScan.activeEntries(
            in: [
                lore("wren", keys: ["wren"], content: "Keeper of the Sundering light."),
                lore("lantern", keys: ["lantern"]),
                lore("sundering", keys: ["sundering"], priority: 10),
                lore("absent", keys: ["kraken"]),
            ],
            story: story
        )
        let byId = Dictionary(uniqueKeysWithValues: matches.map { ($0.id, $0) })
        #expect(byId["wren"]?.triggeredBy == .source(.memory))
        #expect(byId["wren"]?.stable == true)
        #expect(byId["lantern"]?.triggeredBy == .source(.story))
        #expect(byId["lantern"]?.stable == false)
        #expect(byId["sundering"]?.depth == 1)
        #expect(byId["sundering"]?.triggeredBy == .lore(id: "wren", name: "Wren"))
        #expect(byId["sundering"]?.stable == true)
        #expect(byId["absent"] == nil)
    }

    private func storyFixture(memory: String, note: String, passages: [String]) throws -> Story {
        var story = try FixtureLoader.decode(WorkspacePayload.self, from: "workspace.json").story
        story.memory = memory
        story.authorsNote = note
        story.entries = passages.enumerated().map { passage($0.element, $0.offset) }
        return story
    }

    // MARK: - Readouts

    @Test func approximateTokensReadAsTheWebPrintsThem() {
        #expect(InspectorText.approxTokens(812) == "812")
        #expect(InspectorText.approxTokens(1234) == "1.2k")
        #expect(InspectorText.approxTokens(9999) == "10.0k")
        #expect(InspectorText.approxTokens(24_000) == "24k")
    }

    @Test func theRecapSaysWhetherItIsPausedEmptyOrHowLong() {
        #expect(InspectorText.recapStatus(summarize: false, summary: "Long ago…") == "Paused")
        #expect(InspectorText.recapStatus(summarize: true, summary: "  \n") == "Not needed yet")
        #expect(InspectorText.recapStatus(summarize: true, summary: " Wren  lit\nthe lamp. ") == "4 words")
        #expect(InspectorText.recapStatus(summarize: true, summary: "Alone") == "1 word")
    }

    @Test func onlyANonBlankNarratorPromptIsAnOverride() {
        #expect(!NarratorPrompt.isOverride(nil))
        #expect(!NarratorPrompt.isOverride(""))
        #expect(!NarratorPrompt.isOverride("  \n\t"))
        #expect(NarratorPrompt.isOverride("Write in verse."))
        #expect(NarratorPrompt.builtIn.hasPrefix("you are capable and well-practiced"))
    }

    @Test func loreRowsSayHowAnEntryArrived() throws {
        let direct = LoreMatcher.Match(entry: lore("wren", keys: ["wren"]), matchedKey: "wren", depth: 0, triggeredBy: .source(.memory), stable: true)
        #expect(InspectorText.loreArrival(direct) == "via Memory · matched “wren”")
        #expect(InspectorText.loreRank(direct) == "Priority 50")
        let always = LoreMatcher.Match(entry: lore("sea", keys: []), matchedKey: nil, depth: 0, triggeredBy: nil, stable: true)
        #expect(InspectorText.loreArrival(always) == "Always on")
        let cascade = LoreMatcher.Match(entry: lore("king", keys: ["king"], priority: 70), matchedKey: "king", depth: 2, triggeredBy: .lore(id: "war", name: "The War"), stable: false)
        #expect(InspectorText.loreArrival(cascade) == "via The War · matched “king”")
        #expect(InspectorText.loreRank(cascade) == "Priority 70 · 2 hops away")
    }
}
