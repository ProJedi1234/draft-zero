import SwiftUI

/// A blank manuscript, with a few Do-shaped openings to prime the composer.
struct StoryEmptyState: View {
    let title: String
    let suggest: (String) -> Void

    private static let suggestions = ["I look around", "I check my pockets", "I call out"]

    var body: some View {
        ContentUnavailableView {
            Label("A blank page, full of possibility", systemImage: "pencil.and.scribble")
        } description: {
            Text("Open “\(title)” with your first move. Write what you do, or what you say, in first person — it lands on the page in second.")
        } actions: {
            ForEach(Self.suggestions, id: \.self) { suggestion in
                Button(suggestion) { suggest(suggestion) }
                    .buttonStyle(.bordered)
            }
        }
        .padding(.vertical, 40)
    }
}
