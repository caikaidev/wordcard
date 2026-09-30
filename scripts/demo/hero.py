"""把 4 张演示截图合成 README 顶部的流程动画（SVG，浅色/深色各一份）。

依赖 Pillow（带 WebP 支持）。用法：
    python3 scripts/demo/hero.py            # 读 docs/images/raw/*.png，输出到 docs/images/
截图本身由 scripts/demo/shots.mjs 生成，全部是虚构的演示数据。
"""

import base64
import io
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "docs/images/raw"
OUT = ROOT / "docs/images"

FRAMES = ["1-article", "2-write", "3-feedback", "4-review"]
STEPS = [
    ("发一篇文章", "链接、正文或截图，AI 出生词、句式和 3 个输出任务"),
    ("写三句话", "从模板或开头写起，写不出的先用中文括起来"),
    ("AI 逐句批改", "只改真正的错误，每次一个改进点，改两次给参考版本"),
    ("加入复习", "值得记的表达一键变卡片，按遗忘曲线复习"),
]
THEMES = {
    "light": dict(bg="#f6f4ef", surface="#ffffff", ink="#1c1b19", muted="#6b6860", faint="#b9b5ac",
                  line="#e6e2d9", accent="#2b4c7e", accent_soft="#e8edf5", on_accent="#ffffff", phone="#1c1b19"),
    "dark": dict(bg="#131312", surface="#1d1c1a", ink="#edeae3", muted="#a19d94", faint="#5e5b54",
                 line="#2a2926", accent="#9db8e3", accent_soft="#232c3b", on_accent="#131312", phone="#3a3935"),
}

W, H = 960, 600
PW, PH = 250, 541          # 手机屏幕（390×844 等比缩放）
PX, PY = 650, 30           # 屏幕左上角
PERIOD = 14                # 一轮秒数
SLOT = PERIOD / len(FRAMES)
FONT = "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Segoe UI', sans-serif"
SERIF = "'Newsreader', Georgia, 'Songti SC', serif"


def webp(path: Path) -> str:
    im = Image.open(path).convert("RGB").resize((PW * 2, PH * 2), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "WEBP", quality=80, method=6)
    return base64.b64encode(buf.getvalue()).decode()


def keyframes() -> str:
    # 每帧占 1/4 周期：淡入 → 停留 → 淡出
    share = 100 / len(FRAMES)
    fade = 3
    return f"""
    @keyframes show {{ 0% {{ opacity: 0 }} {fade}% {{ opacity: 1 }} {share}% {{ opacity: 1 }} {share + fade}% {{ opacity: 0 }} 100% {{ opacity: 0 }} }}
    @keyframes step {{ 0% {{ opacity: .38 }} {fade}% {{ opacity: 1 }} {share}% {{ opacity: 1 }} {share + fade}% {{ opacity: .38 }} 100% {{ opacity: .38 }} }}
    @keyframes bar {{ 0% {{ transform: scaleX(0) }} {share}% {{ transform: scaleX(1) }} {share + .01}% {{ transform: scaleX(0) }} 100% {{ transform: scaleX(0) }} }}
    """


def build(theme: str) -> str:
    c = THEMES[theme]
    frames = [webp(RAW / f"{name}-{theme}.png") for name in FRAMES]
    delay = lambda i: f"{i * SLOT - PERIOD:.2f}s" if i else "0s"  # noqa: E731

    steps_svg = []
    for i, (title, desc) in enumerate(STEPS):
        y = 250 + i * 78
        steps_svg.append(f"""
    <g class="step" style="animation-delay:{delay(i)}">
      <circle cx="78" cy="{y}" r="15" fill="{c['accent']}"/>
      <text x="78" y="{y + 5}" text-anchor="middle" font-size="14" font-weight="600" fill="{c['on_accent']}">{i + 1}</text>
      <text x="108" y="{y - 2}" font-size="19" font-weight="600" fill="{c['ink']}">{title}</text>
      <text x="108" y="{y + 22}" font-size="14" fill="{c['muted']}">{desc}</text>
      <rect x="108" y="{y + 36}" width="360" height="2" rx="1" fill="{c['line']}"/>
      <rect class="bar" x="108" y="{y + 36}" width="360" height="2" rx="1" fill="{c['accent']}" style="animation-delay:{delay(i)}"/>
    </g>""")

    images_svg = "".join(
        f'\n    <image class="frame" href="data:image/webp;base64,{b64}" x="{PX}" y="{PY}" width="{PW}" height="{PH}" '
        f'clip-path="url(#screen)" style="animation-delay:{delay(i)}"/>'
        for i, b64 in enumerate(frames)
    )

    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" role="img" aria-label="词句卡练习流程：发一篇文章、写三句话、AI 逐句批改、加入复习">
  <title>词句卡：读一篇，写三句，记下来</title>
  <style>
    text {{ font-family: {FONT}; }}
    .serif {{ font-family: {SERIF}; }}
    {keyframes()}
    .frame {{ opacity: 0; animation: show {PERIOD}s infinite both; }}
    .step {{ opacity: .38; animation: step {PERIOD}s infinite both; }}
    .bar {{ transform-box: fill-box; transform-origin: left; transform: scaleX(0); animation: bar {PERIOD}s linear infinite both; }}
    @media (prefers-reduced-motion: reduce) {{
      .frame, .step, .bar {{ animation: none; }}
      .step {{ opacity: 1; }}
      .frame:last-of-type {{ opacity: 1; }}
    }}
  </style>
  <defs>
    <clipPath id="screen"><rect x="{PX}" y="{PY}" width="{PW}" height="{PH}" rx="26"/></clipPath>
  </defs>
  <rect width="{W}" height="{H}" rx="24" fill="{c['bg']}"/>

  <text x="64" y="104" font-size="15" fill="{c['muted']}">词句卡 · wordcard</text>
  <text x="62" y="152" font-size="36" font-weight="600" fill="{c['ink']}">读一篇，写三句，记下来</text>
  <text x="64" y="190" font-size="15" fill="{c['muted']}">自部署的英语词句卡 + AI 写作教练，跑在你自己的 Cloudflare 上</text>
  {''.join(steps_svg)}

  <rect x="{PX - 9}" y="{PY - 9}" width="{PW + 18}" height="{PH + 18}" rx="34" fill="{c['phone']}"/>
  <rect x="{PX}" y="{PY}" width="{PW}" height="{PH}" rx="26" fill="{c['surface']}"/>{images_svg}
</svg>
"""


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for theme in THEMES:
        svg = build(theme)
        (OUT / f"flow-{theme}.svg").write_text(svg, encoding="utf-8")
        print(f"flow-{theme}.svg  {len(svg) / 1024:.0f} KB")
    # README 里的静态截图：WebP，宽 780（2x）
    for name in FRAMES:
        for theme in THEMES:
            im = Image.open(RAW / f"{name}-{theme}.png").convert("RGB")
            im.save(OUT / f"{name}-{theme}.webp", "WEBP", quality=82, method=6)
    print("screenshots:", sum((OUT / f"{n}-{t}.webp").stat().st_size for n in FRAMES for t in THEMES) // 1024, "KB")


if __name__ == "__main__":
    main()
