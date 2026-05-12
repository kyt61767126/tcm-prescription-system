import csv
import json
import sys

def convert_csv_to_json(csv_path, output_path):
    medicines = []
    
    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            medicine = {
                "name": row['药品名称'].strip(),
                "code": row['简码'].strip().upper(),
                "price": float(row['单价']) if row['单价'] else 0,
                "unit": row['单位'].strip() if row['单位'] else 'g',
                "dosage": float(row['常用用量']) if row['常用用量'] and row['常用用量'].replace('.', '').isdigit() else 10,
                "category": "",
                "costPrice": float(row['进价']) if row['进价'] else 0,
                "stock": int(row['库存']) if row['库存'] else 0
            }
            medicines.append(medicine)
    
    output_data = {
        "medicines": medicines,
        "exportDate": "2026-05-08",
        "description": "600味中药库数据"
    }
    
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)
    
    print(f"成功转换 {len(medicines)} 种药品")
    print(f"输出文件: {output_path}")

if __name__ == "__main__":
    csv_path = "../中药库_2026-5-6.csv"
    output_path = "../中药库数据.json"
    convert_csv_to_json(csv_path, output_path)