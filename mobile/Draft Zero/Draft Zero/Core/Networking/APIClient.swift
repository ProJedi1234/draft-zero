import Foundation

/// A JSON object body, for patches where an absent key and a null differ.
typealias JSONObject = [String: JSONValue]

/// The Draft Zero HTTP API. Service routes answer with a `ServiceEnvelope`;
/// payload routes (workspace, snapshot, drafts, runs) answer with bare JSON.
/// Every call carries the session's sync origin so the server can stamp the
/// events it publishes, and this device can ignore its own echo.
nonisolated struct APIClient: Sendable {
    enum Method: String, Sendable {
        case get = "GET"
        case post = "POST"
        case patch = "PATCH"
        case delete = "DELETE"
    }

    let baseURL: URL
    /// This launch's identity on the sync channel.
    let origin: String
    private let session: URLSession
    private let streamSession: URLSession

    init(baseURL: URL, origin: String) {
        self.baseURL = baseURL
        self.origin = origin

        let requests = URLSessionConfiguration.default
        requests.requestCachePolicy = .reloadIgnoringLocalCacheData
        requests.timeoutIntervalForRequest = 60
        requests.waitsForConnectivity = false
        session = URLSession(configuration: requests)

        // Streams get their own pool so a held sync socket and three run
        // subscriptions never starve ordinary requests of connections.
        let streams = URLSessionConfiguration.default
        streams.requestCachePolicy = .reloadIgnoringLocalCacheData
        streams.timeoutIntervalForRequest = 90
        streams.timeoutIntervalForResource = 60 * 60 * 24
        streams.httpMaximumConnectionsPerHost = 8
        streamSession = URLSession(configuration: streams)
    }

    // MARK: - Service routes

    /// Calls a service route and returns its `data`.
    func service<T: Decodable & Sendable>(
        _ method: Method,
        _ path: String,
        query: [URLQueryItem] = [],
        body: JSONObject? = nil,
        as type: T.Type = T.self
    ) async throws -> T {
        let request = try makeRequest(method, path, query: query, body: body.map(encodeBody))
        let (data, response) = try await perform(request)
        return try await Self.unwrap(ServiceEnvelope<T>.self, data: data, status: response.statusCode)
    }

    /// Calls a service route whose data nobody reads.
    func serviceVoid(
        _ method: Method,
        _ path: String,
        body: JSONObject? = nil
    ) async throws {
        _ = try await service(method, path, body: body, as: JSONValue.self)
    }

    /// Calls a service route with an Encodable body.
    func service<T: Decodable & Sendable, Body: Encodable & Sendable>(
        _ method: Method,
        _ path: String,
        encodable body: Body,
        as type: T.Type = T.self
    ) async throws -> T {
        let request = try makeRequest(method, path, body: try JSONEncoder().encode(body))
        let (data, response) = try await perform(request)
        return try await Self.unwrap(ServiceEnvelope<T>.self, data: data, status: response.statusCode)
    }

    // MARK: - Payload routes

    /// Calls a route that answers with bare JSON.
    func payload<T: Decodable & Sendable>(
        _ method: Method = .get,
        _ path: String,
        query: [URLQueryItem] = [],
        body: JSONObject? = nil,
        as type: T.Type = T.self
    ) async throws -> T {
        guard let value = try await optionalPayload(method, path, query: query, body: body, as: type) else {
            throw APIError.decoding("Expected a body, got 204.")
        }
        return value
    }

    /// Like `payload`, but a 204 is an answer: nil.
    func optionalPayload<T: Decodable & Sendable>(
        _ method: Method = .get,
        _ path: String,
        query: [URLQueryItem] = [],
        body: JSONObject? = nil,
        as type: T.Type = T.self
    ) async throws -> T? {
        try await optionalPayloadAndData(method, path, query: query, body: body, as: type)?.value
    }

    /// Like `optionalPayload`, with the bytes the value was decoded from, for keeping on the device.
    func optionalPayloadAndData<T: Decodable & Sendable>(
        _ method: Method = .get,
        _ path: String,
        query: [URLQueryItem] = [],
        body: JSONObject? = nil,
        as type: T.Type = T.self
    ) async throws -> (value: T, data: Data)? {
        let request = try makeRequest(method, path, query: query, body: body.map(encodeBody))
        let (data, response) = try await perform(request)
        if response.statusCode == 204 { return nil }
        guard (200..<300).contains(response.statusCode) else {
            throw await Self.failure(data: data, status: response.statusCode)
        }
        return (try await Self.decode(T.self, from: data), data)
    }

    /// Uploads raw bytes to a service route, as the backup importer takes them.
    func upload<T: Decodable & Sendable>(
        _ path: String,
        data body: Data,
        contentType: String,
        as type: T.Type = T.self
    ) async throws -> T {
        var request = try makeRequest(.post, path, body: nil)
        request.setValue(contentType, forHTTPHeaderField: "content-type")
        request.httpBody = body
        request.timeoutInterval = 300
        let (data, response) = try await perform(request)
        return try await Self.unwrap(ServiceEnvelope<T>.self, data: data, status: response.statusCode)
    }

    // MARK: - Streams

    /// Opens an NDJSON stream. Nil on 204, which the run channels use to say
    /// "nothing to watch".
    func stream<T: Decodable & Sendable>(
        _ path: String,
        query: [URLQueryItem] = [],
        as type: T.Type
    ) async throws -> AsyncThrowingStream<T, Error>? {
        let request = try makeRequest(.get, path, query: query, body: nil)
        let bytes: URLSession.AsyncBytes
        let response: URLResponse
        do {
            (bytes, response) = try await streamSession.bytes(for: request)
        } catch {
            throw Self.map(error)
        }
        guard let http = response as? HTTPURLResponse else {
            throw APIError.transport("The server sent no HTTP response.")
        }
        if http.statusCode == 204 { return nil }
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.http(status: http.statusCode, message: nil)
        }
        return NDJSONReader.events(from: bytes, as: T.self, stallAfter: SyncTiming.stallTimeout)
    }

    // MARK: - URLs

    /// The bytes behind a stored illustration. Immutable, so safe to cache.
    func imageURL(_ imageId: String) -> URL {
        baseURL.appending(path: "api/images/\(imageId)")
    }

    func url(_ path: String, query: [URLQueryItem] = []) -> URL {
        var url = baseURL.appending(path: path)
        if !query.isEmpty { url.append(queryItems: query) }
        return url
    }

    // MARK: - Plumbing

    private func encodeBody(_ body: JSONObject) throws -> Data {
        try JSONEncoder().encode(body)
    }

    private func makeRequest(
        _ method: Method,
        _ path: String,
        query: [URLQueryItem] = [],
        body: Data?
    ) throws -> URLRequest {
        var request = URLRequest(url: url(path, query: query))
        request.httpMethod = method.rawValue
        request.setValue(origin, forHTTPHeaderField: "x-sync-origin")
        request.setValue("application/json", forHTTPHeaderField: "accept")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "content-type")
            request.httpBody = body
        }
        return request
    }

    private func perform(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                throw APIError.transport("The server sent no HTTP response.")
            }
            return (data, http)
        } catch {
            throw Self.map(error)
        }
    }

    private static func map(_ error: Error) -> Error {
        if error is CancellationError { return error }
        if let apiError = error as? APIError { return apiError }
        if let urlError = error as? URLError {
            if urlError.code == .cancelled { return CancellationError() }
            return APIError.transport(urlError.localizedDescription)
        }
        return APIError.transport(error.localizedDescription)
    }

    @concurrent
    private static func unwrap<T>(
        _ type: ServiceEnvelope<T>.Type,
        data: Data,
        status: Int
    ) async throws -> T {
        let envelope: ServiceEnvelope<T>
        do {
            envelope = try JSONDecoder().decode(type, from: data)
        } catch {
            if !(200..<300).contains(status) {
                throw await failure(data: data, status: status)
            }
            throw APIError.decoding(String(describing: error))
        }
        if envelope.ok, let value = envelope.data {
            return value
        }
        if envelope.ok {
            throw APIError.decoding("Missing data.")
        }
        throw APIError.service(
            code: envelope.code ?? "failed",
            message: envelope.error ?? "Something went wrong.",
            status: status
        )
    }

    @concurrent
    static func decode<T: Decodable & Sendable>(_ type: T.Type, from data: Data) async throws -> T {
        do {
            return try JSONDecoder().decode(type, from: data)
        } catch {
            throw APIError.decoding(String(describing: error))
        }
    }

    @concurrent
    private static func failure(data: Data, status: Int) async -> APIError {
        let message = (try? JSONDecoder().decode(ErrorBody.self, from: data))?.error
        return .http(status: status, message: message)
    }
}
