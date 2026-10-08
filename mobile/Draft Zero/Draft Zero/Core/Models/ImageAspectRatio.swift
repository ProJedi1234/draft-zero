import Foundation

/// The frames an illustration may be drawn in, in the order the frame control
/// cycles them.
nonisolated enum ImageAspectRatio: String, Codable, Sendable, CaseIterable, Identifiable {
    case landscape = "16:9"
    case square = "1:1"
    case portrait = "9:16"

    var id: String { rawValue }

    /// Width over height, for reserving space before pixels arrive.
    var value: Double {
        switch self {
        case .landscape: 16.0 / 9.0
        case .square: 1
        case .portrait: 9.0 / 16.0
        }
    }

    var systemImage: String {
        switch self {
        case .landscape: "rectangle"
        case .square: "square"
        case .portrait: "rectangle.portrait"
        }
    }

    var next: ImageAspectRatio {
        let all = Self.allCases
        let index = all.firstIndex(of: self) ?? 0
        return all[(index + 1) % all.count]
    }

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = ImageAspectRatio(rawValue: raw) ?? .landscape
    }
}
