import SwiftUI

/// The pinned top of the inspector: a title row naming the model and how full
/// its window is, over the segment picker. On iPhone it also closes the sheet.
struct InspectorHeader: View {
    let model: InspectorModel
    @Binding var section: InspectorSection

    @Environment(\.inspectorIsSheet) private var isSheet
    @AppStorage("inspectorOpen") private var inspectorOpen = false

    var body: some View {
        VStack(spacing: 12) {
            HStack(spacing: 8) {
                InspectorStatusStrip(model: model, section: $section)
                if isSheet {
                    Button("Close Inspector", systemImage: "xmark", action: close)
                        .labelStyle(.iconOnly)
                        .buttonStyle(.glass)
                        .buttonBorderShape(.circle)
                }
            }
            Picker("Section", selection: $section) {
                ForEach(InspectorSection.allCases) { section in
                    Text(section.title).tag(section)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
        }
        .padding(.horizontal)
        // A sheet's drag indicator and rounded corners crowd the first row.
        .padding(.top, isSheet ? 24 : 12)
        .padding(.bottom, 8)
        // Pinned chrome, capped as system bars are: at accessibility sizes it
        // would take half the sheet, and the Model segment has every detail.
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
    }

    private func close() {
        inspectorOpen = false
    }
}
