import Foundation

extension NewLorebookEntry {
    /// An entry's editable fields, as the editor's draft starts from them.
    nonisolated init(entry: LorebookEntry) {
        self.init(
            name: entry.name,
            category: entry.category,
            keys: entry.keys,
            content: entry.content,
            enabled: entry.enabled,
            alwaysActive: entry.alwaysActive,
            priority: entry.priority
        )
    }

    nonisolated var hasBlankName: Bool {
        name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

extension LorebookEntry {
    /// This row as the writer sees it while a draft of it is open.
    nonisolated func overlaid(with draft: NewLorebookEntry) -> LorebookEntry {
        var entry = self
        entry.name = draft.name
        entry.category = draft.category
        entry.keys = draft.keys
        entry.content = draft.content
        entry.enabled = draft.enabled
        entry.alwaysActive = draft.alwaysActive
        entry.priority = draft.priority
        return entry
    }
}
