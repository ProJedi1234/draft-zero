import SwiftUI

/// A setting's name with its inheritance state beside it: a quiet tag while
/// it follows the default, and the way back once it has its own value.
struct SettingTitle: View {
    let title: String
    let inheritance: SettingInheritance?

    var body: some View {
        HStack(spacing: 8) {
            Text(title)
            switch inheritance {
            case .following(let label):
                Text(label)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 1)
                    .background(.quaternary, in: .capsule)
            case .overridden(let revert):
                Button(action: revert) {
                    Label("Reset", systemImage: "arrow.uturn.backward")
                        .font(.subheadline)
                }
                .buttonStyle(.borderless)
                .contentShape(Rectangle().inset(by: -10))
                .accessibilityLabel("Reset \(title) to the default")
            case nil:
                EmptyView()
            }
        }
    }
}
