import SwiftUI

/// What stories illustrate with unless they chose their own model, and how
/// much of the story the wand reads when writing a prompt.
struct ImageGenerationSection: View {
    @Bindable var model: AutosavedValue<String?>
    @Bindable var context: AutosavedValue<Int>
    let imageModels: [OpenRouterImageModel]
    let requireZdr: Bool
    /// The default the last payload priced; the price belongs to it alone.
    let pricedModelId: String?
    /// That default's price per image, or nil when unknown.
    let price: String?

    var body: some View {
        Section {
            ImageModelPickerRow(
                title: "Default image model",
                models: imageModels,
                selection: model.value,
                fallback: .catalog,
                price: nil,
                zdr: requireZdr,
                onSelect: chooseModel
            )
            LabeledContent("Price per image") {
                // The server prices the stored default; a newer choice has no price until the next read.
                if model.value != pricedModelId {
                    ProgressView()
                        .controlSize(.small)
                } else {
                    Text(price ?? "Unknown")
                        .monospacedDigit()
                }
            }
            Picker("Prompt context", selection: $context.value) {
                ForEach(GenerationLimits.imageContextOptions, id: \.self) { tokens in
                    Text("\(tokens / 1024)k tokens").tag(tokens)
                }
            }
        } header: {
            Text("Images")
        } footer: {
            VStack(alignment: .leading, spacing: 6) {
                Text("Prompt context is how much recent story the wand reads when writing a prompt. Memory, lore and the summary always ride along; more mostly buys longer scenes, not better ones.")
                SaveErrorLabel(message: model.error ?? context.error)
            }
        }
    }

    private func chooseModel(_ modelId: String?) {
        model.value = modelId
    }
}
