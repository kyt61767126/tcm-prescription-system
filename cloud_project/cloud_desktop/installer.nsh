!macro customInit
  ReadRegStr $R0 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion" "ProgramFilesDir"
  StrCpy $INSTDIR "$R0\惠康中医云端"
  ReadRegStr $R1 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion" "ProgramFilesDir (x86)"
  StrCpy $INSTDIR "$R1\惠康中医云端"
  IfFileExists "D:\" D盘存在 继续
  Goto 继续
  D盘存在:
    StrCpy $INSTDIR "D:\Program Files\惠康中医云端"
  继续:
!macroend