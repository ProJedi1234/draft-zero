import Foundation

/// Field readers that tolerate a wrong-typed or absent value, as the web's
/// readers do: import files are traded between writers and edited by hand.
nonisolated enum ImportJSON {
    /// Parses file text; nil when it isn't JSON at all.
    static func parse(_ text: String) -> JSONValue? {
        try? JSONDecoder().decode(JSONValue.self, from: Data(text.utf8))
    }

    static func str(_ value: JSONValue?) -> String {
        if case .string(let string)? = value { string } else { "" }
    }

    /// The strings in an array, trimmed, blanks dropped.
    static func strArray(_ value: JSONValue?) -> [String] {
        guard case .array(let items)? = value else { return [] }
        return items.compactMap { item in
            guard case .string(let string) = item else { return nil }
            let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        }
    }

    static func num(_ value: JSONValue?) -> Double? {
        if case .number(let number)? = value, number.isFinite { number } else { nil }
    }

    static func record(_ value: JSONValue?) -> [String: JSONValue]? {
        if case .object(let object)? = value { object } else { nil }
    }

    static func array(_ value: JSONValue?) -> [JSONValue]? {
        if case .array(let items)? = value { items } else { nil }
    }

    /// Order-preserving de-duplication, like `[...new Set(list)]`.
    static func unique(_ values: [String]) -> [String] {
        var seen = Set<String>()
        return values.filter { seen.insert($0).inserted }
    }
}
