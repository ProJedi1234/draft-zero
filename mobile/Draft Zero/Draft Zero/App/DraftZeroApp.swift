import SwiftUI

@main
struct DraftZeroApp: App {
    @State private var app = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(app)
                .environment(app.library)
                .environment(app.notices)
        }
    }
}
