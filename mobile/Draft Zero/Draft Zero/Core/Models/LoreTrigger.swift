import Foundation

/// Why a lorebook entry is in context: a scan source, or another entry that named it.
nonisolated enum LoreTrigger: Codable, Sendable, Hashable {
    enum Source: String, Codable, Sendable {
        case memory
        case authorsNote
        case story
    }

    case source(Source)
    case lore(id: String, name: String)

    private enum CodingKeys: String, CodingKey {
        case kind, source, id, name
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if try container.decode(String.self, forKey: .kind) == "lore" {
            self = .lore(
                id: try container.decode(String.self, forKey: .id),
                name: try container.decode(String.self, forKey: .name)
            )
        } else {
            let raw = try container.decode(String.self, forKey: .source)
            self = .source(Source(rawValue: raw) ?? .story)
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .source(let source):
            try container.encode("source", forKey: .kind)
            try container.encode(source, forKey: .source)
        case .lore(let id, let name):
            try container.encode("lore", forKey: .kind)
            try container.encode(id, forKey: .id)
            try container.encode(name, forKey: .name)
        }
    }

    /// How the arrival reads in the UI, worded as the web inspector words it.
    static func describe(_ trigger: LoreTrigger?) -> String {
        guard let trigger else { return "Always on" }
        switch trigger {
        case .lore(_, let name): return "via \(name)"
        case .source(.memory): return "via Memory"
        case .source(.authorsNote): return "via Author's note"
        case .source(.story): return "via recent text"
        }
    }

    /// True when a scan source named the entry directly rather than a cascade.
    var isDirect: Bool {
        if case .source = self { true } else { false }
    }
}
