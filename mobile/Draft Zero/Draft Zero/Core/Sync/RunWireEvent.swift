import Foundation

/// One line of GET /api/generation/subscribe. The first frame is always a
/// `run` snapshot with everything streamed so far; increments follow; `end` is
/// last and arrives only after the server has persisted the passage.
nonisolated enum RunWireEvent: Decodable, Sendable {
    struct Frame: Decodable, Sendable {
        var runId: String
        var storyId: String
        var requestKind: String
        /// The writer's persisted turn, or nil for Continue and Retry.
        var userEntryId: String?
        /// Entry ids this run supersedes; attachers hide them.
        var removingEntryIds: [String]
        var reasoningChars: Int
        /// Prose so far.
        var text: String
    }

    struct End: Decodable, Sendable {
        var status: RunEndStatus
        /// The persisted passage, when any prose survived.
        var entryId: String?
        var error: String?
        var usage: GenerationUsage?
    }

    case run(Frame)
    case text(String)
    case reasoning(chars: Int)
    case usage(GenerationUsage)
    case ping
    case end(End)
    case unknown

    private enum CodingKeys: String, CodingKey {
        case type, value, chars, usage
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .type) {
        case "run": self = .run(try Frame(from: decoder))
        case "text": self = .text(try container.decode(String.self, forKey: .value))
        case "reasoning": self = .reasoning(chars: try container.decode(Int.self, forKey: .chars))
        case "usage": self = .usage(try container.decode(GenerationUsage.self, forKey: .usage))
        case "ping": self = .ping
        case "end": self = .end(try End(from: decoder))
        default: self = .unknown
        }
    }
}
