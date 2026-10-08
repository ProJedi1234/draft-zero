import SwiftUI

/// What the next picture is drawn with, as words: frame, style, assistance.
/// They are state rather than moves, so the writer knows what Send is about
/// to cost without opening anything.
struct ImageOptionsRow: View {
    @Bindable var composer: ComposerModel
    let disabled: Bool

    @State private var editingCustomStyle = false
    @State private var customStyle = ""

    var body: some View {
        HStack(spacing: 6) {
            Button {
                composer.aspectRatio = composer.aspectRatio.next
            } label: {
                Label(composer.aspectRatio.rawValue, systemImage: composer.aspectRatio.systemImage)
            }
            .accessibilityLabel("Frame \(composer.aspectRatio.rawValue)")
            .accessibilityHint("Cycles the frame")

            Menu {
                Picker("Style", selection: $composer.imageStyle) {
                    Text("No Style").tag(String?.none)
                    ForEach(ImageStyles.presets) { preset in
                        Text(preset.label).tag(Optional(preset.text))
                    }
                    if let style = composer.imageStyle, ImageStyles.preset(for: style) == nil {
                        Text(style).tag(Optional(style))
                    }
                }
                Button("Custom Style…", systemImage: "pencil") {
                    customStyle = composer.imageStyle.flatMap { ImageStyles.preset(for: $0) == nil ? $0 : nil } ?? ""
                    editingCustomStyle = true
                }
            } label: {
                Label(styleLabel, systemImage: "paintpalette")
            }

            Button {
                composer.imageAssisted.toggle()
            } label: {
                Label(composer.imageAssisted ? "Assisted" : "Verbatim",
                      systemImage: composer.imageAssisted ? "wand.and.sparkles" : "pencil.line")
            }
            .disabled(disabled)
            .accessibilityHint(composer.imageAssisted
                ? "The model expands your brief. Tap to send your words as written."
                : "Your words go as written. Tap to have the model expand them.")
        }
        .font(.caption)
        .labelStyle(.titleAndIcon)
        .buttonStyle(.bordered)
        .buttonBorderShape(.capsule)
        .controlSize(.small)
        .alert("Custom Style", isPresented: $editingCustomStyle) {
            TextField("e.g. linocut, two colours", text: $customStyle)
            Button("Use Style") {
                let trimmed = customStyle.trimmingCharacters(in: .whitespacesAndNewlines)
                composer.imageStyle = trimmed.isEmpty ? nil : String(trimmed.prefix(500))
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Art direction added to the end of every picture's prompt.")
        }
    }

    private var styleLabel: String {
        guard let style = composer.imageStyle else { return "No Style" }
        return ImageStyles.preset(for: style)?.label ?? "Custom"
    }
}
