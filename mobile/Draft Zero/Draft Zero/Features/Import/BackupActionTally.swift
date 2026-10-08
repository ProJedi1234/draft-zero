import Foundation

/// A running count of how a backup's actions land: which become passages,
/// which of those are the writer's turns, and what was dropped.
nonisolated struct BackupActionTally: Sendable, Equatable {
    private(set) var passages = 0
    private(set) var turns = 0
    private(set) var images = 0
    private(set) var empty = 0
    /// Action types with no mapping, in the order first seen.
    private(set) var unknownTypes: [String] = []

    /// Prose the writer or the model committed, not a turn.
    private static let narrationTypes: Set<String> = ["start", "story", "unknown", ""]

    mutating func read(_ actions: [JSONValue]) {
        for action in actions {
            guard let item = ImportJSON.record(action) else {
                empty += 1
                continue
            }
            let type = ImportText.trimmed(ImportJSON.str(item["type"])).lowercased()
            let text = ImportJSON.str(item["text"])
            // An image beat is dropped as an image, not counted as blank.
            if type == "see" {
                images += 1
                continue
            }
            if ImportText.trimmed(text).isEmpty {
                empty += 1
                continue
            }
            passages += 1
            if let kind = ActionKind(rawValue: type) {
                if Self.isTurn(kind, rendered: text) { turns += 1 }
            } else if type != "continue", !Self.narrationTypes.contains(type), !unknownTypes.contains(type) {
                unknownTypes.append(type)
            }
        }
    }

    /// A Do or Say keeps its kind unless its translation comes out empty, in
    /// which case the server keeps the rendering as narration.
    static func isTurn(_ kind: ActionKind, rendered raw: String) -> Bool {
        let rendered = ImportText.paragraphs(stripChevron(raw))
        return !ImportText.trimmed(ActionVoice.translate(kind, inputText(kind, rendered: rendered))).isEmpty
    }

    /// AI Dungeon stores a turn already rendered ("> You say "Run.""); a Say's
    /// quoted line is unwrapped back to what was said.
    static func inputText(_ kind: ActionKind, rendered: String) -> String {
        guard kind == .say,
              let match = rendered.firstMatch(of: #/^(?i:you\s+say)[,:]?\s*["“]([\s\S]*)["”][.!?]?\s*$/#)
        else { return rendered }
        return ImportText.trimmed(String(match.output.1))
    }

    private static func stripChevron(_ text: String) -> String {
        guard let match = text.prefixMatch(of: #/\s*>\s*/#) else { return text }
        return String(text[match.range.upperBound...])
    }
}
