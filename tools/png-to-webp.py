#!/usr/bin/env python3
"""animation_2/icon/ 下的 PNG 图标批量转 WebP(有损 q=95 + 无损 alpha)。

用法(仓库根目录):
    python tools/png-to-webp.py            # 转换并保留 PNG
    python tools/png-to-webp.py --delete-png   # 转换后删除 PNG(避免图标列表出现重名重复项)

为什么用 q=95:Pillow/libwebp 实测 q=95 时 alpha 通道逐像素完全一致(RGBA 无损 alpha),
可见区域 PSNR 42~46dB、单通道最大偏差 ≤12,肉眼不可分辨;体积约为 PNG 的 35%~43%。
"""
import argparse
import os
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit("需要 Pillow: python -m pip install Pillow")

QUALITY = 95
METHOD = 6  # 最高压缩强度(编码慢但体积最小)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=os.path.join("animation_2", "icon"), help="图标目录")
    ap.add_argument("--quality", type=int, default=QUALITY)
    ap.add_argument("--delete-png", action="store_true", help="转换成功后删除源 PNG")
    args = ap.parse_args()

    if not os.path.isdir(args.dir):
        sys.exit("目录不存在: " + args.dir)

    pngs = sorted(f for f in os.listdir(args.dir) if f.lower().endswith(".png"))
    if not pngs:
        print("没有找到 PNG")
        return 0

    total_png = total_webp = 0
    for name in pngs:
        src = os.path.join(args.dir, name)
        dst = os.path.join(args.dir, name[:-4] + ".webp")
        im = Image.open(src)
        if im.mode != "RGBA":
            im = im.convert("RGBA")
        im.save(dst, "WEBP", quality=args.quality, method=METHOD, alpha_quality=100)
        # 回读校验:能解开且尺寸一致才算转换成功
        with Image.open(dst) as chk:
            chk.load()
            if chk.size != im.size:
                sys.exit("尺寸不一致: " + dst)
        sp, dp = os.path.getsize(src), os.path.getsize(dst)
        total_png += sp
        total_webp += dp
        print("%-24s %7d -> %7d  (%3.0f%%)" % (name, sp, dp, 100.0 * dp / sp))
        if args.delete_png:
            os.remove(src)

    print("-" * 60)
    print("共 %d 个:%d -> %d 字节 (%.0f%%),q=%d" % (
        len(pngs), total_png, total_webp, 100.0 * total_webp / total_png, args.quality))
    if args.delete_png:
        print("已删除源 PNG(git 历史仍可取回: git checkout HEAD -- " + args.dir + ")")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
