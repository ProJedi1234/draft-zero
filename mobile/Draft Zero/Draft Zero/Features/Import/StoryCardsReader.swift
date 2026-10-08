import Foundation

/// Reads an AI Dungeon story-card export for the import preview, in either
/// shape: a bare card array, or a scenario object carrying one. A port of
/// lib/import/aidungeon.ts, shared with the backup reader through `readCards`.
nonisolated enum StoryCardsReader {
    static func parse(_ text: String) -> Result<StoryCardsPreview, ImportParseError> {
        if ImportText.trimmed(text).isEmpty {
            return .failure(ImportParseError(recognised: false, message: "The file is empty."))
        }
        guard let value = ImportJSON.parse(text) else {
            return .failure(ImportParseError(recognised: false, message: "That file isn't valid JSON."))
        }
        return parse(value: value)
    }

    static func parse(value: JSONValue) -> Result<StoryCardsPreview, ImportParseError> {
        let cards: [JSONValue]
        var wrapper: [String: JSONValue] = [:]
        switch value {
        case .array(let items):
            // A top-level array could only ever have been a card export.
            cards = items
        case .object(let object):
            guard let list = cardList(object) else {
                return .failure(ImportParseError(
                    recognised: false,
                    message: "That file isn't an AI Dungeon export — no story cards in it."
                ))
            }
            cards = list
            wrapper = object
        default:
            return .failure(ImportParseError(recognised: false, message: "That file isn't an AI Dungeon export."))
        }

        guard !cards.isEmpty else {
            return .failure(ImportParseError(recognised: true, message: "That file has no story cards in it."))
        }
        var warnings: [String] = []
        let read = readCards(cards, warnings: &warnings)
        guard !read.entries.isEmpty || !read.settings.isEmpty else {
            return .failure(ImportParseError(recognised: true, message: "None of the story cards in that file have any text."))
        }

        let wrapperTitle = ImportText.trimmed(ImportJSON.str(wrapper["title"]))
        let title = !wrapperTitle.isEmpty ? wrapperTitle : !read.worldTitle.isEmpty ? read.worldTitle : "Imported story cards"
        let authorsNote = ImportJSON.str(wrapper["authorsNote"])
        return .success(StoryCardsPreview(
            title: title,
            description: ImportText.trimmed(ImportJSON.str(wrapper["description"])),
            prompt: ImportText.paragraphs(ImportJSON.str(wrapper["prompt"])),
            memory: ImportText.paragraphs(ImportJSON.str(wrapper["memory"])),
            authorsNote: ImportText.paragraphs(authorsNote.isEmpty ? ImportJSON.str(wrapper["authors_note"]) : authorsNote),
            tags: ImportJSON.unique(ImportJSON.strArray(wrapper["tags"])),
            worldDescription: read.worldDescription,
            lorebookEntries: read.entries,
            settingEntries: read.settings,
            warnings: warnings
        ))
    }

    /// The card list, preferring a populated one: exporters that renamed the
    /// key leave the old one behind as `[]`.
    private static func cardList(_ object: [String: JSONValue]) -> [JSONValue]? {
        var empty: [JSONValue]?
        for key in ["storyCards", "story_cards", "cards"] {
            guard let list = ImportJSON.array(object[key]) else { continue }
            if !list.isEmpty { return list }
            if empty == nil { empty = list }
        }
        return empty
    }

    // MARK: - Cards

    static func readCards(_ raw: [JSONValue], warnings: inout [String]) -> StoryCardSet {
        var entries: [ImportLoreEntry] = []
        var settings: [ImportLoreEntry] = []
        var worldTexts: [String] = []
        var unknownTypes: [String] = []
        var guessedTypes: [(type: String, category: LorebookCategory)] = []
        var names = Set<String>()
        var duplicateNames: [String] = []
        var worldTitle = ""
        var skipped = 0, untitled = 0, keyedByTitle = 0, triggerless = 0

        for item in raw {
            guard let card = ImportJSON.record(item) else {
                skipped += 1
                continue
            }
            let type = ImportText.trimmed(ImportJSON.str(card["type"]))
            let content = cardContent(
                value: ImportText.lore(ImportJSON.str(card["value"])),
                description: ImportText.lore(ImportJSON.str(card["description"]))
            )
            guard !content.isEmpty else {
                skipped += 1
                continue
            }

            let (category, exact) = category(forType: type)
            if !type.isEmpty, !exact {
                if let category {
                    if !guessedTypes.contains(where: { $0.type == type }) { guessedTypes.append((type, category)) }
                } else if !unknownTypes.contains(type) {
                    unknownTypes.append(type)
                }
            }

            let isWorld = foldType(type) == "worlddescription"
            let title = ImportText.trimmed(ImportJSON.str(card["title"]))
            var keys = readKeys(card["keys"])
            if keys.isEmpty, !title.isEmpty {
                keys = [title]
                keyedByTitle += 1
            }
            let name = !title.isEmpty ? title : keys.first ?? "Untitled entry"
            if title.isEmpty {
                if !keys.isEmpty {
                    untitled += 1
                } else if !isWorld {
                    triggerless += 1
                }
            }

            let fold = name.lowercased()
            if names.contains(fold), !duplicateNames.contains(name) { duplicateNames.append(name) }
            names.insert(fold)

            if isWorld {
                worldTexts.append(content)
                if worldTitle.isEmpty { worldTitle = title }
            }
            let entry = ImportLoreEntry(
                name: name,
                category: category ?? .concept,
                keys: keys,
                content: content,
                enabled: true,
                alwaysActive: isWorld
            )
            if isWorld { settings.append(entry) } else { entries.append(entry) }
        }

        warnings += cardWarnings(
            skipped: skipped,
            guessedTypes: guessedTypes,
            unknownTypes: unknownTypes,
            keyedByTitle: keyedByTitle,
            untitled: untitled,
            triggerless: triggerless,
            duplicateNames: duplicateNames
        )
        return StoryCardSet(
            entries: entries,
            settings: settings,
            worldDescription: worldTexts.joined(separator: "\n\n"),
            worldTitle: worldTitle
        )
    }

    private static func cardWarnings(
        skipped: Int,
        guessedTypes: [(type: String, category: LorebookCategory)],
        unknownTypes: [String],
        keyedByTitle: Int,
        untitled: Int,
        triggerless: Int,
        duplicateNames: [String]
    ) -> [String] {
        var warnings: [String] = []
        if skipped > 0 {
            warnings.append("Skipped \(skipped) empty story \(skipped == 1 ? "card" : "cards").")
        }
        if !guessedTypes.isEmpty {
            let pairs = guessedTypes.map { "\($0.type) → \($0.category.label)" }.joined(separator: ", ")
            warnings.append("Filed by name: \(pairs).")
        }
        if !unknownTypes.isEmpty {
            warnings.append(
                "Unrecognised card \(unknownTypes.count == 1 ? "type" : "types") (\(unknownTypes.joined(separator: ", "))) became Concepts."
            )
        }
        if keyedByTitle > 0 {
            let subject = keyedByTitle == 1
                ? "card had no trigger words — its title is"
                : "cards had no trigger words — their titles are"
            warnings.append("\(keyedByTitle) \(subject) the trigger instead.")
        }
        if untitled > 0 {
            warnings.append(
                "\(untitled) \(untitled == 1 ? "card" : "cards") had no title — named after \(untitled == 1 ? "its" : "their") first trigger word."
            )
        }
        if triggerless > 0 {
            let one = triggerless == 1
            warnings.append(
                "\(triggerless) \(one ? "card has" : "cards have") no title and no trigger words — \(one ? "it" : "they") won't reach a generation until you give \(one ? "it one" : "them some")."
            )
        }
        if !duplicateNames.isEmpty {
            let one = duplicateNames.count == 1
            warnings.append(
                "Duplicate card \(one ? "title" : "titles") (\(duplicateNames.joined(separator: ", "))) \(one ? "was" : "were") imported as separate entries."
            )
        }
        return warnings
    }

    /// `value` is what AI Dungeon injects and `description` the author's note;
    /// keep both when they differ rather than choosing half of the writer's work.
    private static func cardContent(value: String, description: String) -> String {
        if value.isEmpty { return description }
        if description.isEmpty || description == value { return value }
        return "\(value)\n\n\(description)"
    }

    /// Usually one comma-separated string; card editors also write an array.
    /// Duplicates that differ only in case are dropped.
    static func readKeys(_ value: JSONValue?) -> [String] {
        let joined = if case .array = value {
            ImportJSON.strArray(value).joined(separator: ",")
        } else {
            ImportJSON.str(value)
        }
        var keys: [String] = []
        var seen = Set<String>()
        for part in joined.split(separator: ",", omittingEmptySubsequences: false) {
            let key = part.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !key.isEmpty, seen.insert(key.lowercased()).inserted else { continue }
            keys.append(key)
        }
        return keys
    }

    // MARK: - Types

    /// Case, spaces, underscores and hyphens vary by hand and carry no meaning.
    static func foldType(_ type: String) -> String {
        String(type.lowercased().filter { !$0.isWhitespace && $0 != "_" && $0 != "-" })
    }

    /// The category for a free-text card type, and whether the table knew it
    /// exactly. A keyword guess is reported in the warnings; an exact hit isn't.
    static func category(forType type: String) -> (category: LorebookCategory?, exact: Bool) {
        if let exact = exactTypes[foldType(type)] { return (exact, true) }
        let keywords: [(LorebookCategory, String)] = [
            (.character, "char|person|people|npc|protagonist|creature|race|being"),
            (.location, "location|place|setting|region|city|town|realm|geograph"),
            (.faction, "faction|group|organi[sz]ation|guild|order|nation|kingdom|clan"),
            (.class, "class|archetype|profession|vocation|job|role"),
            (.item, "item|object|artifact|artefact|equipment|weapon|gear|treasure"),
            (.event, "event|history|timeline|quest|plot"),
            (.concept, "concept|magic|system|term|misc|rule|theme|lore|power|skill"),
        ]
        for (category, pattern) in keywords
        where type.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil {
            return (category, false)
        }
        return (nil, false)
    }

    private static let exactTypes: [String: LorebookCategory] = [
        "character": .character, "char": .character, "npc": .character, "person": .character,
        "creature": .character, "monster": .character, "race": .character, "species": .character,
        "location": .location, "place": .location, "region": .location, "setting": .location,
        "item": .item, "object": .item, "thing": .item, "artifact": .item, "artefact": .item,
        "weapon": .item, "equipment": .item,
        "faction": .faction, "group": .faction, "organization": .faction, "organisation": .faction,
        "guild": .faction, "nation": .faction, "kingdom": .faction,
        "event": .event, "history": .event, "quest": .event,
        "class": .class, "archetype": .class, "profession": .class, "job": .class,
        "concept": .concept, "lore": .concept, "note": .concept, "other": .concept,
        "worlddescription": .concept,
    ]
}
