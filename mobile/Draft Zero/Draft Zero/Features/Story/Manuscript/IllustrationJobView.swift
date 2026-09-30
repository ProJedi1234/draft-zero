import SwiftUI

/// The picture being drawn, at the live edge where it will land. Its frame is
/// reserved at the final aspect ratio so nothing moves when pixels arrive.
struct IllustrationJobView: View {
    let job: IllustrationController.Job
    let stop: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shimmer = false

    var body: some View {
        Color.clear
            .aspectRatio(job.aspectRatio.value, contentMode: .fit)
            .overlay {
                if let preview = job.preview {
                    Image(uiImage: preview)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                        .blur(radius: job.landedImageId == nil ? 6 : 0)
                } else {
                    Rectangle()
                        .fill(.fill.tertiary)
                        .opacity(shimmer ? 0.5 : 1)
                }
            }
            .clipShape(.rect(cornerRadius: Theme.cornerRadius))
            .overlay(alignment: .bottomLeading) {
                HStack(spacing: 10) {
                    ProgressView()
                        .controlSize(.small)
                    Text(job.landedImageId == nil ? "Drawing…" : "Finishing…")
                        .font(.footnote)
                    if job.landedImageId == nil {
                        Button("Stop", systemImage: "stop.fill", action: stop)
                            .labelStyle(.iconOnly)
                            .font(.footnote)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .glassEffect(.regular, in: .capsule)
                .padding(10)
            }
            .padding(.vertical, 10)
            .animation(.easeOut(duration: 0.3), value: job.preview)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeInOut(duration: 1).repeatForever()) { shimmer = true }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Drawing a picture: \(job.prompt)")
    }
}
