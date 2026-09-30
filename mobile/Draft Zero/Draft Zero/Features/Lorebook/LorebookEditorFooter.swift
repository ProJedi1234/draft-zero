import SwiftUI

/// Deleting the entry, behind a confirmation.
struct LorebookEditorFooter: View {
    let name: String
    let delete: () -> Void

    @State private var isConfirming = false

    var body: some View {
        Section {
            Button("Delete Entry", systemImage: "trash", role: .destructive, action: confirm)
                .confirmationDialog(
                    "Delete “\(name)”?",
                    isPresented: $isConfirming,
                    titleVisibility: .visible
                ) {
                    Button("Delete Entry", role: .destructive, action: delete)
                } message: {
                    Text("It leaves the lorebook and every context it feeds. This can't be undone.")
                }
        }
    }

    private func confirm() {
        isConfirming = true
    }
}
