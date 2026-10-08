import SwiftUI

/// The Settings tab: the server, the key, model profiles, the shared defaults,
/// privacy, the summarizer and atmosphere bundles, and images. Follows the
/// server while visible, and says quietly under its title when it is saving.
struct SettingsScreen: View {
    @Environment(AppModel.self) private var app
    @State private var store = SettingsStore()
    @State private var events: SyncSubscription?
    @State private var reconnects: SyncSubscription?
    @State private var editorTarget: ProfileEditorTarget?

    var body: some View {
        ScrollViewReader { proxy in
            SettingsForm(store: store, editorTarget: $editorTarget, retry: retry)
                .onChange(of: store.isLoaded) { _, loaded in
                    if loaded { applyLaunchOptions(proxy) }
                }
        }
        .navigationTitle("Settings")
        .navigationSubtitle(subtitle)
        .toolbar {
            if store.profiles.count > 1 {
                ToolbarItem(placement: .topBarTrailing) {
                    EditButton()
                }
            }
        }
        .task {
            store.attach(api: app.api, notices: app.notices)
            await store.load()
        }
        .onAppear(perform: subscribe)
        .onDisappear(perform: unsubscribe)
    }

    private var subtitle: String {
        switch store.activity.status {
        case .saving: "Saving…"
        case .saved: "Saved"
        case .idle: ""
        }
    }

    /// Events missed while away are gone, so coming back is a reason to re-read.
    private func subscribe() {
        events = app.sync.subscribe { [store] event in
            store.handle(event)
        }
        reconnects = app.sync.onReconnect { [store] in
            store.scheduleRefresh()
        }
    }

    private func unsubscribe() {
        events?.release()
        reconnects?.release()
        events = nil
        reconnects = nil
        if let editors = store.editors {
            Task { await editors.flush() }
        }
    }

    private func retry() {
        Task { await store.load() }
    }

    private func applyLaunchOptions(_ proxy: ScrollViewProxy) {
        if let section = SettingsLaunchOptions.scrollTarget {
            proxy.scrollTo(section, anchor: .top)
        }
        guard let profileId = SettingsLaunchOptions.editProfile else { return }
        if profileId == "new" {
            let seed = store.profiles.first { $0.id == store.defaultProfileId }
            editorTarget = ProfileEditorTarget(mode: .create, profile: seed)
        } else if let profile = store.profiles.first(where: { $0.id == profileId }) {
            editorTarget = ProfileEditorTarget(mode: .edit, profile: profile)
        }
    }
}

#Preview {
    NavigationStack {
        SettingsScreen()
    }
    .environment(AppModel())
}
