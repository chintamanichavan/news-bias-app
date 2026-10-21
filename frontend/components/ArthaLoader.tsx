// The loading mark: the Artha tile flipping over. The frames are a Blender
// render (ops/icon/render_loader.py) laid out as one strip in
// /artha-loader.png; the .artha-loader rule in globals.css steps through it.
// `className` sets the space the mark sits in, so the page does not jump
// when the real content lands.

export default function ArthaLoader({ className = 'h-96', label = 'Loading' }: {
  className?: string
  label?: string
}) {
  return (
    <div role="status" aria-label={label} className={`flex items-center justify-center ${className}`}>
      <span className="artha-loader" />
    </div>
  )
}
