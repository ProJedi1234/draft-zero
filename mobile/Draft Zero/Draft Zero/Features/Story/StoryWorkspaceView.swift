import SwiftUI

/// The story room: the manuscript, the composer floating over it, and the
/// inspector beside it (a sheet on iPhone). History and Retry move into the
/// toolbar when it is a side rail, as on a foldable's front display; a top
/// bar has no room for them, and focus mode hides the toolbar entirely.
struct StoryWorkspaceView: View {
    let workspace: StoryWorkspace

    @Environment(AppModel.self) private var app
    @AppStorage("inspectorOpen") private var inspectorOpen = false
    @State private var focusMode = false
    @State private var reclaimsStrip = false
    @State private var hasSideRail = false
    @State private var sheet: StorySheet?
    @State private var confirmingDelete = false

    var body: some View {
        StoryWorkspaceContent(workspace: workspace, historyInComposer: focusMode || !hasSideRail)
            // Focus mode reclaims the camera strip on a foldable's front display.
            .ignoresSafeArea(.container, edges: reclaimsStrip ? .horizontal : [])
            .onGeometryChange(for: Bool.self, of: { max($0.safeAreaInsets.leading, $0.safeAreaInsets.trailing) > 0 }) {
                hasSideRail = $0
            }
            .storyActionTint(workspace.tint)
            .background { StoryAmbientBackground(tint: workspace.tint) }
            .navigationTitle(workspace.story?.title ?? "")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarVisibility(focusMode ? .hidden : .automatic, for: .navigationBar)
            .onChange(of: focusMode) { _, on in
                // Widening the column under focus mode's animation re-wraps every
                // passage each frame, so the strip is reclaimed in one step.
                withTransaction(\.disablesAnimations, true) { reclaimsStrip = on }
            }
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
                    FocusExitButton { setFocusMode(false) }
                }
            }
    }

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        if hasSideRail {
            let generation = workspace.generation
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button(generation.undoLabel, systemImage: "arrow.uturn.backward", action: generation.undo)
                    .disabled(!generation.canUndo)
                Button(generation.redoLabel, systemImage: "arrow.uturn.forward", action: generation.redo)
                    .disabled(!generation.canRedo)
                RetryMenu(workspace: workspace, disabled: generation.busy)
            }
            ToolbarSpacer(.fixed, placement: .topBarTrailing)
        }
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
                    withAnimation { inspectorOpen = false }
                    setFocusMode(true)
                }
                .keyboardShortcut(".", modifiers: .command)
                Divider()
                Button("Duplicate", systemImage: "plus.square.on.square") { duplicate(.full) }
                Button("Duplicate from Opening", systemImage: "arrow.counterclockwise") { duplicate(.opening) }
                Button("Delete Story", systemImage: "trash", role: .destructive) { confirmingDelete = true }
            }
        }
    }

    private func setFocusMode(_ on: Bool) {
        withBarAnimation {
            focusMode = on
            app.hidesStatusBar = on
        }
    }

    private func duplicate(_ scope: DuplicateScope) {
        Task {
            do {
                let copy = try await app.library.duplicateStory(workspace.storyId, scope: scope)
                app.notices.info(
                    scope == .opening ? "Story duplicated from its opening." : "Story duplicated.",
                    actionTitle: "Open"
                ) {
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
