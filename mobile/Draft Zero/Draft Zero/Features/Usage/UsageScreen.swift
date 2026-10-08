import SwiftUI

/// What generation has cost, by window, day, story and model.
struct UsageScreen: View {
    @Environment(AppModel.self) private var app
    @State private var model = UsageModel()

    var body: some View {
        content
            .navigationTitle("Usage")
            .navigationSubtitle(subtitle)
            .refreshable { await model.reload() }
            .task(id: app.serverURL) {
                model.attach(api: app.api)
                await model.reload()
            }
            .onAppear {
                model.start(sync: app.sync)
                if model.payload != nil { model.scheduleRefresh() }
            }
            .onDisappear { model.stop() }
    }

    @ViewBuilder
    private var content: some View {
        if let payload = model.payload {
            UsageList(payload: payload, onOpenStory: app.openStory)
        } else if let error = model.loadError {
            PullToRefreshUnavailableView {
                Label("Can't Load Usage", systemImage: "wifi.exclamationmark")
            } description: {
                Text(error.localizedDescription)
            } actions: {
                Button("Try Again") { Task { await model.reload() } }
                    .buttonStyle(.borderedProminent)
            }
        } else {
            ProgressView("Loading usage")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var subtitle: Text {
        guard let summary = model.payload?.summary else { return Text("") }
        return Text("\(Format.usdFloor(summary.todayUsd, unpriced: summary.todayUnpricedCalls)) today")
    }
}
