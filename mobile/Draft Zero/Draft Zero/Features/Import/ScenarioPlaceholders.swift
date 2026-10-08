import Foundation

/// Reads and fills a scenario's `${…}` placeholders. A port of the placeholder
/// half of lib/import/novelai.ts: `$` fills in place, and `%` is NovelAI's
/// table-of-contents form, which declares a placeholder and renders nothing.
nonisolated enum ScenarioPlaceholders {
    /// One `${…}` or `%{…}` occurrence: its sigil and the text between the braces.
    nonisolated struct Occurrence: Equatable, Sendable {
        var range: Range<String.Index>
        var sigil: Character
        var body: String
    }

    /// Every occurrence in reading order, matching `[$%]\{[^{}]*\}`.
    static func occurrences(in text: String) -> [Occurrence] {
        var found: [Occurrence] = []
        var index = text.startIndex
        while index < text.endIndex {
            let character = text[index]
            let open = text.index(after: index)
            guard character == "$" || character == "%", open < text.endIndex, text[open] == "{" else {
                index = text.index(after: index)
                continue
            }
            var cursor = text.index(after: open)
            while cursor < text.endIndex, text[cursor] != "{", text[cursor] != "}" {
                cursor = text.index(after: cursor)
            }
            if cursor < text.endIndex, text[cursor] == "}" {
                let end = text.index(after: cursor)
                found.append(Occurrence(
                    range: index..<end,
                    sigil: character,
                    body: String(text[text.index(after: open)..<cursor])
                ))
                index = end
            } else {
                index = text.index(after: index)
            }
        }
        return found
    }

    /// `1#id[default]Title:Description`; nil when there is no id.
    static func parseBody(_ body: String) -> ScenarioPlaceholder? {
        var rest = Substring(body)
        var order = Int.max

        let digits = rest.prefix { $0.isASCII && $0.isWholeNumber }
        if !digits.isEmpty, rest.dropFirst(digits.count).first == "#" {
            order = Int(digits) ?? Int.max
            rest = rest.dropFirst(digits.count + 1)
        }

        // The id runs until the default's `[`, the description's `:`, or the end.
        let rawId = rest.prefix { $0 != "[" && $0 != ":" }
        let id = rawId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty else { return nil }
        rest = rest.dropFirst(rawId.count)

        var defaultValue = ""
        if rest.first == "[", let close = rest.firstIndex(of: "]") {
            defaultValue = String(rest[rest.index(after: rest.startIndex)..<close])
            rest = rest[rest.index(after: close)...]
        }

        let title: String
        let description: String
        if let colon = rest.firstIndex(of: ":") {
            title = rest[..<colon].trimmingCharacters(in: .whitespacesAndNewlines)
            description = rest[rest.index(after: colon)...].trimmingCharacters(in: .whitespacesAndNewlines)
        } else {
            title = rest.trimmingCharacters(in: .whitespacesAndNewlines)
            description = ""
        }
        return ScenarioPlaceholder(id: id, order: order, defaultValue: defaultValue, title: title, description: description)
    }

    /// Every distinct placeholder across the texts, in fill order. The first
    /// declaration wins, but a later one may supply metadata the first omitted.
    static func collect(_ texts: [String]) -> [ScenarioPlaceholder] {
        var byId: [String: ScenarioPlaceholder] = [:]
        var firstSeen: [String] = []
        for text in texts {
            for occurrence in occurrences(in: text) {
                guard let parsed = parseBody(occurrence.body) else { continue }
                guard let existing = byId[parsed.id] else {
                    byId[parsed.id] = parsed
                    firstSeen.append(parsed.id)
                    continue
                }
                byId[parsed.id] = ScenarioPlaceholder(
                    id: parsed.id,
                    order: min(existing.order, parsed.order),
                    defaultValue: existing.defaultValue.isEmpty ? parsed.defaultValue : existing.defaultValue,
                    title: existing.title.isEmpty ? parsed.title : existing.title,
                    description: existing.description.isEmpty ? parsed.description : existing.description
                )
            }
        }
        return firstSeen.compactMap { byId[$0] }.sorted { a, b in
            a.order != b.order ? a.order < b.order : a.id.localizedCompare(b.id) == .orderedAscending
        }
    }

    /// Substitutes every `${…}` with the writer's value, falling back to the
    /// declared default, and drops the `%{…}` form with the blank line it leaves.
    static func fill(_ text: String, values: [String: String]) -> String {
        var filled = ""
        var cursor = text.startIndex
        for occurrence in occurrences(in: text) {
            filled += text[cursor..<occurrence.range.lowerBound]
            cursor = occurrence.range.upperBound
            guard occurrence.sigil == "$", let parsed = parseBody(occurrence.body) else { continue }
            if let value = values[parsed.id], !value.isEmpty {
                filled += value
            } else {
                filled += parsed.defaultValue
            }
        }
        filled += text[cursor...]
        return dropLeadingBlankLines(filled)
    }

    /// `^[ \t]*\n+`: a table-of-contents block collapses to leading blank lines.
    private static func dropLeadingBlankLines(_ text: String) -> String {
        let indent = text.prefix { $0 == " " || $0 == "\t" }
        let afterIndent = text.dropFirst(indent.count)
        let newlines = afterIndent.prefix { $0 == "\n" }
        guard !newlines.isEmpty else { return text }
        return String(afterIndent.dropFirst(newlines.count))
    }
}
