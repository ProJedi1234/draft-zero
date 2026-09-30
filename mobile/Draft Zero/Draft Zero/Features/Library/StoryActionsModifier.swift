import SwiftUI

/// Open, rename, duplicate, open the lorebook, delete: one story's actions on
/// a long press, and on a swipe where the story is a list row. Rename asks for
/// the title in an alert; delete names the story before it goes.
struct StoryActionsModifier: ViewModifier {
    let story: StoryRecord

    @Environment(AppModel.self) private var app
    @Environment(LibraryStore.self) private var library
    @Environment(NoticeCenter.self) private var notices
    @State private var isRenaming = false
    @State private var draftTitle = ""
    @State private var isConfirmingDelete = false

    func body(content: Content) -> some View {
        content
            .contextMenu {
                StoryMenuItems(
                    onOpen: open,
                    onOpenLorebook: openLorebook,
                    onRename: startRename,
                    onDuplicate: duplicate,
                    onDelete: confirmDelete
                )
            }
            // Not `.destructive`: that role removes the row before the dialog can ask.
            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                Button("Delete", systemImage: "trash", action: confirmDelete)
                    .tint(.red)
                Button("Rename", systemImage: "pencil", action: startRename)
                    .tint(.orange)
            }
            .swipeActions(edge: .leading) {
                Button("Lorebook", systemImage: "book.closed", action: openLorebook)
                    .tint(.indigo)
                Button("Duplicate", systemImage: "plus.square.on.square", action: duplicate)
                    .tint(.blue)
            }
            .alert("Rename Story", isPresented: $isRenaming) {
                TextField("Title", text: $draftTitle)
                    .textInputAutocapitalization(.words)
                Button("Cancel", role: .cancel) {}
                Button("Rename", action: rename)
                    .disabled(trimmedTitle.isEmpty)
            } message: {
                Text("Give “\(story.title)” a new title.")
            }
            .confirmationDialog("Delete “\(story.title)”?", isPresented: $isConfirmingDelete, titleVisibility: .visible) {
                Button("Delete Story", role: .destructive, action: delete)
            } message: {
                Text("This permanently removes the story and all its passages.")
            }
    }

    private var trimmedTitle: String {
        draftTitle.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func open() {
        app.libraryPath.append(.story(story.id))
    }

    private func openLorebook() {
        app.openLorebook(story.id)
    }

    private func startRename() {
        draftTitle = story.title
        isRenaming = true
    }

    private func confirmDelete() {
        isConfirmingDelete = true
    }

    private func rename() {
        let title = trimmedTitle
        let storyId = story.id
        guard !title.isEmpty, title != story.title else { return }
        Task {
            do {
                try await library.renameStory(storyId, title: title)
            } catch {
                notices.error(error)
            }
        }
    }

    private func duplicate() {
        let title = story.title
        let storyId = story.id
        Task {
            do {
                _ = try await library.duplicateStory(storyId)
                notices.info("Duplicated “\(title)”")
            } catch {
                notices.error(error)
            }
        }
    }

    private func delete() {
        let title = story.title
        let storyId = story.id
        app.libraryPath.removeAll { $0 == .story(storyId) || $0 == .lorebook(storyId) }
        Task {
            do {
                try await library.deleteStory(storyId)
                notices.info("Deleted “\(title)”")
            } catch {
                notices.error(error)
            }
        }
    }
}

extension View {
    /// Attaches a story's context menu, swipe actions, rename alert and delete confirmation.
    func storyActions(_ story: StoryRecord) -> some View {
        modifier(StoryActionsModifier(story: story))
    }
}
