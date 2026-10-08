import Foundation

/// Reads a NovelAI `.scenario` for the import preview. A port of
/// lib/import/novelai.ts; the server re-parses the same text on import, so
/// this only has to show the writer the same thing it will make.
nonisolated enum ScenarioReader {
    static func parse(_ text: String) -> Result<ScenarioPreview, ImportParseError> {
        if ImportText.trimmed(text).isEmpty {
            return .failure(ImportParseError(recognised: false, message: "The file is empty."))
        }
        guard let value = ImportJSON.parse(text) else {
            return .failure(ImportParseError(recognised: false, message: "That file isn't valid JSON."))
        }
        return parse(value: value)
    }

    static func parse(value: JSONValue) -> Result<ScenarioPreview, ImportParseError> {
        guard let raw = ImportJSON.record(value) else {
            return .failure(ImportParseError(recognised: false, message: "That file isn't a NovelAI scenario."))
        }
        // `prompt` is the one field every scenario revision carries; without it
        // the file is only ours if another scenario-only key says so.
        guard case .string(let rawPrompt)? = raw["prompt"] else {
            let marker = raw["scenarioVersion"] != nil || raw["lorebook"] != nil || raw["context"] != nil
            return .failure(ImportParseError(
                recognised: marker,
                message: "That file isn't a NovelAI scenario — no story prompt in it."
            ))
        }

        var warnings: [String] = []
        let version = ImportJSON.num(raw["scenarioVersion"]) ?? 0
        if version > 4 {
            warnings.append("This scenario is version \(version.formatted()); fields newer than version 4 were ignored.")
        }

        let context = ImportJSON.array(raw["context"]) ?? []
        let memory = firstNonEmpty(contextText(context, 0), ImportText.trimmed(ImportJSON.str(raw["memory"])))
        let authorsNote = firstNonEmpty(
            contextText(context, 1),
            ImportText.trimmed(ImportJSON.str(raw["authorsNote"])),
            ImportText.trimmed(ImportJSON.str(raw["authors_note"]))
        )

        let attg = ImportJSON.record(raw["attg"]) ?? [:]
        let tags = ImportJSON.unique(ImportJSON.strArray(raw["tags"]) + ImportJSON.strArray(attg["tags"]))
        let genreTags = ImportJSON.strArray(attg["genre"])

        let title = firstNonEmpty(ImportText.trimmed(ImportJSON.str(raw["title"])), "Imported scenario")
        let rawDescription = ImportJSON.str(raw["description"])
        let prompt = ImportText.paragraphs(rawPrompt)
        let entries = readLorebook(raw["lorebook"], warnings: &warnings)
        readSettings(raw["settings"], warnings: &warnings)

        if let scripts = ImportJSON.array(raw["userScripts"]), !scripts.isEmpty {
            warnings.append("User scripts were not imported.")
        }
        if let ephemeral = ImportJSON.array(raw["ephemeralContext"]), !ephemeral.isEmpty {
            warnings.append("Ephemeral context entries were not imported.")
        }

        let placeholderSources = [title, rawDescription, prompt, memory, authorsNote]
            + entries.flatMap { [$0.name, $0.content] + $0.keys }

        return .success(ScenarioPreview(
            scenarioVersion: version,
            title: title,
            description: ImportText.trimmed(rawDescription),
            author: ImportText.trimmed(ImportJSON.str(raw["author"])),
            genre: (genreTags.isEmpty ? tags : genreTags).joined(separator: ", "),
            tags: tags,
            prompt: prompt,
            memory: memory,
            authorsNote: authorsNote,
            lorebookEntries: entries,
            placeholders: ScenarioPlaceholders.collect(placeholderSources),
            warnings: warnings
        ))
    }

    // MARK: - Lorebook

    /// NovelAI folders are free-text names; ours are a fixed enum, so the
    /// folder is matched by keyword and anything unrecognised is a concept.
    /// Order matters: the concrete categories must win over "class".
    static func category(forFolder name: String) -> LorebookCategory {
        let table: [(LorebookCategory, String)] = [
            (.character, "char|person|people|cast|npc|protagonist|creature|race"),
            (.location, "location|place|setting|world|region|city|geograph"),
            (.faction, "faction|group|organi[sz]ation|guild|order|nation|kingdom"),
            (.item, "item|object|artifact|artefact|equipment|weapon|gear"),
            (.event, "event|history|timeline|lore ?event|plot"),
            (.class, #"\bclass(es)?\b|\barchetypes?\b|\bprofessions?\b|\bvocations?\b"#),
            (.concept, "concept|magic|system|term|misc|rule|theme"),
        ]
        for (category, pattern) in table
        where name.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil {
            return category
        }
        return .concept
    }

    /// A `/pattern/flags` key reduced to its pattern text; our matcher is substring-only.
    static func plainKey(_ key: String) -> (key: String, wasRegex: Bool) {
        guard key.count >= 2, key.hasPrefix("/"),
              let close = key.lastIndex(of: "/"), close > key.startIndex,
              key[key.index(after: close)...].allSatisfy({ "gimsuy".contains($0) })
        else { return (key, false) }
        let pattern = key[key.index(after: key.startIndex)..<close]
        var unescaped = ""
        var escaping = false
        for character in pattern {
            if escaping {
                if !".\\/".contains(character) { unescaped.append("\\") }
                unescaped.append(character)
                escaping = false
            } else if character == "\\" {
                escaping = true
            } else {
                unescaped.append(character)
            }
        }
        if escaping { unescaped.append("\\") }
        return (unescaped, true)
    }

    private static func readLorebook(_ value: JSONValue?, warnings: inout [String]) -> [ImportLoreEntry] {
        guard let raw = ImportJSON.record(value) else { return [] }

        var folderNames: [String: String] = [:]
        for folder in ImportJSON.array(raw["categories"]) ?? [] {
            guard let folder = ImportJSON.record(folder) else { continue }
            let id = ImportJSON.str(folder["id"])
            if !id.isEmpty { folderNames[id] = ImportJSON.str(folder["name"]) }
        }

        var entries: [ImportLoreEntry] = []
        var skipped = 0
        var loweredRegex = false
        for item in ImportJSON.array(raw["entries"]) ?? [] {
            guard let item = ImportJSON.record(item) else { continue }
            let content = ImportText.trimmed(ImportJSON.str(item["text"]))
            // Blank templates share the array; they carry nothing into context.
            guard !content.isEmpty else {
                skipped += 1
                continue
            }
            var keys: [String] = []
            for rawKey in ImportJSON.strArray(item["keys"]) {
                let (key, wasRegex) = plainKey(rawKey)
                if wasRegex { loweredRegex = true }
                if !key.isEmpty { keys.append(key) }
            }
            let name = ImportText.trimmed(ImportJSON.str(item["displayName"]))
            entries.append(ImportLoreEntry(
                name: firstNonEmpty(name, keys.first ?? "", "Untitled entry"),
                category: category(forFolder: folderNames[ImportJSON.str(item["category"])] ?? ""),
                keys: keys,
                content: content,
                enabled: item["enabled"] != .bool(false),
                alwaysActive: item["forceActivation"] == .bool(true)
            ))
        }

        if skipped > 0 {
            warnings.append("Skipped \(skipped) empty lorebook \(skipped == 1 ? "entry" : "entries").")
        }
        if loweredRegex {
            warnings.append("Regex lorebook keys were converted to plain text — matching is substring-only here.")
        }
        return entries
    }

    // MARK: - Helpers

    /// Only temperature and top-p survive; say so when the scenario carried more.
    private static func readSettings(_ value: JSONValue?, warnings: inout [String]) {
        guard let raw = ImportJSON.record(value) else { return }
        let parameters = ImportJSON.record(raw["parameters"]) ?? [:]
        if !ImportJSON.str(raw["model"]).isEmpty || !parameters.isEmpty {
            warnings.append(
                "Kept temperature and top-p only — NovelAI's model and repetition penalties have no OpenRouter equivalent."
            )
        }
    }

    private static func contextText(_ context: [JSONValue], _ index: Int) -> String {
        guard context.indices.contains(index), let slot = ImportJSON.record(context[index]) else { return "" }
        return ImportText.trimmed(ImportJSON.str(slot["text"]))
    }

    private static func firstNonEmpty(_ candidates: String...) -> String {
        candidates.first { !$0.isEmpty } ?? ""
    }
}
