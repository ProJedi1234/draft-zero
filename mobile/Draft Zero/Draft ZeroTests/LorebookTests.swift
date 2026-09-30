import Foundation
import Testing
@testable import Draft_Zero

private func entry(
    _ id: String,
    name: String,
    category: LorebookCategory = .character,
    keys: [String] = [],
    content: String = "",
    enabled: Bool = true,
    alwaysActive: Bool = false,
    priority: Int = 50,
    updatedAt: String = "2026-09-01T00:00:00.000Z"
) -> LorebookEntry {
    LorebookEntry(
        id: id, storyId: "story", name: name, category: category, keys: keys, content: content,
        enabled: enabled, alwaysActive: alwaysActive, priority: priority,
        createdAt: "2026-09-01T00:00:00.000Z", updatedAt: updatedAt
    )
}

struct LorebookLedgerTests {
    @Test func upsertKeepsTheNewestVersion() {
        var ledger = LorebookLedger()
        let first = ledger.upsert(entry("a", name: "Wren", updatedAt: "2026-09-02T00:00:00.000Z"))
        let older = ledger.upsert(entry("a", name: "Older", updatedAt: "2026-09-01T00:00:00.000Z"))
        let sameClock = ledger.upsert(entry("a", name: "Same clock", updatedAt: "2026-09-02T00:00:00.000Z"))
        #expect(first && !older && !sameClock)
        #expect(ledger.entry("a")?.name == "Wren")
        let newer = ledger.upsert(entry("a", name: "Newer", updatedAt: "2026-09-03T00:00:00.000Z"))
        #expect(newer)
        #expect(ledger.entry("a")?.name == "Newer")
    }

    @Test func tombstoneOutranksOlderUpserts() {
        var ledger = LorebookLedger()
        ledger.upsert(entry("a", name: "Wren", updatedAt: "2026-09-02T00:00:00.000Z"))
        ledger.delete("a", version: "2026-09-03T00:00:00.000Z")
        #expect(ledger.entry("a") == nil)
        let lateEcho = ledger.upsert(entry("a", name: "Late echo", updatedAt: "2026-09-02T12:00:00.000Z"))
        #expect(!lateEcho)
        let recreated = ledger.upsert(entry("a", name: "Recreated", updatedAt: "2026-09-04T00:00:00.000Z"))
        #expect(recreated)
    }

    @Test func pendingDeleteBuriesEverythingUntilCancelled() {
        var ledger = LorebookLedger()
        let original = entry("a", name: "Wren")
        ledger.upsert(original)
        let removed = ledger.beginDelete("a")
        #expect(removed == original)
        let inFlight = ledger.upsert(entry("a", name: "In flight", updatedAt: "2099-01-01T00:00:00.000Z"))
        #expect(!inFlight)
        ledger.cancelDelete("a", restoring: removed)
        #expect(ledger.entry("a") == original)
    }

    @Test func snapshotSweepsOnlyRowsItCouldHaveSeen() {
        var ledger = LorebookLedger()
        ledger.upsert(entry("a", name: "Old"))
        ledger.upsert(entry("b", name: "Gone"))
        let issuedAt = ledger.ingestSeq
        // Learned while the read was in flight: the read's silence proves nothing.
        ledger.upsert(entry("c", name: "Fresh"))
        let swept = ledger.applySnapshot([entry("a", name: "Old")], issuedAt: issuedAt)
        #expect(swept == ["b"])
        #expect(ledger.ids == ["a", "c"])
    }

    @Test func snapshotAdoptsEqualVersionsButNotOlderOnes() {
        var ledger = LorebookLedger()
        ledger.upsert(entry("a", name: "Reply", updatedAt: "2026-09-05T00:00:00.000Z"))
        ledger.applySnapshot([entry("a", name: "Stale read", updatedAt: "2026-09-04T00:00:00.000Z")], issuedAt: 0)
        #expect(ledger.entry("a")?.name == "Reply")
        ledger.applySnapshot([entry("a", name: "Same clock", updatedAt: "2026-09-05T00:00:00.000Z")], issuedAt: ledger.ingestSeq)
        #expect(ledger.entry("a")?.name == "Same clock")
    }
}

struct LorebookListingTests {
    private let entries = [
        entry("1", name: "saltmere", category: .location, keys: ["island"], content: "Slate roofs."),
        entry("2", name: "Wren", keys: ["keeper"], content: "A wiry keeper."),
        entry("3", name: "Ångström", category: .concept, content: "Units of light."),
        entry("4", name: "Captain Vane", keys: ["the captain"], content: "Smuggler."),
    ]

    @Test func sortsByNameIgnoringCase() {
        #expect(LorebookListing.sorted(entries) == ["3", "4", "1", "2"])
    }

    @Test func holdsOrderWhileTheSetIsUnchanged() {
        let frozen = ["2", "1", "3", "4"]
        var renamed = entries
        renamed[1].name = "Aaron"
        #expect(LorebookListing.stableOrder(previous: frozen, entries: renamed) == frozen)
        let grown = renamed + [entry("5", name: "Beacon")]
        #expect(LorebookListing.stableOrder(previous: frozen, entries: grown) == ["2", "3", "5", "4", "1"])
    }

    @Test func searchCoversNameKeysAndContentWithoutCaseOrDiacritics() {
        #expect(LorebookListing.visible(entries, filter: .all, query: "SALT").map(\.id) == ["1"])
        #expect(LorebookListing.visible(entries, filter: .all, query: "keeper").map(\.id) == ["2"])
        #expect(LorebookListing.visible(entries, filter: .all, query: "smuggler").map(\.id) == ["4"])
        #expect(LorebookListing.visible(entries, filter: .all, query: "angstrom").map(\.id) == ["3"])
        #expect(LorebookListing.visible(entries, filter: .all, query: "  ").count == 4)
    }

    @Test func filtersByCategoryAndGroupsInCategoryOrder() {
        #expect(LorebookListing.visible(entries, filter: .category(.character), query: "").map(\.id) == ["2", "4"])
        let sections = LorebookListing.sections(entries)
        #expect(sections.map(\.category) == [.character, .location, .concept])
        #expect(sections[0].entries.map(\.id) == ["2", "4"])
    }

    @Test func selectionPassesToTheNextThenThePreviousEntry() {
        let order = ["a", "b", "c"]
        #expect(LorebookListing.nextSelection(previousOrder: order, alive: ["a", "c"], gone: "b") == "c")
        #expect(LorebookListing.nextSelection(previousOrder: order, alive: ["a", "b"], gone: "c") == "b")
        #expect(LorebookListing.nextSelection(previousOrder: order, alive: [], gone: "a") == nil)
    }
}

struct LorebookKeysTests {
    @Test func addsTrimmedCommaSeparatedKeysWithoutDuplicates() {
        #expect(LorebookKeys.adding(" wren , keeper,, ", to: []) == ["wren", "keeper"])
        #expect(LorebookKeys.adding("Wren", to: ["wren"]) == ["wren"])
        #expect(LorebookKeys.adding("lantern, LANTERN", to: []) == ["lantern"])
    }

    @Test func splitsTypingAtTheLastComma() {
        let split = LorebookKeys.splitAtLastComma("wren, keeper, lan")
        #expect(split?.committed == "wren, keeper")
        #expect(split?.remainder == " lan")
        #expect(LorebookKeys.splitAtLastComma("wren") == nil)
    }
}

struct LorebookFieldTests {
    @Test func patchCarriesOnlyTheGivenFieldsWithATrimmedName() {
        let draft = NewLorebookEntry(name: "  Wren ", category: .character, keys: ["wren"], content: "x", priority: 70)
        let patch = LorebookField.patch([.name, .priority], from: draft)
        #expect(patch == ["name": .string("Wren"), "priority": .number(70)])
    }

    @Test func mergeReportDropsTheSkipLineTheCountsAlreadySay() {
        let summary = ImportSummary(
            storyId: "s", title: nil, lorebookEntryCount: 3, passageCount: nil, skippedCount: 2,
            warnings: ["Card 4 had no keys.", LorebookMergeReport.skipWarning(2)]
        )
        let report = LorebookMergeReport(summary)
        #expect(report.added == 3)
        #expect(report.skipped == 2)
        #expect(report.warnings == ["Card 4 had no keys."])
        #expect(report.headline == "Added 3 Entries")
    }
}

/// Answers PATCHes with the patched row at a later clock, and records them.
@MainActor
private final class FakeLoreServer {
    var row: LorebookEntry
    var patches: [JSONObject] = []
    var failNext = false
    private var clock = 10

    init(_ row: LorebookEntry) {
        self.row = row
    }

    func write(_ id: String, _ patch: JSONObject) async throws -> LorebookEntry {
        patches.append(patch)
        if failNext {
            failNext = false
            throw APIError.transport("Offline.")
        }
        if case .string(let name)? = patch["name"] { row.name = name }
        if case .string(let content)? = patch["content"] { row.content = content }
        if case .bool(let enabled)? = patch["enabled"] { row.enabled = enabled }
        if case .number(let priority)? = patch["priority"] { row.priority = Int(priority) }
        clock += 1
        row.updatedAt = "2026-09-\(clock)T00:00:00.000Z"
        return row
    }
}

@MainActor
struct LorebookEntryEditorTests {
    @Test func remoteChangesSkipDirtyFields() {
        let original = entry("a", name: "Wren", content: "Keeper.", priority: 50)
        let editor = LorebookEntryEditor(entry: original) { _, _ in original }
        editor.draft.content = "Keeper of the Lantern, mid-sente"
        var remote = original
        remote.content = "Another device's text."
        remote.priority = 90
        remote.updatedAt = "2026-09-02T00:00:00.000Z"
        editor.adopt(remote)
        #expect(editor.draft.content == "Keeper of the Lantern, mid-sente")
        #expect(editor.draft.priority == 90)
        #expect(editor.dirty == [.content])
        editor.cancel()
    }

    @Test func remoteRowsOnlyMoveFieldsTheyChanged() {
        let original = entry("a", name: "Wren")
        let editor = LorebookEntryEditor(entry: original) { _, _ in original }
        // A trailing space the server would trim must survive an unrelated remote change.
        editor.draft.name = "Wren "
        editor.cancel()
        var remote = original
        remote.enabled = false
        remote.updatedAt = "2026-09-02T00:00:00.000Z"
        editor.adopt(remote)
        #expect(editor.draft.name == "Wren ")
        #expect(editor.draft.enabled == false)
    }

    @Test func saveSendsOnlyTouchedFieldsAndCleansThem() async {
        let server = FakeLoreServer(entry("a", name: "Wren", content: "Keeper."))
        let editor = LorebookEntryEditor(entry: server.row, write: server.write)
        editor.draft.content = "Keeper of the Lantern."
        await editor.save()
        #expect(server.patches == [["content": .string("Keeper of the Lantern.")]])
        #expect(editor.dirty.isEmpty)
        #expect(editor.saveState == .saved)
        #expect(editor.base.content == "Keeper of the Lantern.")
    }

    @Test func blankNameIsNeverSent() async {
        let server = FakeLoreServer(entry("a", name: "Wren"))
        let editor = LorebookEntryEditor(entry: server.row, write: server.write)
        editor.draft.name = "  "
        editor.draft.priority = 70
        await editor.save()
        #expect(server.patches == [["priority": .number(70)]])
        #expect(editor.nameError != nil)
        editor.discardBlankName()
        #expect(editor.draft.name == "Wren")
        #expect(editor.isSettled)
    }

    @Test func failedSaveRollsBackSwitchesButKeepsText() async {
        let server = FakeLoreServer(entry("a", name: "Wren", content: "Keeper."))
        let editor = LorebookEntryEditor(entry: server.row, write: server.write)
        var reverted = false
        editor.onRevert = { _ in reverted = true }
        server.failNext = true
        editor.draft.enabled = false
        editor.draft.content = "Unsaved words."
        await editor.save()
        #expect(reverted)
        #expect(editor.draft.enabled == true)
        #expect(editor.draft.content == "Unsaved words.")
        #expect(editor.saveState == .failed("Offline."))
        await editor.save()
        #expect(editor.saveState == .saved)
        #expect(server.row.content == "Unsaved words.")
    }
}

@MainActor
struct LorebookModelTests {
    private func makeModel() -> LorebookModel {
        LorebookModel(
            storyId: "story",
            api: APIClient(baseURL: URL(filePath: "/dev/null"), origin: "me"),
            sync: SyncChannel(),
            notices: NoticeCenter()
        )
    }

    private func event(_ json: String) throws -> SyncWireEvent {
        try JSONDecoder().decode(SyncWireEvent.self, from: Data(json.utf8))
    }

    @Test func entityEventsFoldInByVersionAndDeletesRemove() throws {
        let model = makeModel()
        model.applySnapshot([entry("a", name: "Wren"), entry("b", name: "Lantern", category: .item)], issuedAt: 0)
        #expect(model.entries.map(\.name) == ["Lantern", "Wren"])

        let upsert = """
        {"type":"entity","op":"upsert","entity":"lorebook-entry","id":"a","storyId":"story",
         "version":"2026-09-09T00:00:00.000Z","origin":"other",
         "data":{"id":"a","storyId":"story","name":"Wren","category":"character","keys":["wren"],
                 "content":"Changed elsewhere.","enabled":true,"alwaysActive":false,"priority":80,
                 "createdAt":"2026-09-01T00:00:00.000Z","updatedAt":"2026-09-09T00:00:00.000Z"}}
        """
        model.handle(try event(upsert))
        #expect(model.displayed("a")?.content == "Changed elsewhere.")

        let stale = upsert.replacing("Changed elsewhere.", with: "Stale").replacing("2026-09-09", with: "2026-09-05")
        model.handle(try event(stale))
        #expect(model.displayed("a")?.content == "Changed elsewhere.")

        let otherStory = upsert.replacing("\"storyId\":\"story\"", with: "\"storyId\":\"elsewhere\"").replacing("\"id\":\"a\"", with: "\"id\":\"z\"")
        model.handle(try event(otherStory))
        #expect(model.displayed("z") == nil)

        model.handle(try event("""
        {"type":"entity","op":"delete","entity":"lorebook-entry","id":"b","storyId":"story","version":"2026-09-10T00:00:00.000Z","origin":"other"}
        """))
        #expect(model.entries.map(\.id) == ["a"])
    }

    @Test func openDraftsOverlayTheListAndSurviveRemoteEdits() throws {
        let model = makeModel()
        model.applySnapshot([entry("a", name: "Wren", content: "Keeper.")], issuedAt: 0)
        model.selectedId = "a"
        model.editors["a"]?.draft.content = "Typing here"
        #expect(model.displayed("a")?.content == "Typing here")

        var remote = entry("a", name: "Wren the Keeper", content: "Remote text.")
        remote.updatedAt = "2026-09-09T00:00:00.000Z"
        model.applySnapshot([remote], issuedAt: model.ledger.ingestSeq)
        #expect(model.displayed("a")?.content == "Typing here")
        #expect(model.displayed("a")?.name == "Wren the Keeper")
        model.editors["a"]?.cancel()
    }

    @Test func filterAndSearchNarrowTheSections() {
        let model = makeModel()
        model.applySnapshot([
            entry("a", name: "Wren", keys: ["keeper"]),
            entry("b", name: "Lantern", category: .item, content: "Never goes out."),
            entry("c", name: "Saltmere", category: .location),
        ], issuedAt: 0)
        #expect(model.sections.map(\.category) == [.character, .location, .item])
        model.filter = .category(.item)
        #expect(model.visibleEntries.map(\.id) == ["b"])
        #expect(model.newEntryCategory == .item)
        model.filter = .all
        model.query = "KEEPER"
        #expect(model.visibleEntries.map(\.id) == ["a"])
        #expect(model.count(.category(.location)) == 1)
    }

    @Test func cascadeListsEntriesWhoseKeysTheContentNames() {
        let model = makeModel()
        model.applySnapshot([
            entry("a", name: "Wren", keys: ["wren"], content: "She tends the Lantern on Saltmere."),
            entry("b", name: "Lantern", category: .item, keys: ["lantern"]),
            entry("c", name: "Saltmere", category: .location, keys: ["saltmere"], enabled: false),
            entry("d", name: "Tone", category: .concept, alwaysActive: true),
        ], issuedAt: 0)
        #expect(model.cascade(from: "a").map(\.id) == ["b"])
    }
}
