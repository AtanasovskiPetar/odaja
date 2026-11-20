import type { ButtonHTMLAttributes } from "react";

type Variant = "default" | "primary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANT: Record<Variant, string> = {
  default: "bg-card text-ink border border-line-strong hover:bg-well",
  primary: "bg-accent text-white border border-accent hover:bg-accent-ink",
  ghost: "bg-transparent text-ink border border-transparent hover:bg-well",
  danger: "bg-transparent text-danger border border-transparent hover:bg-danger-wash",
};

const SIZE: Record<Size, string> = {
  sm: "h-7 px-2.5 text-xs rounded-[6px]",
  md: "h-9 px-3.5 text-[13px] rounded-[8px]",
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
