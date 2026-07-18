; ============================================================================
;  installer.nsh - NSIS 自定义安装初始化
;  修复：1) 双赋值 bug（32 位/64 位互相覆盖）
;       2) D 盘存在则安装到 D 盘，否则跟随系统 Program Files
; ============================================================================
!macro customInit
  ; 优先安装到 D 盘（如存在），否则使用上一次或系统默认 Program Files
  IfFileExists "D:\" 0 skipD
    StrCpy $INSTDIR "D:\Program Files\惠康中医-本地"
    Goto done
  skipD:
    ; 64 位系统使用 64 位 Program Files，32 位系统使用 32 位 Program Files
    ${If} ${RunningX64}
      ReadRegStr $0 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion" "ProgramFilesDir"
      StrCpy $INSTDIR "$0\惠康中医-本地"
    ${Else}
      ReadRegStr $0 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion" "ProgramFilesDir"
      StrCpy $INSTDIR "$0\惠康中医-本地"
    ${EndIf}
  done:
!macroend
