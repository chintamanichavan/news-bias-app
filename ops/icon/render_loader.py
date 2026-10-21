"""Render the Artha loading animation: the icon tile flipping over, as one
sprite sheet of square frames laid left to right on a transparent background.

    blender -b --factory-startup -P render_loader.py -- \
        --font NotoSansDevanagari-ExtraBold.ttf --out loader.png

The tile carries an अ on both faces, so half a turn brings it back to where
it started and the strip loops. CSS plays it with steps(FRAMES).
"""
import argparse
import math
import os
import sys
import tempfile

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import render_icon as icon  # noqa: E402

TILE_THICKNESS = 0.2


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument('--font', required=True)
    p.add_argument('--out', required=True)
    p.add_argument('--frames', type=int, default=24)
    p.add_argument('--size', type=int, default=112, help='frame edge in pixels')
    p.add_argument('--samples', type=int, default=96)
    return p.parse_args(sys.argv[sys.argv.index('--') + 1:])


def ease(t):
    """Slow out of the rest position and slow back into it."""
    return t * t * t * (t * (6 * t - 15) + 10)


def build(scene, font):
    """The tile with an अ on each face, hung on a pivot through its middle."""
    pivot = bpy.data.objects.new('pivot', None)
    pivot.location = (0, 0, -TILE_THICKNESS / 2)
    scene.collection.objects.link(pivot)

    tile = icon.add_tile(scene, 'squircle')
    front = icon.add_glyph(scene, font, 0.52, 0.12)
    back = icon.add_glyph(scene, font, 0.52, 0.12)
    back.rotation_euler = (0, math.pi, 0)
    back.location = (-back.location.x, back.location.y, -TILE_THICKNESS - back.location.z)

    bpy.context.view_layer.update()
    for part in (tile, front, back):
        world = part.matrix_world.copy()
        part.parent = pivot
        part.matrix_world = world
    return pivot


def render_frames(scene, pivot, frames, folder):
    paths = []
    for i in range(frames):
        pivot.rotation_euler = (0, math.pi * ease(i / frames), 0)
        scene.render.filepath = os.path.join(folder, f'{i:03d}.png')
        bpy.ops.render.render(write_still=True)
        paths.append(scene.render.filepath)
    return paths


def join(paths, size, out):
    """Lay the frames left to right in one PNG."""
    strip = np.zeros((size, size * len(paths), 4), dtype=np.float32)
    for i, path in enumerate(paths):
        frame = bpy.data.images.load(path)
        pixels = np.empty(size * size * 4, dtype=np.float32)
        frame.pixels.foreach_get(pixels)
        strip[:, i * size:(i + 1) * size] = pixels.reshape(size, size, 4)
    sheet = bpy.data.images.new('sheet', size * len(paths), size, alpha=True)
    sheet.pixels.foreach_set(strip.ravel())
    sheet.filepath_raw = out
    sheet.file_format = 'PNG'
    sheet.save()


def main():
    args = parse_args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    pivot = build(scene, args.font)
    icon.add_light_and_camera(scene, 1.0)
    scene.camera.data.ortho_scale = 2.3   # room for the turning corners

    scene.render.engine = 'CYCLES'
    scene.cycles.samples = args.samples
    scene.cycles.use_denoising = True
    scene.render.film_transparent = True
    scene.view_settings.view_transform = 'Standard'
    scene.render.resolution_x = scene.render.resolution_y = args.size
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'

    with tempfile.TemporaryDirectory() as folder:
        join(render_frames(scene, pivot, args.frames, folder), args.size, os.path.abspath(args.out))


if __name__ == '__main__':
    main()
