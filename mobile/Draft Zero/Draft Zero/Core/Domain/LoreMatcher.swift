import Foundation

/// Which lorebook entries a text summons. A port of
/// `matchActiveLorebookEntries` in lib/generation/lorebook.ts and the brief
/// selection in lib/images/brief-lore.ts, so the chips on screen and the
/// entries the server feeds the develop call are one list.
nonisolated enum LoreMatcher {
    struct Match: Sendable, Hashable, Identifiable {
        var entry: LorebookEntry
        var matchedKey: String?
        /// Cascade rounds from a scan source; 0 is direct or always-on.
        var depth: Int
        var triggeredBy: LoreTrigger?
        var stable: Bool
        var id: String { entry.id }
    }

    struct ScanSource {
        var id: LoreTrigger.Source
        /// Already lowercased.
        var text: String
    }

    /// How many cascade rounds run past the direct matches.
    static let maxCascadeDepth = 3
    /// How much lore content a develop call carries, in UTF-16 units.
    static let briefLoreCharBudget = 16_000

    /// The entries a brief activates, priority descending then depth ascending.
    static func matchBrief(_ entries: [LorebookEntry], brief: String) -> [Match] {
        matchActive(entries, sources: [ScanSource(id: .story, text: brief.lowercased())])
    }

    /// What a develop call actually carries: matched, minus muted ids, trimmed to the budget.
    static func selectBrief(
        _ entries: [LorebookEntry],
        brief: String,
        excluding excluded: Set<String>
    ) -> [Match] {
        var selected: [Match] = []
        var spent = 0
        for match in matchBrief(entries, brief: brief) where !excluded.contains(match.entry.id) {
            let cost = match.entry.content.utf16.count
            if spent + cost > briefLoreCharBudget { continue }
            selected.append(match)
            spent += cost
        }
        return selected
    }

    static func matchActive(_ entries: [LorebookEntry], sources: [ScanSource]) -> [Match] {
        let candidates = entries.filter(\.enabled)
        var active: [String: Match] = [:]

        for entry in candidates {
            var matchedKey: String?
            var trigger: LoreTrigger?
            var stable = false
            for source in sources {
                guard let key = firstMatchingKey(entry, in: source.text) else { continue }
                matchedKey = key
                trigger = .source(source.id)
                stable = source.id != .story
                break
            }
            if entry.alwaysActive {
                active[entry.id] = Match(entry: entry, matchedKey: matchedKey, depth: 0, triggeredBy: nil, stable: true)
                continue
            }
            guard let trigger else { continue }
            active[entry.id] = Match(entry: entry, matchedKey: matchedKey, depth: 0, triggeredBy: trigger, stable: stable)
        }

        var frontier = active.values.sorted(by: ordered)
        for depth in 1...maxCascadeDepth {
            if frontier.isEmpty { break }
            var reached: [Match] = []
            for entry in candidates where active[entry.id] == nil {
                for source in frontier {
                    guard let key = firstMatchingKey(entry, in: source.entry.content.lowercased()) else { continue }
                    reached.append(
                        Match(
                            entry: entry,
                            matchedKey: key,
                            depth: depth,
                            triggeredBy: .lore(id: source.entry.id, name: source.entry.name),
                            stable: source.stable
                        )
                    )
                    break
                }
            }
            for match in reached { active[match.entry.id] = match }
            frontier = reached.sorted(by: ordered)
        }

        return active.values.sorted(by: ordered)
    }

    private static func firstMatchingKey(_ entry: LorebookEntry, in haystack: String) -> String? {
        for key in entry.keys {
            let needle = key.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            if needle.isEmpty { continue }
            if haystack.contains(needle) { return key }
        }
        return nil
    }

    /// Priority descending, then depth ascending, then id ascending.
    private static func ordered(_ a: Match, _ b: Match) -> Bool {
        if a.entry.priority != b.entry.priority { return a.entry.priority > b.entry.priority }
        if a.depth != b.depth { return a.depth < b.depth }
        return a.entry.id < b.entry.id
    }
}
