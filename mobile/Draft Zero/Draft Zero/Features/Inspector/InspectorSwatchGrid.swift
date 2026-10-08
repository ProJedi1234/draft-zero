import SwiftUI

/// None, then the eight named atmospheres. A hue the picker chose that matches
/// no swatch gets its own, so the row always shows what the story is wearing.
struct InspectorSwatchGrid: View {
    let controls: AtmosphereControls

    var body: some View {
        let hue = controls.hue.value
        let current = StoryTintValue(hue: hue, strength: 1)
        let named = current.namedTint
        let auto = controls.isAuto

        LazyVGrid(columns: [GridItem(.adaptive(minimum: 44, maximum: 52), spacing: 4)], spacing: 4) {
            InspectorTintSwatch(label: "No tint", tint: .none, isSelected: hue == nil, isProvisional: auto) {
                controls.pick(nil)
            }
            if hue != nil, named == nil {
                InspectorTintSwatch(label: "Chosen by the story", tint: current, isSelected: true, isProvisional: auto, action: controls.keepCurrent)
            }
            ForEach(StoryTintValue.named) { tint in
                InspectorTintSwatch(label: tint.label, tint: tint.value, isSelected: named?.id == tint.id, isProvisional: auto) {
                    controls.pick(tint)
                }
            }
        }
        .padding(.vertical, 4)
    }
}
