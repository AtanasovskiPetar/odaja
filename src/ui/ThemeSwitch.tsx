// Choosing light, dark or the system's appearance.
import { IconAuto, IconMoon, IconSun } from "./icons";
import { setThemePref, useThemePref, type ThemePref } from "./themePref";

const OPTIONS: { value: ThemePref; label: string; Icon: typeof IconSun }[] = [
  { value: "light", label: "Light", Icon: IconSun },
  { value: "dark", label: "Dark", Icon: IconMoon },
  { value: "system", label: "Match system", Icon: IconAuto },
];

// All three side by side (the welcome).
export function ThemeSwitch() {
  const pref = useThemePref();
  return (
    <div className="theme-switch" role="radiogroup" aria-label="Appearance">
      {OPTIONS.map(({ value, label, Icon }) => (
        <button key={value} role="radio" aria-checked={pref === value} className={pref === value ? "active" : ""} onClick={() => setThemePref(value)} title={label}>
          <Icon size={15} />
        </button>
      ))}
    </div>
  );
}

// One button that steps through them (sidebar, where room is tight).
export function ThemeCycleButton() {
  const pref = useThemePref();
  const i = OPTIONS.findIndex((o) => o.value === pref);
  const { Icon, label } = OPTIONS[i];
  const next = OPTIONS[(i + 1) % OPTIONS.length];
  return (
    <button className="theme-cycle" onClick={() => setThemePref(next.value)} title={`Appearance: ${label}. Click for ${next.label.toLowerCase()}.`}>
      <Icon size={16} />
    </button>
  );
}
