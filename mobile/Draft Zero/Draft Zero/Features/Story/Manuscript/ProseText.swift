import SwiftUI

/// Manuscript prose: paragraphs separated by blank lines, with the inline
/// markdown the web renders (emphasis, strong, code).
struct ProseText: View {
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.paragraphSpacing) {
            ForEach(Array(ProseText.paragraphs(of: text).enumerated()), id: \.offset) { _, paragraph in
                Text(ProseText.styled(paragraph))
                    .font(Theme.proseFont)
                    .lineSpacing(Theme.proseLineSpacing)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .textSelection(.enabled)
        // Scrolling only drops the keyboard once the drag reaches it, so a tap
        // on the story is the quick way out of the composer.
        .onTapGesture {
            UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        }
    }

    /// Splits on blank lines and drops empty paragraphs, like lib/markdown.ts.
    static func paragraphs(of text: String) -> [String] {
        text.replacing("\r\n", with: "\n")
            .split(separator: "\n\n", omittingEmptySubsequences: true)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    static func styled(_ paragraph: String) -> AttributedString {
        let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        return (try? AttributedString(markdown: paragraph, options: options)) ?? AttributedString(paragraph)
    }
}
