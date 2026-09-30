import SwiftUI

/// The pinned top of the inspector: which model is about to run, how full its
/// window is, and the segment picker. On iPhone it also closes the sheet.
struct InspectorHeader: View {
    let model: InspectorModel
    @Binding var section: InspectorSection

    @Environment(\.inspectorIsSheet) private var isSheet
    @AppStorage("inspectorOpen") private var inspectorOpen = false

    var body: some View {
        VStack(spacing: 10) {
            InspectorStatusStrip(model: model, section: $section)
            HStack(spacing: 12) {
                Picker("Section", selection: $section) {
                    ForEach(InspectorSection.allCases) { section in
                        Text(section.title).tag(section)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                if isSheet {
                    Button("Close Inspector", systemImage: "xmark", action: close)
                        .labelStyle(.iconOnly)
                        .buttonStyle(.glass)
                        .buttonBorderShape(.circle)
                }
            }
        }
        .padding(.horizontal)
        .padding(.top, 8)
        .padding(.bottom, 6)
        // Pinned chrome, capped as system bars are: at accessibility sizes it
        // would take half the sheet, and the Model segment has every detail.
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
    }

    private func close() {
        inspectorOpen = false
    }
}
