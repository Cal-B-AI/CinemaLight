# Cuelight

Projection mapping with QLab-style cueing, a timeline editor and a Room view for every projector at once.
Runs as a desktop app on macOS and Windows and updates itself from this repo's Releases.

## Install

Download the latest installer from **[Releases](https://github.com/Cal-B-AI/CinemaLight/releases/latest)**:

- **Mac:** `Cuelight-x.y.z-universal.dmg` (Intel and Apple Silicon). Open it and drag Cuelight into Applications.
- **Windows:** `Cuelight-Setup-x.y.z.exe`.

The builds aren't code-signed yet, so the first launch shows a warning:

- **Mac:** if macOS says it can't check the app, open **System Settings → Privacy & Security**, scroll down and click **Open Anyway**. If it says the app is "damaged", run `xattr -cr /Applications/Cuelight.app` in Terminal once, then open it.
- **Windows:** on the blue SmartScreen box, click **More info → Run anyway**.

Projects and imported media live inside the app's own storage on that computer. Use **Projects → ⤓ Export** to back a show up or move it to another machine.

## Updates

- **Windows** checks GitHub on launch and every few hours, downloads new versions in the background and asks to restart when one is ready (or installs on quit).
- **Mac** tells you a new version is out and opens the download page. Once the app is signed with an Apple Developer ID (see below), Macs update themselves the same way Windows does.
- Anyone can check by hand: **Cuelight → Check for Updates…** (Mac) or **Help → Check for Updates…** (Windows).

## Releasing a new version

```sh
npm version patch        # 1.0.0 → 1.0.1 (use minor or major for bigger releases); commits and tags
git push --follow-tags   # pushing the tag starts the Release workflow
```

The **Release** workflow (`.github/workflows/release.yml`) builds the Mac and Windows installers and attaches them,
plus the `latest*.yml` files the updater reads, to a GitHub Release named after the tag. Watch it under the repo's **Actions** tab;
it takes about 10–15 minutes. The release notes are generated from the commits, and you can edit them on the release page afterwards.

## Developing

```sh
npm install
npm start           # runs the app from source
npm run dist        # builds an installer for this computer into dist/ without publishing
```

The app is a single page. Its source is `src/head.html` (markup and styles) and `src/app.js` (everything else);
`npm run build:web` joins them into `app/index.html`, which `npm start` and the builds do for you. `main.js` is the desktop shell:
window, projector output windows, menu and updates.

## Signing the Mac app (optional, later)

With an Apple Developer account ($99/year):

1. Create a **Developer ID Application** certificate, export it from Keychain as a `.p12`, and base64 it: `base64 -i cert.p12 | pbcopy`.
2. Add these repo secrets (**Settings → Secrets and variables → Actions**): `MAC_CERT_P12_BASE64`, `MAC_CERT_PASSWORD`,
   `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` (from appleid.apple.com) and `APPLE_TEAM_ID`.
3. In `package.json`, set `"cuelight": { "macSigned": true }`, then release as usual. Signed, notarized Mac builds open without warnings and update themselves.

Windows signing works the same way with a code-signing certificate (`WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`) and removes the SmartScreen warning.
