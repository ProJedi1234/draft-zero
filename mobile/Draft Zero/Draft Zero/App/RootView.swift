import SwiftUI

/// Setup until a server is chosen, the app after.
struct RootView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Group {
            if app.api == nil {
                ServerSetupView()
            } else {
                MainTabView()
            }
        }
        .noticeOverlay()
        .onChange(of: scenePhase) { _, phase in
            app.scenePhaseChanged(phase)
        }
    }
}
