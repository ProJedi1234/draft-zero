import Foundation

/// One line of GET /api/image-prompt/subscribe: the brief being answered and
/// the prompt so far, increments, then `end` with the settled text.
nonisolated enum DeriveRunWireEvent: Decodable, Sendable {
    struct Frame: Decodable, Sendable {
        var runId: String
        var storyId: String
        /// The writer's brief, or "" to describe the story as it stands.
        var brief: String
        var excludedLoreIds: [String]
        var text: String
    }

    struct End: Decodable, Sendable {
        var status: RunEndStatus
        /// Everything the model wrote; the authority over accumulated increments.
        var text: String
        var error: String?
    }

    case frame(Frame)
    case text(String)
    case ping
    case end(End)
    case unknown

    private enum CodingKeys: String, CodingKey {
        case type, value
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .type) {
        case "derive-run": self = .frame(try Frame(from: decoder))
        case "text": self = .text(try container.decode(String.self, forKey: .value))
        case "ping": self = .ping
        case "end": self = .end(try End(from: decoder))
        default: self = .unknown
        }
    }
}
