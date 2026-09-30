import SwiftUI

/// One trigger key as a capsule; tapping it removes the key.
struct LorebookKeyToken: View {
    let key: String
    let remove: (String) -> Void

    var body: some View {
        Button(action: removeKey) {
            HStack(spacing: 6) {
                Text(key)
                    .lineLimit(1)
                Image(systemName: "xmark.circle.fill")
                    .imageScale(.small)
                    .foregroundStyle(.secondary)
            }
            .font(.subheadline)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(.tint.quaternary, in: .capsule)
            .frame(minHeight: 44)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(key)
        .accessibilityHint("Removes this key.")
        .accessibilityAction(named: "Remove", removeKey)
    }

    private func removeKey() {
        remove(key)
    }
}
