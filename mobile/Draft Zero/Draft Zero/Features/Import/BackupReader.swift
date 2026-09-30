import Foundation

/// Reads an AI Dungeon backup `.zip` for the import preview: `metadata.json`
/// beside numbered `actions-NNN.json` parts. A port of
/// lib/import/aidungeon-backup.ts that counts passages rather than keeping them.
nonisolated enum BackupReader {
    /// The largest archive the server accepts, compressed.
    static let maxBytes = 16 * 1024 * 1024
    /// What that archive may inflate to, in total, before it counts as a bomb.
    static let maxInflatedBytes = maxBytes * 8

    static func parse(_ data: Data) -> Result<BackupPreview, ImportParseError> {
        var archive: ZipArchive
        do throws(ZipArchiveError) {
            archive = try ZipArchive(data, maxInflatedBytes: maxInflatedBytes)
        } catch {
            return .failure(ImportParseError(recognised: false, message: error.message))
        }

        guard let metadataName = archive.names.first(where: { matchesName($0, "metadata.json") }) else {
            return .failure(ImportParseError(recognised: false, message: "That zip isn't an AI Dungeon backup — no metadata.json."))
        }
        let metadataValue: JSONValue
        do throws(ZipArchiveError) {
            guard let parsed = ImportJSON.parse(try archive.readText(metadataName)) else {
                return .failure(ImportParseError(recognised: true, message: "That backup's metadata.json isn't valid JSON."))
            }
            metadataValue = parsed
        } catch {
            return .failure(ImportParseError(recognised: true, message: error.message))
        }
        guard let metadata = ImportJSON.record(metadataValue) else {
            return .failure(ImportParseError(recognised: true, message: "That backup's metadata.json isn't an AI Dungeon adventure."))
        }
        // `adventure` is what makes this AI Dungeon's metadata rather than a namesake.
        guard let adventure = ImportJSON.record(metadata["adventure"]) else {
            return .failure(ImportParseError(recognised: false, message: "That zip isn't an AI Dungeon backup."))
        }
        let state = ImportJSON.record(metadata["state"]) ?? [:]

        var warnings: [String] = []
        let cards = StoryCardsReader.readCards(ImportJSON.array(state["storyCards"]) ?? [], warnings: &warnings)

        let parts = actionParts(archive.names)
        var tally = BackupActionTally()
        for part in parts {
            let payload: JSONValue?
            do throws(ZipArchiveError) {
                payload = ImportJSON.parse(try archive.readText(part))
            } catch {
                // A blown budget is a bad archive, not a bad part.
                return .failure(ImportParseError(recognised: true, message: error.message))
            }
            guard let payload else {
                warnings.append("\"\(part)\" couldn't be read — those passages are missing.")
                continue
            }
            let actions = ImportJSON.record(payload).map { ImportJSON.array($0["actions"]) } ?? ImportJSON.array(payload)
            guard let actions else {
                warnings.append("\"\(part)\" carried no actions.")
                continue
            }
            tally.read(actions)
        }

        if tally.passages == 0, cards.entries.isEmpty, cards.settings.isEmpty {
            return .failure(ImportParseError(recognised: true, message: "That backup has no story and no story cards in it."))
        }

        warnings += tallyWarnings(tally, parts: parts.count, metadata: metadata)
        let instructions = readInstructions(state["instructions"])
        if !instructions.isEmpty {
            warnings.append("The adventure's AI instructions replace the built-in narrator prompt — edit it under Narrator.")
        }
        let memories = ImportJSON.array(state["memories"])?.count ?? 0
        if memories > 0 {
            warnings.append(
                "Dropped \(ImportText.count(memories, "AI Dungeon memory", "AI Dungeon memories")) — there's nothing here that remembers the way that store does."
            )
        }

        let title = ImportText.trimmed(ImportJSON.str(adventure["title"]))
        return .success(BackupPreview(
            title: title.isEmpty ? "Imported adventure" : title,
            description: ImportText.paragraphs(ImportJSON.str(adventure["description"])),
            memory: ImportText.lore(ImportJSON.str(adventure["memory"])),
            authorsNote: ImportText.lore(ImportJSON.str(adventure["authorsNote"])),
            tags: ImportJSON.unique(ImportJSON.strArray(adventure["tags"])),
            worldDescription: cards.worldDescription,
            lorebookEntries: cards.entries,
            settingEntries: cards.settings,
            passageCount: tally.passages,
            turnCount: tally.turns,
            summary: ImportText.lore(ImportJSON.str(state["storySummary"])),
            instructions: instructions,
            warnings: warnings
        ))
    }

    /// The declared counts against what arrived, and what was dropped on the way.
    private static func tallyWarnings(_ tally: BackupActionTally, parts: Int, metadata: [String: JSONValue]) -> [String] {
        var warnings: [String] = []
        if let declaredParts = ImportJSON.num(metadata["totalParts"]), Double(parts) < declaredParts {
            warnings.append(
                "This backup says it has \(declaredParts.formatted()) action files but only \(parts) \(parts == 1 ? "is" : "are") in the zip."
            )
        }
        if tally.images > 0 {
            warnings.append("Dropped \(ImportText.count(tally.images, "image", "images")) — a backup carries the prompt but not the picture.")
        }
        if tally.empty > 0 {
            warnings.append("Skipped \(ImportText.count(tally.empty, "empty action", "empty actions")).")
        }
        if !tally.unknownTypes.isEmpty {
            let one = tally.unknownTypes.count == 1
            warnings.append(
                "Unrecognised action \(one ? "type" : "types") (\(tally.unknownTypes.joined(separator: ", "))) \(one ? "was" : "were") imported as narration."
            )
        }
        let arrived = tally.passages + tally.images + tally.empty
        if let declared = ImportJSON.num(metadata["totalActionCount"]), declared > Double(arrived) {
            warnings.append("This backup says it has \(declared.formatted()) actions but \(arrived) arrived.")
        }
        return warnings
    }

    /// Matches `name` at the root or under a folder, case-insensitively, since a
    /// re-zipped backup folder is still plainly a backup.
    static func matchesName(_ path: String, _ name: String) -> Bool {
        let lowered = path.lowercased()
        return lowered == name || lowered.hasSuffix("/\(name)")
    }

    /// The `actions-N.json` parts in play order: by the number, not the string,
    /// or `actions-10` would land between 1 and 2.
    static func actionParts(_ names: [String]) -> [String] {
        names.compactMap { name -> (String, Int)? in
            let file = name.split(separator: "/").last.map(String.init)?.lowercased() ?? ""
            guard file.hasPrefix("actions-"), file.hasSuffix(".json") else { return nil }
            let digits = file.dropFirst("actions-".count).dropLast(".json".count)
            guard !digits.isEmpty, digits.allSatisfy({ $0.isASCII && $0.isWholeNumber }), let part = Int(digits) else { return nil }
            return (name, part)
        }
        .sorted { $0.1 < $1.1 }
        .map(\.0)
    }

    /// The adventure's AI instructions: a string, or `custom` falling back to `scenario`.
    private static func readInstructions(_ value: JSONValue?) -> String {
        if case .string(let text)? = value { return ImportText.lore(text) }
        guard let record = ImportJSON.record(value) else { return "" }
        let custom = ImportJSON.str(record["custom"])
        return ImportText.lore(custom.isEmpty ? ImportJSON.str(record["scenario"]) : custom)
    }
}
