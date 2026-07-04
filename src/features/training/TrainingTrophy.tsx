import { useEffect, useState } from "react";
import { fetchTrainingStartDate } from "./api";

// ─────────────────────────────────────────────────────────────────────────────
// TrainingTrophy — the "how long I've been at this" badge of honour that greets
// you at the top of the Training tab. Hero = years + months (the unit the brain
// feels); subline = the concrete start month + a day counter for texture. Gold
// is earned here — this is a celebration surface, not a status readout, so it's
// the one place on the tab that gets the reward colour.
// ─────────────────────────────────────────────────────────────────────────────

type Age = { hero: string; sub: string };

/** Parse a YYYY-MM-DD anchor as a LOCAL calendar date (not UTC midnight), so the
 *  day count and month label don't shift a day in negative-offset timezones. */
function parseLocal(iso: string): Date | null {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export function formatTrainingAge(
  iso: string | null | undefined,
  now = new Date(),
): Age | null {
  if (!iso) return null;
  const start = parseLocal(iso);
  if (!start || start.getTime() > now.getTime()) return null;

  // Whole calendar months elapsed — drop the current month if the day-of-month
  // hasn't come around yet (e.g. started the 20th, today's the 5th → not a full month).
  let months =
    (now.getFullYear() - start.getFullYear()) * 12 +
    (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) months -= 1;
  months = Math.max(0, months);

  const years = Math.floor(months / 12);
  const rem = months % 12;

  let hero: string;
  if (years > 0) hero = rem > 0 ? `${years} yr ${rem} mo` : `${years} yr`;
  else if (months > 0) hero = `${months} mo`;
  else {
    // Under a month — still worth celebrating. Count in weeks, then days.
    const days = Math.floor((now.getTime() - start.getTime()) / 86_400_000);
    const weeks = Math.floor(days / 7);
    hero = weeks >= 1 ? `${weeks} wk` : `${Math.max(1, days)} d`;
  }

  const totalDays = Math.max(
    1,
    Math.floor((now.getTime() - start.getTime()) / 86_400_000),
  );
  const monthYear = start.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });

  return { hero, sub: `${monthYear} · day ${totalDays}` };
}

function TrophyIcon() {
  return (
    <svg
      className="tr-trophy-icon"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M7 4h10v3a5 5 0 0 1-10 0V4Z"
        fill="currentColor"
        fillOpacity="0.9"
      />
      <path
        d="M17 5h2.5a1 1 0 0 1 1 1c0 2.2-1.6 4-3.7 4.2M7 5H4.5a1 1 0 0 0-1 1c0 2.2 1.6 4 3.7 4.2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M12 12v3.5M9 20h6M10 17.5h4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TrainingTrophy() {
  const [age, setAge] = useState<Age | null>(null);

  useEffect(() => {
    let active = true;
    fetchTrainingStartDate()
      .then((iso) => active && setAge(formatTrainingAge(iso)))
      .catch(() => {
        /* No trophy on error — it's an ornament, never block the tab. */
      });
    return () => {
      active = false;
    };
  }, []);

  // Nothing until the anchor is set in Settings — no empty shell, no placeholder.
  if (!age) return null;

  return (
    <div className="tr-trophy" role="img" aria-label={`Training since ${age.sub}`}>
      <span className="tr-trophy-badge">
        <TrophyIcon />
      </span>
      <div className="tr-trophy-text">
        <span className="tr-trophy-eyebrow">Training since</span>
        <span className="tr-trophy-hero">{age.hero}</span>
        <span className="tr-trophy-sub">{age.sub}</span>
      </div>
    </div>
  );
}
