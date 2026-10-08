import SwiftUI

/// Retry, with a menu of profiles to retry under instead. Trying another
/// model on one passage changes nothing about what the story follows.
struct RetryMenu: View {
    let workspace: StoryWorkspace
    let disabled: Bool

    var body: some View {
        Menu {
            Section("Retry With Profile") {
                ForEach(workspace.profiles) { profile in
                    Button {
                        workspace.generation.retryLast(profileId: profile.id)
                    } label: {
                        if profile.id == workspace.story?.profileId {
                            Label(profile.name, systemImage: "checkmark")
                        } else {
                            Text(profile.name)
                        }
                    }
                }
            }
        } label: {
            Label("Retry", systemImage: "arrow.clockwise")
        } primaryAction: {
            workspace.generation.retryLast()
        }
        .disabled(disabled || !workspace.generation.canRetry)
        .accessibilityHint("Writes another take of the last passage. Hold for other profiles.")
    }
}
