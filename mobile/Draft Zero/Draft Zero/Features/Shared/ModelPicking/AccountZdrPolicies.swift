import Foundation

/// What the OpenRouter account enforces, group by group. `unknown` is the
/// common answer and locks nothing.
nonisolated struct AccountZdrPolicies: Equatable, Sendable {
    static let unknown = AccountZdrPolicies([:])

    private var byGroup: [ZdrGroup: AccountZdrPolicy]

    /// Reads the wire shape of GET /api/zdr; groups it omits are unknown.
    init(_ raw: [String: AccountZdrPolicy]) {
        var byGroup: [ZdrGroup: AccountZdrPolicy] = [:]
        for (key, policy) in raw {
            if let group = ZdrGroup(rawValue: key) { byGroup[group] = policy }
        }
        self.byGroup = byGroup
    }

    func policy(for group: ZdrGroup) -> AccountZdrPolicy {
        byGroup[group] ?? .unknown
    }

    /// True when the account forces retention-free routing on this model's group.
    func enforces(modelId: String) -> Bool {
        policy(for: ZdrGroup(modelId: modelId)) == .enforced
    }

    /// Only a verdict covering every group can lock the app-wide switch.
    var enforcesAll: Bool {
        ZdrGroup.allCases.allSatisfy { policy(for: $0) == .enforced }
    }

    /// "Anthropic", "Anthropic and OpenAI", "Anthropic, OpenAI and other
    /// providers" — in OpenRouter's own order; empty when none are enforced.
    var enforcedGroupList: String {
        let names = ZdrGroup.allCases.filter { policy(for: $0) == .enforced }.map(\.label)
        guard let last = names.last else { return "" }
        if names.count == 1 { return last }
        return "\(names.dropLast().joined(separator: ", ")) and \(last)"
    }
}
