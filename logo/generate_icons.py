"""Generate PNG icons from the DeepSeek Proxy logo, using precise geometric rendering.

This script manually draws the lambda mark at each target size, ensuring
pixel-precise rendering without anti-aliasing artifacts from resizing.
"""

import math
import os
from PIL import Image, ImageDraw


BG = (8, 8, 12)        # #08080c — terminal black
FG = (0, 230, 118)     # #00e676 — signal green
SIZES = [512, 256, 192, 128, 64, 48, 32, 16]


def draw_logo(size: int) -> Image.Image:
    """Draw the lambda logo at the given square size using Pillow."""
    img = Image.new("RGBA", (size, size), BG)
    draw = ImageDraw.Draw(img)

    # ── Geometry ──
    # The lambda is defined by two diagonal strokes meeting at a bottom junction.
    # We use a proportional coordinate system based on the 512px master.
    s = size / 512.0

    # Stroke width
    sw = max(1, round(48 * s))
    # Cap extension (square linecap adds half stroke width on each end)
    cap = sw // 2

    # Left stroke: (122, 105) → (252, 350)
    lx1 = round(122 * s)
    ly1 = round(105 * s)
    lx2 = round(252 * s)
    ly2 = round(350 * s)

    # Right stroke: (390, 68) → (252, 350)
    rx1 = round(390 * s)
    ry1 = round(68 * s)
    rx2 = round(252 * s)
    ry2 = round(350 * s)

    # ── Draw strokes as thick lines ──
    # We draw thick lines by computing polygon corners

    def draw_thick_line(draw, x1, y1, x2, y2, width, color):
        """Draw a thick line with square caps as a filled polygon."""
        dx = x2 - x1
        dy = y2 - y1
        length = math.sqrt(dx * dx + dy * dy)
        if length == 0:
            return
        # Unit perpendicular
        nx = -dy / length
        ny = dx / length
        half_w = width / 2
        # Cap extension along the line direction
        ux = dx / length
        uy = dy / length
        cap_ext = width / 2  # square linecap extends by half stroke width

        # Polygon corners (order: start-left, end-left, end-right, start-right)
        # Extend endpoints for square cap
        points = [
            (x1 - ux * cap_ext + nx * half_w, y1 - uy * cap_ext + ny * half_w),
            (x2 + ux * cap_ext + nx * half_w, y2 + uy * cap_ext + ny * half_w),
            (x2 + ux * cap_ext - nx * half_w, y2 + uy * cap_ext - ny * half_w),
            (x1 - ux * cap_ext - nx * half_w, y1 - uy * cap_ext - ny * half_w),
        ]
        draw.polygon([(int(p[0]), int(p[1])) for p in points], fill=color)

    # Draw left stroke
    draw_thick_line(draw, lx1, ly1, lx2, ly2, sw, FG)
    # Draw right stroke
    draw_thick_line(draw, rx1, ry1, rx2, ry2, sw, FG)

    # ── Routing node accents ──
    # Left channel small dash
    adx1 = round(170 * s)
    adx2 = round(210 * s)
    ady = round(228 * s)
    ah = max(1, round(8 * s))
    draw.rectangle([adx1, ady, adx2, ady + ah], fill=FG)

    # Right channel small dash
    adx3 = round(295 * s)
    adx4 = round(335 * s)
    ady2 = round(210 * s)
    ah2 = max(1, round(8 * s))
    draw.rectangle([adx3, ady2, adx4, ady2 + ah2], fill=FG)

    return img


def main():
    logo_dir = os.path.dirname(os.path.abspath(__file__))

    for size in SIZES:
        img = draw_logo(size)

        # Save individual PNG
        path = os.path.join(logo_dir, f"deepseek-proxy-logo-{size}.png")
        img.save(path, "PNG")
        print(f"  ✓ {size}x{size} → {path}")

    # ── ICO (multi-size Windows icon) ──
    # Collect all sizes <= 256 for .ico
    ico_path = os.path.join(logo_dir, "favicon.ico")
    ico_images = []
    for size in [16, 32, 48, 64, 128, 256]:
        img = draw_logo(size)
        ico_images.append(img)

    ico_images[0].save(
        ico_path,
        format="ICO",
        sizes=[(i.width, i.height) for i in ico_images],
        append_images=ico_images[1:],
    )
    print(f"  ✓ favicon.ico → {ico_path}")

    print("\nDone. All icons generated.")


if __name__ == "__main__":
    main()
