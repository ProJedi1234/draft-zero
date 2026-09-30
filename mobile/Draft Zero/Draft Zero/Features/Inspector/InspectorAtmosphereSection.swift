import SwiftUI

/// The story's colour: eight named hues and none, how strongly the room takes
/// it, and whether the story picks it after each turn. Changes nothing the
/// model reads, which is why it sits last in the Prompt segment.
struct InspectorAtmosphereSection: View {
    @Bindable var controls: AtmosphereControls
    /// Where the post-turn picker got to on this story, if it has run this session.
    let status: SyncWireEvent.Atmosphere?

    var body: some View {
        Section {
            Toggle(isOn: $controls.isAuto) {
                Text("Choose automatically")
                Text("The story picks its colour after each turn, as the scene moves.")
            }
            if controls.isAuto, let status {
                InspectorAtmosphereStatusRow(status: status)
            }
            InspectorSwatchGrid(controls: controls)
            // No strength while the story is choosing: the next check would move it back.
            if !controls.isAuto, controls.hue.value != nil {
                SettingSlider(
                    "Strength",
                    value: Bindable(controls.strength).value,
                    in: 0...1,
                    step: 0.05,
                    readout: SliderReadout.fractionPercent,
                    hint: "How far the room's colours travel toward the hue."
                )
            }
        } header: {
            Text("Atmosphere")
        } footer: {
            Text(controls.isAuto
                ? "Pick a swatch to keep a colour; that turns automatic off."
                : "Light and dark mode each render the colour their own way.")
        }
    }
}
