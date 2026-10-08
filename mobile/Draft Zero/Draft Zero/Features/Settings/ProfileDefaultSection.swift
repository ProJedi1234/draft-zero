import SwiftUI

/// Whether new stories start from this profile, and who a save will move.
struct ProfileDefaultSection: View {
    let isDefault: Bool
    @Binding var makeDefault: Bool
    let consequence: String?

    var body: some View {
        Section {
            if isDefault {
                Label("New stories start from this profile.", systemImage: "star.fill")
                    .foregroundStyle(.secondary)
            } else {
                Toggle(isOn: $makeDefault) {
                    Text("Make default")
                    Text("New stories start from the default profile.")
                }
            }
        } footer: {
            if let consequence {
                Text(consequence)
            }
        }
    }
}
