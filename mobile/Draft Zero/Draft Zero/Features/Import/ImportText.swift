import Foundation

/// The text shapes the importers store, so a preview counts what the server
/// will actually write. Ported from lib/import/aidungeon.ts.
nonisolated enum ImportText {
    /// CRLF and bare CR both become "\n" before anything else reads the text.
    static func normalizeNewlines(_ text: String) -> String {
        text.replacing("\r\n", with: "\n").replacing("\r", with: "\n")
    }

    /// Prose under the paragraph contract: every line break becomes a
    /// paragraph break and runs of blank lines collapse.
    static func paragraphs(_ text: String) -> String {
        normalizeNewlines(text)
            .split(separator: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .joined(separator: "\n\n")
    }

    /// Lore keeps its own line breaks; only the endings are normalised.
    static func lore(_ text: String) -> String {
        normalizeNewlines(text).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func trimmed(_ text: String) -> String {
        text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// "1 entry", "3 entries".
    static func count(_ count: Int, _ one: String, _ many: String) -> String {
        "\(count.formatted()) \(count == 1 ? one : many)"
    }
}
