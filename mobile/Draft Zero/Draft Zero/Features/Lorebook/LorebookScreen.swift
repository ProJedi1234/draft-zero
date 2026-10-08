import SwiftUI

/// A story's lorebook: its entries, and an editor for each.
struct LorebookScreen: View {
    let storyId: String

    @Environment(AppModel.self) private var app

    var body: some View {
        if let api = app.api {
            LorebookRoot(storyId: storyId, app: app, api: api)
        } else {
            ContentUnavailableView(
                "Not Connected",
                systemImage: "network.slash",
                description: Text("Connect to a Draft Zero server to open this lorebook.")
            )
        }
    }
}
