import SwiftUI

/// A form row naming the image model; tapping it opens the searchable catalog.
/// Nil follows `fallback`, which the list offers as its own row.
struct ImageModelPickerRow: View {
    let title: String
    let models: [OpenRouterImageModel]
    let selection: String?
    let fallback: ImageModelFallback
    /// What the shown model costs per image, preformatted by the server, or nil.
    let price: String?
    /// The effective retention policy: models no ZDR endpoint serves are greyed.
    let zdr: Bool
    let onSelect: (String?) -> Void

    @State private var isPresented = false

    var body: some View {
        let resolved = selection ?? fallback.resolve(in: models, zdr: zdr)
        let name = resolved.map { id in models.first { $0.id == id }?.name ?? id } ?? "None"
        let detail = [selection == nil ? fallback.title : nil, price].compactMap { $0 }.joined(separator: " · ")

        Button(action: present) {
            PickerRowLabel(title: title, value: name, detail: detail.isEmpty ? nil : detail)
        }
        .tint(.primary)
        .accessibilityHint("Opens the image model list.")
        .sheet(isPresented: $isPresented) {
            ImageModelPickerSheet(
                title: title,
                models: models,
                selection: selection,
                fallback: fallback,
                zdr: zdr,
                onSelect: onSelect
            )
        }
    }

    private func present() {
        isPresented = true
    }
}
