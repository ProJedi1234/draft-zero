import SwiftUI

/// What a passage was shown: every section of the prompt, how much of the
/// budget each took, and why each lore entry was in it.
struct ContextViewerSheet: View {
    let entry: StoryEntry
    let workspace: StoryWorkspace

    @Environment(\.dismiss) private var dismiss
    @State private var state: LoadState = .loading

    enum LoadState {
        case loading
        case loaded(EntryContext)
        case gone
        case failed(String)
    }

    var body: some View {
        NavigationStack {
            Group {
                switch state {
                case .loading:
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                case .gone:
                    ContentUnavailableView(
                        "Not in the Manuscript",
                        systemImage: "text.badge.xmark",
                        description: Text("This take is no longer part of the story.")
                    )
                case .failed(let message):
                    ContentUnavailableView("Couldn't Load", systemImage: "exclamationmark.triangle", description: Text(message))
                case .loaded(let context):
                    ContextBreakdownList(context: context, entry: entry)
                }
            }
            .navigationTitle("What It Was Shown")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .task { await load() }
    }

    private func load() async {
        do {
            if let context = try await workspace.context(for: entry) {
                state = .loaded(context)
            } else {
                state = .gone
            }
        } catch is CancellationError {
        } catch {
            state = .failed((error as? LocalizedError)?.errorDescription ?? "Try again.")
        }
    }
}
