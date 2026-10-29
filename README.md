# DTV

A fast IPTV player for Xtream Codes playlists (Big1, Zumtv and any other Xtream provider).
Runs on Windows, Mac and Linux.

## Get it running on Windows

1. Install **Node.js LTS** from https://nodejs.org (default options are fine).
2. Unzip this folder somewhere, e.g. your Desktop.
3. Double-click **Build DTV for Windows.bat**.
   It downloads what's needed (first time only) and builds DTV.
4. When it finishes, the `dist` folder opens with:
   - `DTV Setup 1.0.0.exe` – installs DTV with a Start menu and desktop shortcut
   - `DTV-Portable-1.0.0.exe` – runs straight away, no install

Want to try it before building? Double-click **Run DTV (no install).bat**.

Windows may show "Windows protected your PC" the first time because the app isn't signed.
Click **More info → Run anyway**.

### Mac / Linux
```
npm install
npm start            # run it
npm run dist:mac     # or dist:linux, to build an app
```

## Fire TV Stick (and Android TV)

The `android` folder is the Fire TV version: the same DTV screens, made for the remote,
with Android's own video player for smooth full-screen playback.

### Get a download link (free, no software needed)

GitHub builds the APK for you in the cloud and gives you a permanent link.

1. Make a free account at https://github.com
2. Click **+** (top right) → **New repository**. Name it `dtv`, choose **Public**, click **Create repository**.
3. On the next page click **uploading an existing file**. Open this unzipped folder, select
   **everything inside it** (including the `.github` folder), drag it onto the page, then click **Commit changes**.
4. Click the **Actions** tab. A build called "Build DTV" starts by itself and takes about 5–8 minutes.
   (If GitHub asks, click the green button to enable Actions.)
5. When it shows a green tick, your link is:

   `https://github.com/YOUR-USERNAME/dtv/releases/latest/download/DTV-FireTV.apk`

   The same build also makes the Windows app: `.../download/DTV-Setup.exe`.

Tip: that link is long to type with a remote. Paste it into https://tinyurl.com to get a short one.

### Install on the Firestick

1. On the Firestick: **Settings → My Fire TV → Developer options → Install unknown apps → Downloader → On**.
   (No Developer options? Go to **My Fire TV → About** and click your device name 7 times.)
2. Install **Downloader** from the Amazon app store if you don't have it.
3. Open Downloader, type your link, press **Go**, then **Install**.
4. DTV appears in your apps. Hold the Home button → **Apps** to move it to the front.

To update later, upload the changed files to GitHub; it rebuilds and the same link gives you the new version.

### Using DTV with the remote

| Button | What it does |
|---|---|
| Arrows | Move around. In the channel list, the right side shows what's on |
| OK | Open / play |
| Menu (☰) | Add or remove a favourite |
| Back | Go back; press twice on the home screen to close DTV |
| While watching TV: Up / Down | Change channel |
| While watching a film: Left / Right | Skip 10 seconds |

## Adding your playlist

Enter the details your provider gave you:

- **Server URL** – e.g. `http://example.com:8080` (include the port if they gave you one)
- **Username** and **Password**

If you only have an M3U link (`http://...get.php?username=...&password=...`), paste the
whole link into Server URL and DTV fills in the rest.

You can add several playlists and switch between them in Settings.

## Keyboard shortcuts

| Key | Live TV | Movies & series |
|---|---|---|
| ↑ / ↓ | Change channel | Volume |
| ← / → | | Skip 10 s (Shift for 60 s) |
| Enter | Full screen | |
| 0–9 | Jump to channel number | |
| Space | Pause | Pause |
| F | Full screen | Full screen |
| M | Mute | Mute |
| P | Picture in picture | Picture in picture |
| Esc | Back | Back |
| / or Ctrl+F | Search | Search |

## If something won't play

- **Live channel won't start** – Settings → Live stream format → try **HLS**.
  Also check you're not already watching on another device (Settings → Account shows connections).
- **A film says its format can't be played** – some files use codecs (like HEVC/x265) that
  only VLC can play. Click **Open in VLC** (install VLC free from videolan.org).
- **Provider blocks the app** – if your provider gave you a user agent, paste it in
  Settings → Advanced → User agent.

## Why it's fast

- Lists are stored on your PC, so DTV opens instantly and refreshes in the background every 12 hours.
- Only the rows on screen are drawn, so 50,000 channels scroll as smoothly as 50.
- Live TV plays the raw MPEG-TS stream for quick starts, falling back to HLS automatically.
