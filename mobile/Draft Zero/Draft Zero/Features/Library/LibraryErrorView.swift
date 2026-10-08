import SwiftUI

/// The library couldn't load at all; says why and offers to try again.
struct LibraryErrorView: View {
    let error: APIError

    @Environment(LibraryStore.self) private var library
    @State private var isRetrying = false

    var body: some View {
        ContentUnavailableView {
            Label("Can't Load the Library", systemImage: "exclamationmark.icloud")
        } description: {
            Text(error.localizedDescription)
        } actions: {
            Button(action: retry) {
                if isRetrying {
                    ProgressView()
                } else {
                    Text("Retry")
                }
            }
            .buttonStyle(.bordered)
            .disabled(isRetrying)
        }
    }

    private func retry() {
        isRetrying = true
        Task {
            await library.load()
            isRetrying = false
        }
    }
}
