import SwiftUI

/// Pinch to zoom, drag to pan when zoomed, double-tap to jump in and out, and
/// a single tap reported to the caller.
///
/// The content is laid out at the size `ZoomGeometry` fits it to, so it can be
/// any view; the zoom itself only moves and scales it.
struct ZoomablePicture<Content: View>: View {
    let aspectRatio: Double
    let insets: EdgeInsets
    /// Only the visible page reports zoom, so the pager knows when to stop scrolling.
    let isActive: Bool
    @Binding var isZoomed: Bool
    var onSingleTap: () -> Void = {}
    @ViewBuilder var content: () -> Content

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var viewport = CGSize.zero
    @State private var scale = 1.0
    @State private var pan = CGSize.zero
    @State private var pinchStart: PinchStart?
    @State private var dragStart: CGSize?

    private struct PinchStart: Equatable {
        var scale: Double
        var pan: CGSize
    }

    private var geometry: ZoomGeometry {
        ZoomGeometry(viewport: viewport, insets: insets, aspectRatio: aspectRatio)
    }

    var body: some View {
        content()
            .frame(width: geometry.fittedSize.width, height: geometry.fittedSize.height)
            .scaleEffect(scale)
            .offset(
                x: geometry.restingOffset.width + pan.width,
                y: geometry.restingOffset.height + pan.height
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .contentShape(.rect)
            .onGeometryChange(for: CGSize.self, of: \.size) { viewport = $0 }
            .simultaneousGesture(pinch)
            .simultaneousGesture(drag, isEnabled: scale > 1)
            .gesture(taps)
            .onChange(of: geometry) { settle(animated: false) }
            .onChange(of: scale) { reportZoom() }
            .onChange(of: isActive) { _, active in
                if active { reportZoom() } else { reset(animated: false) }
            }
            .accessibilityAction(named: "Zoom In") { zoom(to: ZoomGeometry.doubleTapScale, about: .zero) }
            .accessibilityAction(named: "Zoom Out") { reset(animated: true) }
    }

    private var pinch: some Gesture {
        MagnifyGesture()
            .onChanged { value in
                let start = pinchStart ?? PinchStart(scale: scale, pan: pan)
                pinchStart = start
                let target = min(max(start.scale * value.magnification, 0.6), ZoomGeometry.maxScale * 1.2)
                scale = target
                pan = geometry.pan(from: start.pan, scale: start.scale, to: target, about: relativeToCentre(value.startLocation))
            }
            .onEnded { _ in
                pinchStart = nil
                settle(animated: true)
            }
    }

    private var drag: some Gesture {
        DragGesture(minimumDistance: 4)
            .onChanged { value in
                let start = dragStart ?? pan
                dragStart = start
                let moved = CGSize(width: start.width + value.translation.width, height: start.height + value.translation.height)
                pan = geometry.clampedPan(moved, scale: scale)
            }
            .onEnded { _ in dragStart = nil }
    }

    private var taps: some Gesture {
        ExclusiveGesture(SpatialTapGesture(count: 2), SpatialTapGesture(count: 1))
            .onEnded { result in
                switch result {
                case .first(let tap):
                    if scale > 1.01 {
                        reset(animated: true)
                    } else {
                        zoom(to: ZoomGeometry.doubleTapScale, about: relativeToCentre(tap.location))
                    }
                case .second:
                    onSingleTap()
                }
            }
    }

    private func relativeToCentre(_ point: CGPoint) -> CGPoint {
        CGPoint(x: point.x - viewport.width / 2, y: point.y - viewport.height / 2)
    }

    private func zoom(to target: Double, about anchor: CGPoint) {
        let newPan = geometry.clampedPan(
            geometry.pan(from: pan, scale: scale, to: target, about: anchor),
            scale: target
        )
        apply(animated: true) {
            scale = target
            pan = newPan
        }
    }

    private func reset(animated: Bool) {
        apply(animated: animated) {
            scale = 1
            pan = .zero
        }
    }

    private func settle(animated: Bool) {
        let target = geometry.clampedScale(scale)
        let newPan = target > 1 ? geometry.clampedPan(pan, scale: target) : .zero
        guard target != scale || newPan != pan else { return }
        apply(animated: animated) {
            scale = target
            pan = newPan
        }
    }

    private func reportZoom() {
        if isActive { isZoomed = scale > 1.001 }
    }

    private func apply(animated: Bool, _ change: () -> Void) {
        if animated && !reduceMotion {
            withAnimation(.snappy(duration: 0.3), change)
        } else {
            change()
        }
    }
}
