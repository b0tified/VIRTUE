import { createContext, useContext, useEffect, useState, useCallback } from "react";
import api, { formatApiErrorDetail } from "../api";

const AuthContext = createContext(null);
const CACHED_USER_KEY = "virtue.cachedUser";

function loadCachedUser() {
  try {
    const raw = localStorage.getItem(CACHED_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function saveCachedUser(u) {
  try {
    if (u && typeof u === "object") localStorage.setItem(CACHED_USER_KEY, JSON.stringify(u));
    else localStorage.removeItem(CACHED_USER_KEY);
  } catch {}
}

export function AuthProvider({ children }) {
  // null = still checking, false = anon, object = signed-in or cached
  const [user, setUser] = useState(null);
  const [accessToken, setAccessToken] = useState(null);

  const refreshMe = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
      saveCachedUser(data);
      return data;
    } catch (e) {
      // If we have a cached user AND the failure is a network error (offline),
      // keep using the cached profile so offline-vs-AI / practice still work.
      const networkErr = !e?.response;
      const cached = loadCachedUser();
      if (networkErr && cached) {
        setUser(cached);
        return cached;
      }
      setUser(false);
      saveCachedUser(null);
      return null;
    }
  }, []);

  useEffect(() => {
    refreshMe();
  }, [refreshMe]);

  // Presence heartbeat — pings backend every 20s so friends see this user as
  // online from any authenticated page (Lobby, Profile, Leaderboard, etc.).
  // The game WebSocket already counts presence while in a match.
  useEffect(() => {
    if (!user || user === false) return;
    let alive = true;
    const ping = () => { if (alive) api.post("/presence/heartbeat").catch(() => {}); };
    ping();
    const id = setInterval(ping, 20000);
    return () => { alive = false; clearInterval(id); };
  }, [user]);

  const login = async (email, password, opts = {}) => {
    try {
      const { data } = await api.post("/auth/login", {
        email,
        password,
        remember: opts.remember !== false,
      });
      setUser(data.user);
      setAccessToken(data.access_token);
      saveCachedUser(data.user);
      return { ok: true };
    } catch (e) {
      // Surface the structured ban payload (when the backend returns one)
      // so Login.jsx can render a dedicated "ACCOUNT BANNED" banner with
      // reason + expiry instead of a generic error string.
      const detail = e.response?.data?.detail;
      const ban = detail && typeof detail === "object" ? detail.ban : null;
      return {
        ok: false,
        error: formatApiErrorDetail(detail) || e.message,
        ban: ban || null,
      };
    }
  };

  const register = async (email, password, username) => {
    try {
      const { data } = await api.post("/auth/register", { email, password, username });
      setUser(data.user);
      setAccessToken(data.access_token);
      saveCachedUser(data.user);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: formatApiErrorDetail(e.response?.data?.detail) || e.message };
    }
  };

  const logout = async () => {
    try {
      await api.post("/auth/logout");
    } catch {}
    setUser(false);
    setAccessToken(null);
    saveCachedUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, accessToken, login, register, logout, refreshMe }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
