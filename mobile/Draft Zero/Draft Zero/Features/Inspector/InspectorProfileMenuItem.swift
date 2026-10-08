import SwiftUI

/// A profile in the switcher: its name, its bundle in one line, and a star on
/// the one new stories start from.
struct InspectorProfileMenuItem: View {
    let name: String
    let detail: String
    let isDefault: Bool

    var body: some View {
        Label {
            Text(name)
            Text(detail)
        } icon: {
            if isDefault {
                Image(systemName: "star.fill")
                    .accessibilityLabel("Default")
            }
        }
    }
}
