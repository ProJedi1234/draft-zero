import Foundation

/// Which half of the catalog a model picker shows. Remembered per device under
/// `storageKey` and shared by every picker; a view preference, so it never syncs.
nonisolated enum ModelSource: String, CaseIterable, Identifiable, Sendable {
    case all
    case local
    case external

    static let storageKey = "modelSource"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .all: "All"
        case .local: "Local"
        case .external: "External"
        }
    }
}
