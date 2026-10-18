// The sunlight view's controls: where the flat is (once), then the day and
// time to show, with play to watch the light move through the day. The light
// itself is in src/three/SunLight.tsx; the sun maths in src/model/sun.ts.
import { useState } from "react";
import { daylight, momentOf, sunPosition } from "../model/sun";
import { useOdaja } from "../store";
import { IconClose, IconPause, IconPlay } from "./icons";
import { SUN_YEAR, useSun } from "./sunState";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(Math.floor(minutes % 60)).padStart(2, "0")}`;
const dateLabel = (day: number) => {
  const d = momentOf(SUN_YEAR, day, 0);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
};
const dayOf = (month: number, date: number) => Math.round((new Date(SUN_YEAR, month, date).valueOf() - new Date(SUN_YEAR, 0, 0).valueOf()) / 86400000);

// "41.99, 21.42" (as copied from a map), or two numbers in any form.
function parseCoordinates(text: string): [number, number] | null {
  const nums = text.match(/-?\d+(?:\.\d+)?/g)?.map(Number);
  if (!nums || nums.length !== 2) return null;
  const [lat, lon] = nums;
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lat, lon] : null;
}

// A small compass showing where north is on the plan.
export function NorthGlyph({ north, size = 30 }: { north: number; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="-15 -15 30 30" className="north-glyph" aria-hidden="true">
      <circle r="13.5" className="ring" />
      <g transform={`rotate(${north})`}>
        <path d="M0 -11 L4 2 L0 0 L-4 2 Z" className="needle" />
        <text y="-4" x="0" transform="translate(0 15)" className="letter">
          N
        </text>
      </g>
    </svg>
  );
}

function SiteForm() {
  const site = useOdaja((s) => s.project?.site);
  const applyProject = useOdaja((s) => s.applyProject);
  const setEditingSite = useSun((s) => s.setEditingSite);
  const setDraftNorth = useSun((s) => s.setDraftNorth);
  const [coords, setCoords] = useState(site ? `${site.latitude}, ${site.longitude}` : "");
  const [north, setNorth] = useState(site?.north ?? 0);
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  const changeNorth = (value: number) => {
    const n = ((Math.round(value) % 360) + 360) % 360;
    setNorth(n);
    setDraftNorth(n);
  };

  const locate = () => {
    if (!navigator.geolocation) return setError("This browser can't tell where you are; paste the coordinates instead.");
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setCoords(`${p.coords.latitude.toFixed(5)}, ${p.coords.longitude.toFixed(5)}`);
        setLocating(false);
      },
      () => {
        setError("Couldn't get your location. Paste the coordinates instead.");
        setLocating(false);
      },
      { timeout: 15000 },
    );
  };

  const save = () => {
    const parsed = parseCoordinates(coords);
    if (!parsed) return setError("Enter latitude and longitude, e.g. 41.9981, 21.4254.");
    applyProject((doc) => ({ ...doc, site: { latitude: parsed[0], longitude: parsed[1], north } }));
    setEditingSite(false);
  };

  return (
    <div className="site-form">
      <p className="hint">Where the flat is and which way it faces, to work out the sun. Kept with the home; nothing is looked up online.</p>
      <label className="field">
        <span>Location (latitude, longitude)</span>
        <input value={coords} placeholder="41.9981, 21.4254" onChange={(e) => setCoords(e.target.value)} autoFocus spellCheck={false} />
      </label>
      <p className="hint">
        In a map app, right-click the building and copy its coordinates.{" "}
        <button className="link" onClick={locate} disabled={locating}>
          {locating ? "Locating…" : "Use where I am"}
        </button>
      </p>
      <div className="field">
        <span>North on your plan</span>
        <div className="north-row">
          <NorthGlyph north={north} />
          <input type="range" min={0} max={359} value={north} onChange={(e) => changeNorth(Number(e.target.value))} />
          <span className="input-wrap north-input">
            <input inputMode="numeric" value={north} onChange={(e) => changeNorth(Number(e.target.value) || 0)} />
            <span className="suffix">°</span>
          </span>
        </div>
      </div>
      <p className="hint">0° when the top of the plan is north. In the plan view the arrow shows it over your drawing; a map of the building helps.</p>
      {error && <div className="inline-error">{error}</div>}
      <div className="actions">
        {site && <button onClick={() => setEditingSite(false)}>Cancel</button>}
        <button className="active" onClick={save}>
          Save
        </button>
      </div>
    </div>
  );
}

function SunControls() {
  const site = useOdaja((s) => s.project!.site!);
  const plan = useOdaja((s) => s.viewMode === "plan");
  const { day, minutes, playing, setDay, setMinutes, setPlaying, setEditingSite } = useSun();
  const pos = sunPosition(momentOf(SUN_YEAR, day, Math.floor(minutes)), site.latitude, site.longitude);
  const light = daylight(SUN_YEAR, day, site);
  const today = dayOf(new Date().getMonth(), new Date().getDate());

  const play = () => {
    if (playing) return setPlaying(false);
    // From sunrise when there's no day left to play.
    if (light && (minutes >= light.sunset || minutes < light.sunrise - 60)) setMinutes(Math.max(0, light.sunrise - 30));
    setPlaying(true);
  };

  return (
    <>
      <p className="sun-now">
        {pos.altitude > -0.833 ? (
          <>
            Sun <strong>{Math.round(pos.altitude)}°</strong> up, from the {COMPASS[Math.round(pos.bearing / 45) % 8]}
          </>
        ) : (
          "The sun is below the horizon."
        )}
      </p>
      <label className="field">
        <span>
          Day <strong className="value">{dateLabel(day)}</strong>
        </span>
        <input type="range" min={1} max={365} value={day} onChange={(e) => setDay(Number(e.target.value))} />
      </label>
      <div className="sun-days">
        {(
          [
            ["Mar 20", dayOf(2, 20)],
            ["Jun 21", dayOf(5, 21)],
            ["Sep 22", dayOf(8, 22)],
            ["Dec 21", dayOf(11, 21)],
            ["Today", today],
          ] as const
        ).map(([label, d]) => (
          <button key={label} className={day === d ? "active" : ""} onClick={() => setDay(d)}>
            {label}
          </button>
        ))}
      </div>
      <label className="field">
        <span>
          Time <strong className="value">{clock(minutes)}</strong>
        </span>
        <div className="sun-time">
          <button className="icon" onClick={play} title={playing ? "Pause" : "Play the day"}>
            {playing ? <IconPause size={15} /> : <IconPlay size={15} />}
          </button>
          <input
            type="range"
            min={0}
            max={1439}
            step={5}
            value={Math.floor(minutes)}
            onChange={(e) => {
              setPlaying(false);
              setMinutes(Number(e.target.value));
            }}
          />
        </div>
      </label>
      <p className="hint">{light ? `Sunrise ${clock(light.sunrise)} · sunset ${clock(light.sunset)} · your computer's time zone` : "No sunrise or sunset that day."}</p>
      {plan && <p className="hint strong">Switch to 3D or Walk to see the light.</p>}
      <p className="hint sun-site">
        {site.latitude.toFixed(4)}, {site.longitude.toFixed(4)} · north {site.north}°{" "}
        <button className="link" onClick={() => setEditingSite(true)}>
          Change
        </button>
        <br />
        Without neighbouring buildings or trees.
      </p>
    </>
  );
}

export function SunPanel() {
  const on = useSun((s) => s.on);
  const editing = useSun((s) => s.editingSite);
  const setOn = useSun((s) => s.setOn);
  const hasSite = useOdaja((s) => Boolean(s.project?.site));
  if (!on) return null;
  return (
    <div className="underlay-panel sun-panel">
      <div className="underlay-head">
        <strong>Sunlight</strong>
        <button className="icon" onClick={() => setOn(false)} title="Turn sunlight off">
          <IconClose size={15} />
        </button>
      </div>
      {!hasSite || editing ? <SiteForm /> : <SunControls />}
    </div>
  );
}

// North on the plan view, when the flat's site is set (or being set).
export function PlanNorthArrow() {
  const plan = useOdaja((s) => s.viewMode === "plan");
  const north = useOdaja((s) => s.project?.site?.north);
  const draft = useSun((s) => s.draftNorth);
  const shown = draft ?? north;
  if (!plan || shown === undefined) return null;
  return (
    <div className="plan-north" title={`North is ${shown}° clockwise from the top of the plan`}>
      <NorthGlyph north={shown} size={44} />
    </div>
  );
}

// The time of day in the Walk view, so you can scrub through the day standing in a room.
export function WalkSunTime() {
  const on = useSun((s) => s.on);
  const hasSite = useOdaja((s) => Boolean(s.project?.site));
  const minutes = useSun((s) => s.minutes);
  const playing = useSun((s) => s.playing);
  const setMinutes = useSun((s) => s.setMinutes);
  const setPlaying = useSun((s) => s.setPlaying);
  if (!on || !hasSite) return null;
  return (
    <label className="walk-sun">
      <button className="icon" onClick={() => setPlaying(!playing)} title={playing ? "Pause" : "Play the day"}>
        {playing ? <IconPause size={14} /> : <IconPlay size={14} />}
      </button>
      {clock(minutes)}
      <input
        type="range"
        min={0}
        max={1439}
        step={5}
        value={Math.floor(minutes)}
        onChange={(e) => {
          setPlaying(false);
          setMinutes(Number(e.target.value));
        }}
      />
    </label>
  );
}
