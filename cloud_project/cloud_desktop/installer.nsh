!macro customInit
  ; 64位 Electron 应用应安装到 64位 Program Files（不是 Program Files (x86)）
  ; 优先 D:\Program Files（用户常有 SSD D 盘），其次 64位 Program Files
  IfFileExists "D:\" D盘存在 继续
  Goto 继续
  D盘存在:
    StrCpy $INSTDIR "D:\Program Files\惠康中医-云端"
    Goto 结束
  继续:
    ; 优先使用 ProgramW6432 环境变量（64位 Windows 总是存在），回退到注册表
    ReadEnvStr $R0 "ProgramW6432"
    StrCmp $R0 "" 0 设置路径
      ReadRegStr $R0 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion" "ProgramFilesDir"
    设置路径:
    StrCpy $INSTDIR "$R0\惠康中医-云端"
  结束:
!macroend
