; Reamlet — custom NSIS installer script
; Included by electron-builder. Registers the native messaging host
; for all supported Chromium browsers during install and cleans up on uninstall.

!include "StrFunc.nsh"
${StrRep}

!macro customInstall
  DetailPrint "Registering Reamlet native messaging host..."

  ; Escape backslashes in the exe path for JSON
  ${StrRep} $R0 "$INSTDIR\reamlet-native-host.exe" "\" "\\"

  ; Write the host manifest with the real path stamped in
  FileOpen $0 "$INSTDIR\com.reamlet.chromebridge.json" w
  FileWrite $0 "{$\n"
  FileWrite $0 "  $\"name$\": $\"com.reamlet.chromebridge$\",$\n"
  FileWrite $0 "  $\"description$\": $\"Reamlet native messaging host$\",$\n"
  FileWrite $0 "  $\"path$\": $\"$R0$\",$\n"
  FileWrite $0 "  $\"type$\": $\"stdio$\",$\n"
  FileWrite $0 "  $\"allowed_origins$\": [$\n"
  FileWrite $0 "    $\"chrome-extension://PLACEHOLDER_CHROME_ID/$\",$\n"
  FileWrite $0 "    $\"chrome-extension://PLACEHOLDER_EDGE_ID/$\"$\n"
  FileWrite $0 "  ]$\n"
  FileWrite $0 "}"
  FileClose $0

  ; Register for each supported Chromium browser
  WriteRegStr HKCU "Software\Google\Chrome\NativeMessagingHosts\com.reamlet.chromebridge"          "" "$INSTDIR\com.reamlet.chromebridge.json"
  WriteRegStr HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.reamlet.chromebridge"         "" "$INSTDIR\com.reamlet.chromebridge.json"
  WriteRegStr HKCU "Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.reamlet.chromebridge" "" "$INSTDIR\com.reamlet.chromebridge.json"
  WriteRegStr HKCU "Software\Vivaldi\NativeMessagingHosts\com.reamlet.chromebridge"                "" "$INSTDIR\com.reamlet.chromebridge.json"
  WriteRegStr HKCU "Software\Opera Software\Opera\NativeMessagingHosts\com.reamlet.chromebridge"   "" "$INSTDIR\com.reamlet.chromebridge.json"
  WriteRegStr HKCU "Software\Opera Software\Opera GX\NativeMessagingHosts\com.reamlet.chromebridge" "" "$INSTDIR\com.reamlet.chromebridge.json"
!macroend

!macro customUnInstall
  ; Remove registry entries for all browsers
  DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\com.reamlet.chromebridge"
  DeleteRegKey HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.reamlet.chromebridge"
  DeleteRegKey HKCU "Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.reamlet.chromebridge"
  DeleteRegKey HKCU "Software\Vivaldi\NativeMessagingHosts\com.reamlet.chromebridge"
  DeleteRegKey HKCU "Software\Opera Software\Opera\NativeMessagingHosts\com.reamlet.chromebridge"
  DeleteRegKey HKCU "Software\Opera Software\Opera GX\NativeMessagingHosts\com.reamlet.chromebridge"
!macroend
