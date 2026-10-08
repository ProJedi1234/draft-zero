import Foundation

/// Reads the JSON and NDJSON captured verbatim from a running server.
enum FixtureLoader {
    private final class Token {}

    static func data(_ name: String) throws -> Data {
        let bundle = Bundle(for: Token.self)
        let parts = name.split(separator: ".", maxSplits: 1).map(String.init)
        guard let url = bundle.url(forResource: parts[0], withExtension: parts.count > 1 ? parts[1] : nil) else {
            throw CocoaError(.fileNoSuchFile, userInfo: [NSFilePathErrorKey: name])
        }
        return try Data(contentsOf: url)
    }

    static func decode<T: Decodable>(_ type: T.Type, from name: String) throws -> T {
        try JSONDecoder().decode(type, from: data(name))
    }

    /// The bytes delivered one at a time, the harshest chunking a network could produce.
    static func byteStream(_ data: Data) -> AsyncStream<UInt8> {
        AsyncStream { continuation in
            for byte in data { continuation.yield(byte) }
            continuation.finish()
        }
    }
}
