import Foundation
import Testing
@testable import Draft_Zero

/// The stream reader must hold partial lines across arbitrary chunk
/// boundaries and never split inside a JSON string.
struct NDJSONReaderTests {
    private func collect<T: Decodable & Sendable>(_ data: Data, as type: T.Type) async throws -> [T] {
        var events: [T] = []
        let stream = NDJSONReader.events(
            from: FixtureLoader.byteStream(data),
            as: type,
            stallAfter: .seconds(30)
        )
        for try await event in stream { events.append(event) }
        return events
    }

    @Test func runStreamReplaysToTheTerminalFrame() async throws {
        let events = try await collect(try FixtureLoader.data("run.ndjson"), as: RunWireEvent.self)
        guard case .run(let frame)? = events.first else {
            Issue.record("First frame was not the run snapshot")
            return
        }
        #expect(frame.userEntryId != nil)
        guard case .end(let end)? = events.last else {
            Issue.record("Last frame was not end")
            return
        }
        #expect(end.status == .ok)
        #expect(end.entryId != nil)
        #expect(end.usage?.completionTokens ?? 0 > 0)
    }

    @Test func imageAndDeriveStreams() async throws {
        let image = try await collect(try FixtureLoader.data("image-run.ndjson"), as: ImageRunWireEvent.self)
        #expect(image.count == 4)
        if case .end(let end)? = image.last {
            #expect(end.imageId != nil)
        } else {
            Issue.record("Image stream did not end")
        }

        let derive = try await collect(try FixtureLoader.data("derive-run.ndjson"), as: DeriveRunWireEvent.self)
        if case .end(let end)? = derive.last {
            #expect(!end.text.isEmpty)
        } else {
            Issue.record("Derive stream did not end")
        }
    }

    @Test func syncStreamDecodesDraftsAndEntities() async throws {
        let events = try await collect(try FixtureLoader.data("sync.ndjson"), as: SyncWireEvent.self)
        #expect(events.contains { if case .hello = $0 { true } else { false } })
        #expect(events.contains { if case .draft(let draft) = $0 { draft.text == "I trim the wick" } else { false } })
        #expect(events.contains {
            if case .entity(let entity) = $0, case .story = entity.payload { true } else { false }
        })
    }

    @Test func lineSeparatorInsideProseDoesNotSplitTheRecord() async throws {
        let prose = "before\u{2028}after"
        let line = try JSONEncoder().encode(["type": "text", "value": prose])
        var data = line
        data.append(0x0A)
        let events = try await collect(data, as: RunWireEvent.self)
        guard case .text(let value)? = events.first else {
            Issue.record("Expected one text event")
            return
        }
        #expect(value == prose)
    }

    @Test func finalRecordWithoutNewlineStillArrives() async throws {
        let text = #"{"type":"ping"}"# + "\n" + #"{"type":"end","status":"aborted","entryId":null,"error":null,"usage":null}"#
        let data = Data(text.utf8)
        let events = try await collect(data, as: RunWireEvent.self)
        #expect(events.count == 2)
        if case .end(let end)? = events.last {
            #expect(end.status == RunEndStatus.aborted)
        } else {
            Issue.record("Missing terminal frame")
        }
    }

    @Test func unparseableLineIsDropped() async throws {
        let data = Data("{\"type\":\"text\",\"value\":\"a\"}\n{not json\n{\"type\":\"text\",\"value\":\"b\"}\n".utf8)
        let events = try await collect(data, as: RunWireEvent.self)
        #expect(events.count == 2)
    }
}
