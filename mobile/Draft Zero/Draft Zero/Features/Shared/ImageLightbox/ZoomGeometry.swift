import SwiftUI

/// The geometry of pinch-zoom and pan for a picture fitted into a viewport.
///
/// At rest the picture is fitted and centred in the viewport minus `insets`,
/// which keeps it clear of chrome. Zoomed, it may spread across the whole
/// viewport. Pans are offsets from the resting position.
nonisolated struct ZoomGeometry: Equatable {
    static let maxScale = 5.0
    static let doubleTapScale = 2.5

    var viewport: CGSize
    var insets: EdgeInsets
    var aspectRatio: Double

    /// The picture's size at scale 1.
    var fittedSize: CGSize {
        let width = max(viewport.width - insets.leading - insets.trailing, 1)
        let height = max(viewport.height - insets.top - insets.bottom, 1)
        let ratio = aspectRatio > 0 ? aspectRatio : 1
        if width / height > ratio {
            return CGSize(width: height * ratio, height: height)
        }
        return CGSize(width: width, height: width / ratio)
    }

    /// Where the picture's centre rests, relative to the viewport's centre.
    var restingOffset: CGSize {
        CGSize(width: (insets.leading - insets.trailing) / 2, height: (insets.top - insets.bottom) / 2)
    }

    func clampedScale(_ scale: Double) -> Double {
        min(max(scale, 1), Self.maxScale)
    }

    /// The pan closest to `pan` that keeps the picture covering the viewport
    /// along every axis it is larger than the viewport on.
    func clampedPan(_ pan: CGSize, scale: Double) -> CGSize {
        let size = fittedSize
        let rest = restingOffset
        return CGSize(
            width: Self.clamp(pan.width, extent: size.width * scale, viewport: viewport.width, rest: rest.width),
            height: Self.clamp(pan.height, extent: size.height * scale, viewport: viewport.height, rest: rest.height)
        )
    }

    /// The pan that keeps the point under `anchor` still while zooming from
    /// one scale to another. `anchor` is relative to the viewport's centre.
    func pan(from pan: CGSize, scale: Double, to newScale: Double, about anchor: CGPoint) -> CGSize {
        guard scale > 0 else { return pan }
        let ratio = newScale / scale
        let rest = restingOffset
        return CGSize(
            width: (anchor.x - rest.width) * (1 - ratio) + pan.width * ratio,
            height: (anchor.y - rest.height) * (1 - ratio) + pan.height * ratio
        )
    }

    private static func clamp(_ pan: Double, extent: Double, viewport: Double, rest: Double) -> Double {
        guard extent > viewport else { return 0 }
        let centre = viewport / 2 + rest
        let lower = viewport - centre - extent / 2
        let upper = extent / 2 - centre
        return min(max(pan, lower), upper)
    }
}
