import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    try {
      fetch("/api/logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          line_user_id: "frontend",
          type: "check",
          note: `error: ${error?.message || String(error)}\ninfo: ${
            info?.componentStack || ""
          }`,
        }),
      }).catch(() => {});
    } catch {}
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 16 }}>
          <div className="alert error" style={{ marginBottom: 8 }}>
            画面の表示で問題が発生しました。
          </div>
          <div style={{ color: "#555", fontSize: 14 }}>
            {this.state.error?.message || "Unknown error"}
          </div>
          <div style={{ marginTop: 8 }}>
            可能であればリロードしてください。改善しない場合は開発者にこのメッセージを共有してください。
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
