import Foundation

/// Turns first-person input into the second-person prose the manuscript shows.
///
/// A port of lib/story/action-voice.ts, used only for the optimistic echo: the
/// server writes the real passage, and when the two agree the swap is
/// invisible. The accepted failures are the web's, pinned by the same cases in
/// the unit tests. The `mine` rule is checked by hand because ICU look-behind
/// must be bounded and the web's is not.
nonisolated enum ActionVoice {
    static func translate(_ kind: ActionKind, _ raw: String) -> String {
        let text = normalize(raw)
        if text.isEmpty { return "" }
        return kind == .say ? translateSay(text) : translateDo(text)
    }

    // MARK: - Do

    private static func translateDo(_ text: String) -> String {
        // Quoted dialogue is the character speaking in their own "I"; mask it
        // so the narrator's pronoun shift never reaches inside.
        var quotations: [String] = []
        var masked = replace(quotedSpan, in: text) { match, _ in
            quotations.append(match)
            return "\u{0}\(quotations.count - 1)\u{0}"
        }

        masked = fixBeAgreement(shiftPronouns(masked))
        if masked.range(of: #"^you\b"#, options: [.regularExpression, .caseInsensitive]) == nil {
            masked = "You \(masked)"
        }

        let unmasked = replace(maskToken, in: masked) { match, groups in
            Int(groups[1] ?? "").flatMap { quotations.indices.contains($0) ? quotations[$0] : nil } ?? match
        }
        return punctuate(capitalize(unmasked))
    }

    // MARK: - Say

    private static func translateSay(_ text: String) -> String {
        var inner = unwrapQuotes(text)
        var stripped = replace(sayPreambleWithBreak, in: inner) { _, _ in "" }
        stripped = replace(sayPreambleBare, in: stripped) { _, _ in "" }
        stripped = stripped.trimmingCharacters(in: .whitespaces)
        // A preamble that swallowed the whole line was not a preamble.
        if !stripped.isEmpty { inner = unwrapQuotes(stripped) }
        if inner.isEmpty { return "" }
        // Say never shifts pronouns: the character speaks of themselves as "I".
        return "You say, \"\(punctuate(capitalize(curlQuotes(inner))))\""
    }

    // MARK: - Pronouns

    private struct PronounRule {
        let source: String
        let to: String
        var skipAllCaps = false
        var alwaysCapitalized = false
        var isMine = false
    }

    private static let pronounRules: [PronounRule] = [
        PronounRule(source: "ourselves", to: "yourself"),
        PronounRule(source: "myself", to: "yourself"),
        PronounRule(source: "we['’]re", to: "you're"),
        PronounRule(source: "we['’]ve", to: "you've"),
        PronounRule(source: "we['’]ll", to: "you'll"),
        PronounRule(source: "we['’]d", to: "you'd"),
        PronounRule(source: "I['’]ve", to: "you've", alwaysCapitalized: true),
        PronounRule(source: "I['’]ll", to: "you'll", alwaysCapitalized: true),
        PronounRule(source: "I['’]m", to: "you're", alwaysCapitalized: true),
        PronounRule(source: "I['’]d", to: "you'd", alwaysCapitalized: true),
        PronounRule(source: "ours", to: "yours"),
        PronounRule(source: "mine", to: "yours", isMine: true),
        PronounRule(source: "our", to: "your"),
        PronounRule(source: "my", to: "your"),
        PronounRule(source: "us", to: "you", skipAllCaps: true),
        PronounRule(source: "we", to: "you", skipAllCaps: true),
        PronounRule(source: "me", to: "you"),
        PronounRule(source: "I", to: "you", alwaysCapitalized: true),
    ]

    private static let pronounPattern = regex(
        #"\b(?:"# + pronounRules.map(\.source).joined(separator: "|") + #")\b"#
    )

    private static let pronounMatchers = pronounRules.map { regex("^(?:\($0.source))$") }

    private static let determiners: Set<String> = [
        "the", "a", "an", "this", "that", "its", "his", "her", "their", "my", "our", "your",
    ]

    /// Words that cannot sit between a determiner and its noun; one of these in
    /// the gap means a "mine" after it is the pronoun.
    private static let notANounGap: Set<String> = Set(
        [
            "is|was|are|were|be|been|being",
            "become|becomes|became|seem|seems|seemed|remain|remains|remained",
            "look|looks|looked|sound|sounds|sounded|feel|feels|felt|stay|stays|stayed",
            "make|makes|made|call|calls|called|turn|turns|turned",
            "will|would|shall|should|can|could|may|might|must",
            "have|has|had|do|does|did",
            "it|them|him",
            "and|or|but|nor|than|as|like|unlike",
            "of|to|in|on|at|by|with|without|from|for|into|onto|over|under",
            "near|behind|beside|beneath|against|toward|towards|around|about",
            "after|before|between|beyond|through|upon",
        ].joined(separator: "|").split(separator: "|").map(String.init)
    )

    private static func shiftPronouns(_ text: String) -> String {
        replace(pronounPattern, in: text) { matched, _, range in
            guard let index = pronounMatchers.firstIndex(where: { matches($0, matched) }) else {
                return matched
            }
            let rule = pronounRules[index]
            let before = String(text[..<range.lowerBound])
            if rule.isMine && mineIsNoun(before: before) { return matched }
            if rule.skipAllCaps && isAllCaps(matched) { return matched }
            if rule.alwaysCapitalized && !isAllCaps(matched) {
                return sentenceStart(before) ? capitalize(rule.to) : rule.to
            }
            return matchCase(rule.to, matched)
        }
    }

    /// "the abandoned mine" is a noun: a determiner, then up to three plausible
    /// modifiers, then the word, each separated by one whitespace character.
    private static func mineIsNoun(before: String) -> Bool {
        guard let last = before.last, last.isWhitespace else { return false }
        let words = before.dropLast().split(separator: " ", omittingEmptySubsequences: false).map(String.init)
        for gap in 0...3 where words.count > gap {
            let determiner = words[words.count - 1 - gap]
            let modifiers = words.suffix(gap)
            guard endsWithWord(determiner, in: determiners) else { continue }
            let plausible = modifiers.allSatisfy { word in
                !word.isEmpty && word.allSatisfy(isWordCharacter) && !notANounGap.contains(word.lowercased())
            }
            if plausible { return true }
        }
        return false
    }

    private static func endsWithWord(_ token: String, in words: Set<String>) -> Bool {
        let lower = token.lowercased()
        for word in words where lower.hasSuffix(word) {
            let prefix = lower.dropLast(word.count)
            if prefix.isEmpty || !(prefix.last.map(isWordCharacter) ?? false) { return true }
        }
        return false
    }

    private static func isWordCharacter(_ character: Character) -> Bool {
        character.isASCII && (character.isLetter || character.isNumber || character == "_")
    }

    // MARK: - Agreement

    private static let agreementAdverbs = [
        #"\w+ly"#, "still", "never", "always", "almost", "already", "just", "barely", "hardly",
        "nearly", "once", "again", "also", "even", "maybe", "perhaps", "now", "then", "sure",
    ].joined(separator: "|")

    private static let beAgreement = regex(#"\b(you)((?:\s+(?:"# + agreementAdverbs + #"))*\s+)(am|was)\b"#)

    /// Only am/was differ between first and second person; every other verb agrees already.
    private static func fixBeAgreement(_ text: String) -> String {
        replace(beAgreement, in: text) { _, groups in
            let verb = groups[3] ?? ""
            let fixed = matchCase(verb.lowercased() == "am" ? "are" : "were", verb)
            return (groups[1] ?? "") + (groups[2] ?? "") + fixed
        }
    }

    // MARK: - Say preambles

    private static let speechVerbs = [
        "say", "says", "said", "tell", "told", "ask", "asks", "asked", "shout", "yell", "whisper",
        "mutter", "murmur", "reply", "answer", "respond", "call", "snap", "add", "explain", "insist",
        "admit", "scream", "hiss", "growl",
    ].joined(separator: "|")

    private static let sayPreambleWithBreak = regex(
        #"^(?:i|we)\s+(?:"# + speechVerbs + #")\b[^,:—–]{0,40}?\s*(?:[,:—–]|\s-\s)+\s*(?:that\s+)?"#
    )

    private static let sayPreambleBare = regex(
        #"^(?:i|we)\s+(?:"# + speechVerbs
            + #")\b(?:\s+(?:to\s+)?(?:him|her|them|it|everyone|anyone|someone|the\s+\w+)(?:\s+that)?|\s+that)\s+"#
    )

    // MARK: - Text helpers

    private static let quotedSpan = regex(#""[^"]*"|“[^”]*”"#)
    private static let maskToken = regex("\u{0}(\\d+)\u{0}")
    private static let sentenceStartPattern = regex(#"(?:^|[.?!…]["”]?)\s*$"#)

    private static func normalize(_ raw: String) -> String {
        raw.split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }

    private static func isAllCaps(_ text: String) -> Bool {
        text.contains(where: { $0.isASCII && $0.isLetter }) && text.count > 1 && text == text.uppercased()
    }

    private static func matchCase(_ replacement: String, _ matched: String) -> String {
        if isAllCaps(matched) { return replacement.uppercased() }
        if let first = matched.first, String(first) == String(first).uppercased(), first.isLetter {
            return replacement.prefix(1).uppercased() + replacement.dropFirst()
        }
        return replacement
    }

    private static func capitalize(_ text: String) -> String {
        guard let index = text.firstIndex(where: { $0.isASCII && $0.isLetter }) else { return text }
        return String(text[..<index]) + text[index].uppercased() + String(text[text.index(after: index)...])
    }

    private static func punctuate(_ text: String) -> String {
        let terminal: Set<Character> = [".", "?", "!", "…"]
        if let last = text.last, last == "\"" || last == "”" {
            let inner = text.dropLast()
            if let innerLast = inner.last, terminal.contains(innerLast) { return text }
            return String(inner) + "." + String(last)
        }
        if let last = text.last, terminal.contains(last) { return text }
        return text + "."
    }

    private static func curlQuotes(_ text: String) -> String {
        var open = true
        return String(text.map { character -> Character in
            guard character == "\"" else { return character }
            open.toggle()
            return open ? "”" : "“"
        })
    }

    private static func unwrapQuotes(_ text: String) -> String {
        for (open, close) in [("\"", "\""), ("“", "”")] {
            guard text.count >= 2, text.hasPrefix(open), text.hasSuffix(close) else { continue }
            let inner = text.dropFirst().dropLast()
            if !inner.contains(close) {
                return inner.trimmingCharacters(in: .whitespaces)
            }
        }
        return text
    }

    private static func sentenceStart(_ before: String) -> Bool {
        matches(sentenceStartPattern, before)
    }

    // MARK: - Regex plumbing

    private static func regex(_ pattern: String) -> NSRegularExpression {
        do {
            return try NSRegularExpression(pattern: pattern, options: [.caseInsensitive])
        } catch {
            fatalError("Invalid ActionVoice pattern \(pattern): \(error)")
        }
    }

    private static func matches(_ regex: NSRegularExpression, _ text: String) -> Bool {
        let range = NSRange(text.startIndex..., in: text)
        return regex.firstMatch(in: text, range: range) != nil
    }

    private static func replace(
        _ regex: NSRegularExpression,
        in text: String,
        with transform: (String, [String?]) -> String
    ) -> String {
        replace(regex, in: text) { match, groups, _ in transform(match, groups) }
    }

    /// Replaces every match left to right; `transform` sees the match, its
    /// capture groups, and its range in the ORIGINAL string.
    private static func replace(
        _ regex: NSRegularExpression,
        in text: String,
        with transform: (String, [String?], Range<String.Index>) -> String
    ) -> String {
        let matches = regex.matches(in: text, range: NSRange(text.startIndex..., in: text))
        guard !matches.isEmpty else { return text }
        var result = ""
        var cursor = text.startIndex
        for match in matches {
            guard let range = Range(match.range, in: text) else { continue }
            result += text[cursor..<range.lowerBound]
            let groups: [String?] = (0..<match.numberOfRanges).map { index in
                Range(match.range(at: index), in: text).map { String(text[$0]) }
            }
            result += transform(String(text[range]), groups, range)
            cursor = range.upperBound
        }
        result += text[cursor...]
        return result
    }
}
