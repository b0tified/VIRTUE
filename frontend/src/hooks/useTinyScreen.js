import { useEffect, useState } from "react";

const QUERY = "(max-height: 500px)";

// True on short screens (e.g. phones held sideways).
export default function useTinyScreen() {
  const [tiny, setTiny] = useState(() => typeof window !== "undefined" && window.matchMedia(QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const onChange = () => setTiny(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return tiny;
}
