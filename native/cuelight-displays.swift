// cuelight-displays: a tiny macOS helper Cuelight runs to see and fix how screens are arranged,
// so connecting a projector never needs a trip to System Settings.
//   cuelight-displays list     -> JSON array of online displays (id, builtin, main, mirrorOf, inMirrorSet, width, height)
//   cuelight-displays extend   -> stop mirroring: every screen becomes its own screen
//   cuelight-displays warp X Y -> move the mouse pointer to X,Y (global points, top-left origin)
//   cuelight-displays serve    -> keep running and read "warp X Y" lines from stdin (fast, no process start per move)
import CoreGraphics
import Foundation

func onlineDisplays() -> [CGDirectDisplayID] {
    var count: UInt32 = 0
    guard CGGetOnlineDisplayList(0, nil, &count) == .success, count > 0 else { return [] }
    var ids = [CGDirectDisplayID](repeating: 0, count: Int(count))
    guard CGGetOnlineDisplayList(count, &ids, &count) == .success else { return [] }
    return Array(ids.prefix(Int(count)))
}

func list() -> Int32 {
    var out: [[String: Any]] = []
    for id in onlineDisplays() {
        out.append([
            "id": Int(id),
            "builtin": CGDisplayIsBuiltin(id) != 0,
            "main": CGDisplayIsMain(id) != 0,
            "active": CGDisplayIsActive(id) != 0,
            "mirrorOf": Int(CGDisplayMirrorsDisplay(id)),
            "inMirrorSet": CGDisplayIsInMirrorSet(id) != 0,
            "width": CGDisplayPixelsWide(id),
            "height": CGDisplayPixelsHigh(id)
        ])
    }
    guard let data = try? JSONSerialization.data(withJSONObject: out, options: []),
          let text = String(data: data, encoding: .utf8) else { return 1 }
    print(text)
    return 0
}

func extend() -> Int32 {
    let mirrored = onlineDisplays().filter { CGDisplayMirrorsDisplay($0) != CGDirectDisplayID(0) }
    if mirrored.isEmpty { print("{\"changed\":0}"); return 0 }
    var config: CGDisplayConfigRef?
    guard CGBeginDisplayConfiguration(&config) == .success, let cfg = config else { return 2 }
    for id in mirrored { _ = CGConfigureDisplayMirrorOfDisplay(cfg, id, CGDirectDisplayID(0)) }
    guard CGCompleteDisplayConfiguration(cfg, .permanently) == .success else { _ = CGCancelDisplayConfiguration(cfg); return 3 }
    print("{\"changed\":\(mirrored.count)}")
    return 0
}

let args = CommandLine.arguments
func warp(_ x: Double, _ y: Double) -> Int32 {
    guard CGWarpMouseCursorPosition(CGPoint(x: x, y: y)) == .success else { return 4 }
    _ = CGAssociateMouseAndMouseCursorPosition(1)
    return 0
}

switch args.count > 1 ? args[1] : "list" {
case "extend": exit(extend())
case "serve":
    while let line = readLine() {
        let p = line.split(separator: " ")
        if p.count == 3, p[0] == "warp", let x = Double(p[1]), let y = Double(p[2]) { _ = warp(x, y) }
    }
    exit(0)
case "warp":
    guard args.count > 3, let x = Double(args[2]), let y = Double(args[3]) else { exit(5) }
    exit(warp(x, y))
default: exit(list())
}
