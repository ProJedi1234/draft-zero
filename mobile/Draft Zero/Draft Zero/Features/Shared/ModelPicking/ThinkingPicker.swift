import SwiftUI

/// How hard the model thinks, offering only the efforts it accepts. Says so
/// when thinking is mandatory or unsupported instead of offering a lie.
struct ThinkingPicker: View {
    let reasoning: OpenRouterModel.Reasoning?
    @Binding var selection: ThinkingLevel

    var body: some View {
        if let reasoning {
            Menu {
                Picker("Thinking", selection: $selection) {
                    ForEach(ModelCatalog.thinkingOptions(reasoning, current: selection)) { level in
                        Text(level.label).tag(level)
                    }
                }
            } label: {
                PickerRowLabel(
                    title: "Thinking",
                    value: selection.label,
                    detail: reasoning.mandatory ? "This model always thinks. Off leaves the effort to the provider." : nil
                )
            }
            .tint(.primary)
        } else {
            PickerRowLabel(
                title: "Thinking",
                value: "Not supported",
                detail: "This model writes without thinking first.",
                showsChevron: false
            )
            .accessibilityElement(children: .combine)
        }
    }
}
