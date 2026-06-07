#!/bin/bash
# 本能中医处方系统 - 代码还原脚本
# 用法: bash restore-from-backup.sh [备份文件名]
# 如果不指定备份文件名，将列出所有备份并让用户选择

BACKUP_DIR="backups"

echo "================================"
echo "本能中医处方系统 - 代码还原"
echo "================================"
echo ""

# 检查备份目录是否存在
if [ ! -d "$BACKUP_DIR" ]; then
    echo "❌ 错误：备份目录不存在"
    echo "请先运行 backup-now.sh 创建备份"
    exit 1
fi

# 获取项目根目录
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"

# 如果没有指定备份文件，列出所有备份
if [ -z "$1" ]; then
    echo "可用备份列表："
    echo ""
    
    # 检查是否有备份文件
    BACKUP_COUNT=$(ls -1 "$BACKUP_DIR"/*.zip 2>/dev/null | wc -l)
    
    if [ "$BACKUP_COUNT" -eq 0 ]; then
        echo "❌ 没有找到任何备份文件"
        exit 1
    fi
    
    # 显示备份列表
    INDEX=1
    declare -a BACKUP_FILES
    for file in $(ls -t "$BACKUP_DIR"/*.zip); do
        SIZE=$(du -h "$file" | cut -f1)
        DATE=$(basename "$file" | sed 's/tcm-prescription-system_//' | sed 's/.zip//')
        echo "[$INDEX] $(basename "$file") - $SIZE - $DATE"
        BACKUP_FILES[$INDEX]="$file"
        INDEX=$((INDEX + 1))
    done
    
    echo ""
    read -p "请选择要还原的备份编号 [1-$((INDEX-1))]: " SELECTION
    
    # 验证输入
    if [ -z "$SELECTION" ] || [ "$SELECTION" -lt 1 ] || [ "$SELECTION" -ge "$INDEX" ]; then
        echo "❌ 无效的选择"
        exit 1
    fi
    
    BACKUP_FILE="${BACKUP_FILES[$SELECTION]}"
else
    # 使用指定的备份文件
    BACKUP_FILE="$1"
    
    # 检查文件是否存在
    if [ ! -f "$BACKUP_FILE" ]; then
        # 尝试在备份目录中查找
        if [ -f "$BACKUP_DIR/$BACKUP_FILE" ]; then
            BACKUP_FILE="$BACKUP_DIR/$BACKUP_FILE"
        else
            echo "❌ 错误：备份文件不存在"
            exit 1
        fi
    fi
fi

echo ""
echo "即将还原备份：$(basename "$BACKUP_FILE")"
echo ""

# 确认操作
read -p "⚠️  注意：这将覆盖当前所有代码！是否继续？ [y/N]: " CONFIRM

if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    echo "已取消还原操作"
    exit 0
fi

echo ""
echo "正在还原代码..."

# 备份当前代码（临时）
TEMP_BACKUP="${BACKUP_DIR}/temp_before_restore_$(date +%Y%m%d_%H%M%S).zip"
echo "正在备份当前代码到临时文件..."
zip -r "$TEMP_BACKUP" . \
    -x "backups/*" \
    -x ".git/*" \
    -x "*.log" \
    -x "node_modules/*" \
    -x ".DS_Store" \
    -x "Thumbs.db" > /dev/null 2>&1

if [ $? -eq 0 ]; then
    echo "✅ 当前代码已备份到: $TEMP_BACKUP"
else
    echo "⚠️  警告：无法创建临时备份"
fi

# 删除当前所有文件（保留备份目录）
echo ""
echo "正在清理当前代码..."
cd "$PROJECT_ROOT"
find . -maxdepth 1 -type f ! -name "restore-from-backup.sh" ! -name "backup-now.sh" -delete 2>/dev/null
find . -maxdepth 1 -type d ! -name "." ! -name ".." ! -name "backups" ! -name ".git" -exec rm -rf {} \; 2>/dev/null

# 解压备份文件
echo ""
echo "正在解压备份文件..."
unzip -o "$BACKUP_FILE"

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ 代码还原成功！"
    echo ""
    echo "备份文件: $(basename "$BACKUP_FILE")"
    echo ""
    echo "================================"
    echo "还原完成！"
    echo "================================"
else
    echo ""
    echo "❌ 还原失败！"
    echo "临时备份保存在: $TEMP_BACKUP"
    exit 1
fi
