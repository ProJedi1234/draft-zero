import Foundation
import Synchronization

/// Turns an NDJSON response into a stream of decoded records.
///
/// Lines are split on the newline byte only. A network read boundary has
/// nothing to do with a record boundary, so partial lines are held until their
/// newline arrives. `AsyncBytes.lines` is not used because it also splits on
/// U+2028, which JSON strings may carry unescaped inside model prose.
nonisolated enum NDJSONReader {
    static func events<T: Decodable & Sendable, Bytes: AsyncSequence & Sendable>(
        from bytes: Bytes,
        as type: T.Type,
        stallAfter: Duration
    ) -> AsyncThrowingStream<T, Error> where Bytes.Element == UInt8 {
        AsyncThrowingStream { continuation in
            let activity = ActivityClock()

            let reader = Task {
                let decoder = JSONDecoder()
                var line: [UInt8] = []
                line.reserveCapacity(4096)
                do {
                    for try await byte in bytes {
                        if byte == 0x0A {
                            activity.touch()
                            if let record = decode(line, as: type, decoder: decoder) {
                                continuation.yield(record)
                            }
                            line.removeAll(keepingCapacity: true)
                        } else {
                            line.append(byte)
                            if line.count & 0x3FF == 0 { activity.touch() }
                        }
                    }
                    // The terminal frame is always last; a stream that ended
                    // without a final newline still holds a whole record.
                    if let record = decode(line, as: type, decoder: decoder) {
                        continuation.yield(record)
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }

            // iOS kills a backgrounded socket without an error or a close; the
            // read simply never resolves. Silence past the ping window is death.
            let watchdog = Task {
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(2))
                    if activity.silence > stallAfter {
                        continuation.finish(throwing: APIError.stalled)
                        reader.cancel()
                        return
                    }
                }
            }

            continuation.onTermination = { _ in
                reader.cancel()
                watchdog.cancel()
            }
        }
    }

    /// A line that does not parse is dropped rather than thrown: the passage on
    /// screen is worth more than strictness about one frame.
    private static func decode<T: Decodable>(
        _ line: [UInt8],
        as type: T.Type,
        decoder: JSONDecoder
    ) -> T? {
        guard line.contains(where: { $0 != 0x20 && $0 != 0x0D && $0 != 0x09 }) else { return nil }
        return try? decoder.decode(type, from: Data(line))
    }
}

/// When the stream last showed signs of life.
nonisolated final class ActivityClock: Sendable {
    private let last = Mutex(ContinuousClock.now)

    func touch() {
        last.withLock { $0 = .now }
    }

    var silence: Duration {
        last.withLock { ContinuousClock.now - $0 }
    }
}
