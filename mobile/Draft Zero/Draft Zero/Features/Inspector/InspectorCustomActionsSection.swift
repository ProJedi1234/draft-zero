import SwiftUI

/// The end of an experiment: keep a Custom story's settings as a profile, or
/// go back to the profile this session left.
struct InspectorCustomActionsSection: View {
    let settings: StoryModelSettings
    let saveAsProfile: () -> Void

    var body: some View {
        Section {
            Button(action: saveAsProfile) {
                HStack {
                    Label("Save as Profile…", systemImage: "square.and.arrow.down")
                    if settings.isSavingProfile {
                        Spacer()
                        ProgressView()
                    }
                }
            }
            .disabled(settings.isSavingProfile)
            if let basedOn = settings.basedOnProfile {
                Button("Back to \(basedOn.name)", systemImage: "arrow.uturn.backward", action: returnToProfile)
            }
        } footer: {
            Text("A profile keeps these settings under a name any story can follow.")
        }
    }

    private func returnToProfile() {
        guard let basedOn = settings.basedOnProfile else { return }
        settings.chooseProfile(basedOn.id)
    }
}
