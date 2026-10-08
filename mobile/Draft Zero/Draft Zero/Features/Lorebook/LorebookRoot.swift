import SwiftUI
import UniformTypeIdentifiers

/// Owns the lorebook's model and everything presented over it: search, the
/// toolbar, the new-entry sheet, the card importer and its summary.
struct LorebookRoot: View {
    @State private var model: LorebookModel

    @Environment(LibraryStore.self) private var library
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.colorScheme) private var colorScheme

    init(storyId: String, app: AppModel, api: APIClient) {
        _model = State(initialValue: LorebookModel(storyId: storyId, api: api, sync: app.sync, notices: app.notices))
    }

    var body: some View {
        @Bindable var model = model
        let tint = library.story(model.storyId)?.tint ?? .none
        Group {
            if sizeClass == .regular {
                LorebookSplitLayout(model: model)
            } else {
                LorebookCompactLayout(model: model)
            }
        }
        .background {
            StoryAmbientBackground(tint: LorebookTint.wash(tint))
        }
        .tint(LorebookTint.accent(tint, scheme: colorScheme))
        .navigationTitle("Lorebook")
        .navigationSubtitle(library.story(model.storyId)?.title ?? "")
        .searchable(text: $model.query, prompt: "Name, key, or content")
        .toolbar {
            LorebookToolbar(model: model)
        }
        .sheet(isPresented: $model.isCreatingEntry) {
            LorebookNewEntrySheet(model: model, category: model.newEntryCategory)
        }
        .sheet(item: $model.importReport, content: LorebookImportSummarySheet.init)
        .fileImporter(isPresented: $model.isPickingCardFile, allowedContentTypes: [.json], onCompletion: importPicked)
        .alert("Couldn't Import Story Cards", isPresented: $model.isShowingImportError) {
        } message: {
            Text(model.importError ?? "")
        }
        .onAppear(perform: model.surfaceAppeared)
        .onDisappear(perform: model.surfaceDisappeared)
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { model.flushAll() }
        }
    }

    private func importPicked(_ result: Result<URL, Error>) {
        model.importPicked(result)
    }
}
