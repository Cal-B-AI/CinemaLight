// cuelight-displays: a tiny macOS helper Cuelight runs to see and fix how screens are arranged,
// so connecting a projector never needs a trip to System Settings.
//   cuelight-displays list     -> JSON array of online displays (id, builtin, main, mirrorOf, inMirrorSet, width, height)
//   cuelight-displays extend   -> stop mirroring: every screen becomes its own screen
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
switch args.count > 1 ? args[1] : "list" {
case "extend": exit(extend())
default: exit(list())
}
