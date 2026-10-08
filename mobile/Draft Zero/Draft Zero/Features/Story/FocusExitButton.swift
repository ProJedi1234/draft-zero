import SwiftUI

/// Focus mode hides the status bar. Keep its exit control near the top edge,
/// with room around the rounded corner.
struct FocusExitButton: View {
    let exit: () -> Void

    @State private var topInset: CGFloat = 0

    var body: some View {
        Button("Exit Focus", systemImage: "arrow.down.right.and.arrow.up.left", action: exit)
            .labelStyle(.iconOnly)
            .buttonStyle(.glass)
            .keyboardShortcut(".", modifiers: .command)
            // Where the strip is shorter than the padded button (no notch,
            // landscape), the padding alone keeps it off the top edge.
            .padding(.vertical, 8)
            .frame(minHeight: topInset)
            .padding([.top, .trailing])
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
            .ignoresSafeArea(edges: .top)
            // Read outside the ignore: inside it, the inset reads as zero.
            .onGeometryChange(for: CGFloat.self, of: \.safeAreaInsets.top) { topInset = $0 }
    }
}
