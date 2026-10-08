import SwiftUI

/// The composed context, section by section, in the order it is sent.
/// Token counts are the server's own estimate: a quarter of the characters.
struct ContextBreakdownList: View {
    let context: EntryContext
    /// The passage this was composed for, or nil for the next one.
    let entry: StoryEntry?

    var body: some View {
        let composed = context.context
        List {
            Section {
                ContextBudgetMeter(used: composed.approxTokens, budget: context.contextWindow)
                if let modelId = context.modelId {
                    LabeledContent("Model", value: Format.shortModelId(modelId))
                }
                if let generation = entry?.generation {
                    LabeledContent("Temperature", value: generation.temperature.formatted(fixed: 2))
                    if let prompt = generation.promptTokens, let completion = generation.completionTokens {
                        LabeledContent("Tokens", value: "\(Format.tokens(prompt)) in · \(Format.tokens(completion)) out")
                    }
                }
                if let entry, entry.costUsd != nil {
                    LabeledContent("Cost", value: Format.usd(entry.costUsd))
                }
            } footer: {
                Text(entry == nil
                    ? "Composed now from the whole manuscript, clamped as the next request will be."
                    : "Composed now from the passages before this one, clamped as a real request would be.")
            }

            ContextTextSection(title: "Narrator", text: composed.systemPrompt, monospaced: true)
            ContextTextSection(title: "Memory", text: composed.memory)

            Section {
                if composed.lore.isEmpty {
                    Text(composed.fit.loreMatched > 0 ? "Matched entries didn't fit the lore budget." : "No entries triggered.")
                        .foregroundStyle(.secondary)
                }
                ForEach(composed.lore) { lore in
                    ContextLoreRow(lore: lore)
                }
            } header: {
                Text("Lore · \(composed.lore.count) of \(composed.fit.loreMatched) matched")
            } footer: {
                if composed.fit.loreMatched > composed.lore.count {
                    Text("\(composed.fit.loreMatched - composed.lore.count) matched entries were trimmed by the lore budget. Higher priority survives longer.")
                }
            }

            ContextTextSection(title: "Summary", text: composed.summary)

            Section {
                Text(composed.storyText)
                    .font(.system(.footnote, design: .serif))
                    .textSelection(.enabled)
            } header: {
                Text("Story · ≈\(Format.tokens(Self.tokens(composed.storyText)))")
            } footer: {
                if composed.fit.storyCharsKept < composed.fit.storyChars {
                    Text("The last \(composed.fit.storyCharsKept.formatted()) of \(composed.fit.storyChars.formatted()) characters fit the window. Earlier prose rides in the summary.")
                }
            }

            ContextTextSection(title: "Author's Note", text: composed.authorsNote)
        }
    }

    static func tokens(_ text: String) -> Int {
        (text.utf16.count + 3) / 4
    }
}
