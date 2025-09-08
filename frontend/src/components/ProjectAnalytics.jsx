import React, { useEffect, useMemo, useState } from "react";

export default function ProjectAnalytics({ projectId, getHeaders }) {
  const [overview, setOverview] = useState(null);
  const [series, setSeries] = useState([]);
  const [weeks, setWeeks] = useState(12);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const hasEstimates = useMemo(
    () => Number(overview?.est_total || 0) > 0,
    [overview?.est_total]
  );

  useEffect(() => {
    if (!projectId) return;
    (async () => {
      try {
        setLoading(true);
        setErr("");
        const [o, s] = await Promise.all([
          fetch(`/api/projects/${projectId}/overview`, {
            headers: await getHeaders(),
          }),
          fetch(
            `/api/projects/${projectId}/weekly-metrics?weeks=${encodeURIComponent(
              weeks
            )}`,
            { headers: await getHeaders() }
          ),
        ]);
        if (!o.ok) throw new Error(`overview ${o.status}`);
        if (!s.ok) throw new Error(`weekly ${s.status}`);
        const oCt = o.headers.get("content-type") || "";
        const sCt = s.headers.get("content-type") || "";
        const oText = await o.text();
        const sText = await s.text();
        if (!oCt.includes("application/json"))
          throw new Error(
            `overview non-JSON ${o.status} ct=${oCt} body=${oText.slice(
              0,
              120
            )}`
          );
        if (!sCt.includes("application/json"))
          throw new Error(
            `weekly non-JSON ${s.status} ct=${sCt} body=${sText.slice(0, 120)}`
          );
        try {
          setOverview(JSON.parse(oText));
        } catch (e) {
          throw new Error(
            `overview parse error: ${e?.message || e} body=${oText.slice(
              0,
              120
            )}`
          );
        }
        try {
          const parsed = JSON.parse(sText);
          setSeries(Array.isArray(parsed) ? parsed : []);
        } catch (e) {
          throw new Error(
            `weekly parse error: ${e?.message || e} body=${sText.slice(0, 120)}`
          );
        }
      } catch (e) {
        setErr(e?.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [projectId, weeks]);

  if (!projectId)
    return <div className="panel">プロジェクトを選択してください。</div>;
  if (loading) return <div className="panel">Loading…</div>;
  if (err)
    return (
      <div className="panel" style={{ color: "#b00" }}>
        Error: {err}
      </div>
    );

  return (
    <div className="panel" style={{ marginTop: 8 }}>
      <div
        className="row"
        style={{ justifyContent: "space-between", alignItems: "center" }}
      >
        <h3 style={{ margin: 0 }}>Analytics</h3>
        <div className="row" style={{ gap: 8 }}>
          <label>
            期間:
            <select
              value={weeks}
              onChange={(e) => setWeeks(Number(e.target.value))}
              style={{ marginLeft: 6 }}
            >
              <option value={4}>4週</option>
              <option value={8}>8週</option>
              <option value={12}>12週</option>
            </select>
          </label>
        </div>
      </div>

      {overview && (
        <div className="grid-3" style={{ gap: 12, marginTop: 12 }}>
          <Kpi
            label="進捗%"
            value={`${overview.progress_percent || 0}%`}
            hint={hasEstimates ? "見積り比" : "件数比"}
          />
          <Kpi
            label="完了/総数"
            value={`${overview.done || 0} / ${overview.total || 0}`}
          />
          <Kpi
            label="完了見積/総見積"
            value={`${overview.est_done || 0} / ${overview.est_total || 0} 分`}
          />
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <h4 style={{ margin: "8px 0" }}>週次トレンド</h4>
        {series && series.length ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "120px 1fr 80px 80px",
              gap: 8,
              alignItems: "center",
            }}
          >
            <HeaderCell>週開始</HeaderCell>
            <HeaderCell>累積進捗%</HeaderCell>
            <HeaderCell>完了数</HeaderCell>
            <HeaderCell>完了見積</HeaderCell>
            {series.map((w) => (
              <React.Fragment key={w.week_start}>
                <div style={{ color: "#555" }}>{w.week_start}</div>
                <Bar
                  percent={Math.max(
                    0,
                    Math.min(100, Number(w.cumulative_progress_percent || 0))
                  )}
                />
                <div style={{ textAlign: "right" }}>
                  {w.completed_count || 0}
                </div>
                <div style={{ textAlign: "right" }}>
                  {w.completed_estimated_minutes || 0}
                </div>
              </React.Fragment>
            ))}
          </div>
        ) : (
          <div style={{ color: "#777" }}>データがありません</div>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, hint }) {
  return (
    <div className="panel" style={{ padding: 12 }}>
      <div style={{ color: "#777", fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
      {hint && <div style={{ color: "#999", fontSize: 11 }}>{hint}</div>}
    </div>
  );
}

function HeaderCell({ children }) {
  return (
    <div style={{ fontWeight: 600, color: "#333", padding: "6px 0" }}>
      {children}
    </div>
  );
}

function Bar({ percent }) {
  return (
    <div
      style={{
        height: 12,
        background: "#f0f0f0",
        borderRadius: 6,
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          bottom: 0,
          width: `${percent}%`,
          background: percent >= 100 ? "#2e7d32" : "#1976d2",
          borderRadius: 6,
          transition: "width .2s",
        }}
      />
      <div
        style={{
          position: "absolute",
          right: 6,
          top: -2,
          fontSize: 11,
          color: "#333",
        }}
      >
        {percent}%
      </div>
    </div>
  );
}
