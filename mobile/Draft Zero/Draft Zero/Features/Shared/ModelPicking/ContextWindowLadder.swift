import SwiftUI

/// The context-window ladder as a snapping slider. Stops above the model's
/// window are out of reach, and a note says why the ladder stops short.
struct ContextWindowLadder: View {
    /// The shown value, already clamped to the model's window.
    let tokens: Int
    /// The model's window; zero when unknown, which clamps nothing.
    let contextLength: Int
    let inheritance: SettingInheritance?
    let onChange: (Int) -> Void

    @State private var index: Double

    /// A window that always has a value, like the global default.
    init(value: Binding<Int>, contextLength: Int = 0) {
        self.init(
            tokens: GenerationLimits.clampContextWindow(value.wrappedValue, contextLength: contextLength),
            contextLength: contextLength,
            inheritance: nil,
            onChange: { value.wrappedValue = $0 }
        )
    }

    /// A window whose nil follows `fallback`, like a profile's.
    init(override: Binding<Int?>, fallback: Int, contextLength: Int, inheritedLabel: String = "Default") {
        let inheritance: SettingInheritance = if override.wrappedValue == nil {
            .following(label: inheritedLabel)
        } else {
            .overridden(revert: { override.wrappedValue = nil })
        }
        self.init(
            tokens: GenerationLimits.clampContextWindow(override.wrappedValue ?? fallback, contextLength: contextLength),
            contextLength: contextLength,
            inheritance: inheritance,
            onChange: { override.wrappedValue = $0 }
        )
    }

    private init(tokens: Int, contextLength: Int, inheritance: SettingInheritance?, onChange: @escaping (Int) -> Void) {
        self.tokens = tokens
        self.contextLength = contextLength
        self.inheritance = inheritance
        self.onChange = onChange
        _index = State(initialValue: Double(ContextLadder.index(of: tokens, contextLength: contextLength)))
    }

    var body: some View {
        let maxIndex = ContextLadder.maxIndex(contextLength: contextLength)
        let shownIndex = ContextLadder.index(of: tokens, contextLength: contextLength)
        let label = GenerationLimits.contextWindowLabel(ContextLadder.tokens(atIndex: Int(index.rounded())))
        let following = inheritance?.isFollowing == true

        VStack(alignment: .leading, spacing: 6) {
            LabeledContent {
                Text(label)
                    .monospacedDigit()
            } label: {
                SettingTitle(title: "Context window", inheritance: inheritance)
            }
            if maxIndex > 0 {
                Slider(value: $index, in: 0...Double(maxIndex), step: 1) {
                    Text("Context window")
                }
                .tint(following ? Color.secondary : nil)
                .accessibilityValue("\(label) tokens")
                .accessibilityHint(following ? "Following the default. Adjust to set a value of its own." : "")
            }
            if ContextLadder.isLimited(contextLength: contextLength) {
                Text("Limited by the model's \(Format.contextLength(contextLength)) window.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
        .onChange(of: shownIndex) { _, newIndex in
            if Int(index.rounded()) != newIndex { index = Double(newIndex) }
        }
        .onChange(of: index) { _, newIndex in
            let stop = ContextLadder.tokens(atIndex: Int(newIndex.rounded()))
            if stop != tokens { onChange(stop) }
        }
    }
}
