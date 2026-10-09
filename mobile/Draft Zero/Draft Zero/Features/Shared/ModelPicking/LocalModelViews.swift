import SwiftUI

/// "loaded · nvfp4 · 66K", with a dot that says whether the first passage
/// waits for the model to load.
struct LocalModelDetail: View {
    let local: OpenRouterModel.Local
    let extra: [String]

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(local.loaded ? Color.green : Color.secondary.opacity(0.4))
                .frame(width: 6, height: 6)
                .accessibilityHidden(true)
            Text(([local.loaded ? "loaded" : "cold", local.quantization].compactMap { $0 } + extra).joined(separator: " · "))
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
    }
}

/// The All · Local · External switch at the top of a picker. Only shown while
/// there is a local host to filter by.
struct ModelSourcePicker: View {
    @Binding var source: ModelSource

    var body: some View {
        Picker("Show", selection: $source) {
            ForEach(ModelSource.allCases) { source in
                Text(source.label).tag(source)
            }
        }
        .pickerStyle(.segmented)
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets())
    }
}
