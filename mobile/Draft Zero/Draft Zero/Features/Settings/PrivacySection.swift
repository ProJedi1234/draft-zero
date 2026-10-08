import SwiftUI

/// The app-wide retention floor, and what the OpenRouter account already
/// enforces for each model group.
struct PrivacySection: View {
    @Bindable var editor: AutosavedValue<Bool>
    let policies: AccountZdrPolicies

    var body: some View {
        let groups = policies.enforcedGroupList
        Section {
            ZdrToggle(
                "Require zero data retention",
                isOn: $editor.value,
                lock: policies.enforcesAll ? .account : nil,
                hint: "Every story and profile, whatever they say for themselves. Costs you the providers that retain prompts, and the models only they serve.",
                accountNote: groups.isEmpty ? nil : "Your OpenRouter account already enforces this for \(groups)."
            )
            ForEach(ZdrGroup.allCases) { group in
                LabeledContent(group.title) {
                    AccountPolicyLabel(policy: policies.policy(for: group))
                }
            }
            if groups.isEmpty {
                Link(destination: OpenRouterLinks.privacySettings) {
                    Label("OpenRouter Privacy Settings", systemImage: "arrow.up.forward.square")
                }
            }
        } header: {
            Text("Privacy")
        } footer: {
            VStack(alignment: .leading, spacing: 6) {
                Text("Your OpenRouter account's own policy, per model group. Unknown until a request reveals it; an enforced group routes privately whatever this app says.")
                SaveErrorLabel(message: editor.error)
            }
        }
    }
}
