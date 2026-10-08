import Foundation
import Observation

/// A control's value as it follows the server without fighting the person
/// using it. A port of `hooks/use-server-synced.ts`.
///
/// A server value is adopted only when the control is idle (no local write in
/// flight, nothing holding it) and only when it comes from a row version newer
/// than the one on display. Versions are the story's `updatedAt`, ISO-8601 UTC,
/// so string order is time order: a payload rendered before this device's own
/// write can never roll the control backwards. Every counted `write` must end
/// in exactly one `settle` or `reset`, or the control stops following the server.
@Observable
final class ServerSyncedValue<Value: Equatable> {
    /// What the control shows.
    private(set) var value: Value
    /// What the row is believed to hold: the server's value, or this device's
    /// own write once declared. A save compares against it.
    private(set) var server: Value
    /// Local writes sent and not yet resolved. Counted, because the writer can
    /// get ahead of the network with two changes travelling at once.
    private(set) var inFlight = 0
    /// The row version `server` was adopted from.
    private(set) var version: String
    /// Focus, a pending edit or a gesture owns the value.
    private(set) var isHeld = false

    /// The newest payload seen, kept so a hold's release or a write's end can adopt it.
    @ObservationIgnored private var offered: Value
    @ObservationIgnored private var offeredVersion: String

    init(_ value: Value, version: String) {
        self.value = value
        server = value
        self.version = version
        offered = value
        offeredVersion = version
    }

    /// True when nothing local is pending, so the server's value is what shows.
    var isIdle: Bool { inFlight == 0 && !isHeld }

    /// Offers the server's value at a row version.
    func receive(_ serverValue: Value, version: String) {
        // An older payload landing late must not replace a newer one still waiting.
        guard version >= offeredVersion else { return }
        offered = serverValue
        offeredVersion = version
        reconcile()
    }

    func hold(_ held: Bool) {
        guard held != isHeld else { return }
        isHeld = held
        reconcile()
    }

    /// Moves the control without claiming anything was persisted.
    func setLocal(_ next: Value) {
        if value != next { value = next }
    }

    /// Declares `next` persisted, or about to be. Returns false when the row
    /// already holds it: nothing is counted, and no `settle` may follow.
    @discardableResult
    func write(_ next: Value) -> Bool {
        setLocal(next)
        guard next != server else { return false }
        server = next
        inFlight += 1
        return true
    }

    /// Ends one write that succeeded.
    func settle() {
        endWrite()
        reconcile()
    }

    /// Ends one write the server refused and puts the control back.
    func reset(to previous: Value) {
        endWrite()
        server = previous
        setLocal(previous)
        reconcile()
    }

    /// Ends one refused write but leaves the edit on screen, for text the
    /// writer typed and should not lose to a failed request.
    func resetServer(to previous: Value) {
        endWrite()
        server = previous
        reconcile()
    }

    private func endWrite() {
        // Clamped: going negative would suspend the control for good.
        if inFlight > 0 { inFlight -= 1 }
    }

    private func reconcile() {
        guard inFlight == 0, offeredVersion > version else { return }
        if isHeld {
            // Track the row through the hold so a release that lands back on the
            // old value still counts as a change. The version stays owed.
            if server != offered { server = offered }
            return
        }
        version = offeredVersion
        server = offered
        setLocal(offered)
    }
}
