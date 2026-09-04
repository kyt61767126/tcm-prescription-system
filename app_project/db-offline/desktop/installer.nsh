; ============================================================================
;  installer.nsh - NSIS 自定义安装初始化
;  ★ 数据安全策略：推荐安装到 D 盘或 E 盘，避免 C 盘
;    1) 优先安装到 D:\Program Files\tcm-prescription-custom
;    2) D 盘不存在时尝试 E:\Program Files\tcm-prescription-custom
;    3) D 盘和 E 盘都不存在时使用默认安装目录（用户可自行修改）
;  注意：不强制 Abort，让用户通过 allowToChangeInstallationDirectory 自行选择
; ============================================================================
!macro customInit
  ; ★ 升级卡死修复（2026-08-20）：安装前自动关闭正在运行的旧版程序
  ; 现象：旧版在后台运行（开机自启/最小化）时，安装器弹"惠康中医-本地无法关闭，请手动关闭"
  ; 策略：先温和关闭（WM_CLOSE，等同用户手动点X，正常保存数据）→ 等1.5秒 → 仍存活才强制结束
  ; 注：taskkill 失败（程序本就没运行）时静默忽略，不影响安装流程
  nsExec::Exec 'taskkill /im "${APP_EXECUTABLE_FILENAME}"'
  Sleep 1500
  nsExec::Exec 'taskkill /f /im "${APP_EXECUTABLE_FILENAME}"'

  ; 优先 D 盘（用 D:\nul 检测更可靠，D:\ 在某些 NSIS 版本下不可靠）
  IfFileExists "D:\nul" 0 tryE
    StrCpy $INSTDIR "D:\Program Files\tcm-prescription-custom"
    Goto done
  tryE:
  ; 其次 E 盘
  IfFileExists "E:\nul" 0 useDefault
    StrCpy $INSTDIR "E:\Program Files\tcm-prescription-custom"
    Goto done
  useDefault:
  ; D 盘和 E 盘都不存在，使用默认安装目录
  ; 用户可通过安装界面的"浏览"按钮自行选择其他盘
  done:
!macroend

; ★ 接管 electron-builder 内置"应用运行检查"（templates/nsis/include/allowOnlyOneInstallerInstance.nsh:33）
; 内置逻辑：taskkill 两轮后仍检测到进程 → 弹"惠康中医-本地无法关闭"死循环框（重试无效，只能取消）。
; 接管后：强杀（/f /t 连子进程树）两轮 + 短等待，**永不弹框、永不阻塞安装**（宁漏检不可误报）。
!macro customCheckAppRunning
  DetailPrint `Closing running "${PRODUCT_NAME}"...`
  nsExec::Exec 'taskkill /f /t /im "${APP_EXECUTABLE_FILENAME}"'
  Sleep 800
  nsExec::Exec 'taskkill /f /t /im "${APP_EXECUTABLE_FILENAME}"'
  Sleep 500
!macroend

; ★ 2026-09-04 卸载时清理 userData（NSIS 默认不删 %APPDATA%，导致卸载重装后登录框仍显示旧账号）：
;   Electron userData = $APPDATA\tcm-prescription\（config.json / localStorage / license.dat 全在里面）。
;   便携版（免安装 exe）不走本安装器，config.json 在 exe 同目录，删 exe 自然干净，不受影响。
;   策略：卸载完成后弹确认框——升级重装选"保留"（断点续传/处方记录/授权锚点都要留），
;   全新安装测试或彻底清理选"删除本地数据"（删整个 userData 目录）。
;   防句柄锁定：RMDir /r /REBOOTOK，删不掉的文件下次开机自动清理。
!macro customUninit
  ; Electron 的 app name（userData 目录名）必须与 package.json "name" 字段一致
  ; ⚠ 改了 package.json name 这里必须同步改！
  StrCpy $0 "$APPDATA\tcm-prescription"

  ; 目录不存在 → 直接跳过（可能是便携版/绿色装/从未启动过）
  IfFileExists "$0" +3
    DetailPrint `userData 目录不存在，跳过清理`
    Goto +8

  ; 弹确认框：MB_YESNO + MB_ICONQUESTION + 默认选 NO（升级场景最常见）
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
    "是否同时删除本地数据？$\r$\n$\r$\n保留 = 升级重装后断点续传/处方记录/授权仍可用$\r$\n删除 = 卸载后不留任何痕迹（全新安装测试请选此项）" \
    IDYES +2
    Goto +6

  DetailPrint `正在删除 userData: $0`
  RMDir /r /REBOOTOK "$0"
  DetailPrint `userData 已清理完成（被占用的文件将在下次开机后删除）`
!macroend