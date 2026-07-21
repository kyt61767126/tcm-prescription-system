; ============================================================================
;  installer.nsh - NSIS 自定义安装初始化
;  ★ 数据安全策略：默认安装位置必须为 D 盘或 E 盘，禁止 C 盘
;    1) 优先安装到 D:\Program Files\惠康中医-本地
;    2) D 盘不存在时尝试 E:\Program Files\惠康中医-本地
;    3) D 盘和 E 盘都不存在时中止安装，保证数据安全
; ============================================================================
!macro customInit
  ; 优先 D 盘
  IfFileExists "D:\" 0 tryE
    StrCpy $INSTDIR "D:\Program Files\惠康中医-本地"
    Goto done
  tryE:
  ; 其次 E 盘
  IfFileExists "E:\" 0 noDE
    StrCpy $INSTDIR "E:\Program Files\惠康中医-本地"
    Goto done
  noDE:
  ; D 盘和 E 盘都不存在，禁止安装到 C 盘，中止安装
    MessageBox MB_OK|MB_ICONSTOP "为保证数据安全，本程序禁止安装到 C 盘！$\n$\n请确保系统中存在 D 盘或 E 盘后重新运行安装程序。"
    Abort
  done:
!macroend
