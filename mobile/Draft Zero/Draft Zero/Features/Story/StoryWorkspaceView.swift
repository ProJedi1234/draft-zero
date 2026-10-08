import SwiftUI

/// The story room: the manuscript, the composer floating over it, and the
/// inspector beside it (a sheet on iPhone).
struct StoryWorkspaceView: View {
    let workspace: StoryWorkspace

    @Environment(AppModel.self) private var app
    @AppStorage("inspectorOpen") private var inspectorOpen = false
    @State private var focusMode = false
    @State private var sheet: StorySheet?
    @State private var confirmingDelete = false

    var body: some View {
        StoryWorkspaceContent(workspace: workspace)
            .background { StoryAmbientBackground(tint: workspace.tint) }
            .navigationTitle(workspace.story?.title ?? "")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarVisibility(focusMode ? .hidden : .automatic, for: .navigationBar)
            .onChange(of: focusMode) { _, on in app.hidesStatusBar = on }
            .onDisappear { app.hidesStatusBar = false }
            .toolbar { toolbarContent }
            .toolbarTitleMenu {
                StoryTitleMenu(sheet: $sheet, confirmingDelete: $confirmingDelete, duplicate: duplicate)
            }
            .inspector(isPresented: $inspectorOpen) {
                InspectorView(workspace: workspace)
                    .inspectorColumnWidth(min: 300, ideal: 360, max: 460)
            }
            .sheet(item: $sheet) { sheet in
                switch sheet {
                case .details:
                    StoryDetailsSheet(workspace: workspace)
                case .cost:
                    CostLedgerSheet(workspace: workspace)
                }
            }
            .confirmationDialog(
                "Delete “\(workspace.story?.title ?? "this story")”?",
                isPresented: $confirmingDelete,
                titleVisibility: .visible
            ) {
                Button("Delete Story", role: .destructive, action: deleteStory)
            } message: {
                Text("The manuscript, its lorebook and its pictures are removed. This can't be undone.")
            }
            .overlay {
                if focusMode {
                    FocusExitButton { withAnimation { focusMode = false } }
                }
            }
    }

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            AtmosphereIndicator(status: workspace.atmosphere)
        }
        ToolbarItem(placement: .topBarTrailing) {
            Button("Inspector", systemImage: "slider.horizontal.3") {
                inspectorOpen.toggle()
            }
            .keyboardShortcut("i", modifiers: [.command, .option])
        }
        ToolbarItem(placement: .topBarTrailing) {
            Menu("More", systemImage: "ellipsis") {
                Button("Lorebook", systemImage: "book.closed") {
                    app.libraryPath.append(.lorebook(workspace.storyId))
                }
                Button("Story Details", systemImage: "info.circle") { sheet = .details }
                Button("Cost", systemImage: "dollarsign.circle") { sheet = .cost }
                Button("Focus Mode", systemImage: "arrow.up.left.and.arrow.down.right") {
                    withAnimation {
                        inspectorOpen = false
                        focusMode = true
                    }
                }
                .keyboardShortcut(".", modifiers: .command)
                Divider()
                Button("Duplicate", systemImage: "plus.square.on.square", action: duplicate)
                Button("Delete Story", systemImage: "trash", role: .destructive) { confirmingDelete = true }
            }
        }
    }

    private func duplicate() {
        Task {
            do {
                let copy = try await app.library.duplicateStory(workspace.storyId)
                app.notices.info("Story duplicated.", actionTitle: "Open") {
                    app.openStory(copy)
                }
            } catch {
                app.notices.error(error, fallback: "Couldn't duplicate the story.")
            }
        }
    }

    private func deleteStory() {
        Task {
            do {
                try await app.library.deleteStory(workspace.storyId)
                app.libraryPath.removeAll()
            } catch {
                app.notices.error(error, fallback: "Couldn't delete the story.")
            }
        }
    }
}
