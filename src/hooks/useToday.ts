import { useEffect, useState } from "react";

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/**
 * Today, as the device's clock has it: read when the page opens, and again whenever it comes back
 * into view or an hour has passed, so a phone left open overnight on the Schedule does not go on
 * calling yesterday's games today's. The same object while the day is unchanged, so what is worked
 * out from it is not worked out again every hour.
 */
export function useToday(): Date {
  const [today, setToday] = useState(() => new Date());
  useEffect(() => {
    const look = () => {
      if (document.visibilityState === "hidden") return;
      const now = new Date();
      setToday((previous) => (sameDay(previous, now) ? previous : now));
    };
    document.addEventListener("visibilitychange", look);
    const hourly = window.setInterval(look, 60 * 60 * 1000);
    return () => {
      document.removeEventListener("visibilitychange", look);
      window.clearInterval(hourly);
    };
  }, []);
  return today;
}
