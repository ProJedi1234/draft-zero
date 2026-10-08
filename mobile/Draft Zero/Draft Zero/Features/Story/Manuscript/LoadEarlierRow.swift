import SwiftUI

/// Loads the previous page of passages as the reader nears the top.
struct LoadEarlierRow: View {
    let isLoading: Bool
    let load: () -> Void

    var body: some View {
        HStack {
            Spacer()
            if isLoading {
                ProgressView()
            } else {
                Button("Load Earlier Passages", systemImage: "arrow.up", action: load)
                    .font(.footnote)
                    .buttonStyle(.bordered)
            }
            Spacer()
        }
        .padding(.vertical, 12)
        .onAppear(perform: load)
    }
}
