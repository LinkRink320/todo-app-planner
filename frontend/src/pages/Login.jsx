import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

function getPersist(k) {
  try {
    return (
      window.localStorage.getItem(k) || window.sessionStorage.getItem(k) || ""
    );
  } catch {
    return "";
  }
}
function setPersist(k, v, remember) {
  try {
    if (remember) window.localStorage.setItem(k, v);
    else window.sessionStorage.setItem(k, v);
  } catch {}
}

export default function Login() {
  const [api, setApi] = useState(getPersist("API_KEY"));
  const [uid, setUid] = useState(getPersist("LINE_USER_ID"));
  const [remember, setRemember] = useState(
    () =>
      !!(
        typeof window !== "undefined" && window.localStorage.getItem("API_KEY")
      )
  );
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/config");
        if (r.ok) {
          const ct = r.headers.get("content-type") || "";
          const text = await r.text();
          if (ct.includes("application/json")) {
            const c = JSON.parse(text);
            if (!uid && c.defaultLineUserId) setUid(c.defaultLineUserId);
          }
        }
      } catch {}
      setLoading(false);
    })();
  }, []);

  async function submit() {
    if (!api || !uid) return;
    setPersist("API_KEY", api, remember);
    setPersist("LINE_USER_ID", uid, remember);
    try {
      if (
        remember &&
        typeof navigator !== "undefined" &&
        navigator.credentials &&
        window.PasswordCredential
      ) {
        const cred = new window.PasswordCredential({ id: uid, password: api });
        await navigator.credentials.store(cred);
      }
    } catch {}
    navigate("/app");
  }

  if (loading) return <div style={{ padding: 24 }}>Loading…</div>;

  return (
    <div className="container" style={{ maxWidth: 520 }}>
      <h2>ログイン</h2>
      <p style={{ color: "#555" }}>
        API_KEY と LINE User ID を入力してください。
      </p>
      <form
        method="post"
        autoComplete="on"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        style={{ display: "grid", gap: 8 }}
      >
        <input
          id="username"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          placeholder="LINE User ID"
          value={uid}
          onChange={(e) => setUid(e.target.value)}
        />
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="API_KEY"
          value={api}
          onChange={(e) => setApi(e.target.value)}
        />
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          ブラウザに記憶する（自動ログイン）
        </label>
        <button type="submit">続ける</button>
      </form>
    </div>
  );
}
