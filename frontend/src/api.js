import axios from "axios";

export const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

const api = axios.create({
  baseURL: API,
  withCredentials: true,
});

export function formatApiErrorDetail(detail) {
  if (detail == null) return "Something went wrong. Please try again.";
  if (typeof detail === "string") return detail;
  // Ban payload from /auth/login — surface a friendly message with the
  // reason + suspension end-time when present.
  if (detail && typeof detail === "object" && detail.ban) {
    const b = detail.ban;
    const verb = b.status === "banned" ? "permanently banned" : "suspended";
    const until = b.until ? ` until ${new Date(b.until).toLocaleString()}` : "";
    const reason = b.reason ? ` Reason: ${b.reason}` : "";
    return `Your account is ${verb}${until}.${reason}`;
  }
  if (Array.isArray(detail))
    return detail
      .map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e)))
      .filter(Boolean)
      .join(" ");
  if (detail && typeof detail.msg === "string") return detail.msg;
  return String(detail);
}

export default api;
