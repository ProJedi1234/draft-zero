import SwiftUI

/// The prompt, selectable so it can be copied. Collapsed it is a few lines;
/// expanded it takes what it needs and scrolls once it passes a fixed height.
struct LightboxPromptText: View {
    let prompt: String
    let isExpanded: Bool

    var body: some View {
        if isExpanded {
            CappedScrollView(maxHeight: 200) { text }
        } else {
            text.lineLimit(3)
        }
    }

    private var text: some View {
        Text(prompt)
            .font(.callout)
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}
