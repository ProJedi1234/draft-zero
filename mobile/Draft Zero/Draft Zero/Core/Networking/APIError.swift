import Foundation

/// A failed call, in a form the UI can show and branch on.
nonisolated enum APIError: LocalizedError, Sendable, Equatable {
    /// The service refused: `invalid`, `not_found`, `conflict` or `failed`.
    case service(code: String, message: String, status: Int)
    /// A non-2xx response that was not a service envelope.
    case http(status: Int, message: String?)
    /// The server could not be reached.
    case transport(String)
    /// The response did not have the shape this client expects.
    case decoding(String)
    /// No server address has been configured yet.
    case notConfigured
    /// The NDJSON stream went silent past the keepalive window.
    case stalled

    var errorDescription: String? {
        switch self {
        case .service(_, let message, _):
            message
        case .http(let status, let message):
            message ?? "The server answered \(status)."
        case .transport(let message):
            message
        case .decoding:
            "The server sent something this version of the app can't read."
        case .notConfigured:
            "Connect to a Draft Zero server first."
        case .stalled:
            "The connection went quiet."
        }
    }

    var isConflict: Bool {
        if case .service(let code, _, _) = self { return code == "conflict" }
        if case .http(let status, _) = self { return status == 409 }
        return false
    }

    var isNotFound: Bool {
        if case .service(let code, _, _) = self { return code == "not_found" }
        if case .http(let status, _) = self { return status == 404 }
        return false
    }

    /// True when retrying later might succeed without anything changing here.
    var isTransient: Bool {
        switch self {
        case .transport, .stalled: true
        case .http(let status, _): status >= 500
        default: false
        }
    }
}
