import Foundation

/// How the gallery lays its pictures out.
nonisolated enum GalleryOrder: String, CaseIterable, Identifiable, Sendable {
    case newest
    case byStory

    var id: String { rawValue }

    var title: String {
        switch self {
        case .newest: "Newest First"
        case .byStory: "By Story"
        }
    }

    var systemImage: String {
        switch self {
        case .newest: "square.grid.2x2"
        case .byStory: "rectangle.stack"
        }
    }
}
