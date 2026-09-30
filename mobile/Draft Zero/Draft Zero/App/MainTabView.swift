import SwiftUI

/// The four sections. On iPad the tab bar becomes a sidebar.
struct MainTabView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        @Bindable var app = app
        TabView(selection: $app.selectedTab) {
            Tab("Library", systemImage: "books.vertical", value: AppTab.library) {
                LibraryNavigation()
            }
            Tab("Gallery", systemImage: "photo.on.rectangle.angled", value: AppTab.gallery) {
                NavigationStack {
                    GalleryScreen()
                }
            }
            Tab("Usage", systemImage: "chart.bar", value: AppTab.usage) {
                NavigationStack {
                    UsageScreen()
                }
            }
            Tab("Settings", systemImage: "gearshape", value: AppTab.settings) {
                NavigationStack {
                    SettingsScreen()
                }
            }
        }
        .tabViewStyle(.sidebarAdaptable)
    }
}
