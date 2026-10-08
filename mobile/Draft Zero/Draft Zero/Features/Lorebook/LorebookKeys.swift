import Foundation

/// Trigger-key editing rules. Matching is case-insensitive, so "Wren" and
/// "wren" are the same key and the second is refused.
nonisolated enum LorebookKeys {
    /// Adds each comma-separated key in `text` that is not blank or already present.
    static func adding(_ text: String, to keys: [String]) -> [String] {
        var result = keys
        for part in text.split(separator: ",") {
            let key = part.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !key.isEmpty, !contains(result, key) else { continue }
            result.append(key)
        }
        return result
    }

    static func contains(_ keys: [String], _ key: String) -> Bool {
        let folded = key.lowercased()
        return keys.contains { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == folded }
    }

    /// Splits typing at its last comma: everything before it is ready to become
    /// keys, the rest is still being typed.
    static func splitAtLastComma(_ text: String) -> (committed: String, remainder: String)? {
        guard let comma = text.lastIndex(of: ",") else { return nil }
        return (String(text[..<comma]), String(text[text.index(after: comma)...]))
    }
}
