import Foundation

/// What the profile editor is doing, and the profile it starts from.
/// "Duplicate" is a create seeded from an existing profile.
nonisolated struct ProfileEditorTarget: Identifiable, Hashable, Sendable {
    enum Mode: String, Hashable, Sendable {
        case create
        case edit
        case duplicate

        var title: String {
            switch self {
            case .create: "New Profile"
            case .edit: "Edit Profile"
            case .duplicate: "Duplicate Profile"
            }
        }
    }

    var mode: Mode
    /// The row being edited, or the seed for a create or duplicate; nil only
    /// when there is no profile at all to start from.
    var profile: ModelProfile?

    var id: String { "\(mode.rawValue):\(profile?.id ?? "new")" }
}
