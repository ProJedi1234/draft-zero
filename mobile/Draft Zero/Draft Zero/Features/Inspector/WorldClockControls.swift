import Foundation
import Observation

@Observable
final class WorldClockControls {
    let day: ServerSyncedValue<Int>
    let time: ServerSyncedValue<String>
    private(set) var isSaving = false
    @ObservationIgnored private var dirty = false
    @ObservationIgnored private var focused = false
    @ObservationIgnored private let persist: ([JSONObject]) async -> Bool

    init(minutes: Int, version: String, persist: @escaping ([JSONObject]) async -> Bool) {
        day = ServerSyncedValue(WorldClock.day(minutes), version: version)
        time = ServerSyncedValue(WorldClock.time(minutes), version: version)
        self.persist = persist
    }

    var dayValue: Int {
        get { day.value }
        set {
            guard newValue != day.value else { return }
            dirty = true
            day.setLocal(newValue)
            updateHold()
        }
    }

    var timeValue: String {
        get { time.value }
        set {
            guard newValue != time.value else { return }
            dirty = true
            time.setLocal(newValue)
            updateHold()
        }
    }

    var absoluteMinutes: Int? { WorldClock.absoluteMinutes(day: day.value, time: time.value) }

    func receive(minutes: Int, version: String) {
        day.receive(WorldClock.day(minutes), version: version)
        time.receive(WorldClock.time(minutes), version: version)
    }

    func setFocused(_ value: Bool) {
        focused = value
        updateHold()
    }

    func save() async {
        guard !isSaving, let minutes = absoluteMinutes else { return }
        isSaving = true
        if await persist([["type": "set-clock", "minutes": .number(Double(minutes))]]) {
            dirty = false
            updateHold()
        }
        isSaving = false
    }

    private func updateHold() {
        day.hold(focused || dirty)
        time.hold(focused || dirty)
    }
}
