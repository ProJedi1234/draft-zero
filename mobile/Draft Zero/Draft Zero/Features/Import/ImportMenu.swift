import SwiftUI

/// The three formats the library imports, each with a line on what it becomes.
struct ImportMenu: View {
    let onPick: (ImportKind) -> Void

    var body: some View {
        Menu("Import", systemImage: "square.and.arrow.down") {
            ForEach(ImportKind.allCases) { kind in
                Button {
                    onPick(kind)
                } label: {
                    Label {
                        Text(kind.title)
                        Text(kind.subtitle)
                    } icon: {
                        Image(systemName: kind.systemImage)
                    }
                }
            }
        }
    }
}
