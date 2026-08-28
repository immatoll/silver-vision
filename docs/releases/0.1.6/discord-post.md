# SilverVision v0.1.6

Mostly bug fixing this round — window layering fixes, especially for Steam Deck / KDE Plasma.

## Fixed

- **Always-on-top not working on SteamOS / KDE Plasma** — worked around a Wayland limitation with an auto-installing KWin script.
- **Opacity/fade not working on SteamOS / KDE Plasma** — opacity slider now works via the same fix; hover-fade stays off on Linux for now.
- **Popups opening hidden behind their opener** (login/OAuth popups, mostly on macOS).
- **Minimizing one overlay minimized all of them** on mac/Linux — now only the clicked window minimizes.
- **App could stay running invisibly** after closing all windows.

## Release

https://github.com/immatoll/silver-vision/releases/tag/v.0.1.6

Feedback welcome.
