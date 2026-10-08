import SwiftUI

/// One model group's verdict from the OpenRouter account.
struct AccountPolicyLabel: View {
    let policy: AccountZdrPolicy

    var body: some View {
        switch policy {
        case .enforced:
            Text("\(Image(systemName: "checkmark.shield.fill")) Enforced")
                .foregroundStyle(.green)
                .accessibilityLabel("Enforced")
        case .notEnforced:
            Text("\(Image(systemName: "shield.slash")) Not enforced")
                .foregroundStyle(.secondary)
                .accessibilityLabel("Not enforced")
        case .unknown:
            Text("\(Image(systemName: "questionmark.circle")) Unknown")
                .foregroundStyle(.secondary)
                .accessibilityLabel("Unknown")
        }
    }
}
