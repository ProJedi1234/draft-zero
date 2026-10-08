import Foundation

/// Whether a setting shows its own value or the default it falls back to.
enum SettingInheritance {
    /// Showing the fallback; moving the control takes it over. The label names
    /// the fallback: "Default", or "Auto" for a derived value.
    case following(label: String)
    /// Showing its own value; `revert` hands it back to the fallback.
    case overridden(revert: () -> Void)

    var isFollowing: Bool {
        if case .following = self { return true }
        return false
    }
}
