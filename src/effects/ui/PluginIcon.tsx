/** A small decorative "wave" mark shared by every custom plugin UI's header
 * (EQ Three, Compressor, ...) as a consistent brand identity. */
export function PluginIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={(size * 10) / 18} viewBox="0 0 18 10" aria-hidden="true">
      <path d="M1 9 A8 8 0 0 1 17 9 Z" fill="#E6AD5E" />
      <rect x={0} y={4.2} width={18} height={0.9} fill="#1B1C22" />
      <rect x={0} y={6.6} width={18} height={1.2} fill="#1B1C22" />
    </svg>
  );
}
