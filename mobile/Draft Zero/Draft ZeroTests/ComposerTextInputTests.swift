import SwiftUI
import Testing
import UIKit
@testable import Draft_Zero

struct ComposerTextInputTests {
    @Test func softwareReturnSendsWithoutChangingTheDraft() {
        var draft = "Before autocorrect"
        var sent: [String] = []
        let input = ComposerTextInput(
            text: Binding(get: { draft }, set: { draft = $0 }),
            placeholder: "Write", accessibilityLabel: "Composer",
            send: { sent.append(draft) }
        )
        let view = ComposerTextView()
        view.text = "After autocorrect."
        let coordinator = input.makeCoordinator()
        let accepted = coordinator.textView(view, shouldChangeTextIn: NSRange(location: view.text.utf16.count, length: 0), replacementText: "\n")
        #expect(!accepted)
        #expect(sent == ["After autocorrect."])
        #expect(draft == "After autocorrect.")
    }

    @Test func newlinePreferenceAndMultilinePasteDoNotSend() {
        var sends = 0
        let input = ComposerTextInput(text: .constant("Draft"), placeholder: "Write", accessibilityLabel: "Composer", returnSends: false, send: { sends += 1 })
        let coordinator = input.makeCoordinator()
        let view = ComposerTextView()
        #expect(coordinator.textView(view, shouldChangeTextIn: NSRange(location: 0, length: 0), replacementText: "\n"))
        coordinator.parent.returnSends = true
        #expect(coordinator.textView(view, shouldChangeTextIn: NSRange(location: 0, length: 0), replacementText: "One\nTwo"))
        #expect(sends == 0)
    }

    @Test func explicitLineBreakPreservesTheSelectionAndDoesNotSend() {
        var draft = "OneTwo"
        var sends = 0
        let input = ComposerTextInput(text: Binding(get: { draft }, set: { draft = $0 }), placeholder: "Write", accessibilityLabel: "Composer", send: { sends += 1 })
        let coordinator = input.makeCoordinator()
        let view = ComposerTextView()
        view.delegate = coordinator
        view.text = draft
        view.selectedRange = NSRange(location: 3, length: 0)
        view.insertLineBreak()
        #expect(view.text == "One\nTwo")
        #expect(draft == "One\nTwo")
        #expect(sends == 0)
    }

    @Test func hardwareReturnSendsAndShiftReturnInsertsALineBreak() throws {
        var sends = 0
        let view = ComposerTextView()
        view.text = "Hardware draft"
        view.send = { sends += 1 }
        let commands = try #require(view.keyCommands)
        let send = try #require(commands.first { $0.input == "\r" && $0.modifierFlags.isEmpty })
        let newline = try #require(commands.first { $0.input == "\r" && $0.modifierFlags == .shift })
        view.perform(send.action, with: send)
        #expect(sends == 1)
        #expect(view.text == "Hardware draft")
        view.selectedRange = NSRange(location: view.text.utf16.count, length: 0)
        view.perform(newline.action, with: newline)
        #expect(view.text == "Hardware draft\n")
        #expect(sends == 1)
    }
}
