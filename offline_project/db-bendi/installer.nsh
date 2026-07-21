; ============================================================================
;  installer.nsh - NSIS 自定义安装初始化
;  ★ 数据安全策略：推荐安装到 D 盘或 E 盘，避免 C 盘
;    1) 优先安装到 D:\Program Files\惠康中医-本地
;    2) D 盘不存在时尝试 E:\Program Files\惠康中医-本地
;    3) D 盘和 E 盘都不存在时使用默认安装目录（用户可自行修改）
;  注意：不强制 Abort，让用户通过 allowToChangeInstallationDirectory 自行选择
; ============================================================================
!macro customInit
  ; 优先 D 盘（用 D:\nul 检测更可靠，D:\ 在某些 NSIS 版本下不可靠）
  IfFileExists "D:\nul" 0 tryE
    StrCpy $INSTDIR "D:\Program Files\惠康中医-本地"
    Goto done
  tryE:
  ; 其次 E 盘
  IfFileExists "E:\nul" 0 useDefault
    StrCpy $INSTDIR "E:\Program Files\惠康中医-本地"
    Goto done
  useDefault:
  ; D 盘和 E 盘都不存在，使用默认安装目录
  ; 用户可通过安装界面的"浏览"按钮自行选择其他盘
  done:
!macroend