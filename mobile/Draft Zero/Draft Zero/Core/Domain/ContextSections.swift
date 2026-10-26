import Foundation

/// Section counts include the prompt's labels and separators, matching web's breakdown.
nonisolated enum ContextSections {
    struct Section: Identifiable {
        var name: String
        var text: String
        var shade: Double
        var id: String { name }
        var tokens: Int { (text.utf16.count + 3) / 4 }
    }

    static func sections(_ context: ComposedContext) -> [Section] {
        let c = context
        var blocks: [(String, String)] = []
        let trim: (String) -> String = { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        let memory = trim(c.memory)
        if !memory.isEmpty { blocks.append(("Memory", "[Memory]\n\(memory)")) }
        for lore in c.lore where lore.stable { blocks.append(("Lorebook", "[Lore: \(lore.name)]\n\(trim(lore.content))")) }
        let summary = trim(c.summary)
        if !summary.isEmpty { blocks.append(("Story so far", "[Story so far]\n\(summary)")) }
        let story = trim(c.storyText)
        let boundary = story.range(of: "\n\n", options: .backwards)
        let head = boundary.map { String(story[..<$0.lowerBound]) } ?? ""
        if story.isEmpty {
            let marker = summary.isEmpty
                ? "(This story has no text yet. Write its opening paragraph.)"
                : "(None of the recent passages fit. Continue the story from the summary above.)"
            blocks.append(("Story", "[Story]\n\(marker)"))
        } else {
            blocks.append(("Story", head.isEmpty ? "[Story]" : "[Story]\n\(head)"))
        }
        for lore in c.lore where !lore.stable { blocks.append(("Lorebook", "[Lore: \(lore.name)]\n\(trim(lore.content))")) }
        blocks.append(contentsOf: (c.world ?? []).map { ("World", $0) })
        let note = trim(c.authorsNote)
        if !note.isEmpty { blocks.append(("Author's note", "[Author's note: \(note)]")) }
        if !story.isEmpty {
            blocks.append(("Story", boundary.map { String(story[$0.upperBound...]) } ?? story))
        }
        var text = ["Instructions": c.systemPrompt]
        for (index, block) in blocks.enumerated() { text[block.0, default: ""] += (index == 0 ? "" : "\n\n") + block.1 }
        let order: [(String, Double)] = [("Instructions", 0.30), ("Memory", 0.45), ("Lorebook", 0.55),
                                         ("Story so far", 0.70), ("Story", 0.82), ("World", 0.90), ("Author's note", 0.95)]
        return order.compactMap { name, shade in
            let value = text[name] ?? ""
            let trimmedAway = name == "Lorebook" && c.fit.loreMatched > 0 || name == "Story" && c.fit.storyChars > c.fit.storyCharsKept
            guard !trim(value).isEmpty || trimmedAway else { return nil }
            return Section(name: name, text: value, shade: shade)
        }
    }
}
