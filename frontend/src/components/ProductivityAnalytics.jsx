import React, { useEffect, useMemo, useState } from "react";

export default function ProductivityAnalytics({ userId, getHeaders }) {
  const [completionRate, setCompletionRate] = useState([]);
  const [productivityPatterns, setProductivityPatterns] = useState({
    hourly: [],
    weekly: [],
  });
  const [estimationAccuracy, setEstimationAccuracy] = useState({
    tasks: [],
    summary: {},
  });
  const [projectProgress, setProjectProgress] = useState([]);
  const [dailyReflection, setDailyReflection] = useState(null);
  const [selectedDate, setSelectedDate] = useState(
    () => new Date().toISOString().split("T")[0]
  );
  const [aiReflection, setAiReflection] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("completion");

  useEffect(() => {
    if (!userId) return;
    loadAllAnalytics();
  }, [userId]);

  async function loadAllAnalytics() {
    setLoading(true);
    try {
      await Promise.all([
        loadCompletionRate(),
        loadProductivityPatterns(),
        loadEstimationAccuracy(),
        loadProjectProgress(),
      ]);
    } catch (e) {
      console.error("Failed to load analytics:", e);
    } finally {
      setLoading(false);
    }
  }

  async function loadCompletionRate() {
    const r = await fetch(
      `/api/analytics/completion-rate?line_user_id=${encodeURIComponent(
        userId
      )}&days=30`,
      {
        headers: await getHeaders(),
      }
    );
    if (r.ok) setCompletionRate(await r.json());
  }

  async function loadProductivityPatterns() {
    const r = await fetch(
      `/api/analytics/productivity-patterns?line_user_id=${encodeURIComponent(
        userId
      )}&days=30`,
      {
        headers: await getHeaders(),
      }
    );
    if (r.ok) setProductivityPatterns(await r.json());
  }

  async function loadEstimationAccuracy() {
    const r = await fetch(
      `/api/analytics/estimation-accuracy?line_user_id=${encodeURIComponent(
        userId
      )}&days=30`,
      {
        headers: await getHeaders(),
      }
    );
    if (r.ok) setEstimationAccuracy(await r.json());
  }

  async function loadProjectProgress() {
    const r = await fetch(
      `/api/analytics/project-progress?line_user_id=${encodeURIComponent(
        userId
      )}&days=30`,
      {
        headers: await getHeaders(),
      }
    );
    if (r.ok) setProjectProgress(await r.json());
  }

  async function loadDailyReflection() {
    const r = await fetch(
      `/api/analytics/daily-reflection?line_user_id=${encodeURIComponent(
        userId
      )}&date=${selectedDate}`,
      {
        headers: await getHeaders(),
      }
    );
    if (r.ok) {
      const data = await r.json();
      setDailyReflection(data);
      generateAiReflection(data);
    }
  }

  async function generateAdvancedAIReflection() {
    try {
      setLoading(true);
      const r = await fetch("/api/analytics/ai-reflection", {
        method: "POST",
        headers: await getHeaders(),
        body: JSON.stringify({
          line_user_id: userId,
          date: selectedDate,
        }),
      });

      if (r.ok) {
        const result = await r.json();
        setAiReflection(result.reflection);
        setDailyReflection(result.data);
      } else {
        throw new Error(`AI reflection failed: ${r.status}`);
      }
    } catch (error) {
      console.error("Advanced AI reflection failed:", error);
      // フォールバック: シンプルな振り返りを生成
      if (dailyReflection) {
        generateAiReflection(dailyReflection);
      }
    } finally {
      setLoading(false);
    }
  }

  function generateAiReflection(data) {
    // シンプルなAI風振り返り生成
    const { summary, tasks, timeEntries } = data;

    let reflection = `📊 ${data.date} の振り返り\n\n`;

    // 完了状況の評価
    if (
      summary.completed_tasks === summary.total_tasks &&
      summary.total_tasks > 0
    ) {
      reflection += "🎉 素晴らしいです！今日は全てのタスクを完了できました。\n";
    } else if (
      summary.total_tasks > 0 &&
      summary.completed_tasks / summary.total_tasks >= 0.7
    ) {
      reflection += "👍 良い一日でした！多くのタスクを完了できています。\n";
    } else if (
      summary.failed_tasks > summary.completed_tasks &&
      summary.total_tasks > 0
    ) {
      reflection +=
        "⚠️ 今日は少し大変でしたね。明日はもう少しリラックスしたスケジュールを組んでみましょう。\n";
    }

    // 作業時間の分析
    const workHours = Math.floor(summary.total_work_time / 60);
    const workMins = summary.total_work_time % 60;
    if (summary.total_work_time > 0) {
      reflection += `\n⏱️ 今日の作業時間: ${workHours}時間${workMins}分\n`;

      if (summary.total_work_time > 480) {
        // 8時間以上
        reflection += "長時間お疲れさまでした。適度な休憩も大切です。\n";
      } else if (summary.total_work_time < 120) {
        // 2時間未満
        reflection +=
          "今日は軽めでしたね。明日はもう少し集中時間を増やせるかもしれません。\n";
      }
    }

    // 集中パターンの分析
    if (timeEntries.length > 0) {
      const avgSessionTime = Math.round(
        summary.total_work_time / summary.work_sessions
      );
      reflection += `\n🎯 平均集中時間: ${avgSessionTime}分\n`;

      if (avgSessionTime > 60) {
        reflection += "長時間集中できていますね！素晴らしい集中力です。\n";
      } else if (avgSessionTime < 15) {
        reflection +=
          "短いセッションが多いようです。25分間のポモドーロテクニックを試してみてはいかがでしょうか。\n";
      }
    }

    // 改善提案
    reflection += "\n💡 明日への提案:\n";
    if (summary.failed_tasks > 0) {
      reflection +=
        "• 失敗したタスクを見直して、より現実的な期限を設定してみましょう\n";
    }
    if (summary.work_sessions > 10) {
      reflection +=
        "• 作業の細切れが多いようです。まとまった時間を確保できると良いでしょう\n";
    }
    reflection += "• 今日の成果を振り返って、明日も良い一日にしましょう！\n";

    setAiReflection(reflection);
  }

  function formatDuration(minutes) {
    if (!minutes) return "0分";
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return hours > 0 ? `${hours}時間${mins}分` : `${mins}分`;
  }

  function renderChart(data, type, keyField) {
    if (!data || data.length === 0) return <div>データがありません</div>;

    const valueField =
      type === "rate"
        ? "completion_rate"
        : type === "time"
        ? "total_minutes"
        : "sessions";
    const maxValue = Math.max(...data.map((d) => d[valueField] || 0));

    return (
      <div className="chart-container">
        {data.map((item, index) => {
          const value = item[valueField] || 0;
          const height = maxValue > 0 ? (value / maxValue) * 100 : 0;
          const label = item[keyField] || item.date || index;

          return (
            <div
              key={index}
              className="chart-bar"
              title={`${label}: ${value}${
                type === "rate" ? "%" : type === "time" ? "分" : "セッション"
              }`}
            >
              <div
                className="chart-bar-fill"
                style={{
                  height: `${height}%`,
                  backgroundColor:
                    type === "rate"
                      ? "#4caf50"
                      : type === "time"
                      ? "#2196f3"
                      : "#ff9800",
                }}
              />
              <div className="chart-bar-label">{label}</div>
            </div>
          );
        })}
      </div>
    );
  }

  if (loading) return <div>読み込み中...</div>;

  return (
    <div className="productivity-analytics">
      <div className="analytics-tabs">
        <button
          className={activeTab === "completion" ? "active" : ""}
          onClick={() => setActiveTab("completion")}
        >
          📈 完了率推移
        </button>
        <button
          className={activeTab === "productivity" ? "active" : ""}
          onClick={() => setActiveTab("productivity")}
        >
          ⏰ 生産性パターン
        </button>
        <button
          className={activeTab === "estimation" ? "active" : ""}
          onClick={() => setActiveTab("estimation")}
        >
          🎯 見積精度
        </button>
        <button
          className={activeTab === "projects" ? "active" : ""}
          onClick={() => setActiveTab("projects")}
        >
          📁 プロジェクト進捗
        </button>
        <button
          className={activeTab === "reflection" ? "active" : ""}
          onClick={() => {
            setActiveTab("reflection");
            loadDailyReflection();
          }}
        >
          🤔 AI振り返り
        </button>
      </div>

      <div className="analytics-content">
        {activeTab === "completion" && (
          <div className="completion-section">
            <h3>完了率の推移（過去30日）</h3>
            {renderChart(completionRate, "rate", "date")}
          </div>
        )}

        {activeTab === "productivity" && (
          <div className="productivity-section">
            <h3>生産性パターン分析</h3>
            <div className="productivity-charts">
              <div className="chart-section">
                <h4>時間別作業パターン</h4>
                {renderChart(productivityPatterns.hourly, "time", "hour")}
              </div>
              <div className="chart-section">
                <h4>曜日別作業パターン</h4>
                {renderChart(
                  productivityPatterns.weekly,
                  "time",
                  "day_of_week"
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === "estimation" && (
          <div className="estimation-section">
            <h3>見積精度分析</h3>
            <div className="metrics-grid">
              <div className="metric-card">
                <div className="metric-value">
                  {estimationAccuracy.summary.total_tasks}
                </div>
                <div className="metric-label">分析対象タスク</div>
              </div>
              <div className="metric-card">
                <div className="metric-value">
                  {estimationAccuracy.summary.avg_accuracy}%
                </div>
                <div className="metric-label">平均精度</div>
              </div>
              <div className="metric-card">
                <div className="metric-value">
                  {estimationAccuracy.summary.underestimated}
                </div>
                <div className="metric-label">過小見積</div>
              </div>
              <div className="metric-card">
                <div className="metric-value">
                  {estimationAccuracy.summary.overestimated}
                </div>
                <div className="metric-label">過大見積</div>
              </div>
            </div>

            <div className="estimation-tasks">
              <h4>最近の見積精度</h4>
              <div className="task-list">
                {estimationAccuracy.tasks.slice(0, 10).map((task) => (
                  <div key={task.id} className="estimation-task">
                    <div className="task-info">
                      <div className="task-title">{task.title}</div>
                      <div className="task-times">
                        見積: {formatDuration(task.estimated_minutes)} | 実績:{" "}
                        {formatDuration(task.actual_minutes)} | 精度:{" "}
                        {task.accuracy_ratio}%
                      </div>
                    </div>
                    <div
                      className={`accuracy-indicator ${
                        task.accuracy_ratio >= 90 && task.accuracy_ratio <= 110
                          ? "good"
                          : task.accuracy_ratio >= 70 &&
                            task.accuracy_ratio <= 130
                          ? "fair"
                          : "poor"
                      }`}
                    >
                      {task.time_difference > 0
                        ? "↗️"
                        : task.time_difference < 0
                        ? "↘️"
                        : "✅"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === "projects" && (
          <div className="projects-section">
            <h3>プロジェクト別進捗</h3>
            <div className="project-list">
              {projectProgress.map((project) => (
                <div key={project.project_id} className="project-card">
                  <div className="project-header">
                    <h4>{project.project_name}</h4>
                    <div className="progress-bar">
                      <div
                        className="progress-fill"
                        style={{ width: `${project.completion_rate}%` }}
                      />
                      <span className="progress-text">
                        {project.completion_rate}%
                      </span>
                    </div>
                  </div>
                  <div className="project-stats">
                    <span>
                      完了: {project.completed_tasks}/{project.total_tasks}
                    </span>
                    <span>
                      見積: {formatDuration(project.total_estimated_minutes)}
                    </span>
                    <span>
                      実績: {formatDuration(project.total_actual_minutes)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "reflection" && (
          <div className="reflection-section">
            <div className="reflection-header">
              <h3>AI振り返りレポート</h3>
              <div className="row">
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                />
                <button onClick={loadDailyReflection}>データ取得</button>
                <button
                  onClick={generateAdvancedAIReflection}
                  disabled={loading}
                  style={{ background: "#9c27b0", color: "white" }}
                >
                  {loading ? "生成中..." : "🤖 AI分析"}
                </button>
              </div>
            </div>

            {dailyReflection && (
              <div className="reflection-content">
                <div className="daily-summary">
                  <h4>{selectedDate} のサマリー</h4>
                  <div className="metrics-grid">
                    <div className="metric-card">
                      <div className="metric-value">
                        {dailyReflection.summary.completed_tasks}
                      </div>
                      <div className="metric-label">完了タスク</div>
                    </div>
                    <div className="metric-card">
                      <div className="metric-value">
                        {dailyReflection.summary.failed_tasks}
                      </div>
                      <div className="metric-label">未完了タスク</div>
                    </div>
                    <div className="metric-card">
                      <div className="metric-value">
                        {formatDuration(
                          dailyReflection.summary.total_work_time
                        )}
                      </div>
                      <div className="metric-label">作業時間</div>
                    </div>
                    <div className="metric-card">
                      <div className="metric-value">
                        {dailyReflection.summary.work_sessions}
                      </div>
                      <div className="metric-label">作業セッション</div>
                    </div>
                  </div>
                </div>

                {aiReflection && (
                  <div className="ai-reflection">
                    <h4>🤖 AI振り返り</h4>
                    <div className="reflection-text">
                      {aiReflection.split("\n").map((line, index) => (
                        <div key={index}>{line}</div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
