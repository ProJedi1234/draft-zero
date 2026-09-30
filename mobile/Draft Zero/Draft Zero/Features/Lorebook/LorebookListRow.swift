import SwiftUI

/// One entry in the list, with swipe actions to switch it on or off and to delete it.
struct LorebookListRow: View {
    let model: LorebookModel
    let entry: LorebookEntry

    @State private var isConfirmingDelete = false

    var body: some View {
        LorebookEntryRow(entry: entry, isSelected: model.usesSplitLayout && model.selectedId == entry.id)
            .swipeActions(edge: .leading) {
                Button(
                    entry.enabled ? "Disable" : "Enable",
                    systemImage: entry.enabled ? "pause.circle" : "play.circle",
                    action: toggleEnabled
                )
                .tint(entry.enabled ? .gray : .green)
            }
            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                Button("Delete", systemImage: "trash", action: confirmDelete)
                    .tint(.red)
            }
            .contextMenu {
                Button(
                    entry.enabled ? "Disable" : "Enable",
                    systemImage: entry.enabled ? "pause.circle" : "play.circle",
                    action: toggleEnabled
                )
                Button(
                    entry.alwaysActive ? "Trigger by Keys Only" : "Make Always Active",
                    systemImage: entry.alwaysActive ? "pin.slash" : "pin",
                    action: toggleAlwaysActive
                )
                Divider()
                Button("Delete…", systemImage: "trash", role: .destructive, action: confirmDelete)
            }
            .confirmationDialog(
                "Delete “\(entry.name)”?",
                isPresented: $isConfirmingDelete,
                titleVisibility: .visible
            ) {
                Button("Delete Entry", role: .destructive, action: delete)
            } message: {
                Text("It leaves the lorebook and every context it feeds. This can't be undone.")
            }
    }

    private func toggleEnabled() {
        model.setEnabled(entry.id, !entry.enabled)
    }

    private func toggleAlwaysActive() {
        model.setAlwaysActive(entry.id, !entry.alwaysActive)
    }

    private func confirmDelete() {
        isConfirmingDelete = true
    }

    private func delete() {
        model.delete(entry.id)
    }
}
