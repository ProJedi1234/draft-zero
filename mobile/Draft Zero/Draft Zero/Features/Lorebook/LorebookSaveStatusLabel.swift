import SwiftUI

/// The autosave's state in a few words.
struct LorebookSaveStatusLabel: View {
    let editor: LorebookEntryEditor

    var body: some View {
        Group {
            switch editor.saveState {
            case .saving:
                Label {
                    Text("Saving…")
                } icon: {
                    ProgressView()
                        .controlSize(.small)
                }
            case .saved:
                Label("Saved", systemImage: "checkmark.circle")
            case .failed:
                Label("Not Saved", systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.red)
            case .idle:
                Text(editor.statusLine)
            }
        }
        .font(.subheadline)
        .foregroundStyle(.secondary)
        .contentTransition(.opacity)
        .animation(Theme.quickAnimation, value: editor.saveState)
    }
}
