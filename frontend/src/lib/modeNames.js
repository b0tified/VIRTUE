// Admin-editable mode names, shared by every screen that shows a mode name.
import { useEffect, useState } from "react";
import api from "@/api";

export const MODE_NAME_DEFAULTS = { casual: "Casual", ranked: "Ranked", bigffa: "12P FFA", party: "Party", practice: "Practice" };
let names = { ...MODE_NAME_DEFAULTS };
const subs = new Set();
let loading = null;

export function setModeNames(next) {
  if (!next) return;
  names = { ...MODE_NAME_DEFAULTS, ...next };
  subs.forEach((f) => f(names));
}

export function loadModeNames() {
  if (!loading) {
    loading = api.get("/modes/status").then(({ data }) => setModeNames(data?.names)).catch(() => {}).finally(() => {
      setTimeout(() => { loading = null; }, 30000);
    });
  }
  return loading;
}

export const modeName = (k) => names[k] || MODE_NAME_DEFAULTS[k] || k;

// Returns a lookup fn: n("ranked") -> "Ranked"; n("ranked", true) -> "RANKED".
export function useModeNames() {
  const [, setV] = useState(names);
  useEffect(() => {
    subs.add(setV);
    loadModeNames();
    return () => subs.delete(setV);
  }, []);
  return (k, upper = false) => (upper ? modeName(k).toUpperCase() : modeName(k));
}
