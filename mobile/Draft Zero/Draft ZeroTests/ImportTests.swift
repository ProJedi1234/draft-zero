import Foundation
import Testing
@testable import Draft_Zero

struct ScenarioPlaceholderTests {
    @Test func parsesEveryPartOfTheFullForm() throws {
        let placeholder = try #require(ScenarioPlaceholders.parseBody("1#name[Ash]Your name:What the village calls you"))
        #expect(placeholder == ScenarioPlaceholder(
            id: "name", order: 1, defaultValue: "Ash", title: "Your name", description: "What the village calls you"
        ))
    }

    @Test func aBareIdIsLegal() throws {
        let placeholder = try #require(ScenarioPlaceholders.parseBody("name"))
        #expect(placeholder.id == "name")
        #expect(placeholder.order == Int.max)
        #expect(placeholder.defaultValue.isEmpty)
        #expect(placeholder.title.isEmpty)
    }

    @Test func noIdIsNoPlaceholder() {
        #expect(ScenarioPlaceholders.parseBody("") == nil)
        #expect(ScenarioPlaceholders.parseBody("2#[Ash]Name") == nil)
        #expect(ScenarioPlaceholders.parseBody("  :just a description") == nil)
    }

    @Test func anUnclosedDefaultStaysInTheTitle() throws {
        let placeholder = try #require(ScenarioPlaceholders.parseBody("name[Ash"))
        #expect(placeholder.defaultValue.isEmpty)
        #expect(placeholder.title == "[Ash")
    }

    @Test func occurrencesSkipBracesThatNest() {
        let found = ScenarioPlaceholders.occurrences(in: "a ${x{y} b %{toc} c ${ok} $plain {not}")
        #expect(found.map(\.body) == ["toc", "ok"])
        #expect(found.map(\.sigil) == ["%", "$"])
    }

    @Test func laterDeclarationsFillInMissingMetadata() {
        let placeholders = ScenarioPlaceholders.collect([
            "You are ${name}.",
            "%{2#town[Decsos]Home town}\n%{1#name[Ash]Your name:First name only}",
            "${zeta} and ${alpha}",
        ])
        #expect(placeholders.map(\.id) == ["name", "town", "alpha", "zeta"])
        #expect(placeholders[0].defaultValue == "Ash")
        #expect(placeholders[0].title == "Your name")
        #expect(placeholders[0].description == "First name only")
        #expect(placeholders[0].order == 1)
    }

    @Test func fillUsesValuesThenDefaults() {
        let text = "${1#name[Ash]Name} walks to ${town[Decsos]}."
        #expect(ScenarioPlaceholders.fill(text, values: ["name": "Wren"]) == "Wren walks to Decsos.")
        #expect(ScenarioPlaceholders.fill(text, values: ["name": ""]) == "Ash walks to Decsos.")
    }

    @Test func fillDropsTheTableOfContentsAndItsBlankLines() {
        let text = "%{1#name[Ash]Name}\n\nYou are ${name}."
        #expect(ScenarioPlaceholders.fill(text, values: ["name": "Wren"]) == "You are Wren.")
        // A bare reference falls back to its own default, not the declaration's, as on the server.
        #expect(ScenarioPlaceholders.fill(text, values: [:]) == "You are .")
    }
}

struct ScenarioReaderTests {
    private func parsed(_ json: String) throws -> ScenarioPreview {
        try ScenarioReader.parse(json).get()
    }

    @Test func readsTheFieldsAPreviewShows() throws {
        let preview = try parsed("""
        {
          "scenarioVersion": 3,
          "title": "The Kingdom of ${kingdom[Yalann]}",
          "author": "Mira",
          "description": "  A gnomish town.  ",
          "prompt": "You wake in ${1#town[Decsos]Town:Where you begin}.\\nThe bells ring.",
          "context": [{"text": "Memory text"}, {"text": "Close third person."}],
          "tags": ["fantasy"],
          "attg": {"tags": ["fantasy", "intrigue"], "genre": ["Low fantasy"]},
          "lorebook": {"entries": [{"displayName": "Decsos", "text": "A town.", "keys": ["decsos"]}]}
        }
        """)
        #expect(preview.title == "The Kingdom of ${kingdom[Yalann]}")
        #expect(preview.author == "Mira")
        #expect(preview.description == "A gnomish town.")
        #expect(preview.prompt == "You wake in ${1#town[Decsos]Town:Where you begin}.\n\nThe bells ring.")
        #expect(preview.memory == "Memory text")
        #expect(preview.authorsNote == "Close third person.")
        #expect(preview.tags == ["fantasy", "intrigue"])
        #expect(preview.genre == "Low fantasy")
        #expect(preview.lorebookEntries.count == 1)
        #expect(preview.placeholders.map(\.id) == ["town", "kingdom"])
        #expect(preview.placeholders.map(\.defaultValue) == ["Decsos", "Yalann"])
        #expect(preview.warnings.isEmpty)
    }

    @Test func legacyFlatFieldsAndFallbacks() throws {
        let preview = try parsed(#"{"prompt": "Hi", "memory": "Old memory", "authors_note": "Old note"}"#)
        #expect(preview.title == "Imported scenario")
        #expect(preview.memory == "Old memory")
        #expect(preview.authorsNote == "Old note")
    }

    @Test func folderNamesMapToCategories() {
        let cases: [(String, LorebookCategory)] = [
            ("Characters", .character), ("Places", .location), ("Factions", .faction), ("Items", .item),
            ("Events", .event), ("Magic", .concept), ("Classes", .class), ("Archetypes", .class),
            ("Object Classes", .item), ("Professions & Guilds", .faction), ("Character Classes", .character),
            ("Classified Documents", .concept), ("Blorbo", .concept),
        ]
        for (folder, category) in cases {
            #expect(ScenarioReader.category(forFolder: folder) == category, "\(folder)")
        }
    }

    @Test func lorebookWarningsSaySkippedAndLoweredKeys() throws {
        let preview = try parsed("""
        {"prompt": "x", "lorebook": {"entries": [
          {"displayName": "Elf", "text": "Tall.", "keys": ["/elv(en)?\\\\./i"]},
          {"displayName": "Blank", "text": ""}
        ]}}
        """)
        #expect(preview.lorebookEntries.map(\.keys) == [["elv(en)?."]])
        #expect(preview.warnings == [
            "Skipped 1 empty lorebook entry.",
            "Regex lorebook keys were converted to plain text — matching is substring-only here.",
        ])
    }

    @Test func droppedFeaturesAreReportedInOrder() throws {
        let preview = try parsed("""
        {"prompt": "x", "scenarioVersion": 5, "settings": {"model": "kayra"},
         "userScripts": [{}], "ephemeralContext": [{}]}
        """)
        #expect(preview.warnings == [
            "This scenario is version 5; fields newer than version 4 were ignored.",
            "Kept temperature and top-p only — NovelAI's model and repetition penalties have no OpenRouter equivalent.",
            "User scripts were not imported.",
            "Ephemeral context entries were not imported.",
        ])
    }

    @Test func rejectionsSayWhetherTheFileWasOurs() {
        #expect(ScenarioReader.parse("  ") == .failure(ImportParseError(recognised: false, message: "The file is empty.")))
        #expect(ScenarioReader.parse("{ nope") == .failure(ImportParseError(recognised: false, message: "That file isn't valid JSON.")))
        guard case .failure(let cards) = ScenarioReader.parse(#"[{"keys": "Somara", "value": "A town."}]"#) else {
            Issue.record("A card array must not parse as a scenario")
            return
        }
        #expect(!cards.recognised)
        guard case .failure(let marked) = ScenarioReader.parse(#"{"scenarioVersion": 3, "lorebook": {}}"#) else {
            Issue.record("A promptless scenario must not parse")
            return
        }
        #expect(marked.recognised)
    }
}

struct StoryCardsReaderTests {
    private func parsed(_ json: String) throws -> StoryCardsPreview {
        try StoryCardsReader.parse(json).get()
    }

    private func sample() throws -> StoryCardsPreview {
        try parsed(String(decoding: FixtureLoader.data("aidungeon-cards.json"), as: UTF8.self))
    }

    @Test func theSampleExportLandsWhole() throws {
        let preview = try sample()
        #expect(preview.lorebookEntries.count == 25)
        #expect(preview.settingEntries.count == 1)
        #expect(preview.title == "Xaxas")
        #expect(preview.warnings.isEmpty)
        #expect(preview.worldDescription.hasPrefix("Xaxas is a world of peace"))
        #expect(ImportDigest.categoryBreakdown(preview.lorebookEntries) == [
            "6 Characters", "8 Classes", "8 Locations", "3 Factions",
        ])
        let elf = preview.lorebookEntries.first { $0.name == "Elf" }
        #expect(elf?.keys == ["elf", "elv"])
        let uruk = preview.lorebookEntries.first { $0.name == "Uruk" }
        #expect(uruk?.content.hasPrefix("Uruk is a town in the empire") == true)
    }

    @Test func aScenarioWrapperCarriesItsFields() throws {
        let preview = try parsed("""
        {"title": "The Kingdom of Yalann", "description": "A town.", "prompt": "You wake.\\nBells.",
         "memory": "Taxes.", "authorsNote": "Close third.", "tags": ["fantasy", "fantasy"],
         "storyCards": [], "cards": [{"title": "Decsos", "keys": "decsos", "value": "A town.", "type": "location"}]}
        """)
        #expect(preview.title == "The Kingdom of Yalann")
        #expect(preview.prompt == "You wake.\n\nBells.")
        #expect(preview.tags == ["fantasy"])
        #expect(preview.lorebookEntries.map(\.category) == [.location])
    }

    @Test func partialCardsAreNamedAndReported() throws {
        let untitled = try parsed(#"[{"keys": "Somara, somara", "value": "A town.", "type": "location"}]"#)
        #expect(untitled.lorebookEntries.first?.name == "Somara")
        #expect(untitled.lorebookEntries.first?.keys == ["Somara"])
        #expect(untitled.warnings == ["1 card had no title — named after its first trigger word."])

        let keyless = try parsed(#"[{"title": "Somara", "value": "A town.", "type": "location"}]"#)
        #expect(keyless.lorebookEntries.first?.keys == ["Somara"])
        #expect(keyless.warnings == ["1 card had no trigger words — its title is the trigger instead."])

        let bare = try parsed(#"[{"keys": ",,,", "value": "A rumour."}]"#)
        #expect(bare.lorebookEntries.first?.name == "Untitled entry")
        #expect(bare.warnings == [
            "1 card has no title and no trigger words — it won't reach a generation until you give it one.",
        ])
    }

    @Test func typesAreFoldedGuessedOrReported() throws {
        let preview = try parsed("""
        [{"title": "A", "keys": "a", "value": "x", "type": "Major Character"},
         {"title": "B", "keys": "b", "value": "x", "type": "Blorbo"},
         {"title": "C", "keys": "c", "value": "x", "type": "World Description"},
         {"title": "D", "keys": "d", "value": "x", "type": "__proto__"},
         {"title": "a", "keys": "e", "value": "x", "type": "Object"}]
        """)
        #expect(preview.lorebookEntries.map(\.category) == [.character, .concept, .concept, .item])
        #expect(preview.settingEntries.map(\.name) == ["C"])
        #expect(preview.warnings == [
            "Filed by name: Major Character → Character.",
            "Unrecognised card types (Blorbo, __proto__) became Concepts.",
            "Duplicate card title (a) was imported as separate entries.",
        ])
    }

    @Test func arrayKeysAreSplitToo() {
        #expect(StoryCardsReader.readKeys(.array(["elf, elv", "Elven", "ELF"])) == ["elf", "elv", "Elven"])
    }

    @Test func rejections() {
        #expect(StoryCardsReader.parse("[]") == .failure(ImportParseError(recognised: true, message: "That file has no story cards in it.")))
        #expect(StoryCardsReader.parse(#"[{"title": "Empty"}]"#) == .failure(ImportParseError(
            recognised: true, message: "None of the story cards in that file have any text."
        )))
        guard case .failure(let scenario) = StoryCardsReader.parse(#"{"prompt": "You wake."}"#) else {
            Issue.record("A scenario must not parse as cards")
            return
        }
        #expect(!scenario.recognised)
    }
}

struct BackupReaderTests {
    @Test func theSampleArchiveReads() throws {
        let preview = try BackupReader.parse(FixtureLoader.data("aidungeon-backup.zip")).get()
        #expect(preview.title == "Modern Fantasy (World Scenario): Zach")
        #expect(preview.tags.count == 10)
        #expect(preview.tags.first == "fantasy")
        #expect(preview.authorsNote.hasPrefix("Writing style: Elegant, dramatic, vivid prose."))
        #expect(preview.lorebookEntries.count == 56)
        #expect(preview.settingEntries.isEmpty)
        #expect(preview.worldDescription.isEmpty)
        #expect(preview.passageCount == 2)
        #expect(preview.turnCount == 0)
        #expect(preview.memory.contains("Name: Zach\nGender: male"))
        #expect(preview.warnings.isEmpty)
    }

    @Test func actionsLandAsPassagesAndTurns() throws {
        let data = StoredZipBuilder.backup(parts: [("actions-001.json", """
        [{"type": "start", "text": "It begins."},
         {"type": "do", "text": "> You open the door."},
         {"type": "say", "text": "> You say \\"Run.\\""},
         {"type": "continue", "text": "The hall is dark."},
         {"type": "see", "text": "a door"},
         {"type": "continue", "text": "   "},
         {"type": "gamble", "text": "You bet it all."},
         {"type": "do", "text": ">"}]
        """)])
        let preview = try BackupReader.parse(data).get()
        #expect(preview.passageCount == 6)
        #expect(preview.turnCount == 2)
        #expect(preview.warnings == [
            "Dropped 1 image — a backup carries the prompt but not the picture.",
            "Skipped 1 empty action.",
            "Unrecognised action type (gamble) was imported as narration.",
        ])
    }

    @Test func partsAreReadInNumericOrderAndGapsReported() throws {
        let data = StoredZipBuilder.backup(
            metadata: #"{"adventure":{"title":"Zach"},"state":{"memories":[1,2]},"totalParts":3,"totalActionCount":5}"#,
            parts: [
                ("backup/actions-10.json", #"[{"type":"story","text":"ten"}]"#),
                ("backup/actions-2.json", #"[{"type":"story","text":"two"}]"#),
            ]
        )
        #expect(BackupReader.actionParts(["actions-10.json", "a/actions-2.json", "actions-x.json"]) == [
            "a/actions-2.json", "actions-10.json",
        ])
        let preview = try BackupReader.parse(data).get()
        #expect(preview.passageCount == 2)
        #expect(preview.warnings == [
            "This backup says it has 3 action files but only 2 are in the zip.",
            "This backup says it has 5 actions but 2 arrived.",
            "Dropped 2 AI Dungeon memories — there's nothing here that remembers the way that store does.",
        ])
    }

    @Test func instructionsReplaceTheNarrator() throws {
        let data = StoredZipBuilder.backup(
            metadata: #"{"adventure":{"title":"Zach"},"state":{"instructions":{"scenario":"Be terse."}}}"#,
            parts: [("actions-1.json", #"[{"type":"story","text":"One."}]"#)]
        )
        let preview = try BackupReader.parse(data).get()
        #expect(preview.instructions == "Be terse.")
        #expect(ImportDigest.narrator(preview.instructions) == "Replaced · 2 words")
        #expect(preview.warnings.last == "The adventure's AI instructions replace the built-in narrator prompt — edit it under Narrator.")
    }

    @Test func foreignAndBrokenArchives() {
        let foreign = StoredZipBuilder.zip([("readme.txt", "hello")])
        guard case .failure(let notOurs) = BackupReader.parse(foreign) else {
            Issue.record("A zip with no metadata must not parse")
            return
        }
        #expect(!notOurs.recognised)
        #expect(notOurs.message.contains("metadata.json"))

        let broken = StoredZipBuilder.zip([("metadata.json", "{ nope")])
        #expect(BackupReader.parse(broken) == .failure(ImportParseError(
            recognised: true, message: "That backup's metadata.json isn't valid JSON."
        )))

        let empty = StoredZipBuilder.backup(parts: [])
        #expect(BackupReader.parse(empty) == .failure(ImportParseError(
            recognised: true, message: "That backup has no story and no story cards in it."
        )))

        #expect(BackupReader.parse(Data("PK\u{3}\u{4}garbage".utf8)) == .failure(ImportParseError(
            recognised: false, message: "That file isn't a zip archive."
        )))
    }

    @Test func theInflateBudgetStopsABomb() throws {
        var archive = try ZipArchive(StoredZipBuilder.zip([("a.json", String(repeating: "x", count: 100))]), maxInflatedBytes: 50)
        do {
            _ = try archive.read("a.json")
            Issue.record("A read past the budget must throw")
        } catch {
            #expect((error as Error as? ZipArchiveError) == .bomb)
        }
    }
}

struct ImportSniffingTests {
    @Test func eachFormatFindsItsReader() throws {
        let cards = try ImportFileReader.content(of: FixtureLoader.data("aidungeon-cards.json")).get()
        guard case .storyCards = cards else {
            Issue.record("Cards were read as \(cards.formatName)")
            return
        }
        let backup = try ImportFileReader.content(of: FixtureLoader.data("aidungeon-backup.zip")).get()
        guard case .backup = backup else {
            Issue.record("The backup was read as \(backup.formatName)")
            return
        }
        let scenario = try ImportFileReader.content(of: Data("\u{FEFF}{\"prompt\": \"You wake.\"}".utf8)).get()
        guard case .scenario(let json, _) = scenario else {
            Issue.record("The scenario was read as \(scenario.formatName)")
            return
        }
        #expect(!json.hasPrefix("\u{FEFF}"))
    }

    @Test func theRightReaderComplains() {
        // An emptied card list is a broken card file, not a scenario.
        #expect(ImportFileReader.content(of: Data(#"{"storyCards": [], "prompt": "x"}"#.utf8)).failureMessage
            == "That file has no story cards in it.")
        #expect(ImportFileReader.content(of: Data("[1, 2]".utf8)).failureMessage
            == "None of the story cards in that file have any text.")
        #expect(ImportFileReader.content(of: Data(#"{"title": "What"}"#.utf8)).failureMessage
            == "That file isn't a NovelAI scenario — no story prompt in it.")
    }
}

struct ImportDigestTests {
    @Test func summariesReadNaturally() {
        #expect(ImportDigest.words("  ") == "Empty")
        #expect(ImportDigest.words("one") == "1 word")
        #expect(ImportDigest.words("one two\nthree") == "3 words")
        #expect(ImportDigest.entries(0) == "None")
        #expect(ImportDigest.entries(1) == "1 entry")
        #expect(ImportDigest.manuscript(passages: 0, turns: 0) == "Empty")
        #expect(ImportDigest.manuscript(passages: 1, turns: 0) == "1 passage")
        #expect(ImportDigest.manuscript(passages: 412, turns: 205) == "412 passages · 205 of them yours")
        #expect(ImportDigest.narrator("") == "Built-in")
        #expect(ImportDigest.categories([]) == "None")
    }
}

private extension Result where Failure == ImportParseError {
    var failureMessage: String? {
        if case .failure(let error) = self { error.message } else { nil }
    }
}
