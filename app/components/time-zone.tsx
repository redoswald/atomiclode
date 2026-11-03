"use client";

import { useEffect } from "react";
import { syncTimeZone } from "@/app/actions/progress";

/** Tells the server the browser's time zone once a session, so days and streaks use the learner's midnight. */
export function TimeZoneSync() {
  useEffect(() => {
    try {
      if (sessionStorage.getItem("dolomite-tz-synced")) return;
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      syncTimeZone(tz)
        .then((saved) => saved && sessionStorage.setItem("dolomite-tz-synced", "1"))
        .catch(() => {});
    } catch {}
  }, []);
  return null;
}
