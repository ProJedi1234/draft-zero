import UIKit

/// Loads and caches illustrations. An image id names one set of bytes for its
/// whole life, so a decoded image is cached by id and never revalidated.
final class ImageLoader {
    static let shared = ImageLoader()

    private let cache = NSCache<NSString, UIImage>()
    private var inFlight: [String: Task<UIImage, Error>] = [:]
    private let session: URLSession = {
        let configuration = URLSessionConfiguration.default
        configuration.urlCache = URLCache(memoryCapacity: 16 << 20, diskCapacity: 256 << 20)
        configuration.requestCachePolicy = .returnCacheDataElseLoad
        return URLSession(configuration: configuration)
    }()

    private init() {
        cache.totalCostLimit = 128 << 20
    }

    func cached(_ url: URL) -> UIImage? {
        cache.object(forKey: url.absoluteString as NSString)
    }

    func image(at url: URL) async throws -> UIImage {
        let key = url.absoluteString
        if let hit = cache.object(forKey: key as NSString) { return hit }
        if let running = inFlight[key] { return try await running.value }

        let task = Task { () throws -> UIImage in
            let (data, response) = try await session.data(from: url)
            if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                throw APIError.http(status: http.statusCode, message: "Couldn't load that picture.")
            }
            let mediaType = (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Type")
            return try await Self.decode(data, mediaType: mediaType)
        }
        inFlight[key] = task
        defer { inFlight[key] = nil }
        let image = try await task.value
        cache.setObject(image, forKey: key as NSString, cost: Self.cost(of: image))
        return image
    }

    /// Decodes bytes that may be a bitmap or an SVG.
    static func decode(_ data: Data, mediaType: String?) async throws -> UIImage {
        if isSVG(data, mediaType: mediaType) {
            return try await SVGRasterizer.rasterize(data)
        }
        guard let image = UIImage(data: data) else {
            throw APIError.decoding("Unreadable image data.")
        }
        return image
    }

    /// A base64 preview from a live draw, decoded the same way.
    static func decodePreview(base64: String, mediaType: String?) async -> UIImage? {
        guard let data = Data(base64Encoded: base64) else { return nil }
        return try? await decode(data, mediaType: mediaType)
    }

    private static func isSVG(_ data: Data, mediaType: String?) -> Bool {
        if mediaType?.contains("svg") == true { return true }
        guard let head = String(data: data.prefix(256), encoding: .utf8) else { return false }
        return head.contains("<svg")
    }

    private static func cost(of image: UIImage) -> Int {
        Int(image.size.width * image.size.height * image.scale * image.scale * 4)
    }
}
