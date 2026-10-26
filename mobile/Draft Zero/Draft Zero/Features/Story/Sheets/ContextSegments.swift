import SwiftUI

struct ContextSegments: View {
    let context: EntryContext

    private var segments: [ContextSections.Section] { ContextSections.sections(context.context) }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            GeometryReader { geometry in
                let nonempty = segments.filter { !$0.text.isEmpty }
                let denominator = Double(max(context.context.approxTokens, context.contextWindow, 1))
                HStack(spacing: 2) {
                    ForEach(nonempty) { segment in
                        Rectangle()
                            .fill(.primary.opacity(segment.shade))
                            .frame(width: max(0, geometry.size.width - Double(max(0, nonempty.count - 1)) * 2) * Double(segment.tokens) / denominator)
                    }
                    Spacer(minLength: 0)
                }
            }
            .frame(height: 8)
            .background(.quaternary)
            .accessibilityHidden(true)
            ForEach(segments) { segment in
                HStack {
                    Rectangle().fill(.primary.opacity(segment.shade)).frame(width: 8, height: 8)
                        .accessibilityHidden(true)
                    Text(segment.name)
                    Spacer()
                    Text("≈\(Format.tokens(segment.tokens))")
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
                .font(.caption)
                .accessibilityElement(children: .combine)
            }
        }
    }
}
