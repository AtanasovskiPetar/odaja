import type { ButtonHTMLAttributes } from "react";

type Variant = "default" | "primary" | "ghost" | "danger" | "overlay";
type Size = "sm" | "md" | "icon" | "icon-xs";

const VARIANT: Record<Variant, string> = {
  default: "bg-card text-ink border border-line-strong hover:bg-well",
  primary: "bg-accent text-white border border-accent hover:bg-accent-ink",
  ghost: "bg-transparent text-ink border border-transparent hover:bg-well",
  danger: "bg-transparent text-danger border border-transparent hover:bg-danger-wash",
  // On top of an image (e.g. removing an attachment).
  overlay: "bg-ink/70 text-white border border-transparent hover:bg-ink",
};

const SIZE: Record<Size, string> = {
  sm: "h-7 px-2.5 text-xs rounded-[6px]",
  md: "h-9 px-3.5 text-[13px] rounded-[8px]",
  // Round, for a lone icon.
  icon: "h-8 w-8 p-0 rounded-full",
  "icon-xs": "h-5 w-5 p-0 rounded-full",
};

export function Button({
  variant = "default",
  size = "md",
  className = "",
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-1.5 font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${VARIANT[variant]} ${SIZE[size]} ${className}`}
      {...rest}
    />
  );
}
