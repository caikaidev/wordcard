import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement> & { size?: number }
const base = (size = 20, sw = 1.7): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: sw,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
})

export const IconSpeaker = ({ size, waves = 2, ...p }: P & { waves?: 1 | 2 }) => (
  <svg {...base(size)} {...p}>
    <path d="M11 5 6 9H3v6h3l5 4z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7" />
    {waves === 2 && <path d="M18.5 5.5a9 9 0 0 1 0 13" />}
  </svg>
)
export const IconSparkle = ({ size, ...p }: P) => (
  <svg {...base(size, 1.6)} {...p}>
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
    <path d="M19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z" />
  </svg>
)
export const IconCheckCircle = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12.5l2.8 2.8L16 10" />
  </svg>
)
export const IconCheck = ({ size, ...p }: P) => (
  <svg {...base(size, 2)} {...p}>
    <path d="M5 12.5l4.5 4.5L19 7" />
  </svg>
)
export const IconCards = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <rect x="4" y="6" width="13" height="15" rx="2.5" />
    <path d="M8 3h9.5A2.5 2.5 0 0 1 20 5.5V17" />
  </svg>
)
export const IconPlusCircle = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v8M8 12h8" />
  </svg>
)
export const IconList = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M5 5h14M5 12h14M5 19h9" />
  </svg>
)
export const IconClose = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M7 7l10 10M17 7 7 17" />
  </svg>
)
export const IconRefresh = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M20 11a8 8 0 1 0-2.3 5.7" />
    <path d="M20 4.5V11h-6.5" />
  </svg>
)
export const IconSearch = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4-4" />
  </svg>
)
export const IconBack = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M15 5l-7 7 7 7" />
  </svg>
)
export const IconPlay = ({ size = 18, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden {...p}>
    <path d="M8 5.5v13l10.5-6.5z" />
  </svg>
)
export const IconStop = ({ size = 18, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden {...p}>
    <rect x="6.5" y="6.5" width="11" height="11" rx="2" />
  </svg>
)
export const IconTrash = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 12.5h9l1-12.5" />
  </svg>
)
export const IconArrowRight = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
)
export const IconUndo = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </svg>
)
export const IconAlert = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5.5M12 16.5v.01" />
  </svg>
)
export const IconGear = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
)
