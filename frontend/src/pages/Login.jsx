import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

function getSession(k) {
  try {
    return window.sessionStorage.getItem(k) || "";
  } catch {
    return "";
  }
}
function setSession(k, v) {
  try {
    window.sessionStorage.setItem(k, v);
  } catch {}
}

export default function Login() {
  const [api, setApi] = useState(getSession("API_KEY"));
  const [uid, setUid] = useState(getSession("LINE_USER_ID"));
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/config");
        if (r.ok) {
          const c = await r.json();
          if (!uid && c.defaultLineUserId) setUid(c.defaultLineUserId);
        }
      } catch {}
      setLoading(false);
    })();
  }, []);

  function submit() {
    if (!api || !uid) return;
    setSession("API_KEY", api);
    setSession("LINE_USER_ID", uid);
    navigate("/app");
  }

  if (loading) return <div style={{ padding: 24 }}>Loading…</div>;

  return (
    <div
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: 480,
        margin: "0 auto",
        padding: 24,
      }}
    >
      <h2>ログイン</h2>
      <p style={{ color: "#555" }}>
        API_KEY と LINE User ID を入力してください。
      </p>
      <div style={{ display: "grid", gap: 8 }}>
        <input
          placeholder="API_KEY"
          value={api}
          onChange={(e) => setApi(e.target.value)}
        />
        <input
          placeholder="LINE User ID"
          value={uid}
          onChange={(e) => setUid(e.target.value)}
        />
        <button onClick={submit}>続ける</button>
      </div>
    </div>
  );
}
