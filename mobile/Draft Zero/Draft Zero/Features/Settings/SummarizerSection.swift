import SwiftUI

/// What writes the rolling recap once a story outgrows its window. App-wide,
/// because compressing prose without losing names is one job with one right
/// answer, and not the model the writer picked for their book.
///
/// The penalties are deliberately absent: a recap has to repeat the names and
/// debts that matter, which is exactly what they punish.
struct SummarizerSection: View {
    @Bindable var editor: AutosavedValue<AppSettings.Summarizer>
    let models: [OpenRouterModel]
    let requireZdr: Bool
    let policies: AccountZdrPolicies
    /// The window a new story starts with, which "auto" length resolves against.
    let defaultContextWindow: Int

    @State private var endpoints = ModelEndpointsLoader()

    var body: some View {
        let autoTarget = SummaryLength.autoTarget(contextWindow: defaultContextWindow)
        let autoCap = SummaryLength.autoCap(targetWords: editor.value.targetWords, contextWindow: defaultContextWindow)

        Section {
            ModelChoiceRows(
                models: models,
                modelId: editor.value.modelId,
                defaultOption: BuiltInModels.summarizerOption,
                providerTag: editor.value.providerTag,
                thinking: $editor.value.thinking,
                zdr: $editor.value.zdr,
                requireZdr: requireZdr,
                policies: policies,
                endpoints: endpoints,
                onModelChange: chooseModel,
                onProviderChange: chooseProvider
            )
            DisclosureGroup("Length and sampling") {
                SettingSlider(
                    "Summary length",
                    override: $editor.value.targetWords,
                    fallback: autoTarget,
                    in: SummaryLength.range,
                    step: SummaryLength.step,
                    readout: { "\(Int($0.rounded())) words" },
                    inheritedLabel: "Auto",
                    hint: editor.value.targetWords == nil
                        ? "Scales with each story's context window: \(Int(autoTarget)) words at the default."
                        : "The same length whatever the story's window.",
                    onRevert: useAutoLength
                )
                SettingSlider(
                    "Output cap",
                    override: $editor.value.maxTokens,
                    fallback: autoCap,
                    in: SummaryLength.capRange,
                    step: SummaryLength.capStep,
                    readout: { "\(Int($0.rounded())) tokens" },
                    inheritedLabel: "Auto",
                    hint: "Where the provider stops. Keep it well above the length: a long recap is compressed next pass, but one cut off mid-sentence is kept as it is."
                )
                SettingSlider(
                    "Temperature",
                    value: $editor.value.temperature,
                    in: GenerationLimits.temperatureRange,
                    step: 0.01,
                    hint: "Low is right for this: it is compression, not invention."
                )
            }
        } header: {
            Text("Summarizer")
        } footer: {
            VStack(alignment: .leading, spacing: 6) {
                Text("Once a story outgrows its context window, this writes the recap that stands in for what no longer fits. It runs every few passages, so cheap and fast beats clever.")
                SaveErrorLabel(message: editor.error)
            }
        }
    }

    private func chooseModel(_ modelId: String?) {
        editor.value.chooseModel(modelId, in: models)
    }

    private func chooseProvider(_ tag: String?) {
        editor.value.providerTag = tag
    }

    private func useAutoLength() {
        editor.value.useAutoLength()
    }
}
