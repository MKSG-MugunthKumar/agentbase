import AppKit
import Foundation

let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
let source = root.appendingPathComponent("desktop/assets/app-icon.png")
let destination = root.appendingPathComponent("desktop/assets/appx", isDirectory: true)
guard let icon = NSImage(contentsOf: source) else { fatalError("Missing AgentBase app icon") }
try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)

let tiles: [(String, Int, Int)] = [
    ("StoreLogo.png", 50, 50),
    ("Square150x150Logo.png", 150, 150),
    ("Square44x44Logo.png", 44, 44),
    ("Wide310x150Logo.png", 310, 150),
]

for (name, width, height) in tiles {
    guard let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
        isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0,
        bitsPerPixel: 0
    ), let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
        fatalError("Could not create \(name)")
    }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    NSColor(calibratedRed: 15 / 255, green: 35 / 255, blue: 52 / 255, alpha: 1).setFill()
    NSRect(x: 0, y: 0, width: width, height: height).fill()
    let side = CGFloat(min(width, height)) * 0.9
    icon.draw(in: NSRect(x: (CGFloat(width) - side) / 2,
                         y: (CGFloat(height) - side) / 2,
                         width: side, height: side),
              from: .zero, operation: .sourceOver, fraction: 1)
    context.flushGraphics()
    NSGraphicsContext.restoreGraphicsState()
    guard let png = bitmap.representation(using: .png, properties: [:]) else {
        fatalError("Could not encode \(name)")
    }
    try png.write(to: destination.appendingPathComponent(name))
}
