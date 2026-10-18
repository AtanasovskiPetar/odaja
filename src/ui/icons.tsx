// Line icons drawn for Odaja, in the language of a floor plan: walls are
// thick strokes, doors are a leaf with its swing, windows are glazing lines.
// 20×20 grid, 1.5 stroke, round joins. They take the text colour.
import type { ReactNode, SVGProps } from "react";

function Svg({ children, size = 18, ...rest }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

const icon = (paths: ReactNode) => (props: SVGProps<SVGSVGElement> & { size?: number }) => <Svg {...props}>{paths}</Svg>;

// The Odaja mark: a room in plan, with its door swung open.
export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="logo-mark">
      <path d="M11 3H3v18h18V12" stroke="currentColor" strokeWidth={2.4} strokeLinecap="square" />
      <path d="M21 3v1.5" stroke="currentColor" strokeWidth={2.4} strokeLinecap="square" />
      <path d="M12.2 3.2 21 12" className="logo-leaf" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" />
      <path d="M12 3a9 9 0 0 1 9 9" className="logo-arc" stroke="currentColor" strokeWidth={0.9} strokeDasharray="1.6 1.6" />
    </svg>
  );
}

export const IconFurnish = icon(
  <>
    <path d="M5 10V6.5A2.5 2.5 0 0 1 7.5 4h5A2.5 2.5 0 0 1 15 6.5V10" />
    <path d="M3.5 9.5A1.5 1.5 0 0 1 5 11v1.5h10V11a1.5 1.5 0 0 1 3 0v4H2v-4a1.5 1.5 0 0 1 1.5-1.5Z" />
    <path d="M4 15v1.5M16 15v1.5" />
  </>,
);

export const IconStructure = icon(
  <>
    <path d="M3 3h14v6M17 13v4H3V3" strokeWidth={2.2} strokeLinecap="square" />
    <path d="M17 13a4 4 0 0 0-4-4" strokeDasharray="1.4 1.6" strokeWidth={1.1} />
    <path d="M13 9v4h4" strokeWidth={1.1} />
  </>,
);

export const IconPlan = icon(
  <>
    <rect x="2.5" y="3.5" width="15" height="13" rx="1" />
    <path d="M10 3.5v5M10 11.5v5M10 10h7.5M2.5 10H6" />
  </>,
);

export const IconCube = icon(
  <>
    <path d="M10 2.5 17 6.5v7L10 17.5 3 13.5v-7Z" />
    <path d="M3 6.5 10 10.5l7-4M10 10.5v7" />
  </>,
);

export const IconWalk = icon(
  <>
    <path d="M6.5 3.5c1.4 0 2 1.5 2 3.2 0 1.6-.6 2.8-2 2.8s-2-1.2-2-2.8c0-1.7.6-3.2 2-3.2Z" />
    <path d="M5 11.5h3" />
    <path d="M13.5 7.5c1.4 0 2 1.5 2 3.2 0 1.6-.6 2.8-2 2.8s-2-1.2-2-2.8c0-1.7.6-3.2 2-3.2Z" />
    <path d="M12 15.5h3" />
  </>,
);

export const IconLayers = icon(
  <>
    <path d="M10 3 17.5 7 10 11 2.5 7Z" />
    <path d="m2.5 10.5 7.5 4 7.5-4" />
    <path d="m2.5 13.8 7.5 4 7.5-4" opacity={0.55} />
  </>,
);

export const IconCompare = icon(
  <>
    <path d="M3 4h8v8H3z" strokeDasharray="2 1.8" />
    <path d="M9 8h8v8H9z" />
  </>,
);

export const IconCut = icon(
  <>
    <path d="M10 2.5 17 6.5v7L10 17.5 3 13.5v-7Z" opacity={0.5} />
    <path d="M1.5 10.5h17" strokeDasharray="2.2 1.8" />
    <path d="M3 6.5 10 10.5l7-4" />
  </>,
);

export const IconUndo = icon(
  <>
    <path d="M7.5 5 4 8.5 7.5 12" />
    <path d="M4 8.5h8a4 4 0 0 1 0 8H9" />
  </>,
);

export const IconRedo = icon(
  <>
    <path d="m12.5 5 3.5 3.5-3.5 3.5" />
    <path d="M16 8.5H8a4 4 0 0 0 0 8h3" />
  </>,
);

export const IconChat = icon(
  <>
    <path d="M4 4.5h12a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5H9l-4 3v-3H4A1.5 1.5 0 0 1 2.5 13V6A1.5 1.5 0 0 1 4 4.5Z" />
    <path d="M6.5 8.5h7M6.5 11h4.5" />
  </>,
);

export const IconSelect = icon(<path d="M4.5 3 15 9.5l-4.6 1.1 2.8 5-1.8 1-2.8-5L5 14Z" />);

export const IconWall = icon(
  <>
    <path d="M3 15.5 15.5 3" strokeWidth={3.4} strokeLinecap="square" opacity={0.9} />
    <circle cx="3" cy="15.5" r="1.6" fill="var(--sheet, #fff)" strokeWidth={1.2} />
    <circle cx="15.5" cy="3" r="1.6" fill="var(--sheet, #fff)" strokeWidth={1.2} />
  </>,
);

export const IconRoom = icon(
  <>
    <path d="M3 4h10l4 5v7H3Z" />
    <path d="M6 16 13 9M3 13l6-6M9.5 16 17 8.5" opacity={0.45} strokeWidth={1.1} />
  </>,
);

export const IconDoor = icon(
  <>
    <path d="M2 16.5h3M17 16.5h1" strokeWidth={2.4} strokeLinecap="square" />
    <path d="M5 16.5V5" />
    <path d="M5 5a11.5 11.5 0 0 1 11.5 11.5" strokeDasharray="1.6 1.8" strokeWidth={1.1} />
  </>,
);

export const IconWindow = icon(
  <>
    <path d="M2 10h2.5M15.5 10H18" strokeWidth={3.2} strokeLinecap="square" />
    <path d="M4.5 8h11M4.5 10h11M4.5 12h11" strokeWidth={1.1} />
    <path d="M4.5 7.5v5M15.5 7.5v5" />
  </>,
);

export const IconEyeOff = icon(
  <>
    <path d="M3 10s2.6-5 7-5c1.4 0 2.6.5 3.6 1.1M17 10s-2.6 5-7 5c-1.4 0-2.6-.5-3.6-1.1" />
    <path d="M8.3 11.7a2.4 2.4 0 0 1 3.4-3.4" />
    <path d="M3.5 16.5 16.5 3.5" />
  </>,
);

export const IconSwatch = icon(
  <>
    <rect x="3" y="3" width="6" height="14" rx="1.2" />
    <path d="m9 7 3.5-2.2a1.2 1.2 0 0 1 1.6.4L17 10" />
    <path d="M9 13.5h7.5a.5.5 0 0 1 .5.5v2a1 1 0 0 1-1 1H6" />
    <circle cx="6" cy="14" r="0.6" fill="currentColor" />
  </>,
);

export const IconPlus = icon(<path d="M10 4v12M4 10h12" />);
export const IconClose = icon(<path d="m5 5 10 10M15 5 5 15" />);
export const IconChevron = icon(<path d="m6 8 4 4 4-4" />);
export const IconArrowUp = icon(<path d="M10 16V4M5 9l5-5 5 5" />);
export const IconStop = icon(<rect x="5.5" y="5.5" width="9" height="9" rx="1.5" fill="currentColor" stroke="none" />);
export const IconClip = icon(<path d="m15.5 9.5-5.8 5.8a3.5 3.5 0 0 1-5-5l6.3-6.3a2.3 2.3 0 0 1 3.3 3.3L8 13.6a1.2 1.2 0 0 1-1.7-1.7l5.5-5.5" />);
export const IconSliders = icon(
  <>
    <path d="M4 5h7M15 5h1M4 10h2M10 10h6M4 15h8M16 15h0" />
    <circle cx="13" cy="5" r="1.8" />
    <circle cx="8" cy="10" r="1.8" />
    <circle cx="14" cy="15" r="1.8" />
  </>,
);
export const IconHistory = icon(
  <>
    <path d="M3.5 10a6.5 6.5 0 1 0 2-4.7" />
    <path d="M3.5 3.5v3h3" />
    <path d="M10 6.5V10l2.5 1.5" />
  </>,
);
export const IconCheck = icon(<path d="m4.5 10.5 3.5 3.5 7.5-8" />);
export const IconWarning = icon(
  <>
    <path d="M10 3.5 17.5 16.5h-15Z" />
    <path d="M10 8.5v3.5M10 14.3v.2" />
  </>,
);

export const IconSun = icon(
  <>
    <circle cx="10" cy="10" r="3.2" />
    <path d="M10 2.5v1.6M10 15.9v1.6M2.5 10h1.6M15.9 10h1.6M4.7 4.7l1.1 1.1M14.2 14.2l1.1 1.1M4.7 15.3l1.1-1.1M14.2 5.8l1.1-1.1" />
  </>,
);
export const IconMoon = icon(<path d="M15.8 12.4A6.5 6.5 0 0 1 7.6 4.2a6.5 6.5 0 1 0 8.2 8.2Z" />);
export const IconAuto = icon(
  <>
    <circle cx="10" cy="10" r="6.5" />
    <path d="M10 3.5a6.5 6.5 0 0 1 0 13Z" fill="currentColor" stroke="none" />
  </>,
);
