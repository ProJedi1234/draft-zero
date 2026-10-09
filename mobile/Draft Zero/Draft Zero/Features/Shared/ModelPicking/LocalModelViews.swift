import SwiftUI

/// The small "Local" capsule beside a local model's name or group.
struct LocalBadge: View {
    var body: some View {
        Text("Local")
            .font(.caption2.weight(.semibold))
            .textCase(.uppercase)
            .padding(.horizontal, 6)
            .padding(.vertical, 1)
            .foregroundStyle(.teal)
            .background(.teal.opacity(0.15), in: .capsule)
            .accessibilityLabel("Runs locally")
    }
}

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

/// A provider group's header, marked when its models run locally.
struct CatalogGroupHeader: View {
    let provider: String
    let isLocal: Bool

    var body: some View {
        HStack(spacing: 6) {
            Text(provider)
            if isLocal { LocalBadge() }
        }
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
