import SwiftUI

/// The sampling every profile falls back to, field by field. Model, provider
/// and thinking have no global: they are what makes one profile differ.
struct GenerationDefaultsSection: View {
    @Bindable var editor: AutosavedValue<GenerationDefaults>

    var body: some View {
        Section {
            SettingSlider("Temperature", value: $editor.value.temperature, in: GenerationLimits.temperatureRange, step: 0.01)
            SettingSlider("Top P", value: $editor.value.topP, in: GenerationLimits.topPRange, step: 0.01)
            // The whole ladder: no model is attached here, so the per-model
            // ceiling applies where one is known.
            ContextWindowLadder(value: $editor.value.contextWindow)
            SettingSlider(
                "Lore budget",
                value: $editor.value.loreBudget,
                in: GenerationLimits.loreBudgetRange,
                step: GenerationLimits.loreBudgetStep,
                readout: SliderReadout.percent,
                hint: "Share of the free context the lorebook may claim. Whatever it doesn't spend goes to story prose."
            )
            SettingSlider("Frequency penalty", value: $editor.value.frequencyPenalty, in: GenerationLimits.penaltyRange, step: 0.1)
            SettingSlider("Presence penalty", value: $editor.value.presencePenalty, in: GenerationLimits.penaltyRange, step: 0.1)
        } header: {
            Text("Generation defaults")
        } footer: {
            VStack(alignment: .leading, spacing: 6) {
                Text("Sampling every profile inherits unless it sets its own. Changing one moves every profile that hasn't overridden it.")
                SaveErrorLabel(message: editor.error)
            }
        }
    }
}
