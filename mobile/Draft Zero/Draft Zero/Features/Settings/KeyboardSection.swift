import SwiftUI

/// How the composer treats the touch keyboard. Saved on this device and never
/// sent to the server, so it shows even when the settings payload doesn't load.
struct KeyboardSection: View {
    @AppStorage("composerReturnSends") private var returnSends = true

    var body: some View {
        Section {
            Toggle("Return Sends", isOn: $returnSends)
        } header: {
            Text("Keyboard")
        } footer: {
            Text("On, the Return key sends your move. Turn it off to type line breaks on the touch keyboard. Hardware keyboards always send with Return and break lines with Shift. Saved on this device only.")
        }
    }
}
