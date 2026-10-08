import Foundation

/// The inspector's readouts, worded and rounded as the web inspector does.
nonisolated enum InspectorText {
    /// 812 → "812", 1234 → "1.2k", 24000 → "24k". Lowercase k, to match the
    /// ladder label it is printed against. Port of `formatApproxTokens`.
    static func approxTokens(_ tokens: Int) -> String {
        if tokens >= 10_000 { return "\(Int((Double(tokens) / 1_000).rounded()))k" }
        if tokens >= 1_000 { return "\((Double(tokens) / 1_000).formatted(fixed: 1))k" }
        return "\(tokens)"
    }

    /// The recap's state in a word or two. "Paused" and "Not needed yet" are
    /// different facts, and a writer looking for the feature needs both.
    static func recapStatus(summarize: Bool, summary: String) -> String {
        guard summarize else { return "Paused" }
        let words = summary.split(whereSeparator: \.isWhitespace).count
        return words == 0 ? "Not needed yet" : "\(words) \(words == 1 ? "word" : "words")"
    }

    /// "via Memory · matched “wren”", the line under a lore entry's name.
    static func loreArrival(_ match: LoreMatcher.Match) -> String {
        var parts = [LoreTrigger.describe(match.triggeredBy)]
        if let key = match.matchedKey {
            parts.append("matched “\(key)”")
        }
        return parts.joined(separator: " · ")
    }

    /// "Priority 50", with the cascade depth when the entry arrived by association.
    static func loreRank(_ match: LoreMatcher.Match) -> String {
        let priority = "Priority \(match.entry.priority)"
        guard match.depth > 0 else { return priority }
        return "\(priority) · \(match.depth == 1 ? "1 hop" : "\(match.depth) hops") away"
    }
}
