// Launcher configuration. Edit this file, then run install.sh.
// App ids: run `python3 sync-apps.py --list` (or look in app/apps.js after a sync).
window.CONFIG = {
  // The top row holds the apps you open most, newest use first, kept by the launcher itself.
  // These fill it until you have opened enough apps for the TV to know. Missing apps are skipped.
  dockApps: ['netflix', 'youtube.leanback.v4', 'com.apple.appletv.web', 'net.mbc.shahid-lgapp'],

  // Apps never shown as tiles (inputs and Live TV are already in the Inputs menu).
  hiddenApps: [
    'com.gathin.tvhome',
    'com.webos.app.livetv',
    'com.webos.app.hdmi1', 'com.webos.app.hdmi2', 'com.webos.app.hdmi3', 'com.webos.app.hdmi4',
    'com.webos.app.externalinput.av1', 'com.webos.app.externalinput.component',
    'com.webos.app.lgchannels',   // LG Channels
    'shortcutcopilot'             // Copilot
  ],

  // Grid sections, in the order they appear under the dock. An app listed twice lands in the
  // first section that claims it; anything left over goes to the section named by otherTitle.
  categories: [
    {
      title: 'Watch',
      apps: ['smarttv.spark.yango.com', 'watchit.com']
    },
    {
      title: 'Music',
      apps: ['anghami', 'spotify-beehive', 'com.webos.app.music']
    },
    {
      title: 'System',
      apps: ['com.webos.app.discovery', 'com.webos.app.photovideo', 'com.webos.app.browser',
             'com.webos.app.homeconnect', 'com.palmdts.devmode', 'org.webosbrew.hbchannel']
    }
  ],

  // Heading for apps no category claims (newly installed ones land here).
  otherTitle: 'More',

  // The Live TV app, offered at the end of the Inputs menu. Leave empty to omit.
  liveTvApp: 'com.webos.app.livetv',

  // Tiles per row in the grid; the dock always has this many slots.
  columns: 4
};
