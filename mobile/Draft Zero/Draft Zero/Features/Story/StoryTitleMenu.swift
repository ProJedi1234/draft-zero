import SwiftUI

/// The menu under the story's title in the navigation bar.
struct StoryTitleMenu: View {
    @Binding var sheet: StorySheet?
    @Binding var confirmingDelete: Bool
    let duplicate: () -> Void

    var body: some View {
        Button("Edit Details", systemImage: "pencil") { sheet = .details }
        Button("Duplicate", systemImage: "plus.square.on.square", action: duplicate)
        Button("Delete Story", systemImage: "trash", role: .destructive) { confirmingDelete = true }
    }
}
