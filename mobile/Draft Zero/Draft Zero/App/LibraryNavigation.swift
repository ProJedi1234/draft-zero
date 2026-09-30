import SwiftUI

/// The library's navigation stack: the story list, and the stories and
/// lorebooks it opens.
struct LibraryNavigation: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        @Bindable var app = app
        NavigationStack(path: $app.libraryPath) {
            LibraryScreen()
                .navigationDestination(for: AppRoute.self) { route in
                    switch route {
                    case .story(let storyId):
                        StoryScreen(storyId: storyId)
                    case .lorebook(let storyId):
                        LorebookScreen(storyId: storyId)
                    }
                }
        }
    }
}
