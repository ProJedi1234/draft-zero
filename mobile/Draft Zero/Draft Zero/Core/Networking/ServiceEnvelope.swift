import Foundation

/// The body every service route answers with: `{ ok: true, data }` or
/// `{ ok: false, code, error }`. See lib/api/respond.ts.
nonisolated struct ServiceEnvelope<T: Decodable & Sendable>: Decodable, Sendable {
    let data: T?
    let code: String?
    let error: String?
    let ok: Bool

    private enum CodingKeys: String, CodingKey {
        case ok, data, code, error
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        ok = try container.decode(Bool.self, forKey: .ok)
        if ok {
            data = try container.decode(T.self, forKey: .data)
            code = nil
            error = nil
        } else {
            data = nil
            code = try container.decodeIfPresent(String.self, forKey: .code)
            error = try container.decodeIfPresent(String.self, forKey: .error)
        }
    }
}

/// The `{ error }` body the non-service routes answer failures with.
nonisolated struct ErrorBody: Decodable, Sendable {
    let error: String?
}
