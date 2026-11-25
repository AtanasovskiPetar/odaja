import { useState, type InputHTMLAttributes } from "react";

export function TextField({
  label,
  type = "text",
  className = "",
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const [reveal, setReveal] = useState(false);
  const isPassword = type === "password";
  const actualType = isPassword && reveal ? "text" : type;

  return (
    <label className="flex flex-col gap-1.5 text-xs font-medium text-ink-2">
      <span>{label}</span>
      <div className="relative flex items-center">
        <input
          type={actualType}
          className={`w-full h-9 rounded-[8px] border border-line-strong bg-sheet px-3 text-[13px] text-ink placeholder:text-faint outline-none transition-colors focus:border-accent focus:bg-card ${isPassword ? "pr-14" : ""} ${className}`}
          {...rest}
        />
        {isPassword && (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setReveal((v) => !v)}
            className="absolute right-2 rounded px-1.5 py-0.5 text-[11px] font-medium text-muted hover:text-ink bg-transparent border-0 cursor-pointer"
          >
            {reveal ? "Hide" : "Show"}
          </button>
        )}
      </div>
    </label>
  );
}
