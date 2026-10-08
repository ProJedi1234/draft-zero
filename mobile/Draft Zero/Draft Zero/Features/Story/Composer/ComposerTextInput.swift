import SwiftUI
import UIKit

/// A multiline input that handles software Return before it becomes draft text.
struct ComposerTextInput: UIViewRepresentable {
    @Binding var text: String
    let placeholder: String
    let accessibilityLabel: String
    var machineText = false
    var disabled = false
    var returnSends = true
    var focusRequest = 0
    var lineBreakRequest = 0
    var onFocus: () -> Void = {}
    var onTab: (() -> Void)?
    var onContinue: () -> Void = {}
    let send: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> ComposerTextView {
        let view = ComposerTextView()
        view.delegate = context.coordinator
        view.backgroundColor = .clear
        view.textContainerInset = .zero
        view.textContainer.lineFragmentPadding = 0
        view.adjustsFontForContentSizeCategory = true
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return view
    }

    func updateUIView(_ view: ComposerTextView, context: Context) {
        context.coordinator.parent = self
        let descriptor = UIFontDescriptor.preferredFontDescriptor(withTextStyle: machineText ? .footnote : .body)
        view.font = UIFont(descriptor: descriptor.withDesign(machineText ? .monospaced : .serif) ?? descriptor, size: 0)
        view.textColor = machineText ? .secondaryLabel : .label
        view.isEditable = !disabled
        view.accessibilityLabel = accessibilityLabel
        view.accessibilityHint = text.isEmpty ? placeholder : nil
        view.autocapitalizationType = machineText ? .none : .sentences
        view.autocorrectionType = machineText ? .no : .yes
        view.spellCheckingType = machineText ? .no : .yes
        let returnKey: UIReturnKeyType = returnSends ? .send : .default
        if view.returnKeyType != returnKey {
            view.returnKeyType = returnKey
            if view.isFirstResponder { view.reloadInputViews() }
        }
        if view.text != text && view.markedTextRange == nil { view.text = text }
        view.send = send
        view.continueStory = onContinue
        view.swapMode = onTab
        if context.coordinator.focusRequest != focusRequest {
            context.coordinator.focusRequest = focusRequest
            DispatchQueue.main.async { view.becomeFirstResponder() }
        }
        if context.coordinator.lineBreakRequest != lineBreakRequest {
            context.coordinator.lineBreakRequest = lineBreakRequest
            guard !disabled else { return }
            DispatchQueue.main.async {
                view.becomeFirstResponder()
                view.insertLineBreak()
            }
        }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: ComposerTextView, context: Context) -> CGSize? {
        guard let width = proposal.width else { return nil }
        let line = uiView.font?.lineHeight ?? 22
        let fitting = uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height
        let maximum = line * 6
        uiView.isScrollEnabled = fitting > maximum
        return CGSize(width: width, height: min(maximum, max(line, fitting)))
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: ComposerTextInput
        var focusRequest: Int
        var lineBreakRequest: Int

        init(_ parent: ComposerTextInput) {
            self.parent = parent
            focusRequest = parent.focusRequest
            lineBreakRequest = parent.lineBreakRequest
        }

        func textViewDidBeginEditing(_ textView: UITextView) { parent.onFocus() }

        func textViewDidChange(_ textView: UITextView) { parent.text = textView.text }

        func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
            guard !parent.disabled else { return false }
            guard let view = textView as? ComposerTextView else { return true }
            if text == "\n", parent.returnSends, !view.insertingLineBreak, view.markedTextRange == nil {
                // Autocorrect may commit just before Return; send that latest text.
                parent.text = view.text
                parent.send()
                return false
            }
            return true
        }
    }
}
