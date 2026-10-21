"""Render the Artha icon: a raised white अ on an Apple News red tile.

    blender -b --factory-startup -P render_icon.py -- \
        --font NotoSansDevanagari-ExtraBold.ttf --out icon.png --size 512

--shape squircle  rounded tile on a transparent background (browser tab)
--shape bleed     red to every edge; the platform cuts the corners (iOS, maskable)
"""
import argparse
import math
import sys

import bmesh
import bpy

RED_TOP = (0.98, 0.22, 0.31)    # sRGB; brand red is hsl(354 90% 56%)
RED_BOTTOM = (0.80, 0.04, 0.15)
WHITE = (1.0, 1.0, 1.0)


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument('--font', required=True)
    p.add_argument('--out', required=True)
    p.add_argument('--size', type=int, default=512)
    p.add_argument('--shape', choices=['squircle', 'bleed'], default='squircle')
    p.add_argument('--glyph', type=float, default=0.52, help='glyph size as a fraction of the tile')
    p.add_argument('--depth', type=float, default=0.12, help='how far the glyph stands off the tile')
    p.add_argument('--samples', type=int, default=256)
    p.add_argument('--light', type=float, default=1.0, help='key light multiplier')
    return p.parse_args(sys.argv[sys.argv.index('--') + 1:])


def linear(srgb):
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb) + (1.0,)


def material(name, roughness):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Specular IOR Level'].default_value = 0.25  # no glare
    return mat, bsdf


def red_material():
    """Red that runs lighter at the top of the tile, like a lit app icon."""
    mat, bsdf = material('red', 0.6)
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    coord = nodes.new('ShaderNodeTexCoord')
    split = nodes.new('ShaderNodeSeparateXYZ')
    ramp = nodes.new('ShaderNodeMapRange')
    ramp.inputs['From Min'].default_value = -1.0
    ramp.inputs['From Max'].default_value = 1.0
    mix = nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.inputs['A'].default_value = linear(RED_BOTTOM)
    mix.inputs['B'].default_value = linear(RED_TOP)
    links.new(coord.outputs['Object'], split.inputs['Vector'])
    links.new(split.outputs['Y'], ramp.inputs['Value'])
    links.new(ramp.outputs['Result'], mix.inputs['Factor'])
    links.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
    return mat


def white_material():
    mat, bsdf = material('white', 0.35)
    bsdf.inputs['Base Color'].default_value = linear(WHITE)
    return mat


def add_tile(scene, shape):
    """Top face at z=0, spanning -1..1. The squircle is a superellipse, n=5."""
    mesh = bpy.data.meshes.new('tile')
    bm = bmesh.new()
    if shape == 'squircle':
        n, steps = 5.0, 256
        outline = []
        for i in range(steps):
            t = 2 * math.pi * i / steps
            c, s = math.cos(t), math.sin(t)
            x = math.copysign(abs(c) ** (2 / n), c)
            y = math.copysign(abs(s) ** (2 / n), s)
            outline.append(bm.verts.new((x, y, 0)))
        bm.faces.new(outline)
    else:
        bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=4)
    bm.to_mesh(mesh)
    bm.free()
    tile = bpy.data.objects.new('tile', mesh)
    scene.collection.objects.link(tile)
    tile.data.materials.append(red_material())
    if shape == 'squircle':
        solid = tile.modifiers.new('solid', 'SOLIDIFY')
        solid.thickness = 0.2
        solid.offset = -1
        bevel = tile.modifiers.new('bevel', 'BEVEL')
        bevel.width = 0.035
        bevel.segments = 5
        bevel.limit_method = 'ANGLE'
        bevel.angle_limit = math.radians(40)
    return tile


def add_glyph(scene, font_path, size, depth):
    """A raised अ, centred on the tile, `size` of the tile wide or tall."""
    curve = bpy.data.curves.new('glyph', 'FONT')
    curve.body = 'अ'
    curve.font = bpy.data.fonts.load(font_path)
    curve.resolution_u = 32
    glyph = bpy.data.objects.new('glyph', curve)
    scene.collection.objects.link(glyph)
    bpy.context.view_layer.update()

    xs = [corner[0] for corner in glyph.bound_box]
    ys = [corner[1] for corner in glyph.bound_box]
    scale = 2 * size / max(max(xs) - min(xs), max(ys) - min(ys))
    glyph.scale = (scale, scale, scale)

    bevel = 0.18 * depth
    curve.extrude = (depth - bevel) / 2 / scale
    curve.bevel_depth = bevel / scale
    curve.bevel_resolution = 5
    glyph.location = (
        -scale * (min(xs) + max(xs)) / 2,
        -scale * (min(ys) + max(ys)) / 2,
        depth / 2,
    )
    glyph.data.materials.append(white_material())
    return glyph


def add_light_and_camera(scene, light):
    # Key light sits above the top edge, so the shadow falls straight down.
    key = bpy.data.lights.new('key', 'AREA')
    key.shape = 'DISK'
    key.size = 1.4
    key.energy = 230 * light
    lamp = bpy.data.objects.new('key', key)
    lamp.location = (-0.5, 2.4, 4.0)
    lamp.rotation_euler = (-lamp.location).to_track_quat('-Z', 'Y').to_euler()
    scene.collection.objects.link(lamp)

    world = bpy.data.worlds.new('world')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.3
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (1, 1, 1, 1)
    scene.world = world

    cam = bpy.data.cameras.new('cam')
    cam.type = 'ORTHO'
    cam.ortho_scale = 2.0
    camera = bpy.data.objects.new('cam', cam)
    camera.location = (0, 0, 10)
    scene.collection.objects.link(camera)
    scene.camera = camera


def main():
    args = parse_args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene

    add_tile(scene, args.shape)
    add_glyph(scene, args.font, args.glyph, args.depth)
    add_light_and_camera(scene, args.light)

    scene.render.engine = 'CYCLES'
    scene.cycles.samples = args.samples
    scene.cycles.use_denoising = True
    scene.render.film_transparent = args.shape == 'squircle'
    scene.view_settings.view_transform = 'Standard'  # keep the red saturated
    scene.render.resolution_x = scene.render.resolution_y = args.size
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.filepath = args.out
    bpy.ops.render.render(write_still=True)


if __name__ == '__main__':
    main()
