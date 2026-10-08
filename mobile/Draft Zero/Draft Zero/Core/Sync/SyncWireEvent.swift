import Foundation

/// One line of GET /api/sync/events, the long-lived "something changed"
/// channel. Mirrors `SyncWireEvent` in lib/sync/types.ts.
nonisolated enum SyncWireEvent: Decodable, Sendable {
    /// A composer's unsent state moved on some device.
    struct Draft: Decodable, Sendable {
        var storyId: String
        var text: String
        var mode: ComposerMode
        var imagePrompt: String?
        var imageAssisted: Bool
        var imageStyle: String?
        var imageExcludedLoreIds: [String]
        /// The row's updated_at; a device holding something newer turns this away.
        var version: String
        var origin: String
    }

    /// Where the atmosphere picker is on a story.
    struct Atmosphere: Decodable, Sendable {
        enum Phase: String, Decodable, Sendable {
            case checking, kept, painted, failed, stopped
        }
        var storyId: String
        var phase: Phase
        var message: String?
    }

    /// A row moved. Only the payloads this client folds in are decoded.
    struct Entity: Decodable, Sendable {
        enum Payload: Sendable {
            case story(StoryRecord)
            case lorebookEntry(LorebookEntry)
            case other
        }
        var op: String
        var entity: String
        var id: String
        var storyId: String?
        var version: String
        var origin: String?
        var payload: Payload

        private enum CodingKeys: String, CodingKey {
            case op, entity, id, storyId, version, origin, data
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            op = try container.decode(String.self, forKey: .op)
            entity = try container.decode(String.self, forKey: .entity)
            id = try container.decode(String.self, forKey: .id)
            storyId = try container.decodeIfPresent(String.self, forKey: .storyId)
            version = try container.decode(String.self, forKey: .version)
            origin = try container.decodeIfPresent(String.self, forKey: .origin)
            payload = .other
            guard op == "upsert" else { return }
            switch entity {
            case "story":
                if let record = try? container.decode(StoryRecord.self, forKey: .data) {
                    payload = .story(record)
                }
            case "lorebook-entry":
                if let entry = try? container.decode(LorebookEntry.self, forKey: .data) {
                    payload = .lorebookEntry(entry)
                }
            default:
                break
            }
        }
    }

    case hello
    case ping
    /// Something persisted changed. A nil story id is global: library, settings, profiles.
    case change(storyId: String?)
    case entity(Entity)
    case runStarted(storyId: String, runId: String)
    case imageRunStarted(storyId: String, runId: String)
    case deriveRunStarted(storyId: String, runId: String)
    case runEnded(storyId: String, runId: String, status: RunEndStatus)
    case summaryStopped(storyId: String)
    case draft(Draft)
    case atmosphere(Atmosphere)
    case unknown

    private enum CodingKeys: String, CodingKey {
        case type, storyId, runId, status
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)
        func story() throws -> String { try container.decode(String.self, forKey: .storyId) }
        func run() throws -> String { try container.decode(String.self, forKey: .runId) }
        switch type {
        case "hello": self = .hello
        case "ping": self = .ping
        case "change": self = .change(storyId: try container.decodeIfPresent(String.self, forKey: .storyId))
        case "entity": self = .entity(try Entity(from: decoder))
        case "run-started": self = .runStarted(storyId: try story(), runId: try run())
        case "image-run-started": self = .imageRunStarted(storyId: try story(), runId: try run())
        case "derive-run-started": self = .deriveRunStarted(storyId: try story(), runId: try run())
        case "run-ended":
            self = .runEnded(
                storyId: try story(),
                runId: try run(),
                status: try container.decode(RunEndStatus.self, forKey: .status)
            )
        case "summary-stopped": self = .summaryStopped(storyId: try story())
        case "draft": self = .draft(try Draft(from: decoder))
        case "atmosphere": self = .atmosphere(try Atmosphere(from: decoder))
        default: self = .unknown
        }
    }
}
