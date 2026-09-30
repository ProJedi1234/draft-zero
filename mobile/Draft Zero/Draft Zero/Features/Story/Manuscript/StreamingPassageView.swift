import SwiftUI

/// The passage being written, with a caret that says honestly what the model
/// is doing: waiting, thinking, or writing.
struct StreamingPassageView: View {
    let text: String
    let status: GenerationController.Status

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !text.isEmpty {
                ProseText(text: text)
            }
            if status != .settling {
                GenerationCaret(status: status)
            }
        }
        .padding(.vertical, 10)
        .accessibilityElement(children: .combine)
    }
}
