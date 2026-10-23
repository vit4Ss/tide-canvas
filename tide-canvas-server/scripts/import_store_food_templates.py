"""Convert the supplied v002 archive into private, reproducible template drafts.

Usage: python scripts/import_store_food_templates.py <archive.zip>
No model calls or database writes. Only the 20 individual recipes are imported;
the two combined collections are duplicates, not extra templates.
"""
import hashlib
import json
import re
import sys
import zipfile
from pathlib import Path

PROFILES = [
    ("hotpot", "火锅店", "餐饮探店", "真实菜品", "其他就餐空间", "锅底与餐食细节"),
    ("barbecue", "烧烤店", "餐饮探店", "真实菜品", "其他就餐空间", "烤制与餐食细节"),
    ("homestyle", "家常饭店", "餐饮探店", "真实菜品", "其他就餐空间", "餐食与桌面细节"),
    ("nails", "美甲店", "门店带看", "真实美甲作品", "其他工作空间", "工具与陈列细节"),
    ("massage", "按摩休闲店", "门店带看", "真实服务环境", "其他休息空间", "环境与物件细节"),
    ("hair", "理发店", "门店带看", "真实发型作品", "其他工作空间", "工具与陈列细节"),
    ("dental", "口腔机构", "门店带看", "真实环境与设备", "其他接待或设备空间", "环境与设备细节"),
    ("optical", "眼镜店", "门店带看", "真实眼镜产品", "其他陈列空间", "镜框与镜腿细节"),
    ("chili-factory", "辣椒酱食品厂", "食品工厂", "真实产品与包装", "实际生产车间", "设备与工序细节"),
    ("bakery-factory", "烘焙糕点食品厂", "食品工厂", "真实产品与包装", "实际生产车间", "设备与工序细节"),
]


def member_name(info):
    if info.flag_bits & 0x800:
        return info.filename
    try:
        return info.filename.encode("cp437").decode("gb18030")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return info.filename


def main(archive):
    archive = Path(archive)
    target = Path(__file__).resolve().parents[1] / "internal/handler/studiotemplate/content-packs/store-food-v002"
    source = target / "source"
    source.mkdir(parents=True, exist_ok=True)
    entries = []
    with zipfile.ZipFile(str(archive)) as z:
        files = {member_name(info): info for info in z.infolist()}
        manifest = json.loads(z.read(files["模板目录与检查记录.json"]).decode("utf-8-sig"))
        if len(manifest) != 20 or len({entry["file"] for entry in manifest}) != 20:
            raise ValueError("Expected exactly 20 distinct source recipes")
        for duration in (15, 30):
            for index, (slug, industry, category, product, room, detail) in enumerate(PROFILES, 1):
                path = f"{duration}秒_10套/{index:02d}_{industry}_{duration}秒.txt"
                info = files[path]
                if info.file_size > 100000:
                    raise ValueError("Recipe too large: " + path)
                raw = z.read(info)
                text = raw.decode("utf-8-sig").strip()
                metadata = next(entry for entry in manifest if entry["file"] == path)
                if metadata["duration"] != duration or metadata["industry"] != industry or not text.startswith(f"生成视频：{duration}秒｜9:16"):
                    raise ValueError("Recipe metadata mismatch: " + path)
                # Keep the supplied file unchanged for traceability. Only the
                # executable copy gains stable placeholders, expanded privately
                # by the backend after owned uploads and positions are validated.
                prompt = re.sub(r"@?图([1-6])(?!\d)", lambda m: "{{image:" + m.group(1) + "}}", text)
                prompt = re.sub(r"以上为图片编号示例；.*?头像不得错绑为环境图。", "素材引用由系统按本次上传顺序绑定；未上传的素材有明确标记，不能用其他素材代替。", prompt)
                factory = category == "食品工厂"
                labels = ["厂区入口" if factory else "门面照片", "接待与展示区" if factory else "店内全景", "本人头像", product, room, detail]
                hint = ("必填：厂区入口、接待展示区、真实产品和实际生产车间。头像、工序细节可选。" if factory else "必填：门面照片、店内全景。本人头像、作品或产品、其他空间和细节图可选。")
                hint += "不传头像时使用虚构成年讲解人；无需填写店名或厂名。请上传真实且清晰的素材，示例成片不用上传。"
                source_file = f"source/{index:02d}-{slug}-{duration}s.txt"
                (target / source_file).write_bytes(raw)
                entries.append({
                    "slug": f"{slug}-{duration}s", "sourceFile": source_file,
                    "sourceArchivePath": path, "sourceSha256": hashlib.sha256(raw).hexdigest(),
                    "shots": metadata["shots"],
                    "template": {
                        "kind": "inspiration", "mediaType": "video", "title": f"{industry}真人带看 · {duration}秒",
                        "description": f"{duration}秒竖屏实景带看，{metadata['shots']}个镜头与中文短对白。无需填写{'厂名' if factory else '店名'}，上传环境照片即可准备同款。",
                        "category": category, "prompt": prompt, "coverUrl": "", "previewUrl": "", "authorName": "",
                        "inputHint": hint, "inputLabels": {"images": labels}, "mode": "ref", "modelKey": "",
                        "requirements": {"images": 6, "videos": 0, "audio": 0, "optionalImages": [3, 6] if factory else [3, 4, 5, 6]},
                        "options": {"aspectRatio": "9:16", "duration": duration}, "status": 0, "sortOrder": 200 + len(entries),
                    },
                })
        (target / "source/usage.txt").write_bytes(z.read(files["00_先看使用说明.txt"]))
    pack = {"name": "门店与食品厂 · 无需名称版 v002", "archiveSha256": hashlib.sha256(archive.read_bytes()).hexdigest(), "entries": entries}
    (target / "catalog.json").write_text(json.dumps(pack, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Prepared {len(entries)} private drafts in {target}")


if __name__ == "__main__":
    main(sys.argv[1])
