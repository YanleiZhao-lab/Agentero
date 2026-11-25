; Explorer context menu: "Open with Agentero" on folders and folder backgrounds.
; The GUI binary accepts a bare folder path argument
; (features/open_request::collect_open_args), which is lossless for paths with
; spaces, `&`, `%` or non-ASCII characters (a deep-link URL query would not be).
; Keys go under SHCTX so they follow the installer mode (currentUser → HKCU).

!ifndef AGENTERO_DISPLAY_NAME
  !define AGENTERO_DISPLAY_NAME "Agentero"
!endif

!macro AgenteroRenameShortcut DIRECTORY
  !insertmacro IsShortcutTarget "${DIRECTORY}\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
  Pop $0
  ${If} $0 = 1
    ${If} ${FileExists} "${DIRECTORY}\${AGENTERO_DISPLAY_NAME}.lnk"
      !insertmacro IsShortcutTarget "${DIRECTORY}\${AGENTERO_DISPLAY_NAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
      Pop $0
      ${If} $0 = 1
        Delete "${DIRECTORY}\${PRODUCTNAME}.lnk"
      ${EndIf}
    ${Else}
      Rename "${DIRECTORY}\${PRODUCTNAME}.lnk" "${DIRECTORY}\${AGENTERO_DISPLAY_NAME}.lnk"
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
!macroend

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayName" "${AGENTERO_DISPLAY_NAME}"
  !if "${AGENTERO_DISPLAY_NAME}" != "${PRODUCTNAME}"
    !insertmacro AgenteroRenameShortcut "$DESKTOP"
    !insertmacro AgenteroRenameShortcut "$SMPROGRAMS\$AppStartMenuFolder"
  !endif
  ; Right-click on a folder
  WriteRegStr SHCTX "Software\Classes\Directory\shell\OpenWithAgentero" "" "Open with ${AGENTERO_DISPLAY_NAME}"
  WriteRegStr SHCTX "Software\Classes\Directory\shell\OpenWithAgentero" "Icon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "Software\Classes\Directory\shell\OpenWithAgentero\command" "" `"$INSTDIR\${MAINBINARYNAME}.exe" "%1"`
  ; Right-click on the empty area inside a folder
  WriteRegStr SHCTX "Software\Classes\Directory\Background\shell\OpenWithAgentero" "" "Open with ${AGENTERO_DISPLAY_NAME}"
  WriteRegStr SHCTX "Software\Classes\Directory\Background\shell\OpenWithAgentero" "Icon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "Software\Classes\Directory\Background\shell\OpenWithAgentero\command" "" `"$INSTDIR\${MAINBINARYNAME}.exe" "%V"`
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !if "${AGENTERO_DISPLAY_NAME}" != "${PRODUCTNAME}"
    ${If} $UpdateMode <> 1
      !insertmacro IsShortcutTarget "$DESKTOP\${AGENTERO_DISPLAY_NAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
      Pop $0
      ${If} $0 = 1
        !insertmacro UnpinShortcut "$DESKTOP\${AGENTERO_DISPLAY_NAME}.lnk"
        Delete "$DESKTOP\${AGENTERO_DISPLAY_NAME}.lnk"
      ${EndIf}
      !insertmacro MUI_STARTMENU_GETFOLDER Application $AppStartMenuFolder
      !insertmacro IsShortcutTarget "$SMPROGRAMS\$AppStartMenuFolder\${AGENTERO_DISPLAY_NAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
      Pop $0
      ${If} $0 = 1
        !insertmacro UnpinShortcut "$SMPROGRAMS\$AppStartMenuFolder\${AGENTERO_DISPLAY_NAME}.lnk"
        Delete "$SMPROGRAMS\$AppStartMenuFolder\${AGENTERO_DISPLAY_NAME}.lnk"
      ${EndIf}
    ${EndIf}
  !endif
  ; Ownership-guarded cleanup (mirrors the upstream deep-link removal): only
  ; delete entries whose command still points at this install location.
  ReadRegStr $R0 SHCTX "Software\Classes\Directory\shell\OpenWithAgentero\command" ""
  StrCmp $R0 `"$INSTDIR\${MAINBINARYNAME}.exe" "%1"` 0 +2
    DeleteRegKey SHCTX "Software\Classes\Directory\shell\OpenWithAgentero"
  ReadRegStr $R0 SHCTX "Software\Classes\Directory\Background\shell\OpenWithAgentero\command" ""
  StrCmp $R0 `"$INSTDIR\${MAINBINARYNAME}.exe" "%V"` 0 +2
    DeleteRegKey SHCTX "Software\Classes\Directory\Background\shell\OpenWithAgentero"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
!macroend
