/**
 * Decorative foreground terrain — clusters of dark boulders hugging the
 * bottom corners of the frame, like the lip of a crater the constellation
 * floats above. Purely atmospheric, never interactive.
 */
export function RockShelf() {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 z-[15] h-40 overflow-hidden"
      aria-hidden
    >
      <svg
        className="absolute bottom-0 left-0 h-full w-full"
        viewBox="0 0 1440 160"
        preserveAspectRatio="xMidYMax slice"
        fill="none"
      >
        <defs>
          {/* Dark rock body with a faint warm/violet rim from above. */}
          <radialGradient id="rock-body" cx="42%" cy="14%" r="90%">
            <stop offset="0%" stopColor="#241a22" />
            <stop offset="40%" stopColor="#130d14" />
            <stop offset="100%" stopColor="#070608" />
          </radialGradient>
          <linearGradient id="rock-rim" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7b5aa6" stopOpacity="0.5" />
            <stop offset="18%" stopColor="#3a2740" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#000" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Left cluster */}
        <g>
          <ellipse cx="60" cy="150" rx="150" ry="62" fill="url(#rock-body)" />
          <ellipse cx="60" cy="146" rx="150" ry="58" fill="url(#rock-rim)" />
          <ellipse cx="185" cy="158" rx="95" ry="44" fill="url(#rock-body)" />
          <ellipse cx="185" cy="154" rx="95" ry="40" fill="url(#rock-rim)" />
          <ellipse cx="120" cy="160" rx="60" ry="30" fill="#0c080d" />
          <ellipse cx="265" cy="160" rx="70" ry="30" fill="url(#rock-body)" />
        </g>

        {/* Right cluster */}
        <g>
          <ellipse cx="1390" cy="150" rx="160" ry="64" fill="url(#rock-body)" />
          <ellipse cx="1390" cy="146" rx="160" ry="60" fill="url(#rock-rim)" />
          <ellipse cx="1250" cy="158" rx="100" ry="46" fill="url(#rock-body)" />
          <ellipse cx="1250" cy="154" rx="100" ry="42" fill="url(#rock-rim)" />
          <ellipse cx="1320" cy="160" rx="64" ry="30" fill="#0c080d" />
          <ellipse cx="1170" cy="160" rx="74" ry="28" fill="url(#rock-body)" />
        </g>

        {/* A couple of low stones drifting toward centre. */}
        <ellipse cx="360" cy="160" rx="46" ry="18" fill="#0d090e" />
        <ellipse cx="1080" cy="160" rx="52" ry="20" fill="#0d090e" />
      </svg>
    </div>
  );
}
