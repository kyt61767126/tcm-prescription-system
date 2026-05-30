#!/bin/bash
# 本能中医处方系统 - 代码备份脚本
# 用法: bash backup-now.sh

echo "================================"
echo "本能中医处方系统 - 代码备份"
echo "================================"
echo ""

# 创建备份目录
BACKUP_DIR="backups"
if [ ! -d "$BACKUP_DIR" ]; then
    mkdir -p "$BACKUP_DIR"
    echo "已创建备份目录: $BACKUP_DIR"
fi

# 生成带日期时间的备份文件名
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/tcm-prescription-system_${DATE}.zip"

# 获取项目根目录
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "正在备份项目代码..."
echo "备份文件: $BACKUP_FILE"

# 切换到项目目录执行备份
cd "$PROJECT_ROOT"

# 排除不必要的文件进行备份
zip -r "$BACKUP_FILE" . \
    -x "backups/*" \
    -x ".git/*" \
    -x "*.log" \
    -x "node_modules/*" \
    -x ".DS_Store" \
    -x "Thumbs.db"

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ 备份成功！"
    echo "备份文件: $BACKUP_FILE"
    echo ""
    
    # 显示备份目录中的所有备份
    echo "当前备份列表："
    ls -lh "$BACKUP_DIR"/*.zip 2>/dev/null | tail -5
    
    # 计算备份文件大小
    SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo ""
    echo "备份大小: $SIZE"
else
    echo ""
    echo "❌ 备份失败！"
    exit 1
fi

echo ""
echo "================================"
echo "备份完成！"
echo "================================"
