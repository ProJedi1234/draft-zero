import SwiftUI

/// One text section of a composed context, collapsed by default when long.
struct ContextTextSection: View {
    let title: String
    let text: String
    var monospaced = false

    @State private var expanded = false

    var body: some View {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        Section {
            if trimmed.isEmpty {
                Text("Empty").foregroundStyle(.secondary)
            } else {
                Text(trimmed)
                    .font(monospaced ? Theme.machineFont : .system(.footnote, design: .serif))
                    .lineLimit(expanded ? nil : 6)
                    .textSelection(.enabled)
                if trimmed.count > 400 {
                    Button(expanded ? "Show Less" : "Show All") {
                        withAnimation(Theme.quickAnimation) { expanded.toggle() }
                    }
                    .font(.footnote)
                }
            }
        } header: {
            Text("\(title) · ≈\(Format.tokens(ContextBreakdownList.tokens(trimmed)))")
        }
    }
}
