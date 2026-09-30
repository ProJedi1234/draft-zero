import Foundation

/// One line of GET /api/image/subscribe: a snapshot with the sharpest preview
/// so far, live partials, then `end` once the illustration row is committed.
nonisolated enum ImageRunWireEvent: Decodable, Sendable {
    struct Frame: Decodable, Sendable {
        var runId: String
        var storyId: String
        var prompt: String
        var aspectRatio: ImageAspectRatio
        /// The slot a retry is redrawing, or nil for a new beat at the end.
        var imageGroupId: String?
        var previewB64: String?
        var previewMediaType: String?
    }

    struct End: Decodable, Sendable {
        var status: RunEndStatus
        var imageId: String?
        var error: String?
    }

    case frame(Frame)
    case partial(b64: String, mediaType: String)
    case ping
    case end(End)
    case unknown

    private enum CodingKeys: String, CodingKey {
        case type, b64, mediaType
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .type) {
        case "image-run": self = .frame(try Frame(from: decoder))
        case "partial":
            self = .partial(
                b64: try container.decode(String.self, forKey: .b64),
                mediaType: try container.decode(String.self, forKey: .mediaType)
            )
        case "ping": self = .ping
        case "end": self = .end(try End(from: decoder))
        default: self = .unknown
        }
    }
}
