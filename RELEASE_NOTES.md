## Fixes and improvements

- **Live playback** now remembers interruptions after playback resumes and counts each interruption once. When interruptions repeat, the player gives the buffer time to refill before resuming.
- **TV guide** now restores schedules when the XMLTV identifier and channel name agree, even if another playlist entry claims the same identifier. This fixes missing programme information for Sport TV 1 and Sport TV 1 HQ.
- **Discord Rich Presence** shows the current programme title when a matching guide entry is available and programme sharing is enabled.
- **Apple Silicon packages** exclude stray Intel copies of FFmpeg, so the bundled playback tools match the Mac's architecture.

Full HD streams can still pause if video arrives too slowly to keep up with playback. The HD variant may be more stable on an inconsistent connection.

## Downloads

- **Windows x64** — installer or portable EXE.
- **macOS Apple Silicon** — ARM64 DMG or portable ZIP.
- **macOS Intel** — x64 DMG or portable ZIP.
