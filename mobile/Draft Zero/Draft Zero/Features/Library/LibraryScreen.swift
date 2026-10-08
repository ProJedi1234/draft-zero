import SwiftUI

/// The Library tab's root: every story, newest first, led by the one you were
/// last writing; and the two ways in, New Story and Import.
struct LibraryScreen: View {
    @Environment(AppModel.self) private var app
    @Environment(LibraryStore.self) private var library
    @Environment(NoticeCenter.self) private var notices
    @State private var isCreating = false
    @State private var importKind = ImportKind.scenario
    @State private var isPickingFile = false
    @State private var isReadingFile = false
    @State private var pendingImport: PendingImport?
    @State private var fileError: String?
    @State private var isShowingFileError = false

    var body: some View {
        Group {
            if library.isLoaded {
                if library.stories.isEmpty {
                    LibraryEmptyView(isCreating: isCreating, onNewStory: createStory, onImport: pickFile)
                } else {
                    LibraryContentView()
                }
            } else if let error = library.loadError {
                LibraryErrorView(error: error)
            } else {
                ProgressView("Loading library…")
            }
        }
        .navigationTitle("Library")
        .navigationSubtitle(offlineSubtitle)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if isReadingFile {
                    ProgressView()
                        .accessibilityLabel("Reading file")
                } else {
                    ImportMenu(onPick: pickFile)
                }
            }
            ToolbarSpacer(.fixed, placement: .topBarTrailing)
            ToolbarItem(placement: .topBarTrailing) {
                if isCreating {
                    ProgressView()
                        .accessibilityLabel("Creating story")
                } else {
                    Button("New Story", systemImage: "square.and.pencil", action: createStory)
                }
            }
        }
        .fileImporter(isPresented: $isPickingFile, allowedContentTypes: importKind.contentTypes, onCompletion: readPickedFile)
        .sheet(item: $pendingImport) { pending in
            ImportSheet(pending: pending, onOpenStory: openImportedStory)
        }
        .alert("Can't Import That File", isPresented: $isShowingFileError) {
        } message: {
            Text(fileError ?? "")
        }
        #if DEBUG
        .task { await readLaunchImportFile() }
        #endif
    }

    /// A compact offline note under the title; nothing while the server answers.
    private var offlineSubtitle: Text {
        if case .offline(let message) = app.effectiveConnection {
            Text("\(Image(systemName: "icloud.slash")) \(message)")
        } else {
            Text(verbatim: "")
        }
    }

    // MARK: - Actions

    private func createStory() {
        guard !isCreating else { return }
        isCreating = true
        Task {
            do {
                let storyId = try await library.createStory()
                app.libraryPath.append(.story(storyId))
            } catch {
                notices.error(error)
            }
            isCreating = false
        }
    }

    private func pickFile(_ kind: ImportKind) {
        importKind = kind
        isPickingFile = true
    }

    private func readPickedFile(_ result: Result<URL, any Error>) {
        switch result {
        case .success(let url):
            Task { await read(url) }
        case .failure(let error):
            showFileError(error)
        }
    }

    private func read(_ url: URL) async {
        isReadingFile = true
        defer { isReadingFile = false }
        do {
            pendingImport = PendingImport(content: try await ImportFileReader.read(url))
        } catch {
            showFileError(error)
        }
    }

    private func showFileError(_ error: any Error) {
        fileError = (error as? LocalizedError)?.errorDescription ?? "That file couldn't be read. Try picking it again."
        isShowingFileError = true
    }

    private func openImportedStory(_ storyId: String) {
        pendingImport = nil
        app.openStory(storyId)
    }

    #if DEBUG
    private func readLaunchImportFile() async {
        guard let url = ImportLaunchHook.takeFile() else { return }
        await read(url)
    }
    #endif
}
