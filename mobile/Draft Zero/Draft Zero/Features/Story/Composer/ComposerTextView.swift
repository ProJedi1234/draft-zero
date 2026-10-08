import UIKit

final class ComposerTextView: UITextView {
    var send: () -> Void = {}
    var continueStory: () -> Void = {}
    var swapMode: (() -> Void)?
    private(set) var insertingLineBreak = false

    override var keyCommands: [UIKeyCommand]? {
        guard markedTextRange == nil else { return super.keyCommands }
        var commands = [
            UIKeyCommand(input: "\r", modifierFlags: [], action: #selector(hardwareSend)),
            UIKeyCommand(input: "\r", modifierFlags: .shift, action: #selector(hardwareLineBreak)),
            UIKeyCommand(input: "\r", modifierFlags: .alternate, action: #selector(hardwareLineBreak)),
            UIKeyCommand(input: "\r", modifierFlags: .command, action: #selector(hardwareContinue)),
            UIKeyCommand(input: "\r", modifierFlags: .control, action: #selector(hardwareContinue)),
        ]
        if swapMode != nil { commands.append(UIKeyCommand(input: "\t", modifierFlags: [], action: #selector(hardwareTab))) }
        commands.forEach { $0.wantsPriorityOverSystemBehavior = true }
        return commands + (super.keyCommands ?? [])
    }

    func insertLineBreak() {
        guard isEditable else { return }
        insertingLineBreak = true
        defer { insertingLineBreak = false }
        insertText("\n")
    }

    override func paste(_ sender: Any?) {
        insertingLineBreak = true
        defer { insertingLineBreak = false }
        super.paste(sender)
    }

    override func insertDictationResult(_ dictationResult: [UIDictationPhrase]) {
        insertingLineBreak = true
        defer { insertingLineBreak = false }
        super.insertDictationResult(dictationResult)
    }

    @objc private func hardwareSend() {
        guard isEditable, markedTextRange == nil else { return }
        send()
    }

    @objc private func hardwareLineBreak() {
        guard isEditable else { return }
        insertLineBreak()
    }

    @objc private func hardwareContinue() {
        guard isEditable, markedTextRange == nil else { return }
        if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { continueStory() }
        else { send() }
    }

    @objc private func hardwareTab() { swapMode?() }
}
