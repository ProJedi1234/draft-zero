import Foundation

/// The fields of the shared defaults that moved, so a save touches only what
/// this device changed and leaves another device's edits alone.
nonisolated enum GenerationDefaultsPatch {
    static func between(_ old: GenerationDefaults, _ new: GenerationDefaults) -> JSONObject {
        var patch: JSONObject = [:]
        if old.temperature != new.temperature { patch["temperature"] = .number(new.temperature) }
        if old.topP != new.topP { patch["topP"] = .number(new.topP) }
        if old.contextWindow != new.contextWindow { patch["contextWindow"] = .number(Double(new.contextWindow)) }
        if old.loreBudget != new.loreBudget { patch["loreBudget"] = .number(new.loreBudget) }
        if old.frequencyPenalty != new.frequencyPenalty { patch["frequencyPenalty"] = .number(new.frequencyPenalty) }
        if old.presencePenalty != new.presencePenalty { patch["presencePenalty"] = .number(new.presencePenalty) }
        return patch
    }
}
