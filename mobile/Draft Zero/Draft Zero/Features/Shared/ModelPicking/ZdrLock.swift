import Foundation

/// Why a zero-data-retention switch is on and cannot be turned off here.
nonisolated enum ZdrLock: Equatable, Sendable {
    /// OpenRouter applies the account's policy to every request in the group.
    case account
    /// The writer's app-wide floor, lowered only in Settings.
    case app
    /// Not a policy: a local model's request never leaves the network.
    case local

    var note: String {
        switch self {
        case .account: "Required by your OpenRouter account."
        case .app: "Required by the app-wide policy in Settings."
        case .local: "Always on for a local model, which runs on your own hardware."
        }
    }

    /// The account outranks the app: it is the one this app cannot argue with.
    static func resolve(accountEnforced: Bool, requireZdr: Bool) -> ZdrLock? {
        if accountEnforced { return .account }
        return requireZdr ? .app : nil
    }
}
