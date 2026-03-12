const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1"]);
const API_BASE_OVERRIDE_KEY = "ag_api_base_override";

function readApiBaseOverride() {
  try {
    const url = new URL(window.location.href);
    const queryValue = url.searchParams.get("apiBase");

    if (queryValue) {
      localStorage.setItem(API_BASE_OVERRIDE_KEY, queryValue);
      return queryValue;
    }

    return localStorage.getItem(API_BASE_OVERRIDE_KEY) || "";
  } catch {
    return "";
  }
}

export function getApiBase() {
  const override = readApiBaseOverride();

  if (override) {
    return override.replace(/\/+$/, "");
  }

  if (LOCAL_HOSTNAMES.has(window.location.hostname)) {
    return "http://localhost:5000/api";
  }

  return `${window.location.origin}/api`;
}

export function getCurrentUrl() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export function getLoginUrl(redirect = "") {
  const url = new URL("/Public/login.html", window.location.origin);

  if (redirect) {
    url.searchParams.set("redirect", redirect);
  }

  return url.toString();
}

export function redirectToLogin({ preserveCurrent = false, redirect = "" } = {}) {
  const nextRedirect = preserveCurrent ? getCurrentUrl() : redirect;
  window.location.href = getLoginUrl(nextRedirect);
}
